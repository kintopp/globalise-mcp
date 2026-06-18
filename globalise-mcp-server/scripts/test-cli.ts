/**
 * Smoke test for the headless CLI (scripts/cli.mjs).
 *
 * Spawns `node scripts/cli.mjs <args>` as a child process over the cold-stdio
 * transport (self-contained — no running server needed) and asserts the
 * JSON-first output contract + exit codes (0 ok / 1 tool error / 2 usage error).
 *
 * The CLI is an MCP *client*: a CLI query and an LLM query call the same
 * callTool() on the same server, so this doubles as an end-to-end smoke test of
 * the whole tool surface.
 *
 * Requires:  npm run build  (the CLI's stdio path spawns dist/index.js) + the
 *            decompressed DBs in data/  +  NETWORK (search/retrieve/navigate hit
 *            the live upstream API).
 * Run:       npm run test:cli
 *
 * Deliberately NOT in the default `npm test` chain — it needs dist/ + DBs + a
 * healthy upstream, mirroring test:live / test:mcpb. The default suite stays
 * offline-capable by design.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { check, finish } from './test-utils.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SERVER_ROOT, 'scripts', 'cli.mjs');

// Stable, known-good document used throughout the repo's docs (..._0107 exists).
const DOC = 'NL-HaNA_1.04.02_9966_0106';

type CliResult = { code: number; killed: boolean; stdout: string; stderr: string };

/** Run the CLI; resolve with {code, stdout, stderr} (never rejects). */
function runCli(args: string[], timeout = 90000): Promise<CliResult> {
  // These are stdio smoke tests. Strip GLOBALISE_MCP_HTTP (the docs recommend exporting it, so
  // it's commonly set in dev shells / agents) so an exported Railway URL can't hijack the stdio
  // path. Tests that need HTTP pass --http explicitly, which overrides the env var in the CLI.
  const { GLOBALISE_MCP_HTTP, ...env } = process.env;
  return new Promise((resolve) => {
    execFile(
      'node',
      [CLI, ...args],
      { cwd: SERVER_ROOT, timeout, maxBuffer: 64 * 1024 * 1024, env },
      (err: any, stdout: string, stderr: string) => {
        resolve({
          code: err?.code ?? 0,
          killed: !!err?.killed,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

const jsonlRows = (s: string): any[] =>
  s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

async function main() {
  // ── 1. tools --json (capabilities dump; excludes the viewer tool) ─────────────
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
    check(tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object'), 'each entry carries an inputSchema');
  }

  // ── 2. retrieve happy path + --fields projection (single-object JSON) ──────────
  console.log('2. retrieve <DOC> --fields id,inventoryNumber');
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

  // ── 3. list tool → JSONL + stderr count line (network search) ──────────────────
  console.log('3. search "peper" --max 3 --fields id,document');
  {
    const r = await runCli(['search', 'peper', '--max', '3', '--fields', 'id,document']);
    check(r.code === 0, 'exit 0');
    const rows = safe(() => jsonlRows(r.stdout), []);
    check(rows.length >= 1 && rows.length <= 3, `1–3 JSONL rows (got ${rows.length})`);
    check(rows.every((row) => 'id' in row && 'document' in row), 'each row is valid JSON with id + document');
    check(/\bshown\b/.test(r.stderr), 'stderr carries a count/pagination summary');
  }

  // ── 4. --show-call dry-run (resolves args, makes no tool call) ─────────────────
  console.log('4. --show-call search "peper"');
  {
    const r = await runCli(['--show-call', 'search', 'peper']);
    check(r.code === 0, 'exit 0');
    const call = safe(() => JSON.parse(r.stdout.trim()), null) as any;
    check(call && call.tool === 'globalise_search_transcriptions', `resolved tool name (got ${call?.tool})`);
    check(call && call.arguments && call.arguments.query === 'peper', 'resolved positional → query=peper');
    check(!/"id"/.test(r.stdout.replace(/"query"[^\n]*/g, '')), 'no result rows emitted (dry-run)');
  }

  // ── 5. usage error → exit 2 (unknown command + viewer-tool hint) ───────────────
  console.log('5. unknown command → exit 2');
  {
    const r = await runCli(['frobnicate']);
    check(r.code === 2, `exit 2 (got ${r.code})`);
    check(r.stderr.length > 0, 'stderr explains the error');
    const v = await runCli(['globalise_view_document_ui']);
    check(v.code === 2, `viewer tool name → exit 2 (got ${v.code})`);
    check(/viewer\/stateful/.test(v.stderr), 'stderr hints the viewer tool is unavailable over the CLI');
  }

  // ── 6. tool/validation error → exit 1 (bad enum) ───────────────────────────────
  console.log('6. invalid enum (find --source bogus) → exit 1');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'bogus']);
    check(r.code === 1, `exit 1 (got ${r.code})`);
    check(r.stderr.length > 0, 'stderr carries the error message');
  }

  // ── 7. (no image test — GLOBALISE has no bytes-returning tool) ─────────────────

  // ── 8. --show-call navigate: positional → currentDocumentId, + direction ──────
  console.log('8. --show-call navigate <DOC> --direction next');
  {
    const r = await runCli(['--show-call', 'navigate', DOC, '--direction', 'next']);
    check(r.code === 0, 'exit 0');
    const call = safe(() => JSON.parse(r.stdout.trim()), null) as any;
    check(call && call.tool === 'globalise_navigate', `resolved tool name (got ${call?.tool})`);
    check(
      call && call.arguments && call.arguments.currentDocumentId === DOC,
      'positional → currentDocumentId (NOT documentId)',
    );
    check(call && call.arguments && call.arguments.direction === 'next', 'direction:"next" resolved');
  }

  // ── 9. tools --compact (compact capability manifest for agent bootstrap) ───────
  console.log('9. tools --compact');
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
    // Required args are marked with a trailing "!" — navigate requires direction.
    const navigate = manifest.find((m) => m.tool === 'globalise_navigate');
    check(navigate && /!$/.test(navigate.args.direction ?? ''), "required arg marked with trailing '!'");
    // No descriptions or full JSON Schemas → far smaller than `tools --json`.
    const full = await runCli(['tools', '--json']);
    check(r.stdout.length * 3 < full.stdout.length, `compact ≪ --json (${r.stdout.length} vs ${full.stdout.length} bytes)`);
  }

  // ── 10. top-level help is connection-free (never touches the server) ───────────
  console.log('10. --help is offline-safe + curated');
  {
    // A dead --http URL would surface as "Connection failed" IF help connected at all.
    const r = await runCli(['--http', 'http://127.0.0.1:1/mcp', '--help']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(!/Connection failed/.test(r.stderr), 'no connection attempt (stderr clean)');
    check(/Usage: glob-mcp/.test(r.stdout) && /Commands:/.test(r.stdout), 'static usage frame printed');
    check(/Common flags:/.test(r.stdout) && /Transports:/.test(r.stdout), 'Common flags + Transports blocks present');
    check(/GLOBALISE_MCP_HTTP/.test(r.stdout), 'mentions the GLOBALISE_MCP_HTTP env var');
    check(/NOT a precise converter/.test(r.stdout), 'measure line is the curated summary (not a clipped tool desc)');
  }

  // ── 11. per-command --help: schema-derived flags + curated example (live) ──────
  console.log('11. <command> --help (schema-derived flags + example)');
  {
    const r = await runCli(['navigate', '--help']);
    check(r.code === 0, 'exit 0');
    check(/--direction <string> \(required\)/.test(r.stdout), 'required flag marked');
    check(/\{next\|previous\|prev\}/.test(r.stdout), 'enum values shown inline');
    check(/^Example:/m.test(r.stdout) && /glob-mcp navigate/.test(r.stdout), 'worked example present');
    // search has a `size` param → the --max/-n → size alias must be documented.
    const s = await runCli(['search', '--help']);
    check(/Aliases:\s*--max, -n\s*→\s*size/.test(s.stdout), 'search --help documents the --max/-n → size alias');
  }

  // ── 12. per-command --help degrades without a server (static verb info + hint) ─
  console.log('12. <command> --help with no reachable server');
  {
    const r = await runCli(['--http', 'http://127.0.0.1:1/mcp', 'search', '--help']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(/search → globalise_search_transcriptions/.test(r.stdout), 'static verb header rendered');
    check(
      /Example:/.test(r.stdout) && /schema-derived and needs a server/.test(r.stdout),
      'example + schema-needs-server hint',
    );
  }

  // ── 13. `tools --help` is offline-safe (built-in command, static help) ─────────
  console.log('13. tools --help is offline-safe');
  {
    const r = await runCli(['--http', 'http://127.0.0.1:1/mcp', 'tools', '--help']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(!/Connection failed/.test(r.stderr), 'no connection attempt (stderr clean)');
    check(/Usage: glob-mcp tools \[--compact\|--json\]/.test(r.stdout), 'static tools usage printed');
    check(/--compact/.test(r.stdout) && /--json/.test(r.stdout), 'documents both output modes');
  }

  // ── 14. find verb (local DB): JSONL rows + stderr pagination summary ───────────
  console.log('14. find "Amsterdam" --source gm --max 3');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max', '3', '--fields', 'id,description']);
    check(r.code === 0, 'exit 0');
    const rows = safe(() => jsonlRows(r.stdout), []);
    check(rows.length >= 1 && rows.length <= 3, `1–3 JSONL rows (got ${rows.length})`);
    check(rows.every((row) => 'id' in row), 'each row is valid JSON with an id');
    check(/\bshown\b.*\bof\b/.test(r.stderr), 'stderr carries the total.value-derived summary');
  }

  // ── 15. total.relation === 'gte' → the summary marks the count as a lower bound ─
  console.log("15. matchAll → relation 'gte' (≥ in the summary)");
  {
    // matchAll post-filters a capped candidate window, so total.relation is 'gte'
    // unconditionally — locks the §4.1 lower-bound path the Rijksmuseum test never hit.
    const r = await runCli(['search', 'Radja', '--languages', 'nld,msa', '--matchAll', '--max', '1', '--fields', 'id']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    check(/≥/.test(r.stderr), 'stderr summary marks the total as a lower bound (≥)');
    // The comma-split made languages a 2-element array (else matchAll never engages).
    const dry = await runCli(['--show-call', 'search', 'x', '--languages', 'nld,msa']);
    const call = safe(() => JSON.parse(dry.stdout.trim()), null) as any;
    check(
      Array.isArray(call?.arguments?.languages) && call.arguments.languages.length === 2,
      'comma-separated --languages splits into a 2-element array',
    );
  }

  // ── 16. missing flag value → usage error (exit 2), not a NaN tool error ───────
  console.log('16. find ... --max (no value) → exit 2');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max']);
    check(r.code === 2, `exit 2 (got ${r.code})`);
    check(/requires a value/.test(r.stderr), 'stderr names the missing value');
  }

  // ── 17. flag-shaped value is rejected, not silently swallowed ─────────────────
  console.log('17. find ... --max --table (next token is a flag) → exit 2');
  {
    const r = await runCli(['find', 'Amsterdam', '--source', 'gm', '--max', '--table']);
    check(r.code === 2, `exit 2 (got ${r.code})`);
    check(/requires a value/.test(r.stderr), 'stderr names the missing value (did not swallow --table)');
  }

  // ── 18. --http with no URL → usage error (exit 2) ─────────────────────────────
  console.log('18. --http (no url) → exit 2');
  {
    const r = await runCli(['--http']);
    check(r.code === 2, `exit 2 (got ${r.code})`);
    check(/--http requires a URL/.test(r.stderr), 'stderr names the missing URL');
  }

  // ── 19. --max=5 (inline value) still parses correctly ─────────────────────────
  console.log('19. --show-call search "peper" --max=5 (inline value preserved)');
  {
    const r = await runCli(['--show-call', 'search', 'peper', '--max=5']);
    check(r.code === 0, `exit 0 (got ${r.code})`);
    const call = safe(() => JSON.parse(r.stdout.trim()), null) as any;
    check(call && call.arguments && call.arguments.size === 5, `--max=5 → size:5 (got ${call?.arguments?.size})`);
  }

  finish('CLI smoke test');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
