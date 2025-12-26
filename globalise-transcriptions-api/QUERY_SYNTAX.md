# Query Syntax

The GLOBALISE API uses an Elasticsearch-like query syntax for full-text search. This guide covers all supported operators and patterns.

## Table of Contents

- [Basic Queries](#basic-queries)
- [Boolean Operators](#boolean-operators)
- [Wildcards](#wildcards)
- [Fuzzy Matching](#fuzzy-matching)
- [Phrase Search](#phrase-search)
- [Phrase Proximity](#phrase-proximity)
- [Punctuation and Special Characters](#punctuation-and-special-characters)
- [Query Examples](#query-examples)
- [Troubleshooting](#troubleshooting)

---

## Basic Queries

### Simple Term Search

Search for documents containing a single word:

```json
{ "text": "schip" }
```

Returns all documents containing the word "schip" (ship).

### Multiple Terms (Implicit OR)

Multiple terms without operators are treated as OR:

```json
{ "text": "peper koffie" }
```

Returns documents containing "peper" OR "koffie" (or both).

---

## Boolean Operators

### AND Operator

Find documents containing ALL terms:

```json
{ "text": "peper AND koffie" }
```

Returns only documents containing both "peper" AND "koffie".

**Important:** `AND` must be uppercase.

### OR Operator

Find documents containing ANY term:

```json
{ "text": "peper OR koffie" }
```

Returns documents containing "peper" OR "koffie" (or both).

**Note:** This is the default behavior for multiple terms.

### NOT Operator

Exclude documents containing a term:

```json
{ "text": "peper NOT koffie" }
```

Returns documents containing "peper" but NOT "koffie".

### Combining Operators

You can combine boolean operators:

```json
{ "text": "schip AND peper NOT koffie" }
```

Returns documents with both "schip" and "peper" but without "koffie".

### Parentheses for Grouping

Group terms with parentheses:

```json
{ "text": "(peper OR koffie) AND schip" }
```

Returns documents with "schip" that also contain either "peper" or "koffie".

---

## Wildcards

### Multi-Character Wildcard (*)

Match any sequence of characters:

```json
{ "text": "schip*" }
```

Matches: "schip", "schippen", "schippers", "schipbreuk", etc.

**Position examples:**

| Pattern | Matches |
|---------|---------|
| `schip*` | Words starting with "schip" |
| `*schip` | Words ending with "schip" |
| `*schip*` | Words containing "schip" |

### Single-Character Wildcard (?)

Match exactly one character:

```json
{ "text": "cop?e" }
```

Matches: "copie", "coppe", etc.

**Examples:**

| Pattern | Matches |
|---------|---------|
| `h?nd` | "hand", "hond", "hend" |
| `??nd` | Any 4-letter word ending in "nd" |
| `schip??` | "schippen" (exactly 2 more chars) |

### Combining Wildcards

You can combine wildcards:

```json
{ "text": "kof?ie*" }
```

Matches: "koffie", "koffiebonen", etc.

---

## Fuzzy Matching

### Edit Distance (~N)

Find terms within N character edits (insertions, deletions, substitutions):

```json
{ "text": "voorschreven~1" }
```

Matches words within 1 edit distance: "voorschreven", "voorschreve", "voorschreben", etc.

**Edit distance values:**

| Syntax | Meaning |
|--------|---------|
| `term~1` | 1 character difference allowed |
| `term~2` | 2 character differences allowed |
| `term~` | Default (usually 2) |

### Use Cases

Fuzzy matching is useful for:
- Historical spelling variations
- OCR errors in transcriptions
- Typo tolerance

**Example - Finding "Amsterdam" with OCR variations:**

```json
{ "text": "amsterdam~1" }
```

Matches: "Amsterdam", "Amsteldam", "Amsterdan", etc.

---

## Phrase Search

### Exact Phrase

Search for an exact sequence of words:

```json
{ "text": "\"de koffie\"" }
```

Returns documents containing the exact phrase "de koffie" (not just both words separately).

**Note:** Use escaped quotes in JSON.

### JavaScript Example

```javascript
const query = {
  text: '"peper en koffie"',  // Single quotes around JSON, double for phrase
  terms: {},
  aggs: {}
};
```

---

## Phrase Proximity

### Proximity Search (~N after phrase)

Find words that appear within N positions of each other, in any order:

```json
{ "text": "\"peper koffie\"~5" }
```

Returns documents where "peper" and "koffie" appear within 5 word positions of each other.

**Comparison:**

| Query | Meaning | Results |
|-------|---------|---------|
| `"peper koffie"` | Exact phrase (adjacent, in order) | Fewer matches |
| `"peper koffie"~5` | Within 5 positions (any order) | More matches |
| `"peper koffie"~10` | Within 10 positions (any order) | Even more matches |

### Use Cases

Proximity search is useful when:
- Words commonly appear together but not always adjacent
- Word order may vary in historical texts
- You want related concepts without requiring exact phrasing

**Example - Finding ship cargo discussions:**

```json
{ "text": "\"schip lading\"~10" }
```

Finds discussions of ships and cargo even when other words appear between them.

---

## Punctuation and Special Characters

### Punctuation Handling (Important Limitation)

The GLOBALISE corpus is **tokenized** during indexing, which means:

- **Punctuation is stripped** - Apostrophes, periods, hyphens are removed
- **Numbers are preserved** - Year searches like `1609` work correctly
- **Archive numbers don't work** - Searching `1.04.02` returns no results because periods are stripped

**What works:**

| Query | Result |
|-------|--------|
| `1609` | Finds year references |
| `Batavia` | Normal word search |
| `VOC` | Acronyms work |

**What doesn't work:**

| Query | Why It Fails |
|-------|--------------|
| `d'` | Apostrophe stripped, matches just `d` |
| `1.04.02` | Periods stripped, no match |
| `'s-Gravenhage` | Apostrophe/hyphen stripped |

### Workarounds

For words with apostrophes, search for the main word:

```json
{ "text": "Gravenhage" }
```

Instead of `'s-Gravenhage` which won't match as expected.

For archive numbers, use the `invNr` filter instead of text search:

```json
{
  "text": "*",
  "terms": { "invNr": ["9966"] }
}
```

### Escaping Query Operators

These characters have special meaning in queries and need escaping:

| Character | Meaning | To search literally |
|-----------|---------|---------------------|
| `*` | Multi-char wildcard | `\*` |
| `?` | Single-char wildcard | `\?` |
| `~` | Fuzzy/proximity | `\~` |
| `"` | Phrase delimiter | `\"` |
| `(` `)` | Grouping | `\(` `\)` |

### Match All Documents

Use `*` alone to match all documents:

```json
{ "text": "*" }
```

Useful for getting statistics or browsing without filtering.

---

## Query Examples

### Historical Research Examples

**Finding trade goods:**
```json
{ "text": "peper AND (koffie OR thee)" }
```

**Ship-related documents:**
```json
{ "text": "schip* AND (batavia OR ceylon)" }
```

**Official documents (with OCR tolerance):**
```json
{ "text": "voorschreven~1 AND resolutie" }
```

**Letters and correspondence:**
```json
{ "text": "\"missive van\" AND gouverneur" }
```

### Combined with Filters

Combine text search with term filters for precise results:

```javascript
const request = {
  text: "koffie AND peper",
  terms: {
    invNr: ["9966"],           // Specific inventory
    langIso: ["nld"]           // Dutch only
  },
  aggs: {}
};
```

### Statistics Query

Get counts without caring about specific content:

```javascript
const request = {
  text: "*",                    // Match all
  terms: { invNr: ["4293"] },   // Filter to inventory
  aggs: {
    langIso: { order: "countDesc", size: 100 }
  }
};
// Result: language distribution for inventory 4293
```

---

## Query Patterns

### Inventory Browsing

Browse all documents in an inventory:

```json
{
  "text": "*",
  "terms": { "invNr": ["9966"] },
  "aggs": { "langLabel": { "order": "countDesc", "size": 10 } }
}
```

### Language-Specific Search

Search only Dutch documents:

```json
{
  "text": "schip",
  "terms": { "langIso": ["nld"] },
  "aggs": {}
}
```

### Finding Cipher/Encrypted Text

Search for encrypted historical documents:

```json
{
  "text": "*",
  "terms": { "langIso": ["art"] },
  "aggs": {}
}
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| No results | Boolean operator lowercase | Use uppercase: `AND`, `OR`, `NOT` |
| Unexpected results | Implicit OR | Use explicit `AND` for required terms |
| Query error | Unbalanced parentheses | Check all `(` have matching `)` |
| Query error | Invalid regex | Escape special characters |
| Too many results | Query too broad | Add more terms or use filters |
| Too few results | Query too specific | Try wildcards or fuzzy matching |

### Testing Queries

1. **Start simple** - Single term first
2. **Add complexity** - One operator at a time
3. **Use aggregations** - Check facet counts
4. **Check spelling** - Historical spellings differ from modern

### Query Debugging

```javascript
// Test query incrementally
const queries = [
  "peper",                  // Step 1: Basic term
  "peper AND koffie",       // Step 2: Add AND
  "peper AND koffie*",      // Step 3: Add wildcard
];

for (const text of queries) {
  const response = await search({ text, terms: {}, aggs: {} });
  console.log(`"${text}": ${response.total.value} results`);
}
```

---

## Language Notes

### Historical Dutch Spelling

17th-18th century Dutch spelling differs from modern Dutch:

| Modern | Historical | Search Pattern |
|--------|------------|----------------|
| koffie | coffie, cofije | `kof?ie` or `coffie~1` |
| schip | scip, schijp | `sch?p` or `schip~1` |
| Batavia | Batavien | `batavi*` |

### OCR Considerations

Machine-generated transcriptions may contain errors:

- Similar letters confused: `n`/`u`, `c`/`e`, `i`/`l`
- Word boundaries incorrect
- Historical characters unrecognized

**Recommendation:** Use fuzzy matching (`~1`) for important searches to catch OCR errors.

---

## Quick Reference

| Syntax | Description | Example |
|--------|-------------|---------|
| `term` | Simple search | `schip` |
| `term1 AND term2` | Both required | `peper AND koffie` |
| `term1 OR term2` | Either matches | `peper OR koffie` |
| `term1 NOT term2` | Exclude term2 | `peper NOT koffie` |
| `"phrase"` | Exact phrase | `"de koffie"` |
| `"phrase"~N` | Proximity (N positions) | `"peper koffie"~5` |
| `term*` | Multi-char wildcard | `schip*` |
| `ter?` | Single-char wildcard | `cop?e` |
| `term~N` | Fuzzy (N edits) | `amsterdam~1` |
| `(a OR b) AND c` | Grouping | `(peper OR koffie) AND schip` |
| `*` | Match all | `*` |
