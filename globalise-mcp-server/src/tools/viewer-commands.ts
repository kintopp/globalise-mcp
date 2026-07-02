/**
 * `globalise_navigate_viewer` + `globalise_poll_viewer_commands` — the
 * LLM→viewer reverse channel (plan 021, rijksmuseum-mcp-plus
 * `src/registration/tools/viewer.ts` `navigate_viewer` parity).
 *
 * The model pushes viewer commands (zoom to a region, add/clear labelled
 * overlays) into a server-side per-viewUUID queue; the iframe drains it by
 * polling `globalise_poll_viewer_commands`. Registration stays in index.ts
 * (repo convention); this module holds the schemas + handler logic.
 */

import { z } from 'zod';
import {
  IIIF_REGION_RE, parsePctRegion, cropPixelsToIiifPixels, checkRegionBounds,
  projectToFullImage, regionToPixels, computeVerificationRegion, computeDeliveryState,
  type DeliveryState,
} from '../utils/iiif.js';
import { viewerQueues, ACTIVE_OVERLAYS_CAP, type ViewerCommand } from '../utils/viewer-session.js';

export const navigateViewerInputSchema = z.object({
  viewUUID: z.string().describe('Viewer UUID from a prior globalise_view_document_ui call'),
  commands: z.array(z.object({
    action: z.enum(['navigate', 'add_overlay', 'clear_overlays']),
    region: z.string().optional().describe("IIIF region (required for navigate/add_overlay): 'full', 'square', 'pct:x,y,w,h', 'crop_pixels:x,y,w,h', or 'x,y,w,h'"),
    relativeTo: z.string().optional().describe(
      "Crop region from a prior globalise_inspect_page_image call. When provided, " +
      "'region' is interpreted as coordinates within that crop's local space and " +
      'projected to full-image space by the server. Use pct: region values directly, ' +
      'or crop_pixels: values with relativeToSize from globalise_inspect_page_image.'),
    relativeToSize: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict().optional().describe(
      'Actual pixel dimensions of the inspected crop, copied from ' +
      'globalise_inspect_page_image cropPixelWidth/cropPixelHeight. Required when ' +
      'relativeTo is set and region uses crop_pixels:.'),
    label: z.string().optional().describe('Label text for add_overlay'),
    color: z.string().optional().describe('CSS color for the add_overlay border (default: orange)'),
  })).min(1).describe('Commands to execute in the viewer, in order'),
});

export const navigateViewerOutputSchema = z.object({
  viewUUID: z.string(),
  documentId: z.string().optional()
    .describe('Document ID of the page in this viewer session — the identity needed for the show_overlays verify-after call.'),
  queued: z.number().int(),
  regionRecovery: z.object({
    requested: z.string().describe('The offending region exactly as supplied.'),
    clampedTo: z.string().describe('An in-bounds replacement region — retry with this, or a corrected box within validRange.'),
    validRange: z.string().describe('Human-readable valid coordinate range.'),
  }).optional()
    .describe('Out-of-bounds recovery hint. Present only on a region-out-of-bounds error — mirrors the recovery payload the text channel renders, so a structuredContent reader can self-correct without parsing prose.'),
  imageWidth: z.number().int().optional(),
  imageHeight: z.number().int().optional(),
  overlays: z.array(z.object({
    label: z.string().optional(),
    region: z.string(),
    pixelRect: z.string().optional(),
    verificationRegion: z.string().optional()
      .describe('Ready-to-paste pct: crop centred on this overlay (≥12% per axis). Use with globalise_inspect_page_image(show_overlays:true, region:<this>, viewUUID:<same UUID>) to verify placement after add_overlay.'),
  })).optional(),
  currentOverlays: z.array(z.object({
    label: z.string().optional(),
    region: z.string(),
    color: z.string().optional(),
  })).optional(),
  pendingCommandCount: z.number().int().optional()
    .describe('Commands sitting in the queue that the iframe has not yet drained.'),
  lastPolledAt: z.string().optional()
    .describe("ISO timestamp of the iframe's last poll. Absent if the iframe has never polled this session."),
  recentlyPolledByViewer: z.boolean().optional()
    .describe('True if the iframe polled within the last 5s.'),
  deliveryState: z.enum(['delivered_recently', 'queued_waiting_for_viewer', 'no_live_viewer_seen']).optional()
    .describe("Server's view of command delivery: delivered, queued for an existing-but-offscreen viewer, or no viewer ever connected."),
  error: z.string().optional(),
});

export const pollViewerCommandsOutputSchema = z.object({
  commands: z.array(z.object({
    action: z.enum(['navigate', 'add_overlay', 'clear_overlays']),
    region: z.string().optional(),
    label: z.string().optional(),
    color: z.string().optional(),
  })).describe('Pending viewer commands drained from the queue, in order. Empty when nothing is queued.'),
});

type NavigateViewerData = z.infer<typeof navigateViewerOutputSchema>;

export type NavigateViewerResult =
  | { ok: true; data: NavigateViewerData; text: string }
  | { ok: false; data: NavigateViewerData; text: string };

/**
 * Push commands into a viewer's queue and report delivery state (port of
 * rijksmuseum `navigate_viewer`'s seven behaviors: missing-queue retry,
 * validation chain, OOB reject with recovery, relativeTo projection,
 * crop_pixels stripping, queue + shadow overlays, response shape).
 */
export async function navigateViewer(
  input: z.output<typeof navigateViewerInputSchema>,
): Promise<NavigateViewerResult> {
  const navError = (error: string, text: string, recovery?: { requested: string; clampedTo: string; validRange: string }, documentId?: string): NavigateViewerResult => ({
    ok: false,
    data: {
      viewUUID: input.viewUUID,
      queued: 0,
      error,
      ...(documentId && { documentId }),
      ...(recovery && { regionRecovery: recovery }),
    },
    text,
  });

  // 1. Missing-queue retry — claude.ai sends the view mount and a navigate as
  //    concurrent HTTP POSTs; the Map lookup (0ms) can race ahead of the mint
  //    (~25-30ms) that sets the UUID. Three retries at 100ms cover it.
  let queue = viewerQueues.get(input.viewUUID);
  if (!queue) {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 100));
      queue = viewerQueues.get(input.viewUUID);
      if (queue) break;
    }
  }
  if (!queue) {
    return navError(
      'No active viewer for this UUID',
      'No active viewer for this UUID — open a page with globalise_view_document_ui first',
    );
  }

  // 2. Validation chain — navigate/add_overlay require a region; relativeTo must
  //    be pct:; relativeToSize requires relativeTo; relativeTo + crop_pixels
  //    requires relativeToSize; relativeToSize only with crop_pixels.
  const commands: ViewerCommand[] = input.commands.map((c) => ({ ...c }));
  for (const cmd of commands) {
    if (cmd.action === 'navigate' || cmd.action === 'add_overlay') {
      if (!cmd.region) {
        const m = `'${cmd.action}' requires a region. Use 'full', 'square', 'x,y,w,h', 'pct:x,y,w,h', or 'crop_pixels:x,y,w,h'.`;
        return navError(m, m, undefined, queue.documentId);
      }
      if (!IIIF_REGION_RE.test(cmd.region)) {
        const m = `Invalid region '${cmd.region}'. Use 'full', 'square', 'x,y,w,h', 'pct:x,y,w,h', or 'crop_pixels:x,y,w,h'.`;
        return navError(m, m, undefined, queue.documentId);
      }
    }
    if (cmd.relativeTo && !parsePctRegion(cmd.relativeTo)) {
      const m = `Invalid relativeTo '${cmd.relativeTo}'. Must be in pct:x,y,w,h format.`;
      return navError(m, m, undefined, queue.documentId);
    }
    if (cmd.relativeToSize && !cmd.relativeTo) {
      const m = 'relativeToSize requires relativeTo. Use it with a crop region from globalise_inspect_page_image.';
      return navError(m, m, undefined, queue.documentId);
    }
    if (cmd.relativeTo && cmd.region?.startsWith('crop_pixels:') && !cmd.relativeToSize) {
      const m = 'relativeTo + crop_pixels requires relativeToSize. Copy { width: cropPixelWidth, height: cropPixelHeight } from the globalise_inspect_page_image response.';
      return navError(m, m, undefined, queue.documentId);
    }
    if (cmd.relativeTo && cmd.relativeToSize && !cmd.region?.startsWith('crop_pixels:')) {
      const m = 'relativeToSize is only valid when region uses crop_pixels:. Omit relativeToSize for pct: crop-local coordinates.';
      return navError(m, m, undefined, queue.documentId);
    }
  }

  // 3. OOB reject — reject rather than silent-clamp. Skip when relativeTo is
  //    used (validated post-projection below).
  for (const cmd of commands) {
    if (cmd.action !== 'navigate' && cmd.action !== 'add_overlay') continue;
    if (!cmd.region) continue;
    if (cmd.relativeTo) continue;
    const oob = checkRegionBounds(cmd.region, queue.imageWidth, queue.imageHeight);
    if (oob) {
      return navError(
        `Region out of bounds: ${oob.issue}`,
        `Region out of bounds: ${oob.issue}. Your coordinates fall outside valid bounds — re-examine the page and retry with a corrected bounding box. Nearest valid region: ${oob.clampedTo} (${oob.validRange}).`,
        { requested: oob.requested, clampedTo: oob.clampedTo, validRange: oob.validRange },
        queue.documentId,
      );
    }
  }

  // 4. Project relativeTo (crop-local) coordinates to full-image space, then
  //    OOB-check the projection.
  for (const cmd of commands) {
    if (cmd.relativeTo && cmd.region) {
      if (cmd.region.startsWith('crop_pixels:') && cmd.relativeToSize) {
        const localOob = checkRegionBounds(cmd.region, cmd.relativeToSize.width, cmd.relativeToSize.height);
        if (localOob) {
          return navError(
            `Region out of bounds: ${localOob.issue}`,
            `Region out of bounds: ${localOob.issue}. Your crop-local pixel coordinates fall outside the inspected crop dimensions — re-examine the crop and retry with a corrected bounding box. Nearest valid region: ${localOob.clampedTo} (${localOob.validRange}).`,
            { requested: localOob.requested, clampedTo: localOob.clampedTo, validRange: localOob.validRange },
            queue.documentId,
          );
        }
      }
      const projected = projectToFullImage(cmd.region, cmd.relativeTo, cmd.relativeToSize);
      if (!projected) {
        const m = `relativeTo requires 'relativeTo' in pct: format and 'region' in pct: format, or crop_pixels: format with relativeToSize. Got region='${cmd.region}', relativeTo='${cmd.relativeTo}'.`;
        return navError(m, m, undefined, queue.documentId);
      }
      cmd.region = projected;
      const oobPost = checkRegionBounds(cmd.region);
      if (oobPost) {
        return navError(
          `Region out of bounds: ${oobPost.issue}`,
          `Region out of bounds: ${oobPost.issue}. Projected coordinates fall outside 0-100 — the source region or relativeTo box extends outside the image. Nearest valid region: ${oobPost.clampedTo} (${oobPost.validRange}).`,
          { requested: oobPost.requested, clampedTo: oobPost.clampedTo, validRange: oobPost.validRange },
          queue.documentId,
        );
      }
    }
    delete cmd.relativeTo;      // never forward to the viewer
    delete cmd.relativeToSize;  // never forward to the viewer
  }

  // 5. Strip crop_pixels: prefix before forwarding — the viewer understands
  //    plain IIIF pixels.
  for (const cmd of commands) {
    if (cmd.region?.startsWith('crop_pixels:')) {
      const plain = cropPixelsToIiifPixels(cmd.region);
      if (plain) cmd.region = plain;
    }
  }

  // 6. Queue + maintain the server-side shadow overlay list (capped at 64 so a
  //    long session can't grow it unboundedly — the compositor iterates all
  //    entries on every show_overlays call).
  queue.commands.push(...commands);
  queue.lastAccess = Date.now();
  for (const cmd of commands) {
    if (cmd.action === 'clear_overlays') queue.activeOverlays = [];
    else if (cmd.action === 'add_overlay') {
      queue.activeOverlays.push({ label: cmd.label, region: cmd.region!, color: cmd.color });
      if (queue.activeOverlays.length > ACTIVE_OVERLAYS_CAP) {
        queue.activeOverlays = queue.activeOverlays.slice(-ACTIVE_OVERLAYS_CAP);
      }
    }
  }

  // 7. Response — per-overlay pixelRect + verificationRegion, delivery state,
  //    per-state narration + a verify-after nudge.
  const overlayDetails = (queue.imageWidth && queue.imageHeight)
    ? commands
        .filter((c) => c.action === 'add_overlay')
        .map((c) => ({
          label: c.label,
          region: c.region!,
          pixelRect: regionToPixels(c.region!, queue!.imageWidth!, queue!.imageHeight!),
          verificationRegion: computeVerificationRegion(c.region!, queue!.imageWidth, queue!.imageHeight),
        }))
    : undefined;

  const now = Date.now();
  const deliveryState: DeliveryState = computeDeliveryState(queue.lastPolledAt, now);
  const recentlyPolledByViewer = deliveryState === 'delivered_recently';

  const data: NavigateViewerData = {
    viewUUID: input.viewUUID,
    documentId: queue.documentId,
    queued: commands.length,
    imageWidth: queue.imageWidth,
    imageHeight: queue.imageHeight,
    overlays: overlayDetails?.length ? overlayDetails : undefined,
    currentOverlays: queue.activeOverlays.length ? queue.activeOverlays : undefined,
    pendingCommandCount: queue.commands.length,
    lastPolledAt: queue.lastPolledAt != null ? new Date(queue.lastPolledAt).toISOString() : undefined,
    recentlyPolledByViewer,
    deliveryState,
  };

  const overlayCount = queue.activeOverlays.length;
  const overlayClause = overlayCount ? ` | ${overlayCount} active overlays` : '';
  const shortUuid = input.viewUUID.slice(0, 8);
  const baseText = (() => {
    switch (deliveryState) {
      case 'delivered_recently':
        return `Delivered ${commands.length} commands to active viewer ${shortUuid}${overlayClause}`;
      case 'queued_waiting_for_viewer':
        return `Queued ${commands.length} commands for viewer ${shortUuid} (offscreen or paused — overlay state preserved, will apply when viewer resumes polling)${overlayClause}`;
      case 'no_live_viewer_seen':
        return `Queued ${commands.length} commands for viewer ${shortUuid} (no viewer has connected yet)${overlayClause}`;
    }
  })();

  // Verify-and-adjust nudge: fires when the batch added an overlay AND the
  // queue has dims (so verificationRegion is computable). Surfaces the exact
  // pct: crop to pass to globalise_inspect_page_image(show_overlays:true).
  const verifiable = overlayDetails?.filter((o) => o.verificationRegion) ?? [];
  const nudge = verifiable.length && queue.documentId
    ? (() => {
      const pairs = verifiable
        .map((o) => `${o.label ? `"${o.label}" → ` : ''}${o.verificationRegion}`)
        .join('; ');
      return (
        ` | Verify each overlay with globalise_inspect_page_image(documentId:"${queue.documentId}", show_overlays:true, viewUUID:"${input.viewUUID}", region:"<verificationRegion>"): ${pairs}. ` +
        'To reposition, issue clear_overlays then re-add ALL overlays with corrected coordinates (append-only — there is no move/delete-one).'
      );
    })()
    : '';

  return { ok: true, data, text: baseText + nudge };
}
