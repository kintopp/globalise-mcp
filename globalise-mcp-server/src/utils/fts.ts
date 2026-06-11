/**
 * Shared FTS5 query sanitation for the SQLite-backed search tools
 * (archival-index, commodities). Raw user input like "oost-indie" or an
 * unbalanced quote makes SQLite's FTS5 MATCH throw a syntax error (R7).
 *
 * Validate the query against a probe statement; on a syntax error, retry with
 * the whole query phrase-escaped in double quotes and return a note. If even
 * that fails, throw a structured ToolError with a suggestion.
 *
 * The caller supplies an already-prepared probe statement
 * (`SELECT rowid FROM <fts_table> WHERE <fts_table> MATCH @query LIMIT 1`), so
 * each tool keeps its own FTS table and its own per-connection statement caching
 * (see getStaticDbState in archival-index.ts / getStaticState in commodities.ts).
 */

import type { DbStatement } from './database.js';
import { ToolError } from './errors.js';

/** Returns the query to use against MATCH, plus a note when it was rewritten. */
export function sanitizeFtsQuery(
  probe: DbStatement,
  query: string,
): { query: string; note?: string } {
  try {
    probe.get({ query });
    return { query };
  } catch {
    const escaped = `"${query.replace(/"/g, '""')}"`;
    try {
      probe.get({ query: escaped });
      return {
        query: escaped,
        note: `query contained FTS5 syntax characters and was searched as the exact phrase ${escaped}`,
      };
    } catch {
      throw new ToolError(
        `Invalid full-text query: ${query}`,
        'FTS5 syntax error. Wrap multi-word or hyphenated terms in double quotes (e.g. "oost-indie"), and balance any quotes or parentheses.',
      );
    }
  }
}
