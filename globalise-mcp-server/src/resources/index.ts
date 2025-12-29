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
  switch (uri) {
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
