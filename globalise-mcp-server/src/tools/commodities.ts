/**
 * Commodities glossary lookup tool, backed by the local reference SQLite DB.
 *
 * The VOC commodities thesaurus is a consolidated, enriched vocabulary of
 * ~3,500 trade goods and trade-related concepts: bilingual Dutch/English
 * preferred labels, period spelling variants, and a definition per concept
 * carrying its source and a confidence rating.
 *
 * It is a flat glossary by design — the two candidate classifications from the
 * source data (an LLM-assigned coarse `class`, and the SKOS `skos:broader`
 * hierarchy) were both judged too unreliable to surface and were dropped: a
 * misleading taxonomy is worse than none. The tool is therefore a term-lookup,
 * not a browse-by-category tool.
 *
 * Primary use is query expansion: the transcription search tokenizer is
 * spelling-blind, so resolving a modern term to its period variants here and
 * feeding those back into globalise_search_transcriptions surfaces documents a
 * single-spelling search would miss.
 *
 * The PoolParty concept UUID is an internal key only — never surfaced, since
 * the PoolParty links are not publicly resolvable.
 */

import { z } from 'zod';
import {
  getReferenceDatabase,
  isReferenceDatabaseAvailable,
  type Db,
} from '../utils/database.js';
import { ToolError } from '../utils/errors.js';

export const lookupCommodityInputSchema = z.object({
  query: z.string().optional()
    .describe('Full-text search (SQLite FTS5) over Dutch + English labels, spelling variants, and the definition text. A space means AND — all terms must appear; also OR, NOT, prefix*, "exact phrase". Matches on labels/variants rank above matches in the definition body. Special characters (hyphens, slashes, unbalanced quotes/parens) make FTS5 throw, so the server retries the whole query as one quoted phrase and adds a `note`; quote the offending term yourself (e.g. "oost-indie") to keep operators. Omit to page through the whole glossary alphabetically.'),
  from: z.number().int().min(0).default(0)
    .describe('Pagination offset (default: 0)'),
  size: z.number().int().min(1).max(100).default(20)
    .describe('Results per page (1-100, default: 20)'),
});

const commodityResultSchema = z.object({
  prefLabelNl: z.string().nullable().describe('Preferred Dutch label (the form most likely to appear in the VOC text)'),
  prefLabelEn: z.string().nullable().describe('Preferred English label/translation'),
  altLabels: z.array(z.string()).describe('Period spelling variants and alternative forms — feed these to globalise_search_transcriptions to catch documents the modern spelling misses'),
  definition: z.string(),
  definitionLanguage: z.string().nullable().describe('Language of the definition text ("nl" or "en")'),
  definitionSource: z.string().nullable()
    .describe('Provenance of the definition. Authoritative: "PoolParty" (GLOBALISE project), "wnt" (historical Dutch dictionary IVDNT), "aat" (Getty Art & Architecture Thesaurus), "vocGlossarium" (VOC Glossary). Machine-written: "llm (...)" / "llm_sparse (...)" — over half the corpus. Weigh against `confidence`.'),
  definitionSourceDescription: z.string().nullable().describe('Human-readable description of the definition source'),
  confidence: z.string().nullable()
    .describe('Confidence in the definition: "high", "medium", "medium-low", "low" (or rarely "medium-high"). ~31% are low/medium-low — present these tentatively, especially when definitionSource is an "llm" source.'),
  definitionSourceUrl: z.string().nullable().describe('Link to the source entry where one exists (e.g. a WNT or Getty AAT permalink)'),
});

export const lookupCommodityOutputSchema = z.object({
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(commodityResultSchema),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean(),
  }),
  databaseInfo: z.object({
    commoditiesTotal: z.number(),
    available: z.boolean(),
  }),
  note: z.string().optional().describe('Caveats about how this result was computed (e.g. an FTS query rewritten as an exact phrase)'),
});

export type LookupCommodityInput = z.infer<typeof lookupCommodityInputSchema>;
export type LookupCommodityOutput = z.infer<typeof lookupCommodityOutputSchema>;

type CommodityDbRow = {
  pref_nl: string | null;
  pref_en: string | null;
  alt_labels: string | null;
  definition: string;
  definition_language: string | null;
  definition_source: string | null;
  definition_source_desc: string | null;
  confidence: string | null;
  definition_source_url: string | null;
};

// FTS5 column weights for bm25(): labels (pref_nl, pref_en) outrank spelling
// variants, which outrank a hit in the definition body. Lower bm25 = better.
const BM25_WEIGHTS = '10.0, 10.0, 5.0, 1.0';

/** Split the stored "a; b; c" alt-label string into a trimmed, non-empty array. */
function splitAltLabels(value: string | null): string[] {
  if (!value) return [];
  return value.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
}

function mapRow(row: CommodityDbRow) {
  return {
    prefLabelNl: row.pref_nl,
    prefLabelEn: row.pref_en,
    altLabels: splitAltLabels(row.alt_labels),
    definition: row.definition,
    definitionLanguage: row.definition_language,
    definitionSource: row.definition_source,
    definitionSourceDescription: row.definition_source_desc,
    confidence: row.confidence,
    definitionSourceUrl: row.definition_source_url,
  };
}

/**
 * Validate (and if necessary phrase-escape) an FTS5 query, mirroring the
 * archival-index tool: raw input like "oost-indie" or an unbalanced quote
 * makes SQLite throw, so on a syntax error we retry the whole query wrapped in
 * double quotes; if that still fails, throw a structured error.
 */
function sanitizeFtsQuery(db: Db, query: string): { query: string; note?: string } {
  const probe = db.prepare('SELECT rowid FROM commodities_fts WHERE commodities_fts MATCH @query LIMIT 1');
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

/**
 * Look up commodities by free text (or page the whole glossary alphabetically).
 */
export async function lookupCommodity(input: LookupCommodityInput): Promise<LookupCommodityOutput> {
  if (!isReferenceDatabaseAvailable()) {
    return {
      total: { value: 0, relation: 'eq' },
      results: [],
      pagination: { from: input.from, size: input.size, hasMore: false },
      databaseInfo: { commoditiesTotal: 0, available: false },
    };
  }

  const db = getReferenceDatabase();
  const notes: string[] = [];

  // Resolve the FTS query (phrase-escape unparseable input)
  let ftsQuery: string | undefined;
  if (input.query) {
    const sanitized = sanitizeFtsQuery(db, input.query);
    ftsQuery = sanitized.query;
    if (sanitized.note) notes.push(sanitized.note);
  }

  const commoditiesTotal = (db.prepare('SELECT COUNT(*) AS c FROM commodities').get() as { c: number }).c;

  // With a text query we JOIN the FTS table and rank by bm25; without one we
  // page the whole glossary ordered by label.
  let countSql: string;
  let selectSql: string;
  const params: Record<string, string | number> = {};

  if (ftsQuery !== undefined) {
    params.query = ftsQuery;
    countSql = `SELECT COUNT(*) AS c FROM commodities c JOIN commodities_fts f ON c.id = f.rowid
                WHERE commodities_fts MATCH @query`;
    selectSql = `SELECT c.* FROM commodities c JOIN commodities_fts f ON c.id = f.rowid
                 WHERE commodities_fts MATCH @query
                 ORDER BY bm25(commodities_fts, ${BM25_WEIGHTS})
                 LIMIT @limit OFFSET @offset`;
  } else {
    countSql = 'SELECT COUNT(*) AS c FROM commodities';
    selectSql = `SELECT * FROM commodities
                 ORDER BY COALESCE(pref_en, pref_nl) COLLATE NOCASE
                 LIMIT @limit OFFSET @offset`;
  }

  const total = (db.prepare(countSql).get(params) as { c: number }).c;
  const rows = db.prepare(selectSql).all({ ...params, limit: input.size, offset: input.from }) as CommodityDbRow[];

  return {
    total: { value: total, relation: 'eq' },
    results: rows.map(mapRow),
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: total > input.from + rows.length,
    },
    databaseInfo: {
      commoditiesTotal,
      available: true,
    },
    ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
  };
}
