# Understanding `/brinta/globalise/indices`

**Purpose:** This endpoint reveals which document fields are **indexed for search** and their types.

---

## What It Returns

```bash
curl "https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices"
```

**Response:**
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

---

## What This Tells You

### The 4 Searchable Fields

| Field | Type | Meaning | Example Value |
|-------|------|---------|---------------|
| `invNr` | `keyword` | Inventory number | `"9966"` |
| `document` | `keyword` | Document ID | `"NL-HaNA_1.04.02_9966_0106"` |
| `langIso` | `keyword` | ISO language code | `["nld"]` |
| `langLabel` | `keyword` | Language name | `["Dutch"]` |

### Field Type: `keyword`

**Characteristics:**
- **Exact match only** - Must match the entire value exactly
- **Case-sensitive** - `"nld"` ≠ `"NLD"`
- **Not analyzed** - Stored as-is, no tokenization
- **Optimized for:**
  - Filtering (`terms` queries)
  - Aggregations (facet counts)
  - Sorting

**What you CAN do with keyword fields:**
- ✅ Filter: `"terms": {"invNr": ["9966"]}`
- ✅ Aggregate: `"aggs": {"langIso": {"order": "countDesc", "size": 10}}`
- ✅ Sort: `sortBy=invNr`

**What you CANNOT do:**
- ❌ Full-text search (use `text` field type for that)
- ❌ Partial matching (use wildcards in text search)
- ❌ Fuzzy matching

---

## Concrete Example

### Sample Document from Search Results

```json
{
  "_id": "urn:globalise:NL-HaNA_1.04.02_9966_0106",
  "_hits": {
    "text": [
      "314 de singaleesche kar= damom:. verslag nopens de <em>koffie</em>: Het bedragen..."
    ]
  },
  "textTokenCount": 180,
  "invNr": "9966",              // ← Searchable (keyword)
  "document": "NL-HaNA_1.04.02_9966_0106",  // ← Searchable (keyword)
  "langIso": ["nld"],           // ← Searchable (keyword)
  "langLabel": ["Dutch"]        // ← Searchable (keyword)
}
```

**Indexed fields** (the 4 fields from `/brinta/globalise/indices`):
- Can be used in `terms` filters
- Can be used in `aggs` aggregations
- Return exact matches only

**Non-indexed fields** (`_id`, `_hits`, `textTokenCount`):
- Returned in search results
- Cannot be used in filters
- Cannot be used in aggregations

---

## Testing Field Behavior

### Test 1: Filtering by Inventory (keyword field)

**Query:**
```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "*",
    "terms": {"invNr": ["9966"]},
    "aggs": {}
  }'
```

**Result:**
```json
{
  "total": {"value": 495, "relation": "eq"},
  "results": []
}
```

✅ **Works!** Found 495 documents in inventory 9966.

---

### Test 2: Filtering by Language (keyword field)

**Query:**
```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "*",
    "terms": {"langIso": ["nld"]},
    "aggs": {}
  }'
```

**Result:**
```json
{
  "total": {"value": 4344249, "relation": "eq"},
  "results": []
}
```

✅ **Works!** Found 4.3M Dutch documents.

---

### Test 3: Aggregating by Language (keyword field)

**Query:**
```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "koffie",
    "terms": {},
    "aggs": {
      "langIso": {"order": "countDesc", "size": 10}
    }
  }'
```

**Result:**
```json
{
  "total": {"value": 119, "relation": "eq"},
  "results": [],
  "aggs": {
    "langIso": {
      "nld": 119
    }
  }
}
```

✅ **Works!** All 119 documents mentioning "koffie" are in Dutch.

---

### Test 4: Non-Existent Field (not in index)

**Query:**
```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "*",
    "terms": {"date": ["1650-01-01"]},
    "aggs": {}
  }'
```

**Result:**
```json
{
  "total": {"value": 0, "relation": "eq"},
  "results": []
}
```

❌ **Doesn't work** - `date` field not indexed, returns 0 results.

---

## What About Other Fields?

### Full Document Metadata

When you retrieve a document via the document endpoint, you get **much more metadata**:

```json
{
  "anno": [{
    "body": {
      "metadata": {
        "document": "NL-HaNA_1.04.02_9966_0106",
        "file": "NL-HaNA_1.04.02_9966_0106.xml",
        "inventoryNumber": "9966",
        "n": "0106",
        "creator": "Laypa",
        "created": "2023-09-04T01:43:55",
        "lastChange": "2023-09-04T02:52:52",
        "eDepotId": "d0f3a03c-5a52-4343-9d61-4f577a1ec8f3",
        "naUrl": "https://www.nationaalarchief.nl/...",
        "trUrl": "https://globalise.tt.di.huc.knaw.nl/textrepo/...",
        "prevPageId": "urn:globalise:NL-HaNA_1.04.02_9966_0105",
        "nextPageId": "urn:globalise:NL-HaNA_1.04.02_9966_0107",
        "lang": [{"iso": "nld", "label": "Dutch"}],
        "langCorrected": false,
        "comment": "license: CC0"
      }
    }
  }]
}
```

### Indexed vs Non-Indexed Fields

| Field | Indexed? | Can Filter? | Can Aggregate? | Where Available |
|-------|----------|-------------|----------------|-----------------|
| `invNr` | ✅ Yes | ✅ Yes | ✅ Yes | Search + Document |
| `document` | ✅ Yes | ✅ Yes | ✅ Yes | Search + Document |
| `langIso` | ✅ Yes | ✅ Yes | ✅ Yes | Search + Document |
| `langLabel` | ✅ Yes | ✅ Yes | ✅ Yes | Search + Document |
| `inventoryNumber` | ❌ No | ❌ No | ❌ No | Document only |
| `n` (scan number) | ❌ No | ❌ No | ❌ No | Document only |
| `creator` | ❌ No | ❌ No | ❌ No | Document only |
| `created` | ❌ No | ❌ No | ❌ No | Document only |
| `naUrl` | ❌ No | ❌ No | ❌ No | Document only |
| `prevPageId` | ❌ No | ❌ No | ❌ No | Document only |
| `nextPageId` | ❌ No | ❌ No | ❌ No | Document only |

**Key Insight:**
- **`inventoryNumber`** exists in metadata but is **NOT indexed**
- **`invNr`** (different field) IS indexed
- They contain the same value (`"9966"`), but only `invNr` is searchable

---

## Why This Endpoint Matters

### 1. **Field Validation**

Before making a query, check if the field exists:

```javascript
const indices = await fetch('https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices');
const fields = indices['globalise-2024.03.18-test'];

if ('date' in fields) {
  // Can filter by date
} else {
  // Cannot filter by date (Globalise doesn't have it)
}
```

### 2. **Error Prevention**

Prevent users from trying to filter on non-existent fields:

```javascript
const validFilters = Object.keys(fields);  // ['invNr', 'document', 'langIso', 'langLabel']

if (!validFilters.includes(userRequestedField)) {
  throw new Error(`Cannot filter by ${userRequestedField}. Valid fields: ${validFilters.join(', ')}`);
}
```

### 3. **Dynamic UI Generation**

Build faceted search interfaces based on available fields:

```javascript
const facets = Object.keys(fields).map(field => ({
  field: field,
  type: fields[field],
  label: humanize(field)
}));

// Render facets:
// - Inventory Number (invNr)
// - Language (langIso)
// etc.
```

### 4. **Documentation**

Auto-generate accurate field reference:

```markdown
## Available Search Fields

- **invNr** (keyword) - Inventory number for filtering and aggregation
- **document** (keyword) - Document identifier for exact match
- **langIso** (keyword) - ISO 639-3 language code (e.g., "nld", "por")
- **langLabel** (keyword) - Human-readable language name (e.g., "Dutch", "Portuguese")
```

---

## Comparison: Suriano vs Globalise

### Suriano Fields (11 indexed fields)

```json
{
  "suriano-1.0.1e-029": {
    "bodyType": "keyword",
    "date": "date",           // ← Date filtering!
    "recipient": "keyword",
    "recipientLoc": "keyword",
    "sender": "keyword",
    "senderLoc": "keyword",
    "editorNotes": "keyword",
    "shelfmark": "keyword",
    "summary": "text"         // ← Full-text search!
  }
}
```

**Notice:**
- Has `date` field (type: `"date"`) → Date range queries supported
- Has `summary` field (type: `"text"`) → Full-text search on summaries
- Has rich editorial metadata (sender, recipient, locations)

### Globalise Fields (4 indexed fields)

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

**Notice:**
- No `date` field → No date filtering
- All `"keyword"` type → Exact match only
- Archive-focused (inventory, language) vs editorial-focused (sender, recipient)

---

## Use Cases for MCP Server

### Current Use

The MCP server **could** use this endpoint to:

1. **Validate queries** before sending to API
2. **Generate better error messages** when users try invalid fields
3. **Auto-discover** if new fields are added to the index in the future

### Example Implementation

```typescript
// Cache the indices response
let cachedFields: string[] | null = null;

async function getIndexedFields(): Promise<string[]> {
  if (!cachedFields) {
    const response = await fetch('https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices');
    const data = await response.json();
    cachedFields = Object.keys(data['globalise-2024.03.18-test']);
  }
  return cachedFields;
}

async function validateSearchFilters(filters: object): Promise<void> {
  const validFields = await getIndexedFields();

  for (const field of Object.keys(filters)) {
    if (!validFields.includes(field)) {
      throw new Error(
        `Invalid filter field: ${field}. ` +
        `Valid fields: ${validFields.join(', ')}`
      );
    }
  }
}
```

---

## Summary

**`/brinta/globalise/indices` reveals:**

1. **Which fields are searchable** - Only 4 fields in Globalise
2. **Field types** - All `keyword` (exact match)
3. **What operations are supported**:
   - ✅ Filtering via `terms`
   - ✅ Aggregations via `aggs`
   - ✅ Sorting via `sortBy`
   - ❌ Full-text search (no `text` type fields)
   - ❌ Date range filtering (no `date` type fields)

**Practical value:**
- Prevents errors from invalid filters
- Helps users understand search capabilities
- Enables dynamic tooling and validation
- Documents the actual API behavior (not assumptions)

---

**Key Takeaway:** This endpoint is like a **schema introspection tool** - it tells you what's actually indexed for search, not just what fields exist in the raw data.
