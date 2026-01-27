/**
 * GLOBALISE Document Viewer - MCP App Client
 *
 * Interactive viewer for VOC transcription pages with:
 * - IIIF scanned images via OpenSeadragon
 * - Transcribed text with search term highlighting
 * - Page navigation (prev/next)
 */

// Import from CDN-bundled version for browser use
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from 'https://unpkg.com/@modelcontextprotocol/ext-apps@1.0.1/app-with-deps';

// OpenSeadragon is loaded globally via CDN
declare const OpenSeadragon: typeof import('openseadragon');

// Document data structure from tool result
interface DocumentData {
  id: string;
  iiifImageUrl: string;
  transcription: string[];
  metadata: {
    inventory: string;
    scan: string;
    languages: Array<{ code: string; label: string }>;
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
}

// App state
let currentDocument: DocumentData | null = null;
let viewer: OpenSeadragon.Viewer | null = null;

// Initialize the MCP App
const app = new App(
  { name: 'GLOBALISE Document Viewer', version: '1.0.0' },
  { tools: { listChanged: false } },
  { autoResize: true }
);

/**
 * Handle tool result from the server
 */
app.ontoolresult = (result) => {
  console.log('Tool result received:', result);

  // Check for error
  if (result.isError) {
    showError('Error loading document', result.content?.[0]?.text || 'Unknown error');
    return;
  }

  // Parse structured content or text content
  let data: DocumentData | null = null;

  if (result.structuredContent) {
    data = result.structuredContent as DocumentData;
  } else if (result.content?.[0]?.type === 'text') {
    try {
      data = JSON.parse(result.content[0].text) as DocumentData;
    } catch (e) {
      showError('Error parsing document', 'Invalid response format');
      return;
    }
  }

  if (data) {
    currentDocument = data;
    renderDocument(data);
    updateModelContext(data);
  }
};

/**
 * Handle host context changes (theme, etc.)
 */
app.onhostcontextchanged = (params) => {
  if (params.theme) {
    applyDocumentTheme(params.theme);
  }
  if (params.styles?.variables) {
    applyHostStyleVariables(params.styles.variables);
  }
};

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

  // Build external links
  const externalLinks = [
    `<a href="${doc.urls.viewer}" target="_blank" rel="noopener">GLOBALISE Viewer</a>`,
    doc.urls.archive
      ? `<a href="${doc.urls.archive}" target="_blank" rel="noopener">National Archives</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  appEl.innerHTML = `
    <header class="header">
      <h1>${escapeHtml(doc.id.replace('urn:globalise:', ''))}</h1>
      <div class="metadata">
        <span>Inventory: ${escapeHtml(doc.metadata.inventory)}</span>
        <span>Scan: ${escapeHtml(doc.metadata.scan)}</span>
        <span>Language: ${languageBadges}</span>
      </div>
      <div class="external-links">${externalLinks}</div>
    </header>

    <div class="content">
      <div class="image-panel">
        <div id="openseadragon-viewer"></div>
        <div class="image-controls">
          <button id="zoom-in" title="Zoom In">+</button>
          <button id="zoom-out" title="Zoom Out">-</button>
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

    <nav class="navigation">
      <button id="nav-prev" ${!doc.navigation.prev ? 'disabled' : ''}>
        ← Previous
      </button>
      <span class="page-info">Page ${escapeHtml(doc.metadata.scan)}</span>
      <button id="nav-next" ${!doc.navigation.next ? 'disabled' : ''}>
        Next →
      </button>
    </nav>
  `;

  // Initialize OpenSeadragon viewer
  initializeImageViewer(doc.iiifImageUrl);

  // Attach event listeners
  attachEventListeners(doc);
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
    const container = document.getElementById('openseadragon-viewer');
    if (container) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #888;">
          <div style="text-align: center;">
            <p>Image could not be loaded</p>
            <p style="font-size: 0.8em; margin-top: 0.5rem;">
              <a href="${imageUrl}" target="_blank" style="color: #4a9eff;">Open image directly</a>
            </p>
          </div>
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
 * Attach event listeners for navigation and controls
 */
function attachEventListeners(doc: DocumentData): void {
  // Navigation buttons
  const prevBtn = document.getElementById('nav-prev');
  const nextBtn = document.getElementById('nav-next');

  prevBtn?.addEventListener('click', () => {
    if (doc.navigation.prev) {
      navigateToDocument(doc.navigation.prev);
    }
  });

  nextBtn?.addEventListener('click', () => {
    if (doc.navigation.next) {
      navigateToDocument(doc.navigation.next);
    }
  });

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
 * Navigate to a different document page
 */
async function navigateToDocument(documentId: string): Promise<void> {
  // Show loading state
  const transcription = document.getElementById('transcription');
  if (transcription) {
    transcription.innerHTML = '<div class="loading">Loading...</div>';
  }

  try {
    // Call the server tool to get the new document
    const result = await app.callServerTool('globalise_view_document_ui', {
      documentId,
      highlightTerms: currentDocument?.highlight || [],
    });

    // The result will be handled by ontoolresult callback
    console.log('Navigation result:', result);
  } catch (error) {
    console.error('Navigation error:', error);
    showError('Navigation failed', error instanceof Error ? error.message : 'Unknown error');
  }
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
      <button onclick="location.reload()">Reload</button>
    </div>
  `;
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

// Connect to the MCP host
(async () => {
  try {
    await app.connect();
    console.log('Connected to MCP host');

    // Apply initial host context
    const context = app.getHostContext();
    if (context?.theme) {
      applyDocumentTheme(context.theme);
    }
  } catch (error) {
    console.error('Failed to connect:', error);
    showError('Connection failed', 'Could not connect to the MCP host');
  }
})();
