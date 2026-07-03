/**
 * GLOBALISE Document Viewer - MCP App Client
 *
 * Interactive viewer for VOC transcription pages with:
 * - IIIF scanned images via OpenSeadragon
 * - Transcribed text with search term highlighting
 * - Page navigation (prev/next)
 * - Theme integration with host
 *
 * Follows MCP Apps SDK patterns with all lifecycle handlers.
 */

// Bundled from node_modules and inlined by Vite (R11) — the built viewer has
// no runtime CDN dependencies. app-with-deps is upstream's self-contained
// browser entry, so zod and the MCP SDK stay out of our bundle graph.
//
// OpenSeadragon 6.x renders the image pane with WebGL by default, falling back
// to canvas when WebGL is unavailable (the OSD 5.0 change). Its WebGL drawer is
// why the inlined single-file bundle is ~0.68 MB.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from '@modelcontextprotocol/ext-apps/app-with-deps';
import OpenSeadragon from 'openseadragon';

// Server↔viewer wire contract. ViewDocumentUiOutput is the server's own
// zod-inferred type, so the contract is defined ONCE: a server-side field
// rename changes the type the viewer sees instead of silently diverging from a
// hand-copied interface (CODE-REVIEW finding 10). `import type` is erased by
// esbuild, so zod and the rest of the server graph stay out of the viewer
// bundle. DocumentData stays a local alias to avoid churning every use site.
// ArchivalContext and the pure render helpers are imported via render.ts now.
import type { ViewDocumentUiOutput } from '../../../src/tools/document-viewer.js';
import { parseDocumentResult, type ParseableToolResult } from './parse-result.js';
import {
  escapeHtml,
  sanitizeUrl,
  renderTranscription,
  headerInnerHtml,
  pageInfoText,
} from './render.js';

type DocumentData = ViewDocumentUiOutput;

// App state
let currentDocument: DocumentData | null = null;
let seedDocumentId: string | null = null;
let viewer: OpenSeadragon.Viewer | null = null;
let isFullscreen = false;
let visibilityObserver: IntersectionObserver | null = null;
let viewerNeedsRebuild = false;  // read by swapDocument's guard; SET only by the latest open's failure
let openSeq = 0;                 // bumped before every open; lets a late failure tell whether it is still current
let pendingOpenFailed: (() => void) | null = null; // the current open's failure handler (held by reference so it can be removed before the next open is armed)

// Selection mode state (user-highlight → chat region token; plan 020)
let selectMode = false;
let selectionTracker: OpenSeadragon.MouseTracker | null = null;
let dragStart: OpenSeadragon.Point | null = null;
let selectionOverlay: HTMLDivElement | null = null;
let userHighlightEl: HTMLElement | null = null;

const HIGHLIGHT_STROKE = 'rgba(59,130,246,0.8)';
const HIGHLIGHT_FILL = 'rgba(59,130,246,0.12)';

// Reverse-channel state (LLM→viewer commands; plan 021). The view tool mints a
// viewUUID + server-side command queue; this iframe polls
// globalise_poll_viewer_commands and executes drained commands (zoom/pan to a
// region). Only coordinates cross the wire.
let viewUUID: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollGen = 0;
const overlayElements: HTMLElement[] = [];

// Initialize the MCP App with capabilities.
//
// The view exposes no app-side tools (no app.registerTool calls), so it must
// NOT advertise the `tools` capability: a spec-conformant host that sees
// `appCapabilities.tools` may issue `tools/list` to the view, which the SDK
// answers with "No handler for method tools/list registered". On Safari that
// stray error round-trip races the handshake and suppresses delivery of the
// ontoolresult notification, leaving the viewer stuck on "Fetching document"
// (Chrome/native app happen to interleave the messages survivably). Declare
// only what the view actually implements: the supported display modes.
const app = new App(
  { name: 'GLOBALISE Document Viewer', version: '1.0.0' },
  { availableDisplayModes: ['inline', 'fullscreen'] },
  { autoResize: true }
);

/**
 * Handle streaming partial input during LLM generation
 * Shows loading state with partial document ID as it streams in
 */
app.ontoolinputpartial = (params) => {
  const args = params.arguments as { documentId?: string } | undefined;
  const docId = args?.documentId || '...';

  showLoading(`Loading document: ${docId}`);

  app.sendLog({ level: 'info', data: `Partial input: ${docId}` });
};

/**
 * Handle full tool input (tool execution about to start)
 * Update loading state with complete document ID
 */
app.ontoolinput = (params) => {
  const args = params.arguments as { documentId?: string } | undefined;
  const docId = args?.documentId || 'unknown';

  showLoading(`Fetching document: ${docId}`);

  app.sendLog({ level: 'info', data: `Full input received: ${docId}` });
};

/**
 * Handle tool result from the server
 * Parse JSON and render the document viewer
 */
app.ontoolresult = (result) => {
  app.sendLog({ level: 'info', data: 'Tool result received' });

  // Check for error. The server's errorResponse emits JSON.stringify({error,
  // suggestion, tool}) as the text, so parse it and surface the message +
  // suggestion rather than dumping the raw envelope at the user (CODE-REVIEW
  // finding 9). Any other (non-JSON) error text is shown verbatim.
  if (result.isError) {
    const first = result.content?.[0];
    const raw = (first?.type === 'text' ? first.text : undefined) || 'Unknown error';
    let message = raw;
    let suggestion: string | undefined;
    try {
      const parsed = JSON.parse(raw) as { error?: string; suggestion?: string };
      if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
        message = parsed.error;
        suggestion = parsed.suggestion;
      }
    } catch {
      // not JSON — show the raw text as-is
    }
    showError('Error loading document', message, suggestion);
    return;
  }

  // Extract the document payload (structuredContent first, then content
  // fallbacks). The parse logic lives in parse-result.ts so it can be
  // unit-tested under node against a server-built payload (finding 10).
  const data = parseDocumentResult(result as ParseableToolResult);

  if (data) {
    if (!seedDocumentId) seedDocumentId = data.id;
    currentDocument = data;
    adoptViewSession(data);
    renderDocument(data);
    updateModelContext(data);
  } else {
    showError('Error parsing document', 'Could not parse document data from tool result');
  }
};

/**
 * Adopt the viewer session (plan 021): when the server returns a viewUUID that
 * differs from the one we're tracking, store it and (re)start the command poll.
 * A fresh mint or a first open both trigger polling; an in-place page swap that
 * preserved the UUID leaves the existing poll untouched.
 */
function adoptViewSession(data: DocumentData): void {
  if (data.viewUUID && data.viewUUID !== viewUUID) {
    viewUUID = data.viewUUID;
    startPolling();
  }
}

/**
 * Apply host context settings (theme, styles, safe areas, display mode)
 */
function applyHostContext(params: Parameters<NonNullable<typeof app.onhostcontextchanged>>[0]): void {
  if (params.theme) {
    applyDocumentTheme(params.theme);
  }

  if (params.styles?.variables) {
    applyHostStyleVariables(params.styles.variables);
  }

  if (params.styles?.css?.fonts) {
    applyHostFonts(params.styles.css.fonts);
  }

  if (params.safeAreaInsets) {
    const { top, right, bottom, left } = params.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }

  if (params.displayMode) {
    isFullscreen = params.displayMode === 'fullscreen';
    document.querySelector('.main')?.classList.toggle('fullscreen', isFullscreen);
  }
}

/**
 * Handle host context changes (theme, safe areas, display mode)
 */
app.onhostcontextchanged = applyHostContext;

/**
 * Handle app teardown - return viewer state
 */
app.onteardown = async () => {
  stopPolling();
  teardownSelectionTracker();

  // Return current viewer state for potential restoration
  const state: Record<string, unknown> = {};

  if (currentDocument) {
    state.documentId = currentDocument.id;
    state.highlightTerms = currentDocument.highlight;
  }

  if (viewer) {
    const viewport = viewer.viewport;
    state.zoom = viewport.getZoom();
    state.center = viewport.getCenter();
  }

  return state;
};

/**
 * Show loading state
 */
function showLoading(message: string): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  appEl.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/** Apply prev/next button disabled + title from a document's navigation. */
function setNavButtonState(
  prevBtn: HTMLButtonElement | null,
  nextBtn: HTMLButtonElement | null,
  doc: DocumentData,
): void {
  if (prevBtn) {
    prevBtn.disabled = !doc.navigation.prev;
    prevBtn.title = doc.navigation.prev ? 'Previous page (j)' : 'No previous page';
  }
  if (nextBtn) {
    nextBtn.disabled = !doc.navigation.next;
    nextBtn.title = doc.navigation.next ? 'Next page (l)' : 'No next page';
  }
}

/**
 * Render the document viewer UI
 */
function renderDocument(doc: DocumentData): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  appEl.innerHTML = `
    <div class="main${isFullscreen ? ' fullscreen' : ''}">
      <header class="header">${headerInnerHtml(doc)}</header>

      <div class="content">
        <div class="image-panel">
          <div id="openseadragon-viewer"></div>
          <div id="shortcuts-overlay" class="shortcuts-overlay hidden">
            <div class="shortcuts-content">
              <div class="shortcuts-header">Keyboard shortcuts</div>
              <div class="shortcuts-list">
                <div class="shortcut-row"><kbd>+</kbd> / <kbd>&minus;</kbd><span>Zoom in / out</span></div>
                <div class="shortcut-row"><kbd>0</kbd><span>Reset view</span></div>
                <div class="shortcut-row"><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / <kbd>&#8593;</kbd> <kbd>&#8592;</kbd> <kbd>&#8595;</kbd> <kbd>&#8594;</kbd><span>Pan</span></div>
                <div class="shortcut-row"><kbd>j</kbd> / <kbd>l</kbd><span>Previous / next page</span></div>
                <div class="shortcut-row"><kbd>r</kbd> / <kbd>&#8679;R</kbd><span>Rotate left / right</span></div>
                <div class="shortcut-row"><kbd>k</kbd><span>Return to opened page</span></div>
                <div class="shortcut-row"><kbd>f</kbd><span>Full-screen</span></div>
                <div class="shortcut-row"><kbd>i</kbd><span>Select region (drag a box for the assistant to inspect)</span></div>
                <div class="shortcut-row"><kbd>?</kbd><span>This help</span></div>
                <div class="shortcut-row"><kbd>Esc</kbd><span>Close this help</span></div>
              </div>
            </div>
          </div>
          <div class="image-controls">
            <button id="show-shortcuts" title="Keyboard &amp; mouse controls (?)">?</button>
            <button id="zoom-in" title="Zoom In (+)">+</button>
            <button id="zoom-out" title="Zoom Out (−)">−</button>
            <button id="reset-view" title="Reset View (0)">Reset</button>
            <button id="prev-page" title="Previous page (j)">&#9664;</button>
            <button id="next-page" title="Next page (l)">&#9654;</button>
            <button id="select-mode" title="Select region (i)">&#9744;</button>
          </div>
        </div>

        <div class="text-panel">
          <div class="text-panel-header">Transcription</div>
          <div class="transcription" id="transcription">
            ${renderTranscription(doc.transcription, doc.highlight)}
          </div>
        </div>
      </div>

      <nav class="navigation">
        <span class="page-info">${escapeHtml(pageInfoText(doc))}</span>
      </nav>
    </div>
  `;

  // Initialize OpenSeadragon viewer (async: fetches IIIF info.json first)
  void initializeImageViewer(doc.iiifImageUrl);

  // Attach event listeners
  attachEventListeners(doc);

  // Set up visibility-based pause/play for OpenSeadragon
  setupVisibilityObserver();

  // Explicitly report size to host after rendering
  // Use requestAnimationFrame to ensure DOM has updated
  requestAnimationFrame(() => {
    const mainEl = document.querySelector('.main');
    if (mainEl) {
      const rect = mainEl.getBoundingClientRect();
      app.sendSizeChanged({ width: rect.width, height: rect.height });
      app.sendLog({ level: 'info', data: `Size reported: ${rect.width}x${rect.height}` });
    }
  });
}

/**
 * In-place page swap for navigation: keep the image-panel DOM and the live OSD
 * instance, update only the header/transcription/footer + button state, and load
 * the new page's tiles via viewer.open() on the EXISTING viewer. Modeled on the
 * rijksmuseum-mcp-plus swapArtwork() peer-navigation path. Falls back to a full
 * renderDocument() if there is no live viewer or the containers are absent (e.g.
 * the previous load hit open-failed and replaced the container).
 *
 * NB: switching the tile source mid-load makes OSD log "tile loaded before reset"
 * warnings — harmless, inherent to swapping images, not an error.
 */
async function swapDocument(data: DocumentData): Promise<void> {
  const headerEl = document.querySelector('.header');
  const transcriptionEl = document.getElementById('transcription');
  const pageInfoEl = document.querySelector('.page-info');
  if (!viewer || viewerNeedsRebuild || !headerEl || !transcriptionEl || !pageInfoEl) {
    renderDocument(data);   // fallback: full rebuild (also recovers a dead viewer)
    return;
  }

  headerEl.innerHTML = headerInnerHtml(data);
  attachExternalLinkListeners();   // re-attach: the old <a> listeners died with the replaced header

  transcriptionEl.innerHTML = renderTranscription(data.transcription, data.highlight);

  pageInfoEl.textContent = pageInfoText(data);

  // The user highlight belongs to the previous page — clear it. Select mode
  // itself survives the in-place swap (rijksmuseum parity: the MouseTracker
  // rides the persistent OSD canvas).
  clearAllOverlays();
  removeSelectionPreview();
  dragStart = null;

  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement | null;
  setNavButtonState(prevBtn, nextBtn, data);

  // Swap the image in place on the existing viewer (no destroy/recreate).
  viewer.viewport.setRotation(0);
  const seq = ++openSeq;
  const tileSources = await buildTileSources(data.iiifImageUrl);
  if (seq !== openSeq) return;          // a newer swap superseded this one during the info.json await
  armOpenFailed(seq, data.iiifImageUrl);
  viewer.open(tileSources as Parameters<typeof viewer.open>[0]);

  // Report the post-swap size to the host (image-panel layout is unchanged, but
  // the header/transcription heights may differ between pages).
  requestAnimationFrame(() => {
    const mainEl = document.querySelector('.main');
    if (mainEl) {
      const rect = mainEl.getBoundingClientRect();
      app.sendSizeChanged({ width: rect.width, height: rect.height });
    }
  });
}

/**
 * Derive the IIIF Image API info.json URL from a full-image URL like
 * .../{id}.jp2/full/max/0/default.jpg → .../{id}.jp2/info.json
 */
function infoJsonUrl(imageUrl: string): string | null {
  const match = imageUrl.match(/^(.+)\/full\/[^/]+\/\d+\/default\.\w+$/);
  return match ? `${match[1]}/info.json` : null;
}

/**
 * Prefer tiled deep-zoom via IIIF info.json; fall back to single-image mode.
 *
 * service.archief.nl answers IIIF Image API v3 info.json with a 256px tile
 * pyramid (level2 profile, CORS *) — re-verified 2026-06-10. The old "IIP
 * doesn't support info.json" assumption no longer holds, so the
 * full-resolution JPEG is only the fallback when the fetch fails.
 */
async function buildTileSources(imageUrl: string): Promise<object | string> {
  const infoUrl = infoJsonUrl(imageUrl);
  if (infoUrl) {
    try {
      const response = await fetch(infoUrl);
      if (response.ok) {
        return (await response.json()) as object;
      }
      app.sendLog({ level: 'warning', data: `info.json ${response.status}; using single-image mode` });
    } catch (e) {
      app.sendLog({ level: 'warning', data: `info.json fetch failed (${e}); using single-image mode` });
    }
  }
  return { type: 'image', url: imageUrl };
}

// Guards against an older in-flight init clobbering a newer one (the
// info.json fetch makes initialization asynchronous)
let viewerInitSeq = 0;

// Arm an open-failed handler bound to this specific open. A failure from a
// superseded open (seq !== openSeq) is ignored, so it can't nuke a newer, healthy
// viewer or flip viewerNeedsRebuild for the wrong page. Registered with addHandler
// (not addOnceHandler) so the SAME reference we hold in pendingOpenFailed can be
// removed before the next open — exactly one open-failed handler is ever live.
function armOpenFailed(seq: number, imageUrl: string): void {
  if (!viewer) return;
  if (pendingOpenFailed) viewer.removeHandler('open-failed', pendingOpenFailed); // same reference → real removal
  pendingOpenFailed = () => {
    if (seq !== openSeq) return;            // a newer open started — this failure is stale, ignore it
    viewerNeedsRebuild = true;
    const viewerContainer = document.getElementById('openseadragon-viewer');
    if (viewerContainer) {
      viewerContainer.innerHTML = `
        <div class="image-error">
          <p>Image could not be loaded</p>
          <p><a href="${sanitizeUrl(imageUrl)}" target="_blank">Open image directly</a></p>
        </div>
      `;
    }
  };
  viewer.addHandler('open-failed', pendingOpenFailed);
}

/**
 * Initialize OpenSeadragon for IIIF image viewing
 */
async function initializeImageViewer(imageUrl: string): Promise<void> {
  // Destroy previous viewer if exists
  if (viewer) {
    teardownSelectionTracker();   // tracker holds the old canvas
    selectMode = false;           // fresh viewer starts in nav mode (button re-renders inactive)
    overlayElements.length = 0;   // overlays died with the destroyed canvas
    viewer.destroy();
    viewer = null;
  }

  const seq = ++viewerInitSeq;
  const tileSources = await buildTileSources(imageUrl);
  if (seq !== viewerInitSeq) return;

  const container = document.getElementById('openseadragon-viewer');
  if (!container) return;

  const osdViewer = OpenSeadragon({
    element: container,
    // No prefixUrl: it only serves nav-button images, and every built-in
    // control is disabled below — the custom .image-controls buttons are used
    tileSources: tileSources as OpenSeadragon.Options['tileSources'],
    // Request tiles with crossOrigin="anonymous" so the navigator's canvas/WebGL
    // draw is not tainted — the IIIF host (service.archief.nl) serves CORS *, so
    // this is safe and is what makes the bottom-right minimap actually paint.
    // Without it, under OSD 6.x's default WebGL drawer the navigator tile upload
    // fails with a SecurityError and the minimap renders as a black box (#422).
    crossOriginPolicy: 'Anonymous',
    showNavigationControl: false,
    showZoomControl: false,
    showHomeControl: false,
    showFullPageControl: false,
    showRotationControl: false,
    showNavigator: true,
    navigatorPosition: 'BOTTOM_RIGHT',
    navigatorSizeRatio: 0.12,
    // Light navigator background so any un-painted area reads as an empty frame
    // rather than the black box we are fixing (OSD defaults this to '#000').
    navigatorBackground: '#fff',
    animationTime: 0.3,
    blendTime: 0.1,
    constrainDuringPan: true,
    maxZoomPixelRatio: 4,
    minZoomImageRatio: 0.8,
    visibilityRatio: 0.5,
  });
  viewer = osdViewer;
  // Suppress OSD's built-in 'f' = flip-horizontal so 'f' is free for the
  // full-screen toggle (handled in the module keydown listener). OSD raises
  // 'canvas-key' with a preventDefaultAction flag BEFORE running its own key
  // action; setting it for 'f' cancels ONLY the flip — WASD panning and every
  // other OSD key stay intact. Only fires when the image canvas has focus.
  osdViewer.addHandler('canvas-key', (e) => {
    const key = (e.originalEvent as KeyboardEvent).key;
    if (key === 'f' || key === 'F') {
      e.preventDefaultAction = true;
    }
  });
  const openSeqLocal = ++openSeq;
  viewerNeedsRebuild = false;
  armOpenFailed(openSeqLocal, imageUrl);

  // Frame the page on load. Fit-to-width + top-align reads nicely for pages
  // that fit vertically, but a tall page (or any page in a short pane — e.g. the
  // narrow stacked embed) would then show only its top strip. So fit-to-width
  // only when the whole page fits; otherwise fit the ENTIRE page like Reset does
  // (CODE-REVIEW: "vertical manuscripts only half displayed").
  osdViewer.addHandler('open', () => {
    const tiledImage = osdViewer.world.getItemAt(0);
    if (!tiledImage) {
      osdViewer.viewport.goHome(true);
      return;
    }

    // In viewport coordinates the image width is normalised to 1, so the page's
    // height equals imageHeightPx/imageWidthPx. heightAtFullWidth is how much
    // vertical space the pane shows once that width fills it.
    const imageBounds = tiledImage.getBounds();
    const container = osdViewer.viewport.getContainerSize();
    const heightAtFullWidth = container.x > 0 ? container.y / container.x : imageBounds.height;

    if (imageBounds.height <= heightAtFullWidth + 1e-6) {
      // Whole page fits vertically at full width — fit to width, aligned to top.
      osdViewer.viewport.fitBounds(new OpenSeadragon.Rect(0, 0, 1, 0.001), true);
      const bounds = osdViewer.viewport.getBounds();
      // Pan so the top of the image aligns with the top of the viewport
      // (center sits at y = half the viewport height).
      osdViewer.viewport.panTo(new OpenSeadragon.Point(0.5, bounds.height / 2), true);
    } else {
      // Taller than the pane — fit the whole page so it isn't half-cut.
      osdViewer.viewport.goHome(true);
    }
  });

}

/**
 * Zoom steps shared by the toolbar buttons and the keyboard shortcuts
 */
function zoomIn(): void {
  viewer?.viewport.zoomBy(1.5);
}

function zoomOut(): void {
  viewer?.viewport.zoomBy(0.67);
}

/**
 * Rotate the image by the specified degrees
 */
function rotateImage(degrees: number): void {
  if (!viewer) return;
  // Derive from the live viewport rotation rather than a module-level counter,
  // which desynced when a new document loaded a fresh viewer at 0° while the
  // counter still held the previous document's angle (CODE-REVIEW finding 8).
  const next = (((viewer.viewport.getRotation() + degrees) % 360) + 360) % 360;
  viewer.viewport.setRotation(next);
  app.sendLog({ level: 'info', data: `Image rotated to ${next}°` });
}

/**
 * Reset view to default (fit to width, no rotation). Also the explicit way
 * out of select mode, and clears any drawn highlight (rijksmuseum parity).
 */
function resetView(): void {
  if (!viewer) return;
  viewer.viewport.setRotation(0);
  viewer.viewport.goHome();
  clearAllOverlays();
  clearUserHighlight();
  if (selectMode) toggleSelectMode();
}

// ── Selection mode ──
//
// A select-mode toggle (☐ button + 'i' key) lets the user drag a box over the
// scan; on release the region is converted to an IIIF `pct:x,y,w,h` string
// and dropped into the chat as a `[Highlight: region …]` user message (via
// app.sendMessage, falling back to app.updateModelContext). No image moves on
// this path — only coordinates. The assistant then calls
// globalise_inspect_page_image with that documentId + region to fetch the
// actual crop. Ported from rijksmuseum-mcp-plus/apps/artwork-viewer/src/viewer.ts
// (plan 020) — see that file for the reference implementation this mirrors.

function toggleSelectMode(): void {
  if (!viewer) return;
  selectMode = !selectMode;
  viewer.setMouseNavEnabled(!selectMode);
  updateSelectButton();
  if (selectMode) {
    setupSelectionTracker();
  } else {
    teardownSelectionTracker();
  }
}

function updateSelectButton(): void {
  const btn = document.getElementById('select-mode');
  if (btn) {
    btn.textContent = '☐';
    btn.title = selectMode ? 'Exit select mode (i)' : 'Select region (i)';
    btn.classList.toggle('active', selectMode);
  }
  const canvas = document.getElementById('openseadragon-viewer');
  if (canvas) canvas.style.cursor = selectMode ? 'crosshair' : '';
}

function setupSelectionTracker(): void {
  if (!viewer || selectionTracker) return;
  selectionTracker = new OpenSeadragon.MouseTracker({
    element: viewer.canvas,
    pressHandler: onSelectionPress,
    dragHandler: onSelectionDrag,
    releaseHandler: onSelectionRelease,
  });
}

function teardownSelectionTracker(): void {
  if (selectionTracker) {
    selectionTracker.destroy();
    selectionTracker = null;
  }
  dragStart = null;
  removeSelectionPreview();
}

/** Pure geometry: image-pixel space → clamped rect + pct (ported verbatim). */
interface SelectionRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  pctX: number;
  pctY: number;
  pctW: number;
  pctH: number;
}

function computeSelectionRegion(
  a: OpenSeadragon.Point,
  b: OpenSeadragon.Point,
  imgWidth: number,
  imgHeight: number,
): SelectionRegion {
  const x1 = Math.max(0, Math.min(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(imgWidth, Math.max(a.x, b.x));
  const y2 = Math.min(imgHeight, Math.max(a.y, b.y));
  return {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    pctX: (x1 / imgWidth) * 100,
    pctY: (y1 / imgHeight) * 100,
    pctW: ((x2 - x1) / imgWidth) * 100,
    pctH: ((y2 - y1) / imgHeight) * 100,
  };
}

function onSelectionPress(event: OpenSeadragon.PointerMouseTrackerEvent): void {
  if (!viewer || !event.position) return;
  dragStart = viewer.viewport.viewerElementToImageCoordinates(event.position);
  removeSelectionPreview();
}

function onSelectionDrag(event: OpenSeadragon.DragMouseTrackerEvent): void {
  if (!viewer || !dragStart || !event.position) return;
  const contentSize = viewer.world.getItemAt(0)?.getContentSize();
  if (!contentSize || contentSize.x <= 0 || contentSize.y <= 0) return;
  const dragEnd = viewer.viewport.viewerElementToImageCoordinates(event.position);
  const r = computeSelectionRegion(dragStart, dragEnd, contentSize.x, contentSize.y);
  if (r.pctW < 0.5 || r.pctH < 0.5) return; // too small to show
  const rect = viewer.viewport.imageToViewportRectangle(
    new OpenSeadragon.Rect(r.x, r.y, r.w, r.h),
  );
  showSelectionPreview(rect);
}

function onSelectionRelease(event: OpenSeadragon.ReleaseMouseTrackerEvent): void {
  if (!viewer || !dragStart || !event.position) {
    dragStart = null;
    return;
  }
  const contentSize = viewer.world.getItemAt(0)?.getContentSize();
  if (!contentSize || contentSize.x <= 0 || contentSize.y <= 0) {
    dragStart = null;
    removeSelectionPreview();
    return;
  }
  const dragEnd = viewer.viewport.viewerElementToImageCoordinates(event.position);
  const r = computeSelectionRegion(dragStart, dragEnd, contentSize.x, contentSize.y);
  dragStart = null;
  removeSelectionPreview();
  if (r.pctW < 1 || r.pctH < 1) return; // too small — accidental click

  clearUserHighlight();
  const region = `pct:${r.pctX.toFixed(1)},${r.pctY.toFixed(1)},${r.pctW.toFixed(1)},${r.pctH.toFixed(1)}`;
  // Draw the persistent labelled highlight via the shared region-box helper
  // (plan 021 absorbed 020's inline build), in the blue HIGHLIGHT colors.
  userHighlightEl = addRegionOverlay(region, 'Highlight', HIGHLIGHT_STROKE, HIGHLIGHT_FILL);
  // Stay in select mode after drawing — user exits explicitly (button, 'i', or Reset).
  void sendSelectionToChat(region);
}

/** Dashed live preview via an OSD overlay, updated in place during the drag. */
function showSelectionPreview(rect: OpenSeadragon.Rect): void {
  if (!viewer) return;
  if (!selectionOverlay) {
    selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'selection-preview';
    selectionOverlay.style.border = `2px dashed ${HIGHLIGHT_STROKE}`;
    selectionOverlay.style.background = HIGHLIGHT_FILL;
    selectionOverlay.style.pointerEvents = 'none';
    viewer.addOverlay({ element: selectionOverlay, location: rect });
  } else {
    viewer.updateOverlay(selectionOverlay, rect);
  }
}

function removeSelectionPreview(): void {
  if (selectionOverlay && viewer) {
    viewer.removeOverlay(selectionOverlay);
    selectionOverlay = null;
  }
}

/** Remove the persistent labelled highlight box (if any) from the viewer AND
 *  the shared overlay list, then null the reference (rijksmuseum parity). */
function clearUserHighlight(): void {
  if (userHighlightEl && viewer) {
    viewer.removeOverlay(userHighlightEl);
    const idx = overlayElements.indexOf(userHighlightEl);
    if (idx !== -1) overlayElements.splice(idx, 1);
  }
  userHighlightEl = null;
}

/**
 * Drop a `[Highlight: region …]` token into the chat via app.sendMessage,
 * falling back to app.updateModelContext if the host doesn't support
 * sendMessage. The bracketed format is load-bearing: the server tool's
 * description quotes it verbatim (index.ts).
 */
async function sendSelectionToChat(region: string): Promise<void> {
  if (!currentDocument) return;
  const message = `[Highlight: region ${region} on document ${currentDocument.id}]`;
  try {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] });
    app.sendLog({ level: 'info', data: `Highlight sent: ${region}` });
  } catch {
    app.updateModelContext({
      content: [{ type: 'text', text: `Highlight: region ${region} on document ${currentDocument.id}` }],
    });
    app.sendLog({ level: 'info', data: `Highlight added to context: ${region}` });
  }
}

// ── Reverse channel: command polling (plan 021) ──
//
// The view tool mints a viewUUID and a server-side command queue; this iframe
// polls globalise_poll_viewer_commands and executes drained commands. Ported
// from rijksmuseum-mcp-plus/apps/artwork-viewer/src/viewer.ts.

interface ViewerCommand {
  action: 'navigate';
  region?: string;
}

// Adaptive polling. Each poll is a call_mcp round-trip the host records as a
// (hidden, app-only) transcript message — at a fixed 2 Hz that meant hundreds
// per session, which ChatGPT's renderer re-walks on every re-render. So poll
// fast right after a (re)mount, then back off to POLL_SLOW_MS once a run of
// polls comes back empty; any command received, or a fresh mount (startPolling
// re-runs), snaps it back to fast. Do NOT "simplify" this to a fixed interval.
const POLL_FAST_MS = 1000;
const POLL_SLOW_MS = 4000;
const POLL_EMPTY_RUNS_BEFORE_SLOW = 8;

function startPolling(): void {
  stopPolling();
  const caps = app.getHostCapabilities();
  if (!caps?.serverTools) {
    app.sendLog({ level: 'info', data: 'Polling skipped: serverTools not supported' });
    return;
  }
  const gen = ++pollGen;
  pollTimer = setTimeout(() => { void pollForCommands(gen, 0); }, POLL_FAST_MS);
  app.sendLog({ level: 'info', data: `Polling started for ${viewUUID}` });
}

function stopPolling(): void {
  pollGen++; // invalidate any in-flight poll so it won't reschedule itself
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

async function pollForCommands(gen: number, emptyRuns: number): Promise<void> {
  if (gen !== pollGen || !viewUUID) return;
  let gotCommands = false;
  try {
    const result = await app.callServerTool({
      name: 'globalise_poll_viewer_commands',
      arguments: { viewUUID },
    });
    if (!result.isError) {
      const data = result.structuredContent as { commands?: ViewerCommand[] } | undefined;
      let commands: ViewerCommand[] = [];
      if (data?.commands) {
        commands = data.commands;
      } else {
        const textContent = result.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
        if (textContent) {
          try { commands = JSON.parse(textContent.text)?.commands ?? []; } catch { /* not JSON */ }
        }
      }
      if (commands.length) { processCommands(commands); gotCommands = true; }
    }
  } catch { /* retry on next tick */ }
  if (gen !== pollGen || !viewUUID) return; // superseded or torn down mid-poll
  const nextEmptyRuns = gotCommands ? 0 : emptyRuns + 1;
  const delay = nextEmptyRuns >= POLL_EMPTY_RUNS_BEFORE_SLOW ? POLL_SLOW_MS : POLL_FAST_MS;
  pollTimer = setTimeout(() => { void pollForCommands(gen, nextEmptyRuns); }, delay);
}

function processCommands(commands: ViewerCommand[]): void {
  for (const cmd of commands) {
    if (cmd.action === 'navigate' && cmd.region) navigateToRegion(cmd.region);
  }
}

function navigateToRegion(region: string): void {
  if (region === 'full') { viewer?.viewport.goHome(); return; }
  const rect = iiifRegionToViewportRect(region);
  if (rect) viewer!.viewport.fitBounds(rect);
}

/** Resolve an IIIF region string to an OSD viewport rect. Image dims come from
 *  the server (currentDocument.imageWidth/Height), falling back to OSD's own
 *  content size for the single-image / no-dims case. */
function iiifRegionToViewportRect(region: string): OpenSeadragon.Rect | null {
  if (!viewer) return null;
  const contentSize = viewer.world.getItemAt(0)?.getContentSize();
  const width = currentDocument?.imageWidth ?? contentSize?.x;
  const height = currentDocument?.imageHeight ?? contentSize?.y;
  if (!width || !height) return null;

  const pctMatch = region.match(/^pct:([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)$/);
  if (pctMatch) {
    const [, px, py, pw, ph] = pctMatch.map(Number);
    return viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(
      (px / 100) * width,
      (py / 100) * height,
      (pw / 100) * width,
      (ph / 100) * height,
    ));
  }

  const pxMatch = region.match(/^(\d+),(\d+),(\d+),(\d+)$/);
  if (pxMatch) {
    const [, x, y, w, h] = pxMatch.map(Number);
    return viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(x, y, w, h));
  }

  if (region === 'square') {
    const side = Math.min(width, height);
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;
    return viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(sx, sy, side, side));
  }

  return null;
}

/** Draw a bordered (optionally labelled) box for an IIIF region and track it in
 *  overlayElements. Backs the user's drag-select highlight (the LLM-overlay
 *  command path was removed). Returns the element (or null if the region can't
 *  be resolved). */
function addRegionOverlay(region: string, label?: string, color?: string, fill?: string): HTMLElement | null {
  const rect = iiifRegionToViewportRect(region);
  if (!rect || !viewer) return null;

  const el = document.createElement('div');
  el.className = 'region-overlay';
  const c = color || HIGHLIGHT_STROKE;
  el.style.border = `2px solid ${c}`;
  el.style.pointerEvents = 'none';
  if (fill) {
    el.style.background = fill;
  } else {
    // Derive a low-opacity fill from an rgba color; fixed fallback otherwise.
    const rgbaMatch = c.match(/^(rgba?\([^)]+,\s*)[0-9.]+\)$/);
    el.style.background = rgbaMatch ? `${rgbaMatch[1]}0.1)` : HIGHLIGHT_FILL;
  }

  if (label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'region-label';
    labelEl.textContent = label;
    el.appendChild(labelEl);
  }

  viewer.addOverlay({ element: el, location: rect });
  overlayElements.push(el);
  return el;
}

/** Remove every tracked box (the user highlight). */
function clearAllOverlays(): void {
  for (const el of overlayElements) viewer?.removeOverlay(el);
  overlayElements.length = 0;
  userHighlightEl = null;
}

/**
 * Load an adjacent (or the seed) scan into the viewer by calling the server's
 * view tool directly and re-rendering through the same parse path the host-driven
 * tool result uses. `targetId` comes from currentDocument.navigation.{prev,next}
 * (document-ID strings) or seedDocumentId.
 *
 * NB: callServerTool calls a *server* tool; it does NOT require the app-side
 * `tools` capability (see the caveat at the top of this file). Do not add it.
 */
let navigating = false;
async function navigateToPage(targetId: string | null | undefined): Promise<void> {
  if (!targetId || navigating) return;
  navigating = true;
  // No showLoading() here: the in-place swap is the loading affordance — nuking
  // #app would destroy the OSD instance we are trying to keep alive.
  try {
    const result = await app.callServerTool({
      name: 'globalise_view_document_ui',
      // Pass the stored viewUUID so the server preserves this session across
      // the in-place page swap (remount semantics) — polling continues
      // untouched.
      arguments: { documentId: targetId, ...(viewUUID && { viewUUID }) },
    });
    if (result.isError) {
      const first = result.content?.[0];
      const raw = (first?.type === 'text' ? first.text : undefined) || 'Unknown error';
      showError('Error loading page', raw);
      return;
    }
    const data = parseDocumentResult(result as ParseableToolResult);
    if (data) {
      // Set currentDocument BEFORE the await so the now-currentDocument-reading
      // button/keyboard handlers see the new page immediately.
      currentDocument = data;
      adoptViewSession(data);
      await swapDocument(data);
      updateModelContext(data);
    } else {
      showError('Error parsing page', 'Could not parse document data from tool result');
    }
  } catch (e) {
    showError('Error loading page', String(e));
  } finally {
    navigating = false;
  }
}

/**
 * Attach click→app.openLink() listeners to the external-link anchors. Extracted
 * so swapDocument() can re-attach them after replacing the header innerHTML (the
 * old <a> listeners die with the replaced nodes).
 */
function attachExternalLinkListeners(): void {
  // External link buttons - use app.openLink() for sandboxed iframe
  document.querySelectorAll('.external-links a').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = (link as HTMLAnchorElement).dataset.externalUrl;
      if (url) {
        app.sendLog({ level: 'info', data: `Opening external link via app.openLink(): ${url}` });
        const result = await app.openLink({ url });
        if (result.isError) {
          app.sendLog({ level: 'error', data: `Failed to open link: ${url}` });
        }
      }
    });
  });
}

/**
 * Attach event listeners for controls and text selection
 */
function attachEventListeners(doc: DocumentData): void {
  attachExternalLinkListeners();

  // Text selection tracking - update model context when user selects text
  const transcriptionEl = document.getElementById('transcription');
  if (transcriptionEl) {
    transcriptionEl.addEventListener('mouseup', () => {
      const selectedText = window.getSelection()?.toString().trim();

      if (selectedText) {
        // Update model context with selected text (using content array format).
        // Read currentDocument (not the captured doc) so this listener — which
        // survives an in-place swap on the persisted #transcription container —
        // reports the page actually on screen, not the one it was bound under.
        const contextText = `User selected text in document ${currentDocument?.id ?? doc.id}: "${selectedText}"`;
        app.updateModelContext({
          content: [{ type: 'text', text: contextText }],
        });
        app.sendLog({ level: 'info', data: `Text selected: "${selectedText}"` });
      }
    });
  }

  // Image controls
  document.getElementById('zoom-in')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out')?.addEventListener('click', zoomOut);
  document.getElementById('reset-view')?.addEventListener('click', resetView);
  document.getElementById('select-mode')?.addEventListener('click', toggleSelectMode);

  // Help overlay toggle. The overlay lives inside .image-panel, which
  // swapDocument() keeps alive, so this per-render binding survives page
  // navigation and only needs (re)attaching on a full renderDocument().
  const shortcutsOverlay = document.getElementById('shortcuts-overlay');
  document.getElementById('show-shortcuts')?.addEventListener('click', () => {
    shortcutsOverlay?.classList.toggle('hidden');
  });
  shortcutsOverlay?.addEventListener('click', (e) => {
    // Click on the dark scrim (not the card) closes it.
    if (e.target === shortcutsOverlay) shortcutsOverlay.classList.add('hidden');
  });

  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement | null;
  setNavButtonState(prevBtn, nextBtn, doc);
  if (prevBtn) {
    // Read currentDocument (mirroring the keyboard handler): the buttons persist
    // across an in-place swap, so the click must follow the live page's nav.
    prevBtn.addEventListener('click', () => void navigateToPage(currentDocument?.navigation.prev));
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => void navigateToPage(currentDocument?.navigation.next));
  }

}

/**
 * Toggle the viewer between inline and full-screen display modes via the MCP
 * Apps display-mode mechanism (app.requestDisplayMode) — NOT the browser
 * Fullscreen API, which is blocked inside the host's sandboxed iframe. The host
 * grants (or denies) the request; onhostcontextchanged echoes the granted mode
 * back and keeps isFullscreen + the .main.fullscreen class in sync.
 */
function toggleFullscreen(): void {
  const next = isFullscreen ? 'inline' : 'fullscreen';
  void app
    .requestDisplayMode({ mode: next })
    .then((result) => {
      isFullscreen = result.mode === 'fullscreen';
      document.querySelector('.main')?.classList.toggle('fullscreen', isFullscreen);
    })
    .catch(() => {
      /* host declined the display-mode change — leave the current mode as-is */
    });
}

/**
 * Keyboard shortcuts matching the control-button title hints:
 * + / = zoom in, − zoom out, 0 reset view, R rotate left, Shift+R rotate
 * right. Registered once at module scope (renderDocument re-creates the
 * buttons, but this listener lives on document).
 */
document.addEventListener('keydown', (e) => {
  // Help overlay: '?' toggles, Escape closes. Handled BEFORE the viewer guard
  // below so it is never swallowed by the meta/ctrl/alt early-return, and works
  // regardless of viewer state. Query the overlay live — renderDocument()
  // rebuilds the .image-panel DOM, so a captured reference would go stale.
  // ('?' is Shift+'/', which the modifier guard would not block anyway, but
  // keeping this ahead of the guard also lets Escape close the overlay.)
  if (e.key === '?' || e.key === 'Escape') {
    const overlay = document.getElementById('shortcuts-overlay');
    if (overlay) {
      if (e.key === '?') overlay.classList.toggle('hidden');
      else overlay.classList.add('hidden');
      e.preventDefault();
    }
    return;
  }

  // Full-screen toggle on 'f'/'F'. Handled before the viewer guard so it works
  // regardless of viewer state. OSD's built-in 'f' = flip-horizontal is
  // suppressed via the 'canvas-key' handler in initializeImageViewer(), so 'f'
  // maps to full-screen only.
  if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleFullscreen();
    e.preventDefault();
    return;
  }

  if (!viewer || e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case '+':
    case '=':
      zoomIn();
      break;
    case '-':
      zoomOut();
      break;
    case '0':
      resetView();
      break;
    case 'r':
      rotateImage(-90);
      break;
    case 'R':
      rotateImage(90);
      break;
    case 'j':
      void navigateToPage(currentDocument?.navigation.prev);
      break;
    case 'l':
      void navigateToPage(currentDocument?.navigation.next);
      break;
    case 'k':
      if (seedDocumentId && currentDocument && seedDocumentId !== currentDocument.id) {
        void navigateToPage(seedDocumentId);
      }
      break;
    case 'i':
      toggleSelectMode();
      break;
    default:
      return;
  }

  e.preventDefault();
});

/**
 * Set up IntersectionObserver for visibility-based pause/play
 */
function setupVisibilityObserver(): void {
  const mainEl = document.querySelector('.main');
  if (!mainEl) return;

  visibilityObserver?.disconnect();
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // select mode keeps OSD mouse nav off while active
        viewer?.setMouseNavEnabled(entry.isIntersecting && !selectMode);
      }
    },
    { threshold: 0.1 }
  );

  visibilityObserver.observe(mainEl);
}

/**
 * Update the model context with current document info (using content array format)
 */
function updateModelContext(doc: DocumentData): void {
  const contextText = [
    `Current document: ${doc.id}`,
    `Inventory: ${doc.metadata.inventory}, Scan: ${doc.metadata.scan}`,
    `Languages: ${doc.metadata.languages.map((l) => l.label).join(', ')}`,
    `Navigation: ${doc.navigation.prev ? 'Has previous' : 'No previous'}, ${doc.navigation.next ? 'Has next' : 'No next'}`,
    doc.archivalContext ? `Archival context available` : '',
  ].filter(Boolean).join('. ');

  app.updateModelContext({
    content: [{ type: 'text', text: contextText }],
  });
}

/**
 * Show error state
 */
function showError(title: string, message: string, suggestion?: string): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  appEl.innerHTML = `
    <div class="error">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${suggestion ? `<p class="error-suggestion">${escapeHtml(suggestion)}</p>` : ''}
      <button id="error-back-btn">← Back to Document</button>
    </div>
  `;

  // Back button - return to current document if available
  document.getElementById('error-back-btn')?.addEventListener('click', () => {
    if (currentDocument) {
      renderDocument(currentDocument);
    } else {
      showLoading('Waiting for document data...');
    }
  });
}

// IMPORTANT: Register ALL handlers BEFORE calling app.connect()
// Handlers are already registered above via app.ontoolinputpartial, etc.

// Connect to the MCP host
(async () => {
  try {
    await app.connect();
    app.sendLog({ level: 'info', data: 'Connected to MCP host' });

    // Apply initial host context
    const context = app.getHostContext();
    if (context) {
      applyHostContext(context);
    }
  } catch (error) {
    console.error('Failed to connect:', error);
    showError('Connection failed', 'Could not connect to the MCP host');
  }
})();
