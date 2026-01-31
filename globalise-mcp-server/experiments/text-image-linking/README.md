# Text-Image Linking Experiment

**Date:** January 31, 2026
**Status:** Abandoned
**Reason:** Fundamental mismatch between PageXML segmentation and API transcription ordering

## Objective

Enable bidirectional linking between manuscript image regions and transcription text:
- **Image → Text**: Click on a line region in the scanned image to highlight the corresponding line in the transcription
- **Text → Image**: Click a 📍 icon next to a transcription line to pan/zoom to that region in the image

## What Was Built

### 1. PageXML Coordinate Parser (`scripts/build-line-coords-db.ts`)
- Parsed PageXML files from inventory 10000 (265 pages)
- Extracted line polygons from `<TextLine>` elements
- Normalized coordinates to 0-1 range based on `imageWidth`/`imageHeight`
- Stored in SQLite database: 11,146 lines across 261 documents

### 2. Coordinate Storage
- **SQLite approach**: Used `better-sqlite3` native module
  - *Issue*: Native module version mismatch between development Node.js (v25) and Claude Desktop's bundled Node.js (v22)
  - Error: `NODE_MODULE_VERSION 141 vs 137`
- **JSON fallback**: Exported individual JSON files per document
  - Pure JavaScript, no native modules
  - ~18MB total for pilot inventory

### 3. SVG Overlay System (`viewer.ts`)
- Created SVG with `viewBox="0 0 1 1"` for normalized coordinates
- Positioned overlay dynamically using OpenSeadragon's viewport transformation
- Added viewport sync via `animation` and `resize` event handlers

### 4. UI Integration
- Added 📍 icons next to each transcription line
- Click handlers for bidirectional navigation
- Yellow highlight animation for selected lines (2-second fade)
- Hover effects on polygon regions

## What Worked

1. **PageXML parsing**: Successfully extracted 11,146 line polygons
2. **Coordinate normalization**: Correctly scaled to 0-1 range
3. **JSON storage**: Avoided native module compatibility issues
4. **Basic overlay rendering**: SVG polygons appeared over the image
5. **Click detection**: Could detect clicks on polygon regions

## What Didn't Work

### Critical Issue: Segmentation Mismatch

The PageXML files have **word/phrase-level segmentation**, while the API returns **full transcription lines**:

| PageXML (coords) | API Transcription |
|------------------|-------------------|
| "2oo" | "2oo de faniuw" |
| "munterij" | "munterij die het" |
| "laatste" | "laatste jaer heeft" |

**Attempted fix**: Text matching - find which API line contains each PageXML fragment.

**Result**: Works for simple pages but fails badly for:
- Multi-column layouts
- Marginalia
- Tables
- Complex reading orders

The PageXML reading order doesn't match the API's transcription order for complex documents.

### Secondary Issues

1. **SVG overlay bleeding**: Extended beyond image panel into transcription area
   - Fixed with `overflow: hidden` on container

2. **Viewport sync timing**: Overlay sometimes positioned incorrectly on initial load

3. **Aspect ratio handling**: Required using `tiledImage.getBounds()` instead of generic viewport bounds

## Lessons Learned

1. **Data source alignment is critical**: Text-image linking requires coordinates that match the transcription segmentation. Our PageXML files and API transcriptions use incompatible line segmentation.

2. **Native modules cause deployment issues**: `better-sqlite3` works great in development but fails in Claude Desktop due to Node.js version mismatch. Pure JavaScript solutions (JSON files) are more portable.

3. **Complex layouts break reading order**: VOC documents with marginalia, tables, and multi-column text have reading orders that are difficult to match programmatically.

## Files Created (Now Removed)

```
scripts/build-line-coords-db.ts   # PageXML parser
scripts/export-coords-json.ts     # JSON exporter
src/utils/line-coords.ts          # Coordinate accessor
data/line-coords.sqlite           # SQLite database
data/coords/*.json                # Individual document JSON files
```

## PageXML Region Types (Inventory 10000)

The PageXML files contain labeled region types that could be useful for other purposes:

| Region Type | Count | Description |
|-------------|-------|-------------|
| `paragraph` | 1,024 | Main body text |
| `marginalia` | 748 | Marginal notes and annotations |
| `catch-word` | 514 | Word at bottom of page repeated at top of next |
| `header` | 67 | Page headers |
| `page-number` | 29 | Page number annotations |
| `signature-mark` | 4 | Printer's signature marks |

**Total regions:** 2,386 across 265 pages

**Source files:** `~/Downloads/10000/*.xml` (265 PageXML files still available)

**Extraction command:**
```bash
grep -oh 'custom="structure {type:[^;]*"' ~/Downloads/10000/*.xml | sort | uniq -c | sort -rn
```

### Potential Uses for Region Type Data

1. **Region-aware search**: Filter search results by region type (e.g., "show only marginalia containing 'pepper'")
2. **Layout analysis**: Statistics on document structure across inventories
3. **Training data**: Labeled regions for ML models
4. **Transcription quality**: Compare main text vs marginalia accuracy

## Potential Future Approaches

1. **Use GLOBALISE's own coordinate data**: If the project provides coordinates aligned with their transcription API, this would solve the segmentation mismatch.

2. **Word-level coordinates**: Accept word-level granularity instead of line-level. Click on a word in the image, highlight that word in transcription (requires word-level API data).

3. **Server-side matching**: Build a service that aligns PageXML with API transcriptions using fuzzy text matching and layout analysis.

4. **Different coordinate source**: Use IIIF annotations or W3C Web Annotations that are aligned with the transcription.

5. **Region type metadata**: Extract and expose region types as document metadata (e.g., "this page has 3 marginalia regions") without attempting text-image linking.

## References

- PageXML format: http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15
- OpenSeadragon overlays: https://openseadragon.github.io/examples/ui-overlays/
- IIIF Content Search API: https://iiif.io/api/search/2.0/
