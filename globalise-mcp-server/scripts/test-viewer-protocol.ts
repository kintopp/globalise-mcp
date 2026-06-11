/**
 * Cross-check that the server's view_document_ui output contract and the
 * viewer's parse path still agree (CODE-REVIEW finding 10).
 *
 * The server's zod schema (viewDocumentUiOutputSchema) is the single source of
 * the wire type; the viewer imports its inferred type. This feeds a
 * schema-validated payload through the viewer's parseDocumentResult, so a
 * server-side field rename (which changes the schema) can't silently break the
 * iframe's `id`-based detection without failing here. Before this, `npm test`
 * only checked that the viewer *built* — never that it could parse a real
 * server payload.
 */

import { viewDocumentUiOutputSchema } from '../src/tools/document-viewer.js';
import { parseDocumentResult } from '../apps/document-viewer/src/parse-result.js';
import { check, finish } from './test-utils.js';

// A representative payload — exactly the shape the server emits as
// structuredContent.
const sample = {
  id: 'urn:globalise:NL-HaNA_1.04.02_9966_0106',
  iiifImageUrl: 'https://service.archief.nl/iip/example.jp2/full/max/0/default.jpg',
  transcription: ['Eerste regel', 'tweede regel'],
  metadata: {
    inventory: '9966',
    scan: '0106',
    languages: [{ code: 'nld', label: 'Dutch' }],
    license: 'CC-BY-4.0',
  },
  navigation: { prev: null, next: 'urn:globalise:NL-HaNA_1.04.02_9966_0107' },
  urls: {
    viewer: 'https://transcriptions.globalise.huygens.knaw.nl/detail/NL-HaNA_1.04.02_9966_0106',
    archive: null,
  },
  highlight: [],
};

function main() {
  console.log('1. sample payload matches the server output schema');
  let payload: ReturnType<typeof viewDocumentUiOutputSchema.parse>;
  try {
    // If a field were renamed in the schema without updating this sample, parse
    // throws and the contract drift is caught here.
    payload = viewDocumentUiOutputSchema.parse(sample);
    check(true, 'sample validates against viewDocumentUiOutputSchema');
  } catch (e) {
    check(false, `sample validates against viewDocumentUiOutputSchema (${e})`);
    finish('Viewer protocol tests');
    return;
  }

  console.log('2. the viewer parses a server-built payload');
  // structuredContent channel (the default): the viewer must detect + return it.
  const fromStructured = parseDocumentResult({ structuredContent: payload });
  check(fromStructured?.id === sample.id, 'parses schema-valid structuredContent (id detection holds)');

  // Legacy dual-content fallback (STRUCTURED_CONTENT=false): [summary, JSON].
  const fromDualContent = parseDocumentResult({
    content: [
      { type: 'text', text: 'human-readable summary' },
      { type: 'text', text: JSON.stringify(payload) },
    ],
  });
  check(fromDualContent?.id === sample.id, 'parses the legacy dual-content JSON fallback');

  console.log('3. detection guards the contract');
  // A payload without `id` (e.g. a server-side field rename) must NOT be
  // accepted as structuredContent.
  const withoutId: Record<string, unknown> = { ...payload };
  delete withoutId.id;
  check(parseDocumentResult({ structuredContent: withoutId }) === null, 'structuredContent without id is rejected');

  // A non-error result with no usable payload returns null (→ viewer shows an error).
  check(parseDocumentResult({ content: [{ type: 'text', text: 'not json' }] }) === null, 'unparseable content returns null');

  finish('Viewer protocol tests');
}

main();
