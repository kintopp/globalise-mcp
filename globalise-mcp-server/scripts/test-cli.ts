/**
 * Live smoke test for the headless CLI (scripts/cli.mjs): the verbs backed by the
 * upstream Transcriptions API (search/retrieve/navigate), over the cold-stdio transport.
 * Parsing, help, usage errors and the local-DB verbs are in test-cli-offline.ts.
 *
 * The CLI is an MCP *client*: a CLI query and an LLM query call the same
 * callTool() on the same server, so this doubles as an end-to-end smoke test.
 *
 * Requires:  npm run build  + the decompressed DBs in data/  +  NETWORK.
 * Run:       npm run test:cli
 *
 * Deliberately NOT in the default `npm test` chain — it needs a healthy upstream,
 * mirroring test:live / test:mcpb.
 */
import { check, checkEvery, finish, helpExampleArgv, runCli } from './test-utils.js';

// Stable, known-good document used throughout the repo's docs (..._0107 exists).
const DOC = 'NL-HaNA_1.04.02_9966_0106';
const VERBS = ['search', 'find', 'commodity', 'measure', 'retrieve', 'navigate'];

const jsonlRows = (s: string): any[] =>
  s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

async function main() {
  console.log('1. retrieve <DOC> --fields id,inventoryNumber');
  {
    const r = await runCli(['retrieve', DOC, '--fields', 'id,inventoryNumber']);
    check(r.code === 0, 'exit 0');
    const obj = safe(() => JSON.parse(r.stdout.trim()), null) as any;
    check(obj && typeof obj.id === 'string' && obj.id.includes(DOC), `id contains the doc (got ${obj?.id})`);
    check(obj && obj.inventoryNumber === '9966', `inventoryNumber === 9966 (got ${obj?.inventoryNumber})`);
    check(
      obj && Object.keys(obj).every((k) => k === 'id' || k === 'inventoryNumber'),
      'projection kept only the requested fields',
    );
  }

  console.log('2. search "peper" --max 3 --fields id,document');
  {
    const r = await runCli(['search', 'peper', '--max', '3', '--fields', 'id,document']);
    check(r.code === 0, 'exit 0');
    const rows = safe(() => jsonlRows(r.stdout), []);
    check(rows.length >= 1 && rows.length <= 3, `1–3 JSONL rows (got ${rows.length})`);
    checkEvery(rows, (row) => 'id' in row && 'document' in row, 'each row is valid JSON with id + document');
    check(/\bshown\b/.test(r.stderr), 'stderr carries a count/pagination summary');
    check(/pass --offset 3 for more/.test(r.stderr), 'hasMore → "pass --offset 3"');
  }

  console.log("3. matchAll → relation 'gte': ≥ total, and the --offset hint still follows hasMore");
  {
    // matchAll post-filters a capped candidate window, so total.relation is 'gte' unconditionally.
    const r = await runCli(['search', 'Radja', '--languages', 'nld,msa', '--matchAll', '--max', '1', '--fields', 'id']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(/≥/.test(r.stderr), 'stderr summary marks the total as a lower bound (≥)');
    check(/pass --offset 1 for more/.test(r.stderr), 'a lower-bound total still gets the --offset hint');
  }

  console.log('4. every help example runs and returns output (catches stale document IDs)');
  for (const verb of VERBS) {
    const argv = helpExampleArgv((await runCli([verb, '--help'])).stdout);
    if (!argv) { check(false, `${verb}: no example in --help`); continue; }
    const r = await runCli(argv);
    check(r.code === 0 && r.stdout.trim() !== '', `${verb}: example exits 0 with output (exit ${r.code})`);
  }

  finish('CLI smoke test');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
