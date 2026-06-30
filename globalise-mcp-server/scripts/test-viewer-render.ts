/**
 * Unit tests for the pure render helpers in apps/document-viewer/src/render.ts
 * Exercises: escapeHtml, escapeRegex, sanitizeUrl, renderTranscription,
 * buildArchivalContextHtml, headerInnerHtml, pageInfoText.
 *
 * Runs under tsx (browser-free Node environment) — render.ts has no DOM/OSD
 * imports, so it loads cleanly here. Structurally mirrors test-viewer-protocol.ts.
 */

import type { ViewDocumentUiOutput, ArchivalContext } from '../src/tools/document-viewer.js';
import {
  escapeHtml,
  escapeRegex,
  sanitizeUrl,
  renderTranscription,
  buildArchivalContextHtml,
  headerInnerHtml,
  pageInfoText,
} from '../apps/document-viewer/src/render.js';
import { check, finish } from './test-utils.js';

function main(): void {
  // ── escapeHtml ──────────────────────────────────────────────────────────────
  console.log('1. escapeHtml');
  check(
    escapeHtml('<a x="y">&\'') === '&lt;a x=&quot;y&quot;&gt;&amp;&#39;',
    'all five special chars escaped in one pass',
  );
  check(escapeHtml('no specials') === 'no specials', 'clean string passes through unchanged');

  // ── escapeRegex ─────────────────────────────────────────────────────────────
  console.log('2. escapeRegex');
  check(escapeRegex('a.b*c') === 'a\\.b\\*c', 'dot and star are backslash-escaped');
  check(escapeRegex('a[b]') === 'a\\[b\\]', 'square brackets escaped');
  check(escapeRegex('hello') === 'hello', 'plain string unchanged');

  // ── sanitizeUrl ─────────────────────────────────────────────────────────────
  console.log('3. sanitizeUrl');
  const httpUrl = 'http://example.com/foo';
  const httpsUrl = 'https://service.archief.nl/iip/example.jp2/full/max/0/default.jpg';
  check(sanitizeUrl(httpUrl) === httpUrl, 'http:// passes through');
  check(sanitizeUrl(httpsUrl) === httpsUrl, 'https:// passes through');
  check(sanitizeUrl('javascript:alert(1)') === '#', 'javascript: blocked → #');
  check(sanitizeUrl('data:text/html,<h1>x</h1>') === '#', 'data: blocked → #');
  check(sanitizeUrl('not a url') === '#', 'non-URL string → #');
  check(sanitizeUrl('') === '#', 'empty string → #');

  // ── renderTranscription ─────────────────────────────────────────────────────
  console.log('4. renderTranscription');

  // Line numbers are 1-based
  const oneLineHtml = renderTranscription(['hello'], []);
  check(oneLineHtml.includes('<span class="line-number">1</span>'), 'line numbers are 1-based');

  // Empty line renders &nbsp;
  const emptyLineHtml = renderTranscription([''], []);
  check(emptyLineHtml.includes('&nbsp;'), 'empty line renders &nbsp;');

  // HTML in a line is escaped (no raw < leaks)
  const htmlLineHtml = renderTranscription(['<b>bold</b>'], []);
  check(!htmlLineHtml.includes('<b>'), 'HTML in a line is escaped');
  check(htmlLineHtml.includes('&lt;b&gt;'), 'angle brackets become entities');

  // Highlight term wraps in <mark> (case-insensitive)
  const highlightHtml = renderTranscription(['Hello World'], ['hello']);
  check(highlightHtml.includes('<mark>Hello</mark>'), 'matching term wrapped in <mark>');
  const upperHtml = renderTranscription(['PEPER en thee'], ['peper']);
  check(upperHtml.includes('<mark>PEPER</mark>'), 'highlight is case-insensitive');

  // Empty-string highlight term produces no <mark> (filter(Boolean) drops '')
  const emptyTermHtml = renderTranscription(['a b'], ['']);
  check(!emptyTermHtml.includes('<mark>'), 'empty highlight term produces no <mark>');

  // Characterization: whitespace-only term (' ') DOES survive filter(Boolean) and wraps spaces.
  // This locks current behavior — any change is a separate, explicitly-scoped decision.
  const spaceTermHtml = renderTranscription(['a b c'], [' ']);
  check(spaceTermHtml.includes('<mark> </mark>'), 'space-only term wraps spaces (current behavior, not a bug fix)');

  // ── buildArchivalContextHtml ─────────────────────────────────────────────────
  console.log('5. buildArchivalContextHtml');

  check(buildArchivalContextHtml(undefined) === '', 'undefined → empty string');
  check(
    buildArchivalContextHtml({ source: 'none', inventoryTotal: 0 } as ArchivalContext) === '',
    '{ source: "none" } → empty string',
  );

  // Context with settlements and yearRange produces .archival-context block
  const ctx: ArchivalContext = {
    source: 'obp',
    inventoryTotal: 5,
    settlements: ['Batavia'],
    yearRange: { from: 1680, to: 1685 },
  };
  const ctxHtml = buildArchivalContextHtml(ctx);
  check(ctxHtml.includes('class="archival-context"'), 'produces .archival-context block');
  check(ctxHtml.includes('Batavia'), 'settlement appears in output');

  // description containing < is escaped
  const ctxWithDesc: ArchivalContext = {
    source: 'gm',
    inventoryTotal: 3,
    description: 'Notes <draft> only',
  };
  const descHtml = buildArchivalContextHtml(ctxWithDesc);
  check(!descHtml.includes('<draft>'), 'description < is escaped — no raw tag in output');
  check(descHtml.includes('&lt;draft&gt;'), 'description angle-brackets become entities');

  // ── headerInnerHtml ──────────────────────────────────────────────────────────
  console.log('6. headerInnerHtml');

  // Fuller fixture: must populate languages (array), urls.viewer (passed to
  // sanitizeUrl → new URL()), and id (string) at minimum or the call throws.
  // Mirrors the pattern in test-viewer-protocol.ts.
  const doc: ViewDocumentUiOutput = {
    id: 'urn:globalise:NL-HaNA_1.04.02_9966_0106',
    iiifImageUrl: 'https://service.archief.nl/iip/example.jp2/full/max/0/default.jpg',
    transcription: [],
    metadata: {
      inventory: '9966',
      scan: '0106',
      languages: [{ code: 'nld', label: 'Dutch' }],
      license: 'CC-BY-4.0',
    },
    navigation: { prev: null, next: null },
    urls: {
      viewer: 'https://transcriptions.globalise.huygens.knaw.nl/detail/NL-HaNA_1.04.02_9966_0106',
      archive: null,
    },
    highlight: [],
  };

  const hdrHtml = headerInnerHtml(doc);

  // urn:globalise: prefix is stripped from the <h1> title
  check(hdrHtml.includes('NL-HaNA_1.04.02_9966_0106'), 'document id without urn prefix appears in header');
  check(!hdrHtml.includes('urn:globalise:'), 'urn:globalise: prefix is stripped');

  // License present → License: span appears
  check(hdrHtml.includes('License: CC-BY-4.0'), 'license span present when license is set');

  // License absent → License: span absent
  const docNoLicense: ViewDocumentUiOutput = {
    ...doc,
    metadata: { ...doc.metadata, license: undefined },
  };
  const hdrNoLicense = headerInnerHtml(docNoLicense);
  check(!hdrNoLicense.includes('License:'), 'license span absent when license is not set');

  // External viewer link runs through sanitizeUrl (must appear unsanitized for http/https)
  check(
    hdrHtml.includes('https://transcriptions.globalise.huygens.knaw.nl'),
    'viewer URL present in external link',
  );

  // ── pageInfoText ─────────────────────────────────────────────────────────────
  console.log('7. pageInfoText');
  check(
    pageInfoText(doc) === 'Page 0106 of inventory 9966',
    'formats scan + inventory correctly',
  );

  finish('Viewer render tests');
}

main();
