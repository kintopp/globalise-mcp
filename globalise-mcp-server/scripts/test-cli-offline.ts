/**
 * Offline tests for the headless CLI (scripts/cli.mjs): parsing, help, --show-call,
 * usage errors and exit codes (0 ok / 1 tool error / 2 usage error), the local-DB `find`
 * verb, and the upstream-backed verbs against a local stub (BROCCOLI_BASE_URL). Nothing here
 * reaches the real upstream; `test:cli` covers that contract.
 *
 * Requires: npm run build (the stdio path spawns dist/index.js) + the decompressed DBs.
 *
 * Ways the CLI could fail that this suite pins:
 *   - --max/--offset on a single-page verb (retrieve/navigate) reaches the server's strict
 *     schema and fails as a tool error (exit 1) instead of a usage error (exit 2).
 *   - --max/--offset stop resolving to size/from on the list verbs.
 *   - An unknown flag or a missing required param prints as a clean --show-call, or is
 *     only rejected by the server (exit 1).
 *   - A dashed/underscored spelling of a camelCase flag gets no "Did you mean" hint.
 *   - --stdin demands the positional before reading stdin (false failure), or lets an
 *     unknown flag through.
 *   - The server's own stderr log lines leak into the CLI's stderr channel.
 *   - A help example uses a flag or shape the live schema doesn't accept.
 *   - BROCCOLI_BASE_URL is ignored, so "offline" runs silently hit the real upstream.
 *   - Upstream-backed output loses its shape: search stops being JSONL with an --offset hint
 *     (or keeps the hint on the last page), retrieve/navigate stop being one JSON object.
 *   - A retrieve/navigate transcription trimmed to the response budget reaches the user with
 *     no note, so missing lines read as the end of the page.
 */
import { check, checkEvery, finish, helpExampleArgv, runCli, startUpstreamStub } from './test-utils.js';

const DOC = 'NL-HaNA_1.04.02_9966_0106';
const VERBS = ['search', 'find', 'commodity', 'measure', 'retrieve', 'navigate'];
const DEAD_HTTP = 'http://127.0.0.1:1/mcp';

const jsonlRows = (s: string): any[] =>
  s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const showCall = async (...args: string[]) => {
  const r = await runCli(['--show-call', ...args]);
  return { ...r, call: safe(() => JSON.parse(r.stdout.trim()), null) as any };
};

async function main() {
  console.log('1. tools --json');
  {
    const r = await runCli(['tools', '--json']);
    check(r.code === 0, 'exit 0');
    const tools = safe(() => JSON.parse(r.stdout) as any[], []);
    check(Array.isArray(tools) && tools.length === 6, `6 in-scope tools (got ${tools.length})`);
    const names = new Set(tools.map((t) => t.name));
    check(
      names.has('globalise_search_transcriptions') &&
        names.has('globalise_retrieve_document') &&
        names.has('globalise_navigate'),
      'includes search + retrieve + navigate',
    );
    check(!names.has('globalise_view_document_ui'), 'excludes the viewer/stateful tool');
    checkEvery(tools, (t) => !!t.inputSchema && typeof t.inputSchema === 'object', 'each entry carries an inputSchema');
  }

  console.log('2. tools --compact');
  {
    const r = await runCli(['tools', '--compact']);
    check(r.code === 0, 'exit 0');
    const manifest = safe(() => JSON.parse(r.stdout) as any[], []);
    check(Array.isArray(manifest) && manifest.length === 6, `6 in-scope tools (got ${manifest.length})`);
    const search = manifest.find((m) => m.tool === 'globalise_search_transcriptions');
    check(search && search.verb === 'search' && search.positional === 'query', 'search entry: verb + positional');
    check(search && search.result === 'results' && search.page === 'offset', 'search entry: result/list key + paging');
    check(search && search.args && search.args.query === 'string', 'args carry name→type (query: string), no schema');
    const retrieve = manifest.find((m) => m.tool === 'globalise_retrieve_document');
    check(retrieve && retrieve.result === 'single', 'single-object tool reports result:single');
    const navigate = manifest.find((m) => m.tool === 'globalise_navigate');
    check(navigate && /!$/.test(navigate.args.direction ?? ''), "required arg marked with trailing '!'");
    const full = await runCli(['tools', '--json']);
    check(r.stdout.length * 3 < full.stdout.length, `compact ≪ --json (${r.stdout.length} vs ${full.stdout.length} bytes)`);
  }

  console.log('3. --show-call resolves positionals per verb');
  {
    const s = await showCall('search', 'peper');
    check(s.code === 0, 'exit 0');
    check(s.call?.tool === 'globalise_search_transcriptions', `resolved tool name (got ${s.call?.tool})`);
    check(s.call?.arguments?.query === 'peper', 'positional → query=peper');
    const n = await showCall('navigate', DOC, '--direction', 'next');
    check(n.code === 0, 'navigate exit 0');
    check(n.call?.arguments?.currentDocumentId === DOC, 'navigate positional → currentDocumentId (NOT documentId)');
    check(n.call?.arguments?.direction === 'next', 'direction:"next" resolved');
    const l = await showCall('search', 'x', '--languages', 'nld,msa');
    check(
      Array.isArray(l.call?.arguments?.languages) && l.call.arguments.languages.length === 2,
      'comma-separated --languages splits into a 2-element array',
    );
  }

  console.log('4. --max/--offset resolve per verb');
  {
    const r = await showCall('search', 'peper', '--max', '3', '--offset', '20');
    check(r.call?.arguments?.size === 3 && r.call?.arguments?.from === 20, `--max → size, --offset → from (got ${JSON.stringify(r.call?.arguments)})`);
    const n = await showCall('find', 'x', '-n', '4');
    check(n.call?.arguments?.size === 4, '-n → size');
    const eq = await showCall('search', 'peper', '--max=5');
    check(eq.call?.arguments?.size === 5, `--max=5 → size:5 (got ${eq.call?.arguments?.size})`);
    for (const [verb, extra] of [['retrieve', []], ['navigate', ['--direction', 'next']]] as const) {
      const m = await showCall(verb, DOC, ...extra, '--max', '5');
      check(m.code === 2, `${verb} --max → exit 2 (got ${m.code})`);
      check(/--max\/-n is not a flag for "\w+"/.test(m.stderr), `${verb} --max names the flag + verb`);
      check(m.stdout === '', `${verb} --max prints no call`);
      const o = await showCall(verb, DOC, ...extra, '--offset', '1');
      check(o.code === 2, `${verb} --offset → exit 2 (got ${o.code})`);
    }
  }

  console.log('5. unknown flags + missing required params are usage errors before any call');
  {
    const u = await showCall('search', 'peper', '--bogus', '1');
    check(u.code === 2, `unknown flag → exit 2 (got ${u.code})`);
    check(u.stdout === '', 'no call printed');
    check(/--bogus is not a flag for "search"/.test(u.stderr) && /Tool flags: .*--inventoryNumber/.test(u.stderr), 'names the flag and lists the tool flags');
    const d = await showCall('search', 'peper', '--inventory-number', '9966');
    check(d.code === 2 && /Did you mean --inventoryNumber\?/.test(d.stderr), 'dashed spelling → "Did you mean --inventoryNumber?"');
    const us = await showCall('find', 'x', '--year_from', '1700');
    check(us.code === 2 && /Did you mean --yearFrom\?/.test(us.stderr), 'underscored spelling → "Did you mean --yearFrom?"');
    const valueless = await showCall('search', 'peper', '--typo');
    check(valueless.code === 2 && /--typo is not a flag/.test(valueless.stderr), 'value-less unknown flag reads as unknown, not "requires a value"');
    const req = await showCall('navigate', DOC);
    check(req.code === 2, `navigate without --direction → exit 2 (got ${req.code})`);
    check(/"navigate" requires <direction>/.test(req.stderr), 'names the missing required param');
  }

  console.log('6. --stdin validates flags up front, the positional per line');
  {
    const ok = await runCli(['search', '--stdin', '--show-call', '--max', '2'], { input: 'peper\nnoten\n' });
    check(ok.code === 0, `exit 0 (got ${ok.code}: ${ok.stderr.trim()})`);
    const calls = safe(() => jsonlRows(ok.stdout), []);
    check(calls.length === 2 && calls[1]?.arguments?.query === 'noten', 'one call per stdin line');
    const bad = await runCli(['search', '--stdin', '--show-call', '--nope', 'x'], { input: 'peper\n' });
    check(bad.code === 2 && /--nope is not a flag/.test(bad.stderr), 'unknown flag rejected before reading lines');
    const reqd = await runCli(['navigate', '--stdin', '--show-call', '--direction', 'next'], { input: `${DOC}\n` });
    check(reqd.code === 0 && safe(() => jsonlRows(reqd.stdout), [])[0]?.arguments?.currentDocumentId === DOC, 'required positional supplied per line');
  }

  console.log('7. usage errors → exit 2 (unknown command, missing values, --http)');
  {
    const r = await runCli(['frobnicate']);
    check(r.code === 2 && r.stderr.length > 0, `unknown command → exit 2 (got ${r.code})`);
    const v = await runCli(['globalise_view_document_ui']);
    check(v.code === 2 && /viewer\/image/.test(v.stderr), 'viewer tool name → exit 2 + viewer hint');
    const m = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max']);
    check(m.code === 2 && /requires a value/.test(m.stderr), '--max with no value → exit 2');
    const t = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max', '--table']);
    check(t.code === 2 && /requires a value/.test(t.stderr), '--max --table → exit 2 (did not swallow --table)');
    const h = await runCli(['--http']);
    check(h.code === 2 && /--http requires a URL/.test(h.stderr), '--http with no URL → exit 2');
  }

  console.log('8. invalid enum (find --source bogus) → tool error, exit 1');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'bogus']);
    check(r.code === 1, `exit 1 (got ${r.code})`);
    check(r.stderr.length > 0, 'stderr carries the error message');
  }

  console.log('9. find (local DB): JSONL rows, pagination summary, no server log lines');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max', '3', '--fields', 'id,description']);
    check(r.code === 0, 'exit 0');
    const rows = safe(() => jsonlRows(r.stdout), []);
    check(rows.length >= 1 && rows.length <= 3, `1–3 JSONL rows (got ${rows.length})`);
    checkEvery(rows, (row) => 'id' in row, 'each row is valid JSON with an id');
    check(/\bshown\b.*\bof\b/.test(r.stderr), 'stderr carries the total.value-derived summary');
    check(/pass --offset 3 for more/.test(r.stderr), 'hasMore → "pass --offset 3"');
    check(!/running on stdio|"tool":/.test(r.stderr), "server's own stderr lines don't reach the CLI's stderr");
    const p2 = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max', '3', '--offset', '3', '--fields', 'id']);
    check(/offset 3\)/.test(p2.stderr) && /pass --offset 6 for more/.test(p2.stderr), '--offset reflected in the summary and next hint');
  }

  console.log('10. top-level --help is connection-free + curated');
  {
    const r = await runCli(['--http', DEAD_HTTP, '--help']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(!/Connection failed/.test(r.stderr), 'no connection attempt (stderr clean)');
    check(/Usage: glob-mcp/.test(r.stdout) && /Commands:/.test(r.stdout), 'static usage frame printed');
    check(/Common flags:/.test(r.stdout) && /Transports:/.test(r.stdout), 'Common flags + Transports blocks present');
    check(/GLOBALISE_MCP_HTTP/.test(r.stdout), 'mentions the GLOBALISE_MCP_HTTP env var');
    check(/NOT a precise converter/.test(r.stdout), 'measure line is the curated summary (not a clipped tool desc)');
    const commandLines = r.stdout.split('\n').filter((l) => VERBS.some((v) => l.startsWith(`  ${v} `)));
    checkEvery(commandLines, (l) => l.length <= 120, 'each command summary fits one terminal line');
  }

  console.log('11. <command> --help: schema-derived flags, aliases per verb, example');
  {
    const r = await runCli(['navigate', '--help']);
    check(r.code === 0, 'exit 0');
    check(/--direction <string> \(required\)/.test(r.stdout), 'required flag marked');
    check(/\{next\|previous\|prev\}/.test(r.stdout), 'enum values shown inline');
    check(/^Example:/m.test(r.stdout) && /glob-mcp navigate/.test(r.stdout), 'worked example present');
    check(!/Aliases:/.test(r.stdout), 'navigate --help advertises no --max/--offset alias');
    const s = await runCli(['search', '--help']);
    check(/Aliases:\s*--max, -n\s*→\s*size/.test(s.stdout), 'search --help documents the --max/-n → size alias');
    check(/--offset → from/.test(s.stdout), 'search --help documents the --offset → from alias');
  }

  console.log('12. every help example is a valid call (dry-run)');
  for (const verb of VERBS) {
    const help = await runCli([verb, '--help']);
    const argv = helpExampleArgv(help.stdout);
    check(argv !== null && argv[0] === verb, `${verb}: example found and starts with the verb`);
    if (!argv) continue;
    const r = await showCall(...argv);
    check(r.code === 0, `${verb}: example passes --show-call (exit ${r.code}${r.stderr ? `: ${r.stderr.trim()}` : ''})`);
  }

  console.log('13. help without a reachable server');
  {
    const r = await runCli(['--http', DEAD_HTTP, 'search', '--help']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(/search → globalise_search_transcriptions/.test(r.stdout), 'static verb header rendered');
    check(/Example:/.test(r.stdout) && /schema-derived and needs a server/.test(r.stdout), 'example + schema-needs-server hint');
    const t = await runCli(['--http', DEAD_HTTP, 'tools', '--help']);
    check(t.code === 0 && !/Connection failed/.test(t.stderr), 'tools --help: exit 0, no connection attempt');
    check(/Usage: glob-mcp tools \[--compact\|--json\]/.test(t.stdout), 'static tools usage printed');
  }

  console.log('14. upstream-backed verbs against a local stub');
  {
    const stub = await startUpstreamStub({ total: 42 });
    const env = { BROCCOLI_BASE_URL: stub.url };
    try {
      const s = await runCli(['search', 'peper', '--max', '5', '--offset', '10', '--fields', 'id'], { env });
      check(s.code === 0, `search exit 0 (got ${s.code}: ${s.stderr.trim()})`);
      check(stub.requests.includes('POST /projects/globalise/search'), 'the server queried the stub, not the real upstream');
      const rows = safe(() => jsonlRows(s.stdout), []);
      check(rows.length === 5 && rows[0]?.id === 'urn:globalise:NL-HaNA_1.04.02_9966_0011', `5 JSONL rows from offset 10 (got ${rows.length}, first ${rows[0]?.id})`);
      check(/5 shown \(offset 10\) of 42; pass --offset 15 for more/.test(s.stderr), 'summary + next-page hint');
      const last = await runCli(['search', 'peper', '--max', '5', '--offset', '40', '--fields', 'id'], { env });
      check(safe(() => jsonlRows(last.stdout), []).length === 2 && !/pass --offset/.test(last.stderr), 'last page: 2 rows, no --offset hint');

      const r = await runCli(['retrieve', DOC], { env });
      const doc = safe(() => JSON.parse(r.stdout.trim()), null) as any;
      check(r.code === 0 && r.stdout.trim().split('\n').length === 1, 'retrieve prints one JSON object');
      check(doc?.text?.lines?.length === 3 && doc?.navigation?.nextPageId === 'NL-HaNA_1.04.02_9966_0107', 'retrieve carries lines + navigation');
      check(!/truncated/.test(r.stderr), 'an untrimmed page has no truncation note');

      const n = await runCli(['navigate', DOC, '--direction', 'next', '--fields', 'targetDocument'], { env });
      const nav = safe(() => JSON.parse(n.stdout.trim()), null) as any;
      check(n.code === 0 && nav?.targetDocument?.document === 'NL-HaNA_1.04.02_9966_0107', `navigate next → _0107 (got ${nav?.targetDocument?.document})`);
    } finally {
      await stub.close();
    }
  }

  console.log('15. a transcription trimmed to the response budget gets a note');
  {
    const stub = await startUpstreamStub({ lines: 400, lineChars: 60 });
    const env = { BROCCOLI_BASE_URL: stub.url, RESULT_CHAR_CEILING: '8000' };
    try {
      const r = await runCli(['retrieve', DOC], { env });
      const shown = (safe(() => JSON.parse(r.stdout.trim()), null) as any)?.text?.lines?.length;
      check(r.code === 0 && typeof shown === 'number' && shown < 400, `retrieve was trimmed (${shown} of 400 lines)`);
      check(new RegExp(`note: transcription truncated .* ${shown} of 400 lines shown`).test(r.stderr), 'retrieve: note states lines shown of total');
      const n = await runCli(['navigate', DOC, '--direction', 'next'], { env });
      check(/note: transcription truncated .* of 400 lines shown/.test(n.stderr), 'navigate: note read from targetDocument.text');
    } finally {
      await stub.close();
    }
  }

  finish('CLI offline test');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
