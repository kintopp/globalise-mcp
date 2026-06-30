/**
 * Pure (browser-free) presentation helpers extracted from viewer.ts so they
 * can be unit-tested under node — viewer.ts pulls in the image viewer SDK and
 * the MCP app runtime and can't load outside a DOM. Structurally mirrors
 * parse-result.ts (the other browser-free slice); test-viewer-render.ts
 * exercises this file.
 *
 * All functions are stateless pure functions: same inputs → same HTML string.
 * None reads or writes DOM, accesses `window`/`document`, or imports browser-
 * or bundler-only packages.
 */

// The wire types are the server's own zod-inferred types, so the contract is
// defined once. `import type` is erased by esbuild, so zod and the rest of the
// server graph never enter the viewer bundle.
import type { ViewDocumentUiOutput, ArchivalContext } from '../../../src/tools/document-viewer.js';

type DocumentData = ViewDocumentUiOutput;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/**
 * Escape HTML special characters. A regex map, not a throwaway
 * `document.createElement('div')` per call (CODE-REVIEW finding 20) — and it
 * also escapes quotes, which the textContent approach left intact even though
 * this is used inside title="..." attributes.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Escape special regex characters
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate URL protocol to prevent javascript: and data: injection
 */
export function sanitizeUrl(url: string): string {
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

/**
 * Render transcription lines with optional highlighting
 */
export function renderTranscription(lines: string[], highlightTerms: string[]): string {
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
 * Build HTML for archival context section
 */
export function buildArchivalContextHtml(ctx: ArchivalContext | undefined): string {
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
export function headerInnerHtml(doc: DocumentData): string {
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

/** Footer page-info string. Single source for renderDocument + swapDocument. */
export function pageInfoText(doc: DocumentData): string {
  return `Page ${doc.metadata.scan} of inventory ${doc.metadata.inventory}`;
}
