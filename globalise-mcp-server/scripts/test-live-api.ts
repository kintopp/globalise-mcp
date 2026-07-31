/**
 * Live integration tests for the four network-backed tools —
 * globalise_search_transcriptions, globalise_retrieve_document,
 * globalise_navigate, globalise_inspect_page_image — which the rest of the
 * suite never executes (it covers the two local-SQLite tools +
 * registration/schemas only). Every result is validated against the tool's
 * own OUTPUT zod schema, so this suite is also the upstream-contract-drift
 * detector: if the Broccoli API (or the service.archief.nl IIIF image stack)
 * changes shape, a `.parse()` here fails.
 *
 * Plain Node script (no framework). Imports the tools directly from src via
 * tsx — no build needed, but it requires NETWORK and a healthy upstream, so it
 * is deliberately NOT in the `npm test` chain. Run on demand / on a schedule.
 *
 * Run with: npm run test:live
 */

import {
  searchTranscriptions,
  searchTranscriptionsInputSchema,
  searchOutputSchema,
} from '../src/tools/search.js';
import {
  getDocument,
  getDocumentOutputSchema,
} from '../src/tools/document.js';
import {
  navigate,
  navigateInputSchema,
  navigateOutputSchema,
} from '../src/tools/convenience.js';
import {
  inspectPageImage,
  inspectPageImageInputSchema,
  inspectPageImageOutputSchema,
} from '../src/tools/page-image.js';
import { check, finish } from './test-utils.js';

// Stable, known-good document used throughout the repo's docs; ..._0107 exists.
const DOC = 'NL-HaNA_1.04.02_9966_0106';
const DOC_URN = `urn:globalise:${DOC}`;

async function main() {
  console.log('1. search, basic (peper)');
  const basic = searchOutputSchema.parse(
    await searchTranscriptions(searchTranscriptionsInputSchema.parse({ query: 'peper', size: 2 })),
  );
  check(basic.total.value > 100, `peper has many hits (total.value=${basic.total.value})`);
  check(basic.results.length === 2, `size=2 returns 2 results (got ${basic.results.length})`);
  check(/^urn:globalise:NL-HaNA_/.test(basic.results[0].id), `first result id is a globalise document URN (got ${basic.results[0].id})`);
  check(basic.aggregations !== undefined, 'aggregations present on the default path');

  console.log('2. search, filtered by inventory 9966');
  const filtered = searchOutputSchema.parse(
    await searchTranscriptions(searchTranscriptionsInputSchema.parse({ query: 'peper', inventoryNumber: '9966', size: 2 })),
  );
  check(
    filtered.results.every((r) => r.inventoryNumber === '9966'),
    `every filtered result is in inventory 9966 (got ${JSON.stringify(filtered.results.map((r) => r.inventoryNumber))})`,
  );

  console.log('3. search, matchAll path (Dutch + Malay)');
  const matchAll = searchOutputSchema.parse(
    await searchTranscriptions(
      searchTranscriptionsInputSchema.parse({ query: '*', languages: ['Dutch', 'Malay'], matchAll: true, size: 3 }),
    ),
  );
  check(Boolean(matchAll.note && /scan|cap|lower bound/i.test(matchAll.note)), `matchAll note mentions the scan cap (got: ${matchAll.note})`);
  check(matchAll.total.relation === 'gte', `matchAll total is a lower bound (relation=${matchAll.total.relation})`);
  check(
    matchAll.results.every((r) => {
      const codes = r.languages.map((l) => l.code);
      return codes.includes('nld') && codes.includes('msa');
    }),
    'every matchAll result page carries both nld and msa',
  );

  console.log('4. retrieve a known-good page');
  const doc = getDocumentOutputSchema.parse(await getDocument({ documentId: DOC }));
  check(doc.id === DOC_URN, `retrieve normalizes id to URN (got ${doc.id})`);
  const lineCount = doc.text?.lines.length ?? 0;
  check(lineCount > 0, `page has transcribed lines (${lineCount})`);
  const langCount = doc.metadata?.languages.length ?? 0;
  check(langCount > 0, `page metadata lists languages (${langCount})`);
  check(
    Boolean(doc.urls?.transcriptionsViewer.startsWith('https://transcriptions.globalise')),
    `viewer URL points at the GLOBALISE viewer (got ${doc.urls?.transcriptionsViewer})`,
  );

  console.log('5. navigate to the next page');
  const nav = navigateOutputSchema.parse(
    await navigate(navigateInputSchema.parse({ currentDocumentId: DOC, direction: 'next' })),
  );
  check(nav.success === true, `navigation succeeded (message: ${nav.message})`);
  check(nav.targetDocument?.scanNumber === '0107', `next page is scan 0107 (got ${nav.targetDocument?.scanNumber})`);

  console.log('6. retrieve with URN-form input (normalization round-trip)');
  const urnDoc = getDocumentOutputSchema.parse(await getDocument({ documentId: DOC_URN }));
  check(urnDoc.id === DOC_URN, `URN input yields the same id as bare-id input (got ${urnDoc.id})`);

  console.log('7. inspect a page-image region (IIIF crop path)');
  // A pct: region exercises the full pipeline — document resolution, the
  // info.json dims fetch, the never-upscale clamp, and the crop bytes fetch.
  // navigateViewer: false keeps the call pure (no viewer session exists here).
  const inspected = await inspectPageImage(
    inspectPageImageInputSchema.parse({
      documentId: DOC,
      region: 'pct:25,25,50,25',
      size: 400,
      navigateViewer: false,
    }),
  );
  check(inspected.ok === true, `inspect succeeded${inspected.ok ? '' : ` (error: ${inspected.error})`}`);
  if (inspected.ok) {
    const meta = inspectPageImageOutputSchema.parse(inspected.meta);
    check(inspected.image.base64.length > 1000, `image bytes returned (base64 length ${inspected.image.base64.length})`);
    check(/^image\//.test(inspected.image.mimeType), `image mimeType (got ${inspected.image.mimeType})`);
    check(meta.documentId === DOC_URN, `meta.documentId is the URN (got ${meta.documentId})`);
    check(
      typeof meta.nativeWidth === 'number' && meta.nativeWidth > 0,
      `native dims resolved from info.json (nativeWidth=${meta.nativeWidth})`,
    );
    check(
      typeof meta.cropPixelWidth === 'number' && meta.cropPixelWidth <= 400,
      `crop honors the requested size (cropPixelWidth=${meta.cropPixelWidth})`,
    );
  }

  finish('Live API');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
