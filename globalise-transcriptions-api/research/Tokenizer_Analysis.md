# Elasticsearch Tokenizer Analysis

**Date:** December 27, 2025
**Related Issue:** [textannoviz#134](https://github.com/knaw-huc/textannoviz/issues/134)
**Index Tested:** `globalise-2024.03.18-test`

## Summary

Testing against the live GLOBALISE API indicates that the current index now uses the **default (standard) Elasticsearch tokenizer**, NOT the whitespace tokenizer. Previously, as noted in GitHub issue #134, the missing search results were found to be due to the use of the whitespace tokenizer.

## Background

GitHub issue #134 reported:
- Searching for "reuk" in inventory 9945 found 13 pages, but local file search found 37 word occurrences
- Page 77 containing "een benaude Reuk, dierhalven niet" was not found
- Words with attached punctuation (like "Bandar,") didn't match searches for the base word

The issue was caused by Elasticsearch's then use of the whitespace tokenizer, which "includes/leaves punctuation in the token."

## Test Methodology

Systematic API queries were run to determine tokenizer behavior:

1. **Punctuation at word boundaries**: Compare `word` vs `word,` vs `word.`
2. **Special characters as word boundaries**: Compare `oost-indie` vs `oost indie`
3. **Punctuation-only searches**: Search for just `,` or `.`
4. **Abbreviation patterns**: Test VOC-style abbreviations like `Comp=s`, `Ed:s`

## Test Results

### Test 1: Punctuation at Word Boundaries

| Query | Results |
|-------|---------|
| `peper` | 160,366 |
| `peper,` | 160,366 |
| `peper.` | 160,366 |
| `bandar` | 492 |
| `bandar,` | 492 |
| `bandar.` | 492 |
| `bandar;` | 492 |

**Finding:** All queries return identical counts. Punctuation is stripped.

### Test 2: Special Characters as Word Boundaries

| Query | Results |
|-------|---------|
| `oost-indie` | 160,811 |
| `oost indie` | 160,811 |
| `oostindie` | 46 |

**Finding:** Hyphen is treated as word boundary (standard tokenizer behavior).

### Test 3: Punctuation-Only Searches

| Query | Results |
|-------|---------|
| `,` | 0 |
| `.` | 0 |

**Finding:** No punctuation-only tokens exist in the index.

### Test 4: Abbreviation Patterns

| Query | Results | Notes |
|-------|---------|-------|
| `comp=s` (unquoted) | 2,224,867 | Matches "comp" AND "s" separately |
| `"comp=s"` (phrase) | 246,128 | Matches "comp" adjacent to "s" |
| `comps` | 41,855 | Different word entirely |

Snippet from `comp=s` search shows highlighting: `<em>s</em> <em>Comp</em>=<em>s</em>`

**Finding:** The `=` character is treated as a word separator. "Comp=s" is indexed as two tokens: "comp" and "s".

### Test 5: Line Continuation Markers

The transcriptions use `„` (double-low-9 quotation mark) as a line continuation marker (e.g., "vaar„ tung" for "vaartung" split across lines).

| Query | Results |
|-------|---------|
| `"vaar„ tung"` (phrase) | 94 |
| `"vaar tung"` (phrase) | 94 |
| `vaartung` | 95 |

**Finding:** The `„` character is stripped during tokenization.

### Test 6: GitHub Issue #134 Verification

| Test | Issue Reported | Current Result |
|------|----------------|----------------|
| "reuk" in inv 9945 | 13 hits | 16 pages |
| Page 77 phrase search | Missing | **Found** |
| "bandar" total | 415 hits | 492 pages |

The specific phrase "benaude reuk dierhalven" now correctly returns page 77:
```
urn:globalise:NL-HaNA_1.04.02_9945_0077
```

## Conclusions

### Tokenizer Behavior

The observed behavior is consistent with **Elasticsearch's standard (default) tokenizer**:

1. **Punctuation stripping**: Commas, periods, semicolons, etc. are removed
2. **Special characters as boundaries**: `=`, `-`, `:`, `„` all act as word separators
3. **No punctuation tokens**: Punctuation characters are not indexed as separate tokens
4. **Case insensitivity**: Searches are case-insensitive (standard analyzer behavior)

### Issue #134 Status

The specific examples from GitHub issue #134 appear to work correctly now:
- Page 77 is discoverable via phrase search
- Base word searches find documents regardless of trailing punctuation

Possible explanations:
1. The index was rebuilt since the issue was filed (index name suggests March 2024)
2. The Broccoli/Gloccoli layer applies query normalization
3. The original issue may have had other contributing factors

Note: The index was indeed rebuilt since the issue was filed.

### Document vs Word Count Discrepancy

The remaining discrepancy (37 local word occurrences vs 16 API page hits for "reuk") is **expected behavior**:
- Elasticsearch returns **page-level** results, not word occurrence counts
- Multiple occurrences of a word on the same page count as a single hit
- This is documented search API behavior, not a tokenizer issue

## Implications for Search Queries

### What Works

- Searching for `word` finds all instances regardless of surrounding punctuation
- `oost-indie` and `oost indie` are equivalent searches
- Phrase searches work across line continuation markers

### What Users Should Know

| User Intent | Recommended Query |
|-------------|-------------------|
| Find "peper" with any punctuation | `peper` (just the word) |
| Find hyphenated terms | Either form works: `oost-indie` or `oost indie` |
| Find VOC abbreviations like "Comp=s" | Use phrase: `"comp s"` or wildcard: `comp*` |
| Find exact word count | Not available via API; page counts only |

## Recommendations

1. **Update documentation** to clarify that:
   - Punctuation is stripped during tokenization (standard tokenizer)
   - No need to include trailing punctuation in searches
   - Page-level results are returned, not word occurrence counts

2. **Update Help_Revised.md** (`/offline/Help_Revised.md`):
   - The "Punctuation and Special Characters" section is mostly correct
   - Could add note about `=` and other special characters being word separators
   - Clarify that this is standard tokenizer behavior

3. **Consider closing issue #134** with these findings, noting:
   - The specific missing page is now found
   - Behavior is consistent with standard (not whitespace) tokenizer
   - Remaining count discrepancy is expected page-vs-word behavior

## Raw Test Commands

```bash
# Test punctuation stripping
curl -s 'https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=1' \
  -H 'Content-Type: application/json' \
  -d '{"text":"peper"}' | jq '.total.value'

# Test hyphen as word boundary
curl -s 'https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=1' \
  -H 'Content-Type: application/json' \
  -d '{"text":"oost-indie"}' | jq '.total.value'

# Test phrase from issue #134
curl -s 'https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=5' \
  -H 'Content-Type: application/json' \
  -d '{"text":"benaude reuk dierhalven","terms":{"invNr":["9945"]}}' | jq '.results[0]._id'
```
