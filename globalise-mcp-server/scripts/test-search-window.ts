/**
 * Offline test of globalise_search_transcriptions' matchAll candidate window and
 * upstream facet parsing, against a stubbed upstream that records request URLs.
 *
 * Failure modes guarded:
 *   - the matchAll window is sized by `size` (size × 10) instead of the fixed
 *     500-hit cap the tool documents;
 *   - `from` past the matched pages silently yields an empty page with no
 *     explanation;
 *   - an exact total (upstream had fewer hits than the window) is reported as a
 *     lower bound;
 *   - upstream facet order (count-descending) is lost on parse, because JS
 *     enumerates integer-like object keys in ascending numeric order.
 *
 * Run with: npm run test:search-window
 */

import { searchTranscriptions, searchTranscriptionsInputSchema } from '../src/tools/search.js';
import { API_CONFIG } from '../src/utils/api-client.js';
import { check, finish, withRecordingFetch } from './test-utils.js';

API_CONFIG.REQUEST_DELAY_MS = 0;

interface Case {
  upstreamTotal: number;
  results: object[];
  aggsJson?: string;
}

const page = (i: number, bilingual: boolean) => ({
  _id: `urn:globalise:NL-HaNA_1.04.02_9966_${String(i + 1).padStart(4, '0')}`,
  document: `NL-HaNA_1.04.02_9966_${String(i + 1).padStart(4, '0')}`,
  invNr: '9966',
  textTokenCount: 100,
  _hits: { text: [] },
  langIso: bilingual ? ['nld', 'lat'] : ['lat'],
  langLabel: bilingual ? ['Dutch', 'Latin'] : ['Latin'],
});

const json = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

// Honours `size` like upstream, so a too-small window shows up as fewer results.
const respond = ({ upstreamTotal, results, aggsJson }: Case) => (url: string): Response => {
  if (url.includes('/brinta/globalise/indices')) {
    return json(JSON.stringify({
      [API_CONFIG.DEFAULT_INDEX]: { text: 'text', langIso: 'keyword', invNr: 'keyword', document: 'keyword' },
    }));
  }
  const size = Number(new URL(url).searchParams.get('size'));
  const aggs = aggsJson ? `,"aggs":{"invNr":${aggsJson},"document":{}}` : '';
  return json(
    `{"total":{"value":${upstreamTotal},"relation":"eq"},"results":${JSON.stringify(results.slice(0, size))}${aggs}}`,
  );
};

const run = (data: Case, args: Record<string, unknown>) =>
  withRecordingFetch(respond(data), () =>
    searchTranscriptions(searchTranscriptionsInputSchema.parse(args)),
  );

const matchAllArgs = { query: 'peper', languages: ['nld', 'lat'], matchAll: true, size: 10 };
const big: Case = {
  upstreamTotal: 1000,
  results: Array.from({ length: 1000 }, (_, i) => page(i, i % 5 === 0)),
};

console.log('1. matchAll scans the full 500-hit window regardless of size');
{
  const r = await run(big, { ...matchAllArgs, from: 0 });
  const searchUrl = new URL(r.urls.find(u => u.includes('/projects/globalise/search'))!);
  check(r.error === undefined, `no error (${JSON.stringify(r.error)})`);
  check(searchUrl.searchParams.get('size') === '500', `upstream size=500 (got ${searchUrl.searchParams.get('size')})`);
  check(searchUrl.searchParams.get('from') === '0', `upstream from=0 (got ${searchUrl.searchParams.get('from')})`);
  const out = r.value!;
  check(out.total.relation === 'gte', `window truncated: total is a lower bound (got ${out.total.relation})`);
  check(out.total.value === 100, `100 bilingual pages in 500 candidates (got ${out.total.value})`);
  check(out.results.length === 10, `page holds 10 results (got ${out.results.length})`);
  check(out.pagination.hasMore === true, 'hasMore is true');
}

console.log('2. paging past the matched pages');
{
  const last = await run(big, { ...matchAllArgs, from: 90 });
  check(last.value?.results.length === 10, `from=90 returns the final 10 (got ${last.value?.results.length})`);
  const past = await run(big, { ...matchAllArgs, from: 100 });
  check(past.value?.results.length === 0, `from=100 returns nothing (got ${past.value?.results.length})`);
  check(past.value?.pagination.hasMore === false, 'from=100 hasMore is false');
  check(
    Boolean(past.value?.note?.includes('only 100 matches lie within')),
    `from=100 explains the window limit (got: ${past.value?.note})`,
  );
}

console.log('3. exhausted window reports an exact total');
{
  const small: Case = { upstreamTotal: 30, results: Array.from({ length: 30 }, (_, i) => page(i, true)) };
  const r = await run(small, { ...matchAllArgs, from: 0 });
  check(r.value?.total.relation === 'eq', `relation eq (got ${r.value?.total.relation})`);
  check(r.value?.total.value === 30, `total 30 (got ${r.value?.total.value})`);
  check(
    Boolean(r.value?.note?.includes('scanned all 30 candidates')),
    `note says all candidates scanned (got: ${r.value?.note})`,
  );
}

console.log('4. upstream facet order is preserved (count descending)');
{
  const data: Case = {
    upstreamTotal: 3,
    results: [page(0, false), page(1, false), page(2, false)],
    aggsJson: '{"4293": 40, "9966": 12, "1068": 5}',
  };
  const r = await run(data, { query: 'peper', includeAggregations: true });
  const order = r.value?.aggregations?.topInventoryNumbers?.map(x => x.inventoryNumber);
  check(
    JSON.stringify(order) === JSON.stringify(['4293', '9966', '1068']),
    `topInventoryNumbers in count order (got ${JSON.stringify(order)})`,
  );
}

finish('Search window test');
