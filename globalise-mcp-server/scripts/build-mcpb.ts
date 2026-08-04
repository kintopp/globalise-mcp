/**
 * Assemble and pack the GLOBALISE MCP server as an .mcpb bundle (MCP Bundle /
 * Desktop Extension) for one-click local install in Claude Desktop.
 *
 * Why a staging tree instead of packing in place: `mcpb pack <dir>` zips the
 * whole directory, and the working tree carries sources, dev dependencies, the
 * 26 MB .gz artifact, scripts, and tests we don't want in the bundle. We build
 * a clean tree under mcpb-build/stage/ containing exactly what the extension
 * needs at runtime, then pack that.
 *
 * Bundle layout produced (the extension root the .mcpb unpacks to):
 *   manifest.json                  MCPB 0.3 manifest (version stamped here)
 *   package.json                   trimmed: "type": "module" + metadata only
 *   dist/                          compiled server + bundled viewer HTML
 *   data/reference.sqlite          commodities + weights & measures glossaries
 *   node_modules/                  production deps only (npm ci --omit=dev)
 *   LICENSE, README.md, .mcpbignore
 *
 * The ~112 MB archival finding-aid index is deliberately NOT bundled: the
 * server downloads it once on the first `globalise_find_archival_documents`
 * call (ensureDatabaseFile() in src/utils/database.ts) and caches it in the
 * user's data directory. That keeps the .mcpb a few MB instead of ~30 MB.
 * The small reference glossaries ARE bundled — without them
 * globalise_lookup_commodity / _measure would degrade to "unavailable".
 *
 * There is only one variant. A second, "full" bundle that baked the index in
 * used to be built from a separate manifest.thin.json / manifest.json pair;
 * that was retired on 2026-08-04 and the thin manifest became manifest.json.
 *
 * Prerequisite: `npm run build` (compiles dist/ and materializes reference.sqlite).
 * `npm run build:mcpb` chains both. Run from globalise-mcp-server/.
 *
 * Usage: npm run build:mcpb   (or: npx tsx scripts/build-mcpb.ts)
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const DIST_DIR = join(PACKAGE_ROOT, 'dist');
// Reference glossaries (commodities + weights & measures) — small (~a few MB),
// so they ship inside the bundle; only the large archival index is left out.
const REFERENCE_DB_FILE = join(PACKAGE_ROOT, 'data', 'reference.sqlite');
const MANIFEST_SRC = join(PACKAGE_ROOT, 'manifest.json');
const MCPBIGNORE_SRC = join(PACKAGE_ROOT, '.mcpbignore');
const LICENSE_SRC = join(PACKAGE_ROOT, 'LICENSE');

const BUILD_DIR = join(PACKAGE_ROOT, 'mcpb-build');
const STAGE_DIR = join(BUILD_DIR, 'stage');

/** Read-only metadata; the manifest version is sourced from here at pack time. */
interface PackageJson {
  name: string;
  version: string;
  description: string;
  type: string;
  main: string;
  author?: unknown;
  license?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as PackageJson;

function sizeMb(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

/** Run a command, inheriting stdio, and abort the build on a non-zero exit. */
function run(command: string, args: string[], cwd: string): void {
  const printable = [command, ...args].join(' ');
  console.log(`\n$ ${printable}\n  (cwd: ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    throw new Error(`Failed to launch \`${printable}\`: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`\`${printable}\` exited with status ${result.status}`);
  }
}

/** Fail early with an actionable message if the build prerequisites are absent. */
function checkPrerequisites(): void {
  const entry = join(DIST_DIR, 'index.js');
  if (!existsSync(entry)) {
    throw new Error(
      `Compiled server not found at ${entry}.\n` +
      `Run \`npm run build\` first (build:mcpb chains it for you).`,
    );
  }
  const viewer = join(DIST_DIR, 'apps', 'index.html');
  if (!existsSync(viewer)) {
    throw new Error(
      `Bundled viewer not found at ${viewer}.\n` +
      `Run \`npm run build\` (it builds the MCP Apps UI via \`npm run build:ui\`).`,
    );
  }
  // No archival-index check: it is not bundled, so it need not exist at pack
  // time. The reference glossaries back globalise_lookup_commodity / _measure
  // and ARE bundled, so they must be present.
  if (!existsSync(REFERENCE_DB_FILE)) {
    throw new Error(
      `Reference DB not found at ${REFERENCE_DB_FILE}.\n` +
      `Run \`npm run build\` (its ensure:db step decompresses the committed .gz).`,
    );
  }
}

/**
 * Wipe and recreate the staging tree so every pack starts clean. Only STAGE_DIR
 * is removed, not BUILD_DIR — so previously packed .mcpb files (e.g. an earlier
 * version's) are preserved alongside the new one in mcpb-build/.
 */
function resetStage(): void {
  rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });
}

/** Copy the runtime files into the staging tree. */
function stageFiles(): void {
  console.log('Staging runtime files ...');

  // Compiled server (includes dist/apps/index.html, the inlined viewer)
  cpSync(DIST_DIR, join(STAGE_DIR, 'dist'), { recursive: true });

  // Data dir holds the reference glossaries only; opened read-only at runtime.
  mkdirSync(join(STAGE_DIR, 'data'), { recursive: true });

  // Reference glossaries (commodities + weights & measures). Small, so bundled
  // — globalise_lookup_commodity / _measure need them present on disk.
  cpSync(REFERENCE_DB_FILE, join(STAGE_DIR, 'data', 'reference.sqlite'));

  console.log('  (archival index omitted — downloaded by the server on first use)');

  // package.json + lockfile drive `npm ci --omit=dev`; the lockfile is dropped
  // from the bundle afterwards by .mcpbignore.
  cpSync(join(PACKAGE_ROOT, 'package.json'), join(STAGE_DIR, 'package.json'));
  cpSync(join(PACKAGE_ROOT, 'package-lock.json'), join(STAGE_DIR, 'package-lock.json'));

  // Bundle metadata / hygiene
  cpSync(MANIFEST_SRC, join(STAGE_DIR, 'manifest.json'));
  cpSync(MCPBIGNORE_SRC, join(STAGE_DIR, '.mcpbignore'));
  if (existsSync(LICENSE_SRC)) {
    cpSync(LICENSE_SRC, join(STAGE_DIR, 'LICENSE'));
  }
}

/** Install production-only dependencies into the staging tree. */
function installProductionDeps(): void {
  console.log('\nInstalling production dependencies (npm ci --omit=dev) ...');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], STAGE_DIR);
}

/**
 * Stamp the manifest version from package.json (single source of truth) and
 * replace the staged package.json with a trimmed, production-only copy. The
 * trimmed package.json must keep `"type": "module"` so Node loads dist/*.js as
 * ESM, and `version` because the server reads it for SERVER_VERSION/health.
 */
function finalizeMetadata(): void {
  const manifestPath = join(STAGE_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  if (manifest.version !== pkg.version) {
    console.log(`Stamping manifest version ${String(manifest.version)} -> ${pkg.version} (from package.json)`);
    manifest.version = pkg.version;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const trimmed = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: pkg.main,
    author: pkg.author,
    license: pkg.license,
    engines: pkg.engines,
    dependencies: pkg.dependencies,
  };
  writeFileSync(join(STAGE_DIR, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`);

  // Lockfile served its purpose (npm ci); .mcpbignore keeps it out of the zip,
  // but remove it from the stage too so `mcpb info` file counts are honest.
  rmSync(join(STAGE_DIR, 'package-lock.json'), { force: true });

  writeFileSync(join(STAGE_DIR, 'README.md'), bundleReadme());
}

/** Short README shipped inside the bundle. */
function bundleReadme(): string {
  return `# Globalise MCP (MCP Bundle)

Version ${pkg.version}

This \`.mcpb\` runs the GLOBALISE MCP server locally inside Claude Desktop,
serving tools over VOC (Dutch East India Company) transcriptions; see
\`manifest.json\` for the tool list.

- The finding-aid index is **downloaded on first use** of
  globalise_find_archival_documents (configure the URL + data directory at
  install time) and cached on-device for later calls.
- The commodities and weights & measures glossaries are bundled and queried
  entirely on-device.
- Transcription search, page retrieval, and IIIF images are fetched from the
  public GLOBALISE / Nationaal Archief services at request time.
- No account, API key, or credentials are required.

Install: open this file with Claude Desktop (macOS/Windows) and confirm the
install dialog. Build/develop from source: see \`docs/mcpb.md\` in the
repository, https://github.com/kintopp/globalise-mcp
`;
}

/** Validate the manifest, pack the bundle, and print a summary. */
function packBundle(): string {
  const stagedManifest = join(STAGE_DIR, 'manifest.json');
  const outFile = join(BUILD_DIR, `globalise-voc-transcriptions-${pkg.version}.mcpb`);

  // `mcpb validate` checks the manifest against the schema before we pack.
  run('npx', ['-y', '@anthropic-ai/mcpb', 'validate', stagedManifest], PACKAGE_ROOT);

  // `mcpb pack <dir> [output]` zips the staging tree (also re-validates).
  run('npx', ['-y', '@anthropic-ai/mcpb', 'pack', STAGE_DIR, outFile], PACKAGE_ROOT);

  return outFile;
}

function main(): void {
  console.log(`Building .mcpb bundle for ${pkg.name} v${pkg.version}\n`);

  checkPrerequisites();
  resetStage();
  stageFiles();
  installProductionDeps();
  finalizeMetadata();
  const outFile = packBundle();

  console.log('\n--- bundle info ---');
  run('npx', ['-y', '@anthropic-ai/mcpb', 'info', outFile], PACKAGE_ROOT);

  console.log('\nDone.');
  console.log(`  bundle:        ${outFile} (${sizeMb(outFile)})`);
  console.log(`  staging tree:  ${STAGE_DIR} (kept for inspection / stdio testing)`);
  console.log('  archival index: omitted (downloaded by the server on first run)');
}

try {
  main();
} catch (error) {
  console.error(`\nbuild-mcpb failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
