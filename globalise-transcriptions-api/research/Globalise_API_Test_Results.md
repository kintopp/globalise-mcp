# Globalise API Feature Testing Results

**Date:** December 26, 2025
**Purpose:** Validate Suriano API features against Globalise API

---

## Executive Summary

Testing confirmed **2 undocumented features** in the Globalise API:

1. ✅ **`includeResults=iiif` parameter** - WORKS! Returns clean IIIF data
2. ✅ **Multiple `overlapTypes`** - WORKS! But only `px:Page` exists in Globalise
3. ❌ **Rich annotation types** - Globalise only has `px:Page` (Suriano has 11 types)

---

## Test 1: `includeResults=iiif` Parameter

### Test Method

```bash
# WITH iiif parameter
curl "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106?overlapTypes=px:Page&includeResults=anno,iiif,text&views=self&relativeTo=Origin"

# WITHOUT iiif parameter
curl "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106?overlapTypes=px:Page&includeResults=anno,text&views=self&relativeTo=Origin"
```

### Results

**✅ SUCCESS - Feature is fully supported!**

| Aspect | With `iiif` | Without `iiif` |
|--------|-------------|----------------|
| Top-level keys | `['profile', 'request', 'anno', 'views', 'iiif']` | `['profile', 'request', 'anno', 'views']` |
| Has `iiif` key | ✅ Yes | ❌ No |
| Request echo | `['anno', 'text', 'iiif']` | `['anno', 'text']` |

### IIIF Data Structure

When `includeResults=iiif` is specified, response includes:

```json
{
  "iiif": {
    "manifest": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json",
    "canvasIds": [
      "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106"
    ]
  }
}
```

**Fields:**
- `manifest` (string) - URL to IIIF Presentation API manifest
- `canvasIds` (array) - Array of canvas identifiers for this document

### Benefits

**Before** (current documented approach):
```javascript
// Must parse through annotations to find IIIF URLs
const imageUrl = doc.anno[0]?.target?.find(t => t.type === "Image")?.source;
const canvasUrl = doc.anno[0]?.target?.find(t => t.type === "Canvas")?.source;
const manifestUrl = canvasUrl?.split('/canvas/')[0] + '.json';  // Reconstruct!
```

**After** (with `includeResults=iiif`):
```javascript
// Direct access to IIIF data
const manifestUrl = doc.iiif.manifest;
const canvasIds = doc.iiif.canvasIds;
```

### Recommendation

**🔴 HIGH PRIORITY: Update MCP server immediately**

1. Add `iiif` to `includeResults` parameter in document retrieval
2. Parse and return `iiif` object in tool responses
3. Update API documentation to mention this feature
4. Consider exposing manifest/canvas URLs directly in tool output

---

## Test 2: Multiple `overlapTypes`

### Test Method

```bash
# Single type (documented)
curl "...?overlapTypes=px:Page&..."

# Multiple types (comma-separated)
curl "...?overlapTypes=px:Page,tei:Note&..."

# Only alternative type
curl "...?overlapTypes=tei:Note&..."

# Wildcard
curl "...?overlapTypes=*&..."

# No overlapTypes specified
curl "...?includeResults=anno,text&views=self&relativeTo=Origin"
```

### Results

**✅ Syntax supported, but Globalise only has `px:Page` annotations**

| Test | overlapTypes | Anno Count | Result |
|------|--------------|------------|--------|
| Single type | `px:Page` | 1 | ✅ Works |
| Multiple types | `px:Page,tei:Note` | 1 | ✅ Accepts syntax, returns px:Page only |
| Only tei:Note | `tei:Note` | 0 | ✅ Valid query, no results |
| Only tf:Ent | `tf:Ent` | 0 | ✅ Valid query, no results |
| Wildcard | `*` | 0 | ❌ Doesn't work as expected |
| Not specified | (empty) | 1 | ✅ Defaults to px:Page |

### Annotation Types by Project

**Suriano** (11 types):
```
tei:Div, tei:Hi, tf:Ent, tei:Head, tei:Metamark,
tei:Note, tei:Ptr, tf:File, tf:Folder, tf:Page, LetterBody
```

**Globalise** (1 type):
```
px:Page
```

### Analysis

1. **Comma-separated syntax works** - API correctly parses multiple types
2. **Globalise is simpler** - Only page-level annotations, no editorial markup
3. **No rich TEI annotations** - Globalise doesn't have notes, divisions, entities like Suriano
4. **Filtering still useful** - If Globalise adds annotation types in the future, syntax is ready

### Why the Difference?

| Aspect | Suriano | Globalise |
|--------|---------|-----------|
| Project type | Editorial correspondence | OCR transcriptions |
| Annotation model | Rich TEI (Text Encoding Initiative) | Simple page structure |
| Content | 725 edited letters | ~4.8M scanned pages |
| Annotations | Editor notes, entities, divisions | Page metadata only |
| Use case | Scholarly edition | Archive search |

### Recommendation

**🟢 LOW PRIORITY: Document but don't implement**

1. Note that Globalise only has `px:Page` annotation type
2. Multiple `overlapTypes` syntax works but isn't needed
3. If Globalise adds annotation types in future, we're ready
4. Keep `overlapTypes=px:Page` in current implementation

---

## Test 3: Default Behavior

### When `overlapTypes` is NOT specified

**Result:** Returns `px:Page` annotation by default

```json
{
  "request": {
    "overlapTypes": null  // Not set
  },
  "anno": [
    {
      "body": {
        "type": "px:Page"
      }
    }
  ]
}
```

### Recommendation

The `overlapTypes` parameter is **optional** for Globalise:
- If omitted, defaults to `px:Page`
- If specified, must be `px:Page` (only type available)
- Can make it optional in MCP server (use `px:Page` as default)

---

## Comparison: Suriano vs Globalise Document APIs

### URL Pattern (Identical)

```
GET /projects/{project}/urn:{project}:{identifier}?{params}
```

### Query Parameters

| Parameter | Suriano | Globalise | Status |
|-----------|---------|-----------|--------|
| `overlapTypes` | 11 types (comma-sep) | `px:Page` only | Both support syntax |
| `includeResults` | `anno,iiif,text` | `anno,iiif,text` | ✅ Both support `iiif` |
| `views` | `self` | `self` | ✅ Identical |
| `relativeTo` | `Origin` | `Origin` | ✅ Identical |

### Response Structure

| Field | Suriano | Globalise | Status |
|-------|---------|-----------|--------|
| `profile` | ✅ Yes | ✅ Yes | ✅ Identical |
| `request` | ✅ Yes | ✅ Yes | ✅ Identical |
| `anno` | ✅ 41 items | ✅ 1 item | Both have it (different counts) |
| `views.self.lines` | ✅ 20-50 lines | ✅ Varies | ✅ Identical structure |
| `iiif` | ✅ Top-level object | ✅ Top-level object | ✅ **Both support!** |

---

## Implementation Recommendations

### 1. Adopt `includeResults=iiif` (HIGH PRIORITY)

**Changes needed in MCP server:**

#### In `src/tools/document.ts`

**Current:**
```typescript
const params = new URLSearchParams({
  overlapTypes: "px:Page",
  includeResults: "anno,text",  // ← Missing iiif
  views: "self",
  relativeTo: "Origin"
});
```

**Updated:**
```typescript
const params = new URLSearchParams({
  overlapTypes: "px:Page",
  includeResults: "anno,iiif,text",  // ← Add iiif
  views: "self",
  relativeTo: "Origin"
});
```

#### Tool Response Enhancement

**Add IIIF data to tool responses:**

```typescript
// After fetching document
const response = await apiClient.get(url);

// Extract IIIF data
const iiifManifest = response.data.iiif?.manifest;
const iiifCanvas = response.data.iiif?.canvasIds?.[0];

// Include in tool response
return {
  // ... existing fields ...
  iiifManifest: iiifManifest,
  iiifCanvas: iiifCanvas
};
```

#### Tool Description Update

**Add to `globalise_retrieve_document` description:**

```
Returns IIIF manifest and canvas URLs for viewing high-resolution page scans.
```

### 2. Update Documentation (MEDIUM PRIORITY)

**Files to update:**

1. **`globalise-transcriptions-api/API_REFERENCE.md`**
   - Add `iiif` to `includeResults` parameter options
   - Document the `iiif` response field structure
   - Add example showing IIIF data extraction

2. **`globalise-mcp-server/CHANGELOG.md`**
   - Note discovery of `includeResults=iiif` feature
   - Credit Suriano API comparison

3. **`globalise-mcp-server/README.md`**
   - Mention IIIF support in features list

### 3. Optional: Make overlapTypes Optional (LOW PRIORITY)

Since `px:Page` is the only type and the default:

```typescript
// Could make this optional
const overlapTypes = options.overlapTypes || "px:Page";
```

But since we only ever use `px:Page`, keeping it hardcoded is fine.

---

## Testing Checklist

### Completed ✅

- [x] Test `includeResults=iiif` parameter
- [x] Verify `iiif` object structure in response
- [x] Compare with/without `iiif` parameter
- [x] Test multiple `overlapTypes` syntax
- [x] Test different annotation type values
- [x] Test wildcard and no-parameter behavior
- [x] Verify Globalise annotation types

### Remaining ⬜

- [ ] Update MCP server to use `includeResults=iiif`
- [ ] Add IIIF data to tool responses
- [ ] Test updated MCP tools with real clients
- [ ] Update API documentation
- [ ] Update MCP server README/CHANGELOG

---

## Conclusion

**Major Discovery:** The `includeResults=iiif` parameter is **fully supported** by Globalise but **completely undocumented**.

### Impact

**Before:**
- IIIF URLs scattered across `anno[].target[]` arrays
- Required parsing and URL reconstruction
- Manifest URL had to be derived from canvas URL

**After:**
- Clean top-level `iiif` object
- Direct access to manifest and canvas URLs
- Simpler code, better DX

### Next Steps

1. ✅ **Immediate:** Update MCP server to use `includeResults=iiif`
2. 📚 **Soon:** Document this feature in API reference
3. 🧪 **Later:** Test with real IIIF viewers to validate URLs

---

**Test Results Summary:**

| Feature | Status | Priority | Action |
|---------|--------|----------|--------|
| `includeResults=iiif` | ✅ Works | 🔴 HIGH | Implement now |
| Multiple `overlapTypes` | ✅ Works | 🟢 LOW | Document only |
| Rich annotation types | ❌ Not in Globalise | N/A | No action |

---

**Analysis by:** Claude Code
**Test date:** December 26, 2025
**Method:** Direct API testing with curl + Python analysis
**Sample document:** `urn:globalise:NL-HaNA_1.04.02_9966_0106`
