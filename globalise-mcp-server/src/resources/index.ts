/**
 * MCP Resources for GLOBALISE API
 *
 * Resources provide application-controlled context to LLMs.
 * Unlike tools (which the model invokes), resources are exposed
 * for clients to read when they need context.
 *
 * See: https://modelcontextprotocol.io/specification/2025-11-25/server/resources
 */

import { Resource, TextResourceContents } from '@modelcontextprotocol/sdk/types.js';
import { apiPost, buildUrl, API_CONFIG, configCache, getCachedApiGet } from '../utils/api-client.js';
import { SearchResponse } from '../utils/types.js';
import { LRUCache } from '../utils/cache.js';

/**
 * Cache for resource data (corpus stats, languages)
 * 10 minute TTL since this data changes infrequently
 */
const resourceCache = new LRUCache<unknown>(10, 600000);

/**
 * Resource definitions
 *
 * Each resource has:
 * - uri: Unique identifier using globalise:// scheme
 * - name: Short display name
 * - description: What this resource provides
 * - mimeType: Content format
 */
export const RESOURCES: Resource[] = [
  {
    uri: 'globalise://corpus/stats',
    name: 'Corpus Statistics',
    description:
      'Overview of the GLOBALISE corpus including total document count, ' +
      'language distribution, and top inventories. Updated from live API.',
    mimeType: 'application/json',
  },
  {
    uri: 'globalise://languages',
    name: 'Language Index',
    description:
      'All languages in the corpus with ISO codes, labels, and document counts. ' +
      'Use this to understand language distribution before filtering searches.',
    mimeType: 'application/json',
  },
  {
    uri: 'globalise://help/query-syntax',
    name: 'Query Syntax Reference',
    description:
      'Complete guide to GLOBALISE search query syntax including Boolean operators, ' +
      'wildcards, fuzzy matching, phrase search, and proximity operators.',
    mimeType: 'text/markdown',
  },
];

/**
 * Fetch corpus statistics using aggregation query
 *
 * Uses the pattern: query="*" with size=1 to get aggregations
 * without retrieving full document results.
 */
async function fetchCorpusStats(): Promise<Record<string, unknown>> {
  const cacheKey = 'corpus-stats';
  const cached = resourceCache.get(cacheKey);
  if (cached) {
    return cached as Record<string, unknown>;
  }

  // Build aggregation request
  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/search`,
    {
      indexName: API_CONFIG.DEFAULT_INDEX,
      from: 0,
      size: 1, // Minimal results, we want aggregations
    }
  );

  const response = await apiPost<SearchResponse>(url, {
    text: '*', // Match all documents
    terms: {},
    aggs: {
      invNr: { order: 'countDesc', size: 20 },
      langIso: { order: 'countDesc', size: 50 },
      langLabel: { order: 'countDesc', size: 50 },
    },
  });

  // Transform to clean statistics format
  const stats = {
    totalDocuments: response.total.value,
    totalRelation: response.total.relation, // 'eq' or 'gte'
    index: API_CONFIG.DEFAULT_INDEX,
    languages: response.aggs?.langIso
      ? Object.entries(response.aggs.langIso).map(([code, count]) => {
          // Find matching label
          const labelEntry = response.aggs?.langLabel
            ? Object.entries(response.aggs.langLabel).find(([, c]) => c === count)
            : undefined;
          return {
            code,
            label: labelEntry?.[0] || code,
            count,
          };
        })
      : [],
    topInventories: response.aggs?.invNr
      ? Object.entries(response.aggs.invNr)
          .map(([invNr, count]) => ({ inventoryNumber: invNr, count }))
          .slice(0, 10)
      : [],
    fetchedAt: new Date().toISOString(),
  };

  resourceCache.set(cacheKey, stats);
  return stats;
}

/**
 * Fetch language index with detailed information
 */
async function fetchLanguages(): Promise<Record<string, unknown>> {
  const cacheKey = 'languages';
  const cached = resourceCache.get(cacheKey);
  if (cached) {
    return cached as Record<string, unknown>;
  }

  // Get corpus stats first (reuses cache if available)
  const stats = await fetchCorpusStats();
  const languages = stats.languages as Array<{ code: string; label: string; count: number }>;

  // Enrich with notes about specific languages
  const enrichedLanguages = languages.map((lang) => {
    const notes: string[] = [];

    // Add notes for special cases
    if (lang.code === 'unknown') {
      notes.push('Language not yet classified (not unidentifiable)');
    }
    if (lang.code === 'art') {
      notes.push('Cipher: Encrypted Dutch text using artificial/constructed language code');
    }
    if (['fas', 'ben', 'tam', 'sin', 'lzh', 'jpn', 'guj', 'bug', 'chu', 'grc', 'hbo'].includes(lang.code)) {
      notes.push('Non-Roman script: Transcriptions may be unreliable. Use page scan links.');
    }
    if (lang.code === 'msa') {
      notes.push('Malay macrolanguage: Some pages may use non-Roman script. Use page scan links.');
    }

    return {
      ...lang,
      notes: notes.length > 0 ? notes : undefined,
    };
  });

  const result = {
    totalLanguages: enrichedLanguages.length,
    languages: enrichedLanguages,
    notes: {
      classification:
        'Languages are automatically classified. "unknown" means not yet classified.',
      nonRomanScripts:
        'The corpus was transcribed using a Latin-character-only model. Non-Roman script transcriptions are unreliable.',
      cipher:
        'Code "art" (artificial language) is used for encrypted Dutch documents.',
    },
    fetchedAt: new Date().toISOString(),
  };

  resourceCache.set(cacheKey, result);
  return result;
}

/**
 * Static query syntax reference content
 */
const QUERY_SYNTAX_CONTENT = `# GLOBALISE Query Syntax Reference

## Basic Search
- **Simple terms**: \`peper\` - finds documents containing "peper"
- **Multiple terms**: \`peper koffie\` - finds documents with either term (implicit OR)

## Boolean Operators
- **AND**: \`peper AND koffie\` - both terms must appear
- **OR**: \`peper OR koffie\` - either term (explicit OR, same as space)
- **NOT**: \`peper NOT koffie\` - first term without second

## Phrase Search
- **Exact phrase**: \`"East India Company"\` - exact sequence of words
- **Proximity**: \`"peper koffie"~5\` - terms within 5 words of each other

## Wildcards
- **Multi-character**: \`schip*\` - matches "schip", "schipper", "schipbreuk"
- **Single-character**: \`cop?e\` - matches "copie", "copye"

## Fuzzy Matching
- **Edit distance**: \`voorschreven~1\` - matches within 1 character difference
- Useful for OCR errors and spelling variations

## Tokenization Notes
- **Punctuation stripped**: \`peper\` finds "peper," and "peper."
- **Hyphens are separators**: \`oost-indie\` searches for "oost" OR "indie"
- **Case insensitive**: \`Batavia\` = \`batavia\` = \`BATAVIA\`

## Language Filtering
Use ISO 639-3 codes or human-readable names:
- \`nld\` / \`Dutch\`
- \`eng\` / \`English\`
- \`fas\` / \`Persian\`
- \`ben\` / \`Bengali\`
- \`msa\` / \`Malay\`
- \`unknown\` - Not yet classified
- \`art\` / \`Cipher\` - Encrypted Dutch

### Single Language
\`\`\`
language: "nld"
language: "Persian"
\`\`\`

### Multiple Languages (OR - any match)
\`\`\`
language: ["nld", "eng"]        # Documents in Dutch OR English
language: ["Persian", "Dutch"]  # Same, using names
\`\`\`

### Multiple Languages (AND - all required)
\`\`\`
language: ["eng", "nld"], matchAll: true   # Bilingual English-Dutch
language: ["Portuguese", "Dutch"], matchAll: true  # Documents with BOTH
\`\`\`

**Tip:** Put the rarer language FIRST for best results (e.g., English before Dutch).

## Examples
\`\`\`
# Find pepper trade documents in Dutch
query: "peper", language: "nld"

# Find bilingual Dutch-English documents
language: ["nld", "eng"], matchAll: true

# Find mentions of Batavia with spelling variations
query: "batavia~1"

# Find documents about coffee or tea
query: "koffie OR thee"

# Find exact company name
query: "\"Verenigde Oost-Indische Compagnie\""
\`\`\`

## Tips
1. Start broad, then narrow with filters
2. Use wildcards for partial matches
3. Use fuzzy matching for OCR errors
4. Check aggregations for language distribution before filtering
5. Use \`matchAll: true\` to find multilingual/bilingual documents
`;

/**
 * Read a resource by URI
 *
 * @param uri - The resource URI (e.g., "globalise://corpus/stats")
 * @returns Resource contents in the appropriate format
 * @throws Error if resource not found
 */
export async function readResource(uri: string): Promise<TextResourceContents[]> {
  switch (uri) {
    case 'globalise://corpus/stats': {
      const stats = await fetchCorpusStats();
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(stats, null, 2),
        },
      ];
    }

    case 'globalise://languages': {
      const languages = await fetchLanguages();
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(languages, null, 2),
        },
      ];
    }

    case 'globalise://help/query-syntax': {
      return [
        {
          uri,
          mimeType: 'text/markdown',
          text: QUERY_SYNTAX_CONTENT,
        },
      ];
    }

    default:
      throw new Error(`Resource not found: ${uri}`);
  }
}
