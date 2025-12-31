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
import weightsAndMeasures from './weights-measures.json' with { type: 'json' };
import commodities from './commodities.json' with { type: 'json' };

// Pre-stringify for resource response
const WEIGHTS_MEASURES_DATA = JSON.stringify(weightsAndMeasures, null, 2);
const COMMODITIES_DATA = JSON.stringify(commodities, null, 2);

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
    uri: 'globalise://help/query-syntax',
    name: 'Query Syntax Reference',
    description:
      'Complete guide to GLOBALISE search query syntax including Boolean operators, ' +
      'wildcards, fuzzy matching, phrase search, and proximity operators.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'globalise://reference/weights-measures',
    name: 'VOC Weights and Measures Glossary',
    description:
      'Historical units of weight, volume, length, and quantity used in Dutch East India Company (VOC) ' +
      'trade records (1764-1771). Includes 213 units with 385 spelling variants from the Memoriën van ' +
      'Munten, Maaten, en Gewigten. Structure: "units" contains unit definitions with Dutch (text_nl) and ' +
      'English (text_en) definitions plus scholarly source citations; "lookup" maps spelling variants to ' +
      'unit IDs. Use this to: (1) expand search queries with alternative spellings (e.g., "gantang" also ' +
      'appears as "ganting", "ting"), (2) understand regional variations in measurement systems, ' +
      '(3) interpret historical quantities with scholarly citations. Note: Values varied by location, ' +
      'commodity, and time period. Source: GLOBALISE Project (CC-BY-SA-4.0). ' +
      'Full dataset: https://hdl.handle.net/10622/MDNVH5',
    mimeType: 'application/json',
  },
  {
    uri: 'globalise://reference/commodities',
    name: 'VOC Commodities Thesaurus',
    description:
      'Trade goods from Dutch East India Company (VOC) archives. A SKOS thesaurus of 1,359 commodities ' +
      'shipped in the early modern Indian Ocean World, with 2,481 spelling variants for query expansion. ' +
      'Structure: "concepts" contains commodity entries with Dutch/English labels, alternative spellings, ' +
      'hierarchical relationships (broader parent, narrower children), and definitions; "lookup" maps ' +
      'spelling variants to concept IDs; "topConcepts" lists root categories (Food, Beverages, Textiles, etc.). ' +
      'Use this to: (1) expand search queries (e.g., "pepper" → "peper", "piper"), ' +
      '(2) find related commodities via hierarchy (broader/narrower), (3) understand historical trade terminology. ' +
      'Source: GLOBALISE Project (CC-BY-SA-4.0). Full dataset: https://hdl.handle.net/10622/YAWDOV',
    mimeType: 'application/json',
  },
];

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

**Tip:** Put the non-Dutch language FIRST. Dutch is 97% of the corpus, so any other language is always rarer.

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
 * @param uri - The resource URI (e.g., "globalise://help/query-syntax")
 * @returns Resource contents in the appropriate format
 * @throws Error if resource not found
 */
export async function readResource(uri: string): Promise<TextResourceContents[]> {
  const timestamp = new Date().toISOString();

  switch (uri) {
    case 'globalise://help/query-syntax': {
      console.error(`[${timestamp}] 📖 Resource READ: query-syntax`);
      return [
        {
          uri,
          mimeType: 'text/markdown',
          text: QUERY_SYNTAX_CONTENT,
        },
      ];
    }

    case 'globalise://reference/weights-measures': {
      console.error(`[${timestamp}] ⚖️  Resource READ: weights-measures (${WEIGHTS_MEASURES_DATA.length} bytes)`);
      return [
        {
          uri,
          mimeType: 'application/json',
          text: WEIGHTS_MEASURES_DATA,
        },
      ];
    }

    case 'globalise://reference/commodities': {
      console.error(`[${timestamp}] 📦 Resource READ: commodities (${COMMODITIES_DATA.length} bytes)`);
      return [
        {
          uri,
          mimeType: 'application/json',
          text: COMMODITIES_DATA,
        },
      ];
    }

    default:
      console.error(`[${timestamp}] ❌ Resource NOT FOUND: ${uri}`);
      throw new Error(`Resource not found: ${uri}`);
  }
}
