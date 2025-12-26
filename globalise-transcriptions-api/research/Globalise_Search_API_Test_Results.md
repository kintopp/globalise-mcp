# Globalise Search API Test Results

**Date:** December 26, 2025
**Purpose:** Validate Suriano search API patterns against Globalise API

---

## Executive Summary

Testing confirmed **2 optimizations** and revealed **1 architectural difference**:

1. ✅ **`size=0` aggregations** - WORKS! 54.7% payload reduction
2. ❌ **Date range filtering** - NOT supported (Globalise has no date fields)
3. ✅ **`/brinta/globalise/indices`** - Works, reveals searchable fields
4. ✅ **`/config` endpoint** - Works, simpler than Suriano

---

## Test 1: `size=0` Aggregations Pattern

### Test Method

```bash
# size=0 (Suriano pattern)
curl -X POST ".../search?indexName=...&size=0" \
  -d '{"text": "*", "terms": {"invNr": ["9966"]}, "aggs": {...}}'

# size=1 (documented Globalise pattern)
curl -X POST ".../search?indexName=...&size=1" \
  -d '{"text": "*", "terms": {"invNr": ["9966"]}, "aggs": {...}}'
```

### Results

**✅ SUCCESS - `size=0` works perfectly!**

| Metric | size=0 | size=1 | Difference |
|--------|--------|--------|------------|
| Total documents | 495 | 495 | Same |
| Results returned | 0 | 1 | 1 fewer |
| Aggregations | ✅ Yes | ✅ Yes | Same |
| Response size | 107 bytes | 236 bytes | **-129 bytes (-54.7%)** |

### Response Comparison

**With `size=0`:**
```json
{
  "total": {"value": 495, "relation": "eq"},
  "results": [],  // Empty array
  "aggs": {
    "langIso": {
      "nld": 468,
      "unknown": 4
    }
  }
}
```

**With `size=1`:**
```json
{
  "total": {"value": 495, "relation": "eq"},
  "results": [
    {
      "_id": "urn:globalise:...",
      "_hits": {...},
      "invNr": "9966",
      ...
    }
  ],
  "aggs": {
    "langIso": {
      "nld": 468,
      "unknown": 4
    }
  }
}
```

### Recommendation

**🔴 HIGH PRIORITY: Update all aggregations-only queries**

**Current pattern (documented):**
```javascript
const response = await fetch(
  ".../search?indexName=...&size=1",
  { method: "POST", body: JSON.stringify({...}) }
);
```

**Optimized pattern:**
```javascript
const response = await fetch(
  ".../search?indexName=...&size=0",  // ← Change here
  { method: "POST", body: JSON.stringify({...}) }
);
```

**Benefits:**
- 54.7% smaller response payload
- Faster API response
- Lower bandwidth usage
- Standard Elasticsearch pattern

---

## Test 2: Date Range Filtering

### Test Method

```bash
curl -X POST ".../search?indexName=...&size=5" \
  -d '{
    "text": "*",
    "date": {
      "name": "date",
      "from": "1650-01-01",
      "to": "1700-12-31"
    },
    "aggs": {}
  }'
```

### Results

**❌ NOT SUPPORTED - Globalise has no date fields**

```json
{
  "total": {"value": 0, "relation": "eq"},
  "results": [],
  "request": {}
}
```

**Analysis:**
- API accepts the `date` parameter without error
- Returns 0 results (no documents match)
- Globalise index has NO date field (confirmed via `/brinta/globalise/indices`)

### Field Comparison

| Project | Indexed Fields |
|---------|----------------|
| **Suriano** | `bodyType`, `date`, `sender`, `recipient`, `senderLoc`, `recipientLoc`, `editorNotes`, `shelfmark`, `summary` |
| **Globalise** | `invNr`, `document`, `langIso`, `langLabel` |

**Why the difference:**
- **Suriano** = Editorial correspondence (date-centric, sender/recipient metadata)
- **Globalise** = OCR transcriptions (archive-centric, inventory/language metadata)

### Recommendation

**❌ DO NOT implement date filtering for Globalise**

- Globalise documents don't have date fields indexed
- Would return 0 results for all queries
- Not part of Globalise's document model

---

## Test 3: `/config` Endpoint

### Results

**✅ Works - Simpler than Suriano**

**Globalise `/config`:**
```json
{
  "indexName": "globalise-2024.03.18-test",
  "broccoliUrl": "https://gloccoli.tt.di.huc.knaw.nl"
}
```

**Suriano `/config`:**
```json
{
  "indexName": "suriano-1.0.1e-029",
  "initialDateFrom": "1600-01-01",
  "initialDateTo": "1700-12-31",
  "annotationTypesToInclude": [
    "tei:Div", "tei:Hi", "tf:Ent", ...
  ]
}
```

### Comparison

| Field | Globalise | Suriano | Notes |
|-------|-----------|---------|-------|
| `indexName` | ✅ Yes | ✅ Yes | Both have |
| `broccoliUrl` | ✅ Yes | ❌ No | Globalise-specific |
| `initialDateFrom/To` | ❌ No | ✅ Yes | Suriano-specific (date filtering) |
| `annotationTypesToInclude` | ❌ No | ✅ Yes | Suriano-specific (TEI annotations) |

### Recommendation

**✅ Already correctly implemented**

MCP server already uses this endpoint internally. No changes needed.

---

## Test 4: `/brinta/globalise/indices` Endpoint

### Results

**✅ Works - Reveals searchable fields**

```json
{
  "globalise-2024.03.18-test": {
    "invNr": "keyword",
    "document": "keyword",
    "langIso": "keyword",
    "langLabel": "keyword"
  }
}
```

### Field Type Meanings

| Type | Description | Use Case |
|------|-------------|----------|
| `keyword` | Exact match, case-sensitive | Filtering, aggregations |
| `text` | Full-text search, analyzed | Search queries |
| `date` | Date range queries | Time-based filtering |

**Globalise fields are ALL `keyword` type:**
- Optimized for filtering and faceting
- No full-text fields (text search happens on document content, not metadata)

### Use Cases

1. **Field validation** - Check if field exists before querying
2. **Dynamic tool generation** - Build tools based on available fields
3. **Error prevention** - Avoid queries on non-existent fields
4. **Documentation** - Auto-generate field reference

### Recommendation

**🟡 MEDIUM PRIORITY: Document this endpoint**

Add to API reference:
```markdown
## Get Index Fields

**Endpoint:** `GET /brinta/globalise/indices`

Returns field type mappings for all available indices.

**Response:**
{
  "globalise-2024.03.18-test": {
    "invNr": "keyword",
    "document": "keyword",
    "langIso": "keyword",
    "langLabel": "keyword"
  }
}
```

**Optional:** Expose as MCP tool for advanced users

---

## Summary: All Search Features Tested

| Feature | Suriano | Globalise | Status | Action |
|---------|---------|-----------|--------|--------|
| `size=0` aggregations | ✅ Used | ✅ **WORKS!** | 🔴 HIGH | **Implement now** |
| Date filtering | ✅ Used | ❌ No date fields | N/A | Skip |
| `/config` endpoint | ✅ Complex | ✅ Simple | ✅ OK | Already implemented |
| `/brinta/{project}/indices` | ✅ Used | ✅ Works | 🟡 MEDIUM | Document |

---

## Implementation Recommendations

### 1. Update to `size=0` Pattern (HIGH PRIORITY)

**Files to change:**

#### `globalise-transcriptions-api/API_REFERENCE.md`

**Current example (line 315-337):**
```javascript
// Use size=1 to minimize payload while getting aggregations
const response = await fetch(
  ".../search?indexName=...&size=1",
  ...
);
```

**Update to:**
```javascript
// Use size=0 to get only aggregations without results
const response = await fetch(
  ".../search?indexName=...&size=0",  // ← Changed from size=1
  ...
);
```

#### MCP Server Tools (if any use this pattern)

Search for `size=1` in aggregations-only queries and change to `size=0`.

### 2. Document `/brinta/globalise/indices` (MEDIUM PRIORITY)

Add new section to `API_REFERENCE.md`:

```markdown
## Get Index Fields

Retrieve field type mappings to understand which fields support filtering, full-text search, or date ranges.

**Endpoint:** `GET /brinta/globalise/indices`

**Response:**
{
  "globalise-2024.03.18-test": {
    "invNr": "keyword",      // Supports exact match filtering
    "document": "keyword",   // Supports exact match filtering
    "langIso": "keyword",    // Supports exact match filtering
    "langLabel": "keyword"   // Supports exact match filtering
  }
}

**Field Types:**
- `keyword` - Exact match, used for filtering and aggregations
- `text` - Full-text search with analysis
- `date` - Date range queries
```

### 3. Do NOT Implement Date Filtering

Globalise has no date fields. Skip this feature entirely.

---

## Complete Test Results

### Test Commands

```bash
# Test 1: size=0
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0" \
  -H "Content-Type: application/json" \
  -d '{"text": "*", "terms": {"invNr": ["9966"]}, "aggs": {"langIso": {"order": "countDesc", "size": 10}}}'

# Test 2: Date filtering
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=5" \
  -H "Content-Type: application/json" \
  -d '{"text": "*", "date": {"name": "date", "from": "1650-01-01", "to": "1700-12-31"}, "aggs": {}}'

# Test 3: /config
curl "https://transcriptions.globalise.huygens.knaw.nl/config"

# Test 4: /brinta/globalise/indices
curl "https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices"
```

### Raw Results

Saved to:
- `/tmp/search-size0.json`
- `/tmp/search-size1.json`
- `/tmp/search-date-filter.json`
- `/tmp/globalise-config.json`
- `/tmp/globalise-indices.json`

---

## Conclusion

**Search API testing revealed:**

1. ✅ **`size=0` optimization** - Ready to implement, 54.7% payload savings
2. ❌ **Date filtering** - Not applicable to Globalise (architectural difference)
3. ✅ **Field introspection** - `/brinta/globalise/indices` works, should be documented

**Next Steps:**

1. Update documentation to use `size=0` instead of `size=1`
2. Document `/brinta/globalise/indices` endpoint
3. Skip date filtering (not supported by Globalise's data model)

---

**Analysis by:** Claude Code
**Test date:** December 26, 2025
**Method:** Direct API testing with curl + Python
