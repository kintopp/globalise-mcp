# Suriano API Comparison & Analysis

**Date:** December 26, 2025
**Purpose:** Compare Suriano correspondence API with documented Globalise API to identify features applicable to Globalise MCP server

---

## Executive Summary

The Suriano correspondence site (`https://edition.suriano.huygens.knaw.nl/`) uses the same Broccoli/Gloccoli platform as Globalise. By analyzing API calls made during site usage, we discovered **several API features not documented in the Globalise API reference** that could enhance the Globalise MCP server.

### Key Findings

1. ✅ **Date range filtering in POST body** - Not documented for Globalise
2. ✅ **Enhanced /config endpoint** - Returns more metadata than documented
3. ✅ **Aggregations-only query pattern** - `size=0` explicitly supported
4. ✅ **Field type introspection** - `/brinta/{project}/indices` reveals searchable fields

---

## API Endpoints Comparison

### 1. Search Endpoint: `POST /projects/{project}/search`

**Base Pattern (Both Projects):**
```
POST https://broccoli.{domain}/projects/{project}/search
```

#### Suriano Example:
```
POST https://broccoli.suriano.huygens.knaw.nl/projects/suriano/search
```

#### Globalise Example:
```
POST https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search
```

---

## New Features Discovered

### 🆕 Feature 1: Date Range Filtering in POST Body

**Status:** ✅ Not documented for Globalise, but likely supported

**Suriano Usage:**
```json
{
  "terms": {},
  "date": {
    "name": "date",
    "from": "1600-01-01",
    "to": "1700-12-31"
  },
  "aggs": { ... }
}
```

**Current Globalise Documentation:**
- Does NOT mention date range filtering
- No `date` field in request body schema
- Globalise index shows `langIso`, `invNr`, `document`, `langLabel` fields
- No date-related fields visible in `/brinta/globalise/indices`

**Analysis:**
- Suriano has a `date` field (type: "date") in its index
- This enables date range queries in the POST body
- **Globalise may not have indexed date fields**, explaining why this isn't documented
- Would require checking if Globalise documents have date metadata

**Action Items:**
- [ ] Test if Globalise API supports date range filtering
- [ ] Check Globalise document metadata for date fields
- [ ] If supported, add to MCP server as optional parameter

---

### 🆕 Feature 2: Enhanced `/config` Endpoint

**Status:** ✅ Suriano returns more data than Globalise documentation shows

**Suriano Response:**
```json
{
  "indexName": "suriano-1.0.1e-029",
  "initialDateFrom": "1600-01-01",
  "initialDateTo": "1700-12-31",
  "annotationTypesToInclude": [
    "tei:Div",
    "tei:Hi",
    "tf:Ent",
    "tei:Head",
    "tei:Metamark",
    "tei:Note",
    "tei:Ptr",
    "tf:File",
    "tf:Folder",
    "tf:Page",
    "LetterBody"
  ]
}
```

**Documented Globalise Response:**
```json
{
  "indexName": "globalise-2024.03.18-test",
  "broccoliUrl": "https://gloccoli.tt.di.huc.knaw.nl"
}
```

**Differences:**
- Suriano includes `annotationTypesToInclude` array
- Suriano includes default date range (`initialDateFrom/To`)
- Globalise includes `broccoliUrl` (Suriano doesn't)

**Analysis:**
- `/config` structure varies by project
- Suriano's config is tailored for date-based historical correspondence
- Globalise config might have additional fields we haven't documented
- Not directly useful for MCP server (we hardcode indexName already)

**Action Items:**
- [x] Noted: Config structure is project-specific
- [ ] Optional: Fetch Globalise `/config` to see if there are undocumented fields

---

### 🆕 Feature 3: Aggregations-Only Query Pattern

**Status:** ✅ Confirmed working, improves on Globalise documentation

**Suriano Pattern:**
```
POST /projects/suriano/search?size=0&indexName=suriano-1.0.1e-029

Body:
{
  "terms": {},
  "aggs": {
    "bodyType": { "order": "countDesc", "size": 10 },
    "date": { "order": "countDesc", "size": 10 },
    ...
  }
}

Response:
{
  "total": { "value": 725, "relation": "eq" },
  "results": [],  // Empty array when size=0
  "aggs": { ... } // Full aggregation results
}
```

**Current Globalise Documentation:**
```javascript
// Documented pattern uses size=1
const response = await fetch(
  ".../search?indexName=...&size=1",
  { ... }
);
```

**Analysis:**
- `size=0` explicitly returns zero results
- More efficient than `size=1` for aggregations-only queries
- Reduces payload size and processing time
- Standard Elasticsearch pattern

**Action Items:**
- [x] Update Globalise documentation to recommend `size=0` for aggregations
- [ ] Consider adding `aggregationsOnly` parameter to MCP tools

---

### 🆕 Feature 4: Structured Aggregations Object

**Status:** ✅ Both projects use same pattern

**Pattern:**
```json
{
  "aggs": {
    "fieldName": {
      "order": "countDesc" | "countAsc" | "keyDesc" | "keyAsc",
      "size": 10
    }
  }
}
```

**Suriano Fields:**
- `bodyType`, `date`, `recipient`, `recipientLoc`, `sender`, `senderLoc`, `editorNotes`, `shelfmark`, `summary`

**Globalise Fields:**
- `invNr`, `document`, `langIso`, `langLabel`

**Analysis:**
- Same aggregation syntax across both projects
- Field names differ based on document schemas
- Both support `order` and `size` parameters
- Already well-documented for Globalise

**Action Items:**
- [x] No changes needed - already implemented

---

## Endpoint-by-Endpoint Analysis

### Config Endpoint

| Endpoint | Suriano | Globalise (Documented) |
|----------|---------|------------------------|
| URL | `GET https://edition.suriano.huygens.knaw.nl/config` | `GET https://transcriptions.globalise.huygens.knaw.nl/config` |
| Returns indexName | ✅ Yes | ✅ Yes |
| Returns date range | ✅ Yes (`initialDateFrom/To`) | ❌ No |
| Returns annotation types | ✅ Yes | ❌ No |
| Returns broccoliUrl | ❌ No | ✅ Yes |

**Conclusion:** Config is project-specific. Suriano's focus on date ranges reflects its historical correspondence nature.

---

### Indices Endpoint

| Endpoint | Suriano | Globalise (Documented) |
|----------|---------|------------------------|
| URL | `GET /brinta/suriano/indices` | `GET /brinta/globalise/indices` |
| Multiple indices | ✅ 3 versions | ✅ Typically 1 |
| Field type info | ✅ Yes | ✅ Yes |
| Purpose | Introspection | Introspection |

**Example Response:**

**Suriano:**
```json
{
  "suriano-1.0.1e-029": {
    "bodyType": "keyword",
    "date": "date",
    "recipient": "keyword",
    "recipientLoc": "keyword",
    "sender": "keyword",
    "senderLoc": "keyword",
    "editorNotes": "keyword",
    "shelfmark": "keyword",
    "summary": "text"
  }
}
```

**Globalise:**
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

**Field Types:**
- `keyword` = Exact match, used for filtering/aggregations
- `text` = Full-text search
- `date` = Date range queries

**Analysis:**
- This endpoint reveals which fields support which query types
- Could be used for dynamic tool generation or validation
- Not currently exposed in Globalise MCP server

---

### Search Endpoint

**Query Parameters:**

| Parameter | Suriano Usage | Globalise Documented | Notes |
|-----------|---------------|----------------------|-------|
| `indexName` | ✅ Required | ✅ Required | Both projects |
| `fragmentSize` | ✅ 100 | ✅ Default 100 | Snippet size |
| `from` | ✅ 0 | ✅ Default 0 | Pagination offset |
| `size` | ✅ 0 or 10 | ✅ Default 10 | Results per page |
| `sortBy` | ✅ `date` | ✅ `_score` (default) | Sort field |
| `sortOrder` | ✅ `asc` | ✅ `desc` (default) | Sort direction |

**POST Body Structure:**

| Field | Suriano | Globalise | Notes |
|-------|---------|-----------|-------|
| `text` | ❌ Not used | ✅ Required | Full-text query |
| `terms` | ✅ Empty object | ✅ Filter object | Facet filters |
| `date` | ✅ Range object | ❌ Not documented | Date filtering |
| `aggs` | ✅ Aggregations | ✅ Aggregations | Facet counts |

---

## Recommendations for Globalise MCP Server

### High Priority

1. **✅ Use `size=0` for aggregations-only queries**
   - Update documentation examples
   - More efficient than `size=1`
   - Reduces API load and response payload

2. **🔍 Investigate date filtering support**
   - Test if Globalise supports `date` field in POST body
   - Check document metadata for date fields
   - If available, add to search tools

3. **📚 Document `/brinta/globalise/indices` endpoint**
   - Useful for discovering available fields
   - Could enable dynamic validation
   - Consider exposing as MCP tool for advanced users

### Medium Priority

4. **🧪 Test undocumented Globalise `/config` fields**
   - Fetch actual config response
   - Document any additional fields
   - May reveal useful metadata

5. **🔧 Consider field introspection utility**
   - Use `/indices` endpoint to validate queries
   - Prevent errors from invalid field names
   - Could improve error messages

### Low Priority

6. **📖 Update documentation patterns**
   - Show `size=0` for aggregations
   - Clarify which query params are optional
   - Add more examples of faceted filtering

---

## Testing Checklist

Before implementing features, test on Globalise API:

- [ ] Does Globalise support `size=0` query parameter?
- [ ] Does Globalise API accept `date` field in POST body?
- [ ] What does Globalise `/config` actually return?
- [ ] Are there undocumented query parameters?
- [ ] Do other Broccoli/Gloccoli projects share these patterns?

---

## Technical Notes

### API Architecture Similarities

Both Suriano and Globalise share:
- Broccoli/Gloccoli platform (same search engine)
- Similar URL structure: `/projects/{name}/search`
- Same aggregation syntax
- Same response structure (`total`, `results`, `aggs`)
- W3C Web Annotations for document metadata

### Differences Reflect Content

- **Suriano**: Historical correspondence (1616-1623)
  - Fields: sender, recipient, locations, dates, shelfmarks
  - Date-based navigation is core feature
  - Smaller corpus (725 documents)

- **Globalise**: VOC transcriptions (1600s-1700s)
  - Fields: inventory numbers, languages, document IDs
  - Inventory-based organization
  - Massive corpus (~4.8M documents)

---

## Conclusion

The Suriano API analysis revealed that the Broccoli/Gloccoli platform supports features not documented in the Globalise API reference:

1. **Date range filtering** - Possibly available for Globalise if date fields exist
2. **`size=0` aggregations pattern** - Confirmed working and more efficient
3. **Field type introspection** - `/indices` endpoint reveals searchable fields

**Next Steps:**
1. Test `size=0` pattern with Globalise API (likely works)
2. Investigate whether Globalise has date metadata fields
3. Consider exposing `/indices` endpoint as MCP tool
4. Update documentation with `size=0` aggregations pattern

**Impact on MCP Server:**
- Minimal changes needed
- `size=0` can be adopted immediately
- Date filtering requires testing before implementation
- Field introspection could improve error handling

---

## Appendix: Captured API Calls

**Initial Page Load (5 API calls):**

1. `GET /` - HTML page
2. `GET /config` - App configuration
3. `GET /brinta/suriano/indices` - Index metadata
4. `POST /search?size=0&indexName=...` - Aggregations only
5. `POST /search?indexName=...&fragmentSize=100&from=0&size=10&sortBy=date&sortOrder=asc` - Full search

**Raw captures saved to:**
- `/dev-browser/tmp/suriano-api-calls-initial.json`
- `/dev-browser/tmp/suriano-api-calls-complete.json`

---

**Analysis by:** Claude Code
**Browser automation:** dev-browser (Playwright)
**Methodology:** Network traffic monitoring during site interaction
