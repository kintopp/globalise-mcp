/**
 * Subprocess test for the graceful HTTP shutdown path (v2.7.5 / CODE-REVIEW
 * finding 5): on SIGTERM the server must drain the HTTP listener and exit 0
 * (it exited 143 before the fix, cutting in-flight requests on every Railway
 * redeploy). Spawns the built server in HTTP mode, waits for /health, sends
 * SIGTERM, and asserts a clean exit plus the [SHUTDOWN] log line.
 *
 * Requires a prior `npm run build` (runs dist/index.js), like smoke-test.ts.
 *
 * Run with: npm run test:http-shutdown
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'dist', 'index.js');
const PORT = 3917;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll /health every 50ms until it returns 200 or the timeout elapses. */
async function waitForHealth(timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.status === 200) return res;
    } catch (err) {
      lastErr = err;
    }
    await sleep(50);
  }
  throw new Error(`/health did not become ready within ${timeoutMs}ms (last error: ${lastErr})`);
}

async function main() {
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, TRANSPORT: 'http', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe'], // capture stderr for the [SHUTDOWN] log
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });

  const health = await waitForHealth(10_000);
  const body = (await health.json()) as { status?: string; version?: string };
  check(body.status === 'healthy', 'health endpoint responds healthy');
  check(typeof body.version === 'string' && body.version.length > 0, 'health reports a version');

  // Race the clean-exit promise against a hard backstop (the server's internal
  // drain backstop is 10s); on timeout, SIGKILL and fail rather than hang.
  child.kill('SIGTERM');
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 15_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  check(exitCode === 0, `clean exit on SIGTERM (got: ${exitCode})`); // was 143 before the v2.7.5 fix
  check(stderr.includes('[SHUTDOWN] SIGTERM received'), 'shutdown sequence logged');

  finish('HTTP shutdown');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
