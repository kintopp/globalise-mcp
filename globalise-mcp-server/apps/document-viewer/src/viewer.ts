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

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from 'https://unpkg.com/@modelcontextprotocol/ext-apps@1.0.1/app-with-deps';

// OpenSeadragon is loaded globally via CDN
declare const OpenSeadragon: typeof import('openseadragon');

// Archival context from OBP/GM databases
interface ArchivalContext {
  source: 'obp' | 'gm' | 'both' | 'none';
  inventoryTotal: number;
  settlements?: string[];
  yearRange?: { from: number; to: number };
  chamber?: string;
  htrAvailable?: boolean;
  locationTanap?: string;
  geographicalCoverage?: string;
  description?: string;
}

// Document data structure from tool result
interface DocumentData {
  id: string;
  iiifImageUrl: string;
  transcription: string[];
  metadata: {
    inventory: string;
    scan: string;
    languages: Array<{ code: string; label: string }>;
    license?: string;
  };
  navigation: {
    prev: string | null;
    next: string | null;
  };
  urls: {
    viewer: string;
    archive: string | null;
  };
  highlight: string[];
  archivalContext?: ArchivalContext;
}

// App state
let currentDocument: DocumentData | null = null;
let viewer: OpenSeadragon.Viewer | null = null;
let isFullscreen = false;

// Initialize the MCP App with capabilities
const app = new App(
  { name: 'GLOBALISE Document Viewer', version: '1.0.0' },
  { tools: { listChanged: false } },
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

  // Check for error
  if (result.isError) {
    showError('Error loading document', result.content?.[0]?.text || 'Unknown error');
    return;
  }

  // Parse document data from JSON in content
  // The tool returns [human-readable text, JSON data]
  let data: DocumentData | null = null;

  if (result.content && result.content.length >= 2) {
    // Second content item should be the JSON data
    const jsonContent = result.content[1];
    if (jsonContent?.type === 'text') {
      try {
        data = JSON.parse(jsonContent.text) as DocumentData;
      } catch (e) {
        app.sendLog({ level: 'error', data: `JSON parse error: ${e}` });
      }
    }
  }

  // Fallback: try first content item if it looks like JSON
  if (!data && result.content?.[0]?.type === 'text') {
    const text = result.content[0].text;
    if (text.startsWith('{')) {
      try {
        data = JSON.parse(text) as DocumentData;
      } catch {
        // Not JSON, ignore
      }
    }
  }

  if (data) {
    currentDocument = data;
    renderDocument(data);
    updateModelContext(data);
  } else {
    showError('Error parsing document', 'Could not parse document data from tool result');
  }
};

/**
 * Handle host context changes (theme, safe areas, display mode)
 */
app.onhostcontextchanged = (params) => {
  // Apply theme
  if (params.theme) {
    applyDocumentTheme(params.theme);
  }

  // Apply CSS variables from host
  if (params.styles?.variables) {
    applyHostStyleVariables(params.styles.variables);
  }

  // Apply fonts from host
  if (params.styles?.css?.fonts) {
    applyHostFonts(params.styles.css.fonts);
  }

  // Handle safe area insets
  if (params.safeAreaInsets) {
    const { top, right, bottom, left } = params.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }

  // Handle display mode changes
  if (params.displayMode) {
    isFullscreen = params.displayMode === 'fullscreen';
    document.querySelector('.main')?.classList.toggle('fullscreen', isFullscreen);
  }
};

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
 * Render the document viewer UI
 */
function renderDocument(doc: DocumentData): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  // Build language badges
  const languageBadges = doc.metadata.languages
    .map((l) => `<span class="language-badge" title="${l.code}">${l.label}</span>`)
    .join('');

  // Build archival context section
  const archivalHtml = buildArchivalContextHtml(doc.archivalContext);

  appEl.innerHTML = `
    <div class="main${isFullscreen ? ' fullscreen' : ''}">
      <header class="header">
        <h1>${escapeHtml(doc.id.replace('urn:globalise:', ''))}</h1>
        <div class="metadata">
          <div class="metadata-left">
            <span>Inventory: ${escapeHtml(doc.metadata.inventory)}</span>
            <span>Scan: ${escapeHtml(doc.metadata.scan)}</span>
            <span>Language: ${languageBadges}</span>
          </div>
          ${doc.metadata.license ? `<span class="metadata-right">License: ${escapeHtml(doc.metadata.license)}</span>` : ''}
        </div>
        ${archivalHtml}
      </header>

      <div class="content">
        <div class="image-panel">
          <div id="openseadragon-viewer"></div>
          <div class="image-controls">
            <button id="zoom-in" title="Zoom In">+</button>
            <button id="zoom-out" title="Zoom Out">−</button>
            <button id="reset-view" title="Reset View">Reset</button>
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

      <footer class="footer">
        <span class="page-info">Page ${escapeHtml(doc.metadata.scan)} of inventory ${escapeHtml(doc.metadata.inventory)}</span>
        ${doc.navigation.prev ? `<span class="nav-hint">Previous: ${doc.navigation.prev.replace('urn:globalise:', '')}</span>` : ''}
        ${doc.navigation.next ? `<span class="nav-hint">Next: ${doc.navigation.next.replace('urn:globalise:', '')}</span>` : ''}
      </footer>
    </div>
  `;

  // Initialize OpenSeadragon viewer
  initializeImageViewer(doc.iiifImageUrl);

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
 * Initialize OpenSeadragon for IIIF image viewing
 */
function initializeImageViewer(imageUrl: string): void {
  // Destroy previous viewer if exists
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }

  const container = document.getElementById('openseadragon-viewer');
  if (!container) return;

  // IIPImage server at service.archief.nl doesn't support standard IIIF info.json
  // Use simple image mode instead
  viewer = OpenSeadragon({
    element: container,
    prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/images/',
    tileSources: {
      type: 'image',
      url: imageUrl,
    },
    showNavigationControl: false,
    showZoomControl: false,
    showHomeControl: false,
    showFullPageControl: false,
    showRotationControl: false,
    animationTime: 0.3,
    blendTime: 0.1,
    constrainDuringPan: true,
    maxZoomPixelRatio: 4,
    minZoomImageRatio: 0.8,
    visibilityRatio: 0.5,
  });

  // Handle image load error
  viewer.addHandler('open-failed', () => {
    const viewerContainer = document.getElementById('openseadragon-viewer');
    if (viewerContainer) {
      viewerContainer.innerHTML = `
        <div class="image-error">
          <p>Image could not be loaded</p>
          <p><a href="${imageUrl}" target="_blank">Open image directly</a></p>
        </div>
      `;
    }
  });
}

/**
 * Render transcription lines with optional highlighting
 */
function renderTranscription(lines: string[], highlightTerms: string[]): string {
  return lines
    .map((line, i) => {
      let text = escapeHtml(line);

      // Apply highlighting for search terms
      if (highlightTerms && highlightTerms.length > 0) {
        for (const term of highlightTerms) {
          const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
          text = text.replace(regex, '<mark>$1</mark>');
        }
      }

      return `<div class="line"><span class="line-number">${i + 1}</span>${text || '&nbsp;'}</div>`;
    })
    .join('');
}

/**
 * Attach event listeners for controls and text selection
 */
function attachEventListeners(doc: DocumentData): void {
  // External link buttons - use window.open() to ensure they work in iframe context
  document.querySelectorAll('.external-links a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = (link as HTMLAnchorElement).href;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        app.sendLog({ level: 'info', data: `Opening external link: ${url}` });
      }
    });
  });

  // Text selection tracking - update model context when user selects text
  const transcriptionEl = document.getElementById('transcription');
  if (transcriptionEl) {
    transcriptionEl.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        // Update model context with selected text
        app.updateModelContext({
          structuredContent: {
            documentId: doc.id,
            selectedText: selectedText,
            selectionContext: 'User selected text from transcription',
          },
        });
        app.sendLog({ level: 'info', data: `Text selected: "${selectedText}"` });
      }
    });
  }

  // Zoom controls
  document.getElementById('zoom-in')?.addEventListener('click', () => {
    viewer?.viewport.zoomBy(1.5);
  });

  document.getElementById('zoom-out')?.addEventListener('click', () => {
    viewer?.viewport.zoomBy(0.67);
  });

  document.getElementById('reset-view')?.addEventListener('click', () => {
    viewer?.viewport.goHome();
  });

  // Splitter drag functionality
  const splitter = document.querySelector('.splitter');
  const imagePanel = document.querySelector('.image-panel') as HTMLElement;

  if (splitter && imagePanel) {
    let isDragging = false;

    splitter.addEventListener('mousedown', () => {
      isDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const containerRect = document.querySelector('.content')?.getBoundingClientRect();
      if (!containerRect) return;

      const newWidth = e.clientX - containerRect.left;
      const minWidth = 300;
      const maxWidth = containerRect.width - 300;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        imagePanel.style.flex = 'none';
        imagePanel.style.width = `${newWidth}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }
}

/**
 * Set up IntersectionObserver for visibility-based pause/play
 */
function setupVisibilityObserver(): void {
  const mainEl = document.querySelector('.main');
  if (!mainEl) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!viewer) return;

        if (entry.isIntersecting) {
          // Resume viewer updates when visible
          viewer.setMouseNavEnabled(true);
        } else {
          // Pause viewer updates when not visible
          viewer.setMouseNavEnabled(false);
        }
      });
    },
    { threshold: 0.1 }
  );

  observer.observe(mainEl);
}

/**
 * Update the model context with current document info
 */
function updateModelContext(doc: DocumentData): void {
  app.updateModelContext({
    structuredContent: {
      documentId: doc.id,
      inventory: doc.metadata.inventory,
      scan: doc.metadata.scan,
      languages: doc.metadata.languages,
      transcriptionPreview: doc.transcription.slice(0, 10).join('\n'),
      hasNext: !!doc.navigation.next,
      hasPrev: !!doc.navigation.prev,
      archivalContext: doc.archivalContext || null,
    },
  });
}

/**
 * Show error state
 */
function showError(title: string, message: string): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  appEl.innerHTML = `
    <div class="error">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
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

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape special regex characters
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    if (context?.theme) {
      applyDocumentTheme(context.theme);
    }
    if (context?.styles?.variables) {
      applyHostStyleVariables(context.styles.variables);
    }
    if (context?.styles?.css?.fonts) {
      applyHostFonts(context.styles.css.fonts);
    }
    if (context?.safeAreaInsets) {
      const { top, right, bottom, left } = context.safeAreaInsets;
      document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    }
  } catch (error) {
    console.error('Failed to connect:', error);
    showError('Connection failed', 'Could not connect to the MCP host');
  }
})();
