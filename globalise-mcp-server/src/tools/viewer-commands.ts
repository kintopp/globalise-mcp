/**
 * `globalise_navigate_viewer` + `globalise_poll_viewer_commands` — the
 * LLM→viewer reverse channel (plan 021, rijksmuseum-mcp-plus
 * `src/registration/tools/viewer.ts` `navigate_viewer` parity).
 *
 * The model pushes viewer commands (zoom/pan to a region) into a server-side
 * per-viewUUID queue; the iframe drains it by polling
 * `globalise_poll_viewer_commands`. Registration stays in index.ts (repo
 * convention); this module holds the schemas + handler logic.
 */

import { z } from 'zod';
import {
  IIIF_REGION_RE, parsePctRegion, cropPixelsToIiifPixels, checkRegionBounds,
  projectToFullImage, computeDeliveryState,
  type DeliveryState,
} from '../utils/iiif.js';
import { viewerQueues, type ViewerCommand } from '../utils/viewer-session.js';

export const navigateViewerInputSchema = z.object({
  viewUUID: z.string().describe('Viewer UUID from a prior globalise_view_document_ui call'),
  commands: z.array(z.object({
    action: z.enum(['navigate']).describe(
      "Command type: 'navigate' zooms/pans the viewer to a region (needs region)."),
    region: z.string().optional().describe("IIIF region (required for navigate): 'full', 'square', 'pct:x,y,w,h', 'crop_pixels:x,y,w,h', or 'x,y,w,h'"),
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
  })).min(1).describe('Commands to execute in the viewer, in order'),
});

export const navigateViewerOutputSchema = z.object({
  viewUUID: z.string(),
  documentId: z.string().optional()
    .describe('Document ID of the page in this viewer session.'),
  queued: z.number().int(),
  regionRecovery: z.object({
    requested: z.string().describe('The offending region exactly as supplied.'),
    clampedTo: z.string().describe('An in-bounds replacement region — retry with this, or a corrected box within validRange.'),
    validRange: z.string().describe('Human-readable valid coordinate range.'),
  }).optional()
    .describe('Out-of-bounds recovery hint. Present only on a region-out-of-bounds error — mirrors the recovery payload the text channel renders, so a structuredContent reader can self-correct without parsing prose.'),
  imageWidth: z.number().int().optional(),
  imageHeight: z.number().int().optional(),
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
    action: z.enum(['navigate']),
    region: z.string().optional(),
  })).describe('Pending viewer commands drained from the queue, in order. Empty when nothing is queued.'),
});

type NavigateViewerData = z.infer<typeof navigateViewerOutputSchema>;

export type NavigateViewerResult =
  | { ok: true; data: NavigateViewerData; text: string }
  | { ok: false; data: NavigateViewerData; text: string };

/**
 * Push commands into a viewer's queue and report delivery state (port of
 * rijksmuseum `navigate_viewer`'s behaviors: missing-queue retry, validation
 * chain, OOB reject with recovery, relativeTo projection, crop_pixels
 * stripping, queue, response shape).
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
      'Unknown or expired viewUUID',
      'Unknown or expired viewUUID — no queue exists for it (sessions expire after ~30 min idle). Open the page again with globalise_view_document_ui and use the fresh viewUUID it returns.',
    );
  }

  // 2. Validation chain — navigate requires a region; relativeTo must be pct:;
  //    relativeToSize requires relativeTo; relativeTo + crop_pixels requires
  //    relativeToSize; relativeToSize only with crop_pixels.
  const commands: ViewerCommand[] = input.commands.map((c) => ({ ...c }));
  for (const cmd of commands) {
    if (cmd.action === 'navigate') {
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

  // 6. Queue the commands for the iframe to drain.
  queue.commands.push(...commands);
  queue.lastAccess = Date.now();

  // 7. Response — delivery state + per-state narration.
  const now = Date.now();
  const deliveryState: DeliveryState = computeDeliveryState(queue.lastPolledAt, now);
  const recentlyPolledByViewer = deliveryState === 'delivered_recently';

  const data: NavigateViewerData = {
    viewUUID: input.viewUUID,
    documentId: queue.documentId,
    queued: commands.length,
    imageWidth: queue.imageWidth,
    imageHeight: queue.imageHeight,
    pendingCommandCount: queue.commands.length,
    lastPolledAt: queue.lastPolledAt != null ? new Date(queue.lastPolledAt).toISOString() : undefined,
    recentlyPolledByViewer,
    deliveryState,
  };

  const shortUuid = input.viewUUID.slice(0, 8);
  const baseText = (() => {
    switch (deliveryState) {
      case 'delivered_recently':
        return `Delivered ${commands.length} commands to active viewer ${shortUuid}`;
      case 'queued_waiting_for_viewer':
        return `Queued ${commands.length} commands for viewer ${shortUuid} (offscreen or paused — will apply when viewer resumes polling)`;
      case 'no_live_viewer_seen': {
        const ageSecs = Math.round((now - queue.createdAt) / 1000);
        // Young queue: the iframe simply hasn't connected yet — benign. Old
        // queue with zero polls ever: the host's app bridge most likely does
        // not support app-initiated tool calls (serverTools), so the reverse
        // channel cannot work there at all — say so instead of promising a
        // first poll that will never come (2026-08-03 stdio test report §4.3).
        if (ageSecs > 30) {
          return `Queued ${commands.length} commands for viewer ${shortUuid}, but its iframe has never polled in the ${ageSecs}s since it was opened. If the widget is visibly rendered, this host's MCP Apps bridge likely does not support app-initiated tool calls (serverTools capability), and queued viewer commands will never be delivered here. Do not keep re-sending; to show the user a detail, use globalise_inspect_page_image (its returned image works on every host) or share the region as a viewer link.`;
        }
        return `Queued ${commands.length} commands for viewer ${shortUuid} — the viewUUID is valid but its iframe has not started polling yet (typical right after globalise_view_document_ui returns; the widget usually connects within a few seconds of rendering). The commands are held and will apply on its first poll — no retry needed.`;
      }
    }
  })();

  return { ok: true, data, text: baseText };
}
