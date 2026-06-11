/**
 * Shared FTS5 query sanitation for the SQLite-backed search tools
 * (archival-index, commodities). Raw user input like "oost-indie" or an
 * unbalanced quote makes SQLite's FTS5 MATCH throw a syntax error (R7).
 *
 * The error comes from the FTS5 query *grammar*, not the tokenizer: a bareword
 * may contain only letters, digits, underscore, and codepoints above U+007F, so
 * a hyphen/slash/apostrophe/comma is rejected before any tokenizer runs (see
 * https://sqlite.org/fts5.html#fts5_strings). The fix is therefore query-side —
 * quote the offending barewords — not a different tokenizer (which would change
 * indexing but leave the parse error untouched and force a DB rebuild).
 *
 * Strategy, cheapest-and-most-faithful first:
 *   1. Try the query verbatim — valid FTS5 passes through, preserving full
 *      power-user syntax (AND/OR/NOT/NEAR, grouping, prefix*, "phrases").
 *   2. On failure, quote only the barewords that contain illegal characters and
 *      leave the STRUCTURE intact (escapeFtsTerms). `peper OR oost-indie`
 *      becomes `peper OR "oost-indie"` — operators and grouping survive.
 *   3. If even that won't parse (unterminated quote, unbalanced parens), fall
 *      back to wrapping the whole query as one exact phrase. This DOES drop
 *      operators, so the note says so.
 *   4. If nothing parses, throw a structured ToolError with a suggestion.
 *
 * The caller supplies an already-prepared probe statement
 * (`SELECT rowid FROM <fts_table> WHERE <fts_table> MATCH @query LIMIT 1`), so
 * each tool keeps its own FTS table and its own per-connection statement caching
 * (see getStaticDbState in archival-index.ts / getStaticState in commodities.ts).
 */

import type { DbStatement } from './database.js';
import { ToolError } from './errors.js';

/**
 * The FTS5 query contract, single-sourced so the two tool input-schema
 * describes and the two `index.ts` registrations can't drift from each other or
 * from the sanitizer's actual behavior (CODE-REVIEW findings 4, 16) — the next
 * change to this file's behavior edits one string. Each call site adds its own
 * surrounding context (grouping caveat, bm25 ranking, alphabetical paging).
 * SKILL.md restates the same contract for a different audience and is updated by
 * hand (markdown can't interpolate a const).
 */
export const FTS_OPERATORS =
  'a bare space means AND — all terms must appear; plus OR/NOT, prefix*, "exact phrase"';
export const FTS_AUTOQUOTE =
  'Terms with special characters (hyphens, slashes, apostrophes) are auto-quoted for you while your AND/OR/NOT operators are kept intact, so `peper OR oost-indie` works as written. Only input FTS5 itself cannot parse (unbalanced quotes/parens) falls back to a whole-phrase search, flagged in the response note.';

/** A token already legal as an FTS5 bareword: letters, digits, underscore, non-ASCII. */
const LEGAL_BAREWORD = /^[\p{L}\p{N}_]+$/u;
/** Characters that delimit a bareword in the FTS5 grammar (structure we pass through). */
const STRUCTURAL = new Set([' ', '\t', '\n', '\r', '(', ')', '"']);

/** Wrap a string as one FTS5 phrase literal, doubling embedded quotes (`a"b` → `"a""b"`). */
function quoteAsPhrase(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Rewrite a raw query into a valid FTS5 MATCH expression by quoting ONLY the
 * individual barewords that contain illegal characters, leaving query structure
 * — grouping parens, existing "phrases", and a trailing prefix `*` — in place.
 * This preserves the user's boolean intent instead of collapsing the whole query
 * into a single phrase.
 *
 * Operator keywords (AND/OR/NOT/NEAR) need no special handling: they are already
 * legal barewords, so they pass through unchanged, and FTS5 itself decides
 * whether each is an operator or a search term (by case and position).
 *
 * Best-effort: the result is not guaranteed to parse (e.g. an unterminated
 * quote passes through unchanged), so the caller must still probe it.
 */
export function escapeFtsTerms(query: string): string {
  let out = '';
  let i = 0;
  const n = query.length;

  while (i < n) {
    const ch = query[i];

    // An existing "phrase": copy the whole span (incl. "" escapes and a trailing
    // prefix *) through untouched. An unterminated phrase runs to end-of-string
    // and is emitted as-is — the caller's probe will reject it and fall back.
    // Handled before the general structural check so the span is consumed whole.
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (query[j] === '"') {
          if (query[j + 1] === '"') { j += 2; continue; } // "" = escaped quote, stays inside
          break;
        }
        j++;
      }
      let end = j < n ? j + 1 : n; // past the closing quote, or end-of-string
      if (query[end] === '*') end++; // keep a phrase-prefix marker attached
      out += query.slice(i, end);
      i = end;
      continue;
    }

    // Other structure — whitespace and grouping parens — copied through verbatim.
    if (STRUCTURAL.has(ch)) {
      out += ch;
      i++;
      continue;
    }

    // Otherwise a bareword: consume up to the next structural character.
    let j = i;
    while (j < n && !STRUCTURAL.has(query[j])) j++;
    let token = query.slice(i, j);
    i = j;

    // Peel a trailing prefix * so it stays OUTSIDE the quotes (`"oost-indie"*`).
    let star = '';
    if (token.endsWith('*')) {
      star = '*';
      token = token.slice(0, -1);
    }

    if (token.length === 0) {
      out += star; // a lone '*' or similar — leave it for the probe to judge
    } else if (LEGAL_BAREWORD.test(token)) {
      out += token + star; // operator keyword or already-legal bareword: pass through
    } else {
      out += quoteAsPhrase(token) + star; // quote just this term
    }
  }

  return out;
}

/**
 * Distinguish an FTS5 *query-grammar* failure (which we recover from by
 * rewriting) from an operational one (which must propagate, not be masked as
 * "invalid query"). node:sqlite tags every SQLite failure with
 * `code: 'ERR_SQLITE_ERROR'` and the raw result code in `errcode`; query-grammar
 * problems — the only thing that varies in the probe — surface as SQLITE_ERROR
 * (errcode 1): "fts5: syntax error near …", "unterminated string",
 * "no such column: …". A finalized statement after closeDatabase() is
 * ERR_INVALID_STATE; SQLITE_BUSY is errcode 5 and I/O errors 10 — none match,
 * so they rethrow instead of degrading to a confusing "Invalid full-text query"
 * (CODE-REVIEW finding 12).
 */
function isFtsQueryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_SQLITE_ERROR' &&
    (error as { errcode?: unknown }).errcode === 1
  );
}

/** Returns the query to use against MATCH, plus a note when it was rewritten. */
export function sanitizeFtsQuery(
  probe: DbStatement,
  query: string,
): { query: string; note?: string } {
  // 1. Valid as-is — preserve full FTS5 syntax for power users.
  try {
    probe.get({ query });
    return { query };
  } catch (e) {
    if (!isFtsQueryError(e)) throw e; // operational failure: surface it, don't rewrite
    // else fall through to rewriting
  }

  // 2. Quote only the offending barewords, keeping operators and grouping.
  const rebuilt = escapeFtsTerms(query);
  if (rebuilt !== query) {
    try {
      probe.get({ query: rebuilt });
      return {
        query: rebuilt,
        note: `query contained FTS5 special characters; the affected terms were quoted (boolean operators preserved) and it was searched as ${rebuilt}`,
      };
    } catch (e) {
      if (!isFtsQueryError(e)) throw e;
      // else fall through to whole-phrase wrap
    }
  }

  // 3. Last resort: search the whole input as one exact phrase. This drops any
  //    AND/OR/NOT operators, so only reach it when per-term quoting still fails
  //    (an unterminated quote or unbalanced parens).
  const escaped = quoteAsPhrase(query);
  try {
    probe.get({ query: escaped });
    return {
      query: escaped,
      note: `query could not be parsed even after quoting individual terms, so it was searched as the exact phrase ${escaped} — any AND/OR/NOT operators were dropped; balance your quotes and parentheses`,
    };
  } catch (e) {
    if (!isFtsQueryError(e)) throw e;
    throw new ToolError(
      `Invalid full-text query: ${query}`,
      'FTS5 syntax error. Wrap multi-word or hyphenated terms in double quotes (e.g. "oost-indie"), and balance any quotes or parentheses.',
    );
  }
}
