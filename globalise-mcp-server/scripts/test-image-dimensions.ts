/**
 * Unit tests for the pure-JS image dimension reader
 * (src/utils/image-dimensions.ts) that replaced the single sharp.metadata()
 * call in page-image.ts. Fixtures are hand-built JPEG/PNG header bytes — no
 * sharp, no network, no DB.
 *
 * Run with: npm run test:image-dimensions
 */

import { readImageDimensions } from '../src/utils/image-dimensions.js';
import { check, finish } from './test-utils.js';

// A minimal but valid PNG header: 8-byte signature, IHDR length+type, then
// width=10, height=8 (big-endian uint32 at offsets 16 and 20).
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d,                         // IHDR length (13)
  0x49, 0x48, 0x44, 0x52,                         // "IHDR"
  0x00, 0x00, 0x00, 0x0a,                         // width = 10
  0x00, 0x00, 0x00, 0x08,                         // height = 8
]);

// A minimal JPEG: SOI + a SOF0 segment carrying precision, height=8, width=10.
const jpegSof0 = Buffer.from([
  0xff, 0xd8,             // SOI
  0xff, 0xc0,             // SOF0 marker
  0x00, 0x11,             // segment length (17)
  0x08,                   // precision
  0x00, 0x08,             // height = 8
  0x00, 0x0a,             // width = 10
  0x00, 0x00,             // (pad — component data we don't read)
]);

// A JPEG with an APP0 (JFIF) segment BEFORE the SOF, to exercise segment
// skipping. APP0 has a 2-byte payload here (0xAA 0xBB); dims are 10x8.
const jpegWithApp0 = Buffer.from([
  0xff, 0xd8,             // SOI
  0xff, 0xe0,             // APP0 marker
  0x00, 0x04,             // APP0 length (4 = 2 len bytes + 2 data bytes)
  0xaa, 0xbb,             // APP0 payload
  0xff, 0xc2,             // SOF2 marker (progressive — also a dims-bearing SOF)
  0x00, 0x11,             // segment length (17)
  0x08,                   // precision
  0x00, 0x08,             // height = 8
  0x00, 0x0a,             // width = 10
  0x00, 0x00,             // (pad)
]);

console.log('1. PNG');
{
  const d = readImageDimensions(png);
  check(d?.width === 10 && d?.height === 8, `PNG IHDR → {10,8} (got: ${JSON.stringify(d)})`);
}

console.log('2. JPEG (SOF0, dims immediately after SOI)');
{
  const d = readImageDimensions(jpegSof0);
  check(d?.width === 10 && d?.height === 8, `JPEG SOF0 → {10,8} (got: ${JSON.stringify(d)})`);
}

console.log('3. JPEG with a preceding APP0 segment (SOF2)');
{
  const d = readImageDimensions(jpegWithApp0);
  check(d?.width === 10 && d?.height === 8, `JPEG APP0→SOF2 skip → {10,8} (got: ${JSON.stringify(d)})`);
}

console.log('4. Non-image / truncated buffers → undefined (non-fatal contract)');
{
  check(readImageDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03])) === undefined, 'random bytes → undefined');
  check(readImageDimensions(Buffer.from([0xff, 0xd8])) === undefined, 'truncated JPEG (SOI only) → undefined');
  check(readImageDimensions(Buffer.from([])) === undefined, 'empty buffer → undefined');
  check(readImageDimensions(Buffer.from([0x89, 0x50])) === undefined, 'truncated PNG signature → undefined');
}

finish('Image dimensions');
