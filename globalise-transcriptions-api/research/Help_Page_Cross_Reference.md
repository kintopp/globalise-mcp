# Help Page vs API/MCP Cross-Reference

**Date:** 2025-12-26
**Source:** `https://transcriptions.globalise.huygens.knaw.nl/help` (saved as `offline/Help.html`)

This document compares the official GLOBALISE help page documentation against actual API behavior and MCP server capabilities.

---

## Feature Comparison Matrix

| Feature | Help Page | API | MCP | Notes |
|---------|:---------:|:---:|:---:|-------|
| **Query Syntax** |||||
| Case-insensitive search | ✅ | ✅ | ✅ | All match |
| Multiple keywords (implicit OR) | ✅ | ✅ | ✅ | All match |
| AND operator (uppercase) | ✅ | ✅ | ✅ | All match |
| OR operator (uppercase) | ✅ | ✅ | ✅ | All match |
| NOT operator (uppercase) | ✅ | ✅ | ✅ | All match |
| Wildcard `*` (multi-char) | ✅ | ✅ | ✅ | All match |
| Wildcard `?` (single-char) | ✅ | ✅ | ✅ | All match |
| Exact phrases (`"..."`) | ✅ | ✅ | ✅ | All match |
| Fuzzy matching (`~N`) | ✅ | ✅ | ✅ | All match |
| Parentheses grouping | ✅ | ✅ | ✅ | All match |
| **Escape characters (`\*`, `\?`)** | ✅ | ⚠️ | ⚠️ | **See Critical Finding #1** |
| **Filters** |||||
| Inventory filter | ✅ | ✅ | ✅ | **Different syntax - See Finding #2** |
| Language filter | ❌ | ✅ | ✅ | Not on help page |
| **API-Only Features** |||||
| Phrase proximity (`"..."~N`) | ❌ | ✅ | ✅ | Undocumented on help page |
| Sorting (score, document, invNr) | ❌ | ✅ | ✅ | Undocumented on help page |
| Aggregations/facets | ❌ | ✅ | ✅ | Undocumented on help page |
| **UI-Only Features** |||||
| Keyword highlighting | ✅ | ✅ | ✅ | API returns `<em>` tags |
| Zoom controls (+, -, reset) | ✅ | 🖥️ | 🖥️ | UI-only |
| Page navigation | ✅ | ✅ | ✅ | API: prev/next IDs |
| Metadata sidebar | ✅ | ✅ | ✅ | API returns metadata |

**Legend:**
- ✅ = Fully supported
- ⚠️ = Partial/unexpected behavior
- ❌ = Not supported
- 🖥️ = UI-only feature

---

## Critical Findings

### Finding #1: Escape Characters Do NOT Work As Documented

**Help page claims:**
> Since * and ? are normally used as wildcards, you need to take special measures to include these in your search term as regular characters. This is done by placing the character after a backslash (\). To search for all words ending in question marks, use, for example, `??\?` this will find all two letter words ending in a question mark, such as `is?`.

**Actual API behavior (tested 2025-12-26):**

| Query | Expected | Actual Results | What Happened |
|-------|----------|----------------|---------------|
| `schip*` | Wildcard | 846,037 | ✅ Works correctly |
| `schip\*` | Literal `schip*` | 755,310 | ❌ Same as `schip` (backslash ignored) |
| `schip` | Exact word | 755,310 | Reference baseline |
| `cop?e` | Single-char wildcard | 46,261 | ✅ Works correctly |
| `cop\?e` | Literal `cop?e` | 2,184,143 | ❌ Tokenized as `cop` OR `e` |
| `cop e` | Implicit OR | 2,184,143 | Reference - confirms tokenization |

**Conclusion:** The backslash (`\`) does NOT escape wildcard characters. Instead:
- `\*` is stripped/ignored, treating `term\*` as `term`
- `\?` acts as a word separator, turning `a\?b` into `a b` (implicit OR)

**Impact:** Users following the help page instructions for searching literal `*` or `?` characters will get unexpected results.

---

### Finding #2: Inventory Filter Syntax Differs

**Help page claims:**
> You can also filter on multiple inventory numbers by listing them separated by commas (e.g. 1053,1604A).

**Actual API behavior (tested 2025-12-26):**

| Syntax | Expected | Actual Results | Status |
|--------|----------|----------------|--------|
| `{"invNr": ["9966"]}` (array, single) | 495 | 495 | ✅ Works |
| `{"invNr": ["9966","4293"]}` (array, multi) | 1,030 | 1,030 | ✅ Works |
| `{"invNr": "9966"}` (string, single) | 495 | 4,784,614 | ❌ Returns ALL docs |
| `{"invNr": "9966,4293"}` (comma-separated) | 1,030 | 4,784,614 | ❌ Returns ALL docs |

**Conclusion:** The API only accepts arrays for the `invNr` filter. String values (whether single or comma-separated) are silently ignored, returning all documents.

**Impact:**
- The web UI likely converts comma-separated input to array format before calling the API
- Direct API users must use array syntax `["inv1", "inv2"]`
- MCP server already uses array syntax (correct)

---

## Features NOT on Help Page (But Supported)

These features work in the API and MCP but are undocumented on the help page:

### 1. Phrase Proximity Search (`"phrase"~N`)

Find words within N positions of each other:

```json
{ "text": "\"peper koffie\"~5" }
```

**Tested:** `"peper koffie"~5` returns 15 results vs 5 for exact phrase.

### 2. Language Filtering

Filter by ISO 639-3 code or human-readable label:

```json
{ "terms": { "langIso": ["nld"] } }
```

**Available:** 23 languages including Dutch, Portuguese, Spanish, French, Malay, Persian, etc.

### 3. Sorting Options

```json
POST /search?sortBy=invNr&sortOrder=asc
```

**Available fields:** `_score` (relevance), `document`, `invNr`, `langLabel`

### 4. Aggregations/Facets

```json
{ "aggs": { "langIso": { "order": "countDesc", "size": 10 } } }
```

Returns document counts by language, inventory, etc.

---

## UI-Only Features

These work in the web interface but are not relevant to API/MCP:

- **Zoom controls** (+, -, reset buttons)
- **Page image navigation** (left/right arrows on image viewer)
- **Sidebar toggle** (shows/hides metadata panel)

The API equivalents:
- High-resolution images: via National Archives link
- Navigation: `prev`/`next` document IDs in response
- Metadata: included in document retrieval response

---

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| Help page features that work correctly | 10 | ✅ |
| Help page features with discrepancies | 2 | ⚠️ |
| API features not on help page | 4 | ✅ (undocumented) |
| UI-only features | 3 | 🖥️ (expected) |

---

## Recommendations

### For Documentation

1. **QUERY_SYNTAX.md**: Update escape character section to note API limitation
2. **MCP tool descriptions**: Already correct (use array syntax)

### For Users

1. **Literal wildcards**: Cannot be searched reliably via API - no workaround
2. **Multiple inventories**: Use array syntax `["inv1", "inv2"]`, not comma-separated

### For Future Investigation

1. Does the web UI have client-side logic that makes escape characters work?
2. Is there an alternate syntax for literal special characters?

---

## Test Commands Used

```bash
# Wildcard test
curl -s -X POST ".../search" -d '{"text": "schip*"}' | jq '.total.value'
# → 846037

# Escape test (fails)
curl -s -X POST ".../search" -d '{"text": "schip\\*"}' | jq '.total.value'
# → 755310 (same as just "schip")

# Inventory array (works)
curl -s -X POST ".../search" -d '{"terms": {"invNr": ["9966"]}}' | jq '.total.value'
# → 495

# Inventory string (fails silently)
curl -s -X POST ".../search" -d '{"terms": {"invNr": "9966"}}' | jq '.total.value'
# → 4784614 (all docs)
```

---

## References

- Help page source: `offline/Help.html`
- API docs: `globalise-transcriptions-api/API_REFERENCE.md`
- Query syntax: `globalise-transcriptions-api/QUERY_SYNTAX.md`
- MCP tools: `globalise-mcp-server/src/index.ts`
