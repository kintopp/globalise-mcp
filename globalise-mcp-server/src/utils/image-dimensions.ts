/**
 * Pure-JS image dimension reader — parses the pixel width/height out of a
 * JPEG or PNG header without decoding the image.
 *
 * Replaces the single `sharp(buf).metadata()` call in `page-image.ts` so the
 * server carries no native dependency. `sharp` ships a platform-specific
 * libvips binary (`@img/sharp-<os>-<arch>`); bundling it into an `.mcpb` bakes
 * in only the build machine's variant, which breaks the bundle on every other
 * OS/arch. Reading dims is a header parse, not image processing, so a few
 * dozen lines of pure JS restore the cross-platform (pure-JS) baseline
 * (`node:sqlite` over better-sqlite3 was the same call).
 *
 * The IIIF endpoint returns JPEG (`default.jpg`, including `quality=gray`); PNG
 * is handled too for robustness. Never throws — returns `undefined` on any
 * unrecognized/truncated buffer, matching the old call's non-fatal contract.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Read `{width,height}` from a JPEG or PNG buffer; `undefined` if unrecognized. */
export function readImageDimensions(buf: Buffer): ImageDimensions | undefined {
  try {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return readJpeg(buf);
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return readPng(buf);
  } catch {
    // Any out-of-bounds read etc. is non-fatal by contract.
  }
  return undefined;
}

/** PNG: dims live in the IHDR chunk at fixed offsets 16 (width) / 20 (height). */
function readPng(buf: Buffer): ImageDimensions | undefined {
  // 8-byte signature, then IHDR length(4) + type(4), then width(4) + height(4).
  if (buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** JPEG: walk the marker segments to the SOF marker, whose payload holds dims. */
function readJpeg(buf: Buffer): ImageDimensions | undefined {
  const len = buf.length;
  let offset = 2; // past SOI (FFD8)
  while (offset + 1 < len) {
    if (buf[offset] !== 0xff) { offset++; continue; } // resync past corruption
    let marker = buf[offset + 1];
    // Collapse any 0xFF fill bytes preceding the marker byte.
    while (marker === 0xff && offset + 2 < len) { offset++; marker = buf[offset + 1]; }
    offset += 2; // now at the 2-byte segment-length field (or next marker for standalones)
    // Standalone markers carry no length payload: TEM (01), RSTn (D0-D7), SOI/EOI (D8/D9).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 1 >= len) break;
    const segLength = buf.readUInt16BE(offset);
    if (segLength < 2) break; // malformed
    // SOF markers hold the frame dims: C0-CF except C4 (DHT), C8 (JPG), CC (DAC).
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (offset + 6 >= len) break;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += segLength; // skip this segment's payload to the next marker
  }
  return undefined;
}
