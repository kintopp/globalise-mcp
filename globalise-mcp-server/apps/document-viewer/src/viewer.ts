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

// Server↔viewer wire contract. ViewDocumentUiOutput / ArchivalContext are the
// server's own zod-inferred types, so the contract is defined ONCE: a
// server-side field rename changes the type the viewer sees instead of
// silently diverging from a hand-copied interface (CODE-REVIEW finding 10).
// `import type` is erased by esbuild, so zod and the rest of the server graph
// stay out of the viewer bundle. DocumentData stays a local alias to avoid
// churning every use site.
import type { ViewDocumentUiOutput, ArchivalContext } from '../../../src/tools/document-viewer.js';
import { parseDocumentResult, type ParseableToolResult } from './parse-result.js';

type DocumentData = ViewDocumentUiOutput;

// App state
let currentDocument: DocumentData | null = null;
let seedDocumentId: string | null = null;
let viewer: OpenSeadragon.Viewer | null = null;
let isFullscreen = false;

// Splitter-drag state. The document-level mousemove/mouseup handlers are
// registered ONCE (below); renderDocument only re-binds mousedown on the
// freshly-rendered splitter. Previously those document handlers were added per
// render and never removed, accumulating a stale pair each time, and read
// getBoundingClientRect on every mousemove (forced reflow) — CODE-REVIEW
// finding 20. Bounds are now captured once on mousedown.
let splitterDragging = false;
let dragImagePanel: HTMLElement | null = null;
let dragContainerLeft = 0;
let dragMinWidth = 0;
let dragMaxWidth = 0;

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
    renderDocument(data);
    updateModelContext(data);
  } else {
    showError('Error parsing document', 'Could not parse document data from tool result');
  }
};

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

/**
 * Build HTML for archival context section
 */
function buildArchivalContextHtml(ctx: ArchivalContext | undefined): string {
  if (!ctx || ctx.source === 'none') {
    return '';
  }

  const rows: string[] = [];

  // Row 1: Settlement, Year range, Location (+ chamber for GM, HTR for GM)
  const row1Parts: string[] = [];
  if (ctx.settlements && ctx.settlements.length > 0) {
    const settlementText = ctx.settlements.join(', ');
    row1Parts.push(`<span title="Settlement">📍 ${escapeHtml(settlementText)}</span>`);
  }
  if (ctx.yearRange) {
    const yearText = ctx.yearRange.from === ctx.yearRange.to
      ? `${ctx.yearRange.from}`
      : `${ctx.yearRange.from}–${ctx.yearRange.to}`;
    row1Parts.push(`<span title="Date range">📅 ${yearText}</span>`);
  }
  // Location and geographic coverage on same row
  if (ctx.locationTanap) {
    row1Parts.push(`<span title="Location (TANAP)">📌 ${escapeHtml(ctx.locationTanap)}</span>`);
  }
  if (ctx.geographicalCoverage && ctx.geographicalCoverage !== ctx.settlements?.[0]) {
    // Only show if different from settlement
    row1Parts.push(`<span title="Geographic coverage">🌍 ${escapeHtml(ctx.geographicalCoverage)}</span>`);
  }
  if (ctx.chamber) {
    row1Parts.push(`<span title="VOC Chamber">🏛️ ${escapeHtml(ctx.chamber)}</span>`);
  }
  if (ctx.htrAvailable !== undefined) {
    const htrText = ctx.htrAvailable ? 'HTR available' : 'No HTR';
    const htrIcon = ctx.htrAvailable ? '✓' : '✗';
    row1Parts.push(`<span title="${htrText}" class="${ctx.htrAvailable ? 'htr-available' : 'htr-unavailable'}">${htrIcon} HTR</span>`);
  }
  if (row1Parts.length > 0) {
    rows.push(`<div class="archival-row">${row1Parts.join('')}</div>`);
  }

  // Row 3: Description (full width, wrapping)
  if (ctx.description) {
    rows.push(`<div class="archival-description" title="${escapeHtml(ctx.description)}">${escapeHtml(ctx.description)}</div>`);
  }

  if (rows.length === 0) {
    return '';
  }

  return `<div class="archival-context">${rows.join('')}</div>`;
}

/**
 * Build the inner markup of <header class="header">. Shared by the full
 * renderDocument() (first/host load) and swapDocument() (in-place navigation),
 * so the header is defined ONCE — a new field is added here, not in two places.
 */
function headerInnerHtml(doc: DocumentData): string {
  const languageBadges = doc.metadata.languages
    .map((l) => `<span class="language-badge" title="${l.code}">${l.label}</span>`)
    .join('');
  const archivalHtml = buildArchivalContextHtml(doc.archivalContext);
  // Sanitize URLs to prevent protocol injection.
  const externalLinks = [
    `<a href="${sanitizeUrl(doc.urls.viewer)}" data-external-url="${sanitizeUrl(doc.urls.viewer)}">GLOBALISE Viewer</a>`,
    doc.urls.archive
      ? `<a href="${sanitizeUrl(doc.urls.archive)}" data-external-url="${sanitizeUrl(doc.urls.archive)}">National Archives</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  return `
        <div class="header-title-row">
          <h1>${escapeHtml(doc.id.replace('urn:globalise:', ''))}</h1>
          <div class="header-right">
            <div class="external-links">${externalLinks}</div>
            ${doc.metadata.license ? `<span class="license">License: ${escapeHtml(doc.metadata.license)}</span>` : ''}
          </div>
        </div>
        <div class="metadata">
          <span>Inventory: ${escapeHtml(doc.metadata.inventory)}</span>
          <span>Scan: ${escapeHtml(doc.metadata.scan)}</span>
          <span>Language: ${languageBadges}</span>
        </div>
        ${archivalHtml}`;
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
          <div class="image-controls">
            <button id="zoom-in" title="Zoom In (+)">+</button>
            <button id="zoom-out" title="Zoom Out (−)">−</button>
            <button id="reset-view" title="Reset View (0)">Reset</button>
            <span class="control-separator"></span>
            <button id="prev-page" title="Previous page (j)">&#9664;</button>
            <button id="next-page" title="Next page (l)">&#9654;</button>
          </div>
        </div>

        <div class="splitter"></div>

        <div class="text-panel">
          <div class="text-panel-header">Transcription</div>
          <div class="transcription" id="transcription">
            ${renderTranscription(doc.transcription, doc.highlight)}
          </div>
        </div>
      </div>

      <nav class="navigation">
        <span class="page-info">Page ${escapeHtml(doc.metadata.scan)} of inventory ${escapeHtml(doc.metadata.inventory)}</span>
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
  if (!viewer || !headerEl || !transcriptionEl || !pageInfoEl) {
    renderDocument(data);   // fallback: full rebuild
    return;
  }

  headerEl.innerHTML = headerInnerHtml(data);
  attachExternalLinkListeners();   // re-attach: the old <a> listeners died with the replaced header

  transcriptionEl.innerHTML = renderTranscription(data.transcription, data.highlight);

  pageInfoEl.textContent = `Page ${data.metadata.scan} of inventory ${data.metadata.inventory}`;

  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement | null;
  if (prevBtn) {
    prevBtn.disabled = !data.navigation.prev;
    prevBtn.title = data.navigation.prev ? 'Previous page (j)' : 'No previous page';
  }
  if (nextBtn) {
    nextBtn.disabled = !data.navigation.next;
    nextBtn.title = data.navigation.next ? 'Next page (l)' : 'No next page';
  }

  // Swap the image in place on the existing viewer (no destroy/recreate).
  viewer.viewport.setRotation(0);
  const tileSources = await buildTileSources(data.iiifImageUrl);
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

/**
 * Initialize OpenSeadragon for IIIF image viewing
 */
async function initializeImageViewer(imageUrl: string): Promise<void> {
  // Destroy previous viewer if exists
  if (viewer) {
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
    showNavigationControl: false,
    showZoomControl: false,
    showHomeControl: false,
    showFullPageControl: false,
    showRotationControl: false,
    showNavigator: true,
    navigatorPosition: 'BOTTOM_RIGHT',
    navigatorSizeRatio: 0.12,
    animationTime: 0.3,
    blendTime: 0.1,
    constrainDuringPan: true,
    maxZoomPixelRatio: 4,
    minZoomImageRatio: 0.8,
    visibilityRatio: 0.5,
  });
  viewer = osdViewer;

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

  // Handle image load error
  osdViewer.addHandler('open-failed', () => {
    const viewerContainer = document.getElementById('openseadragon-viewer');
    if (viewerContainer) {
      viewerContainer.innerHTML = `
        <div class="image-error">
          <p>Image could not be loaded</p>
          <p><a href="${sanitizeUrl(imageUrl)}" target="_blank">Open image directly</a></p>
        </div>
      `;
    }
  });
}

/**
 * Render transcription lines with optional highlighting
 */
function renderTranscription(lines: string[], highlightTerms: string[]): string {
  // Compile one combined highlight regex up front instead of recompiling per
  // term per line (CODE-REVIEW finding 20). Empty terms are dropped so the
  // alternation can't match the empty string.
  const terms = highlightTerms.filter(Boolean).map(escapeRegex);
  const highlightRegex = terms.length > 0 ? new RegExp(`(${terms.join('|')})`, 'gi') : null;

  return lines
    .map((line, i) => {
      let text = escapeHtml(line);
      if (highlightRegex) {
        text = text.replace(highlightRegex, '<mark>$1</mark>');
      }
      return `<div class="line"><span class="line-number">${i + 1}</span>${text || '&nbsp;'}</div>`;
    })
    .join('');
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
 * Reset view to default (fit to width, no rotation)
 */
function resetView(): void {
  if (!viewer) return;
  viewer.viewport.setRotation(0);
  viewer.viewport.goHome();
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
      arguments: { documentId: targetId },
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

  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement | null;
  if (prevBtn) {
    prevBtn.disabled = !doc.navigation.prev;
    prevBtn.title = doc.navigation.prev ? 'Previous page (j)' : 'No previous page';
    // Read currentDocument (mirroring the keyboard handler): the buttons persist
    // across an in-place swap, so the click must follow the live page's nav.
    prevBtn.addEventListener('click', () => void navigateToPage(currentDocument?.navigation.prev));
  }
  if (nextBtn) {
    nextBtn.disabled = !doc.navigation.next;
    nextBtn.title = doc.navigation.next ? 'Next page (l)' : 'No next page';
    nextBtn.addEventListener('click', () => void navigateToPage(currentDocument?.navigation.next));
  }

  // Splitter drag: bind mousedown on the freshly-rendered splitter and capture
  // the drag bounds once. The document-level mousemove/mouseup live at module
  // scope (registered once — finding 20).
  document.querySelector('.splitter')?.addEventListener('mousedown', () => {
    const containerRect = document.querySelector('.content')?.getBoundingClientRect();
    const imagePanel = document.querySelector('.image-panel') as HTMLElement | null;
    if (!containerRect || !imagePanel) return;

    splitterDragging = true;
    dragImagePanel = imagePanel;
    dragContainerLeft = containerRect.left;
    dragMinWidth = 300;
    dragMaxWidth = containerRect.width - 300;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
}

// Document-level splitter-drag handlers, registered once (see splitter-drag
// state). mousemove uses the bounds captured on mousedown — no per-move reflow.
document.addEventListener('mousemove', (e) => {
  if (!splitterDragging || !dragImagePanel) return;
  const newWidth = e.clientX - dragContainerLeft;
  if (newWidth >= dragMinWidth && newWidth <= dragMaxWidth) {
    dragImagePanel.style.flex = 'none';
    dragImagePanel.style.width = `${newWidth}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (!splitterDragging) return;
  splitterDragging = false;
  dragImagePanel = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

/**
 * Keyboard shortcuts matching the control-button title hints:
 * + / = zoom in, − zoom out, 0 reset view, R rotate left, Shift+R rotate
 * right. Registered once at module scope (renderDocument re-creates the
 * buttons, but this listener lives on document).
 */
document.addEventListener('keydown', (e) => {
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

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        viewer?.setMouseNavEnabled(entry.isIntersecting);
      }
    },
    { threshold: 0.1 }
  );

  observer.observe(mainEl);
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

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/**
 * Escape HTML special characters. A regex map, not a throwaway
 * `document.createElement('div')` per call (CODE-REVIEW finding 20) — and it
 * also escapes quotes, which the textContent approach left intact even though
 * this is used inside title="..." attributes.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Escape special regex characters
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate URL protocol to prevent javascript: and data: injection
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // Invalid URL
  }
  return '#';
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
