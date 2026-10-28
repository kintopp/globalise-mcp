/**
 * End-to-end test of globalise_inspect_page_image's delivery guarantee: the model
 * gets either a valid, in-limit image block or a text error, never a block the
 * host could reject. Drives the built dist/index.js against the local upstream
 * stub (BROCCOLI_BASE_URL), including its IIIF image target.
 *
 * Requires: npm run build.
 *
 * Ways delivery could fail that this suite pins:
 *   1. info.json fails and a narrow pct: region is requested with a width-only
 *      size, so the delivered strip is far taller than the vision edge limit.
 *   2. A 200 response with an HTML body becomes an image block labelled image/jpeg.
 *   3. The server returns an image whose edge exceeds the vision limit and it is
 *      passed through unchecked.
 *   4. A failed image fetch reports "[object Object]" instead of the cause.
 *   5. The known-dims path changes: it must keep the plain width form.
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VISION_MAX_TOKENS, visualTokens } from '../src/utils/vision-sizing.js';
import { check, finish, startUpstreamStub } from './test-utils.js';

const serverEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

/** Minimal PNG header (signature + IHDR dims) — all readImageDimensions needs. */
function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

const scan = (n: number) => `NL-HaNA_1.04.02_9966_${String(n).padStart(4, '0')}`;

type Image = { status: number; contentType: string; body: Buffer | string };
const scenarios: Record<string, { info?: { width: number; height: number }; image: Image }> = {
  [scan(1)]: { image: { status: 200, contentType: 'image/png', body: png(60, 1500) } },
  [scan(2)]: { image: { status: 200, contentType: 'image/jpeg', body: '<html>error</html>' } },
  [scan(3)]: { image: { status: 200, contentType: 'image/png', body: png(1220, 3000) } },
  [scan(4)]: { image: { status: 404, contentType: 'text/plain', body: 'nope' } },
  [scan(5)]: { info: { width: 3000, height: 4000 }, image: { status: 200, contentType: 'image/png', body: png(1200, 1600) } },
};

const stub = await startUpstreamStub({
  image: {
    info: (document) => scenarios[document]?.info,
    respond: (document) => scenarios[document]?.image ?? { status: 404, contentType: 'text/plain', body: '' },
  },
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, BROCCOLI_BASE_URL: stub.url } as Record<string, string>,
  stderr: 'pipe',
});
const client = new Client({ name: 'globalise-inspect-image-test', version: '1.0.0' });

async function inspect(n: number, region: string) {
  const res = await client.callTool({
    name: 'globalise_inspect_page_image',
    arguments: { documentId: scan(n), region },
  }) as { isError?: boolean; content: Array<{ type: string; text?: string; mimeType?: string }> };
  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const images = res.content.filter((c) => c.type === 'image');
  return { isError: res.isError === true, text, images };
}

/** The size segment of the recorded image request for a scan, percent-decoded. */
function sizeSegment(n: number): string | undefined {
  const req = stub.requests.find((r) => r.includes(`${scan(n)}.jp2/`) && !r.endsWith('info.json'));
  const parts = req ? decodeURIComponent(req.split(' ')[1]).split('.jp2/')[1].split('/') : [];
  return parts[1];
}

try {
  await client.connect(transport);

  console.log('1. unknown dims, narrow pct: region → best-fit box');
  {
    const r = await inspect(1, 'pct:0,0,5,100');
    check(stub.requests.some((q) => q.startsWith('GET /iip/')), 'the stub served the image (upstream not reached)');
    check(!r.isError && r.images.length === 1 && r.images[0].mimeType === 'image/png', `one png image block (isError=${r.isError}, ${r.text})`);
    const m = sizeSegment(1)?.match(/^\^!(\d+),\1$/);
    check(!!m, `size segment is a square best fit (got: ${sizeSegment(1)})`);
    const n = Number(m?.[1]);
    check(visualTokens(n, n) <= VISION_MAX_TOKENS, `the box fits the token budget (got: ${n})`);
  }

  console.log('2. non-image body with status 200');
  {
    const r = await inspect(2, 'pct:10,10,20,20');
    check(r.isError && r.images.length === 0, 'tool error, no image block');
    check(r.text.includes('non-image'), `error names the cause (got: ${r.text})`);
  }

  console.log('3. image above the vision edge limit');
  {
    const r = await inspect(3, 'pct:20,20,20,20');
    check(r.isError && r.images.length === 0, 'tool error, no image block');
    check(r.text.includes('vision limit'), `error names the cause (got: ${r.text})`);
  }

  console.log('4. failed fetch reads as a message');
  {
    const r = await inspect(4, 'pct:30,30,10,10');
    check(r.isError && r.images.length === 0, 'tool error, no image block');
    check(r.text.includes('Resource not found'), `error carries the upstream cause (got: ${r.text})`);
    check(!r.text.includes('[object Object]'), 'error is not a stringified object');
  }

  console.log('5. known dims keep the plain width form');
  {
    const r = await inspect(5, 'full');
    check(!r.isError && r.images.length === 1, `image delivered (${r.text})`);
    check(!!sizeSegment(5) && !sizeSegment(5)!.includes('!'), `no best-fit form (got: ${sizeSegment(5)})`);
  }
} finally {
  await client.close().catch(() => {});
  await stub.close();
}

finish('Inspect image delivery');
