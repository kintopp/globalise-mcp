/**
 * Weights & measures lookup tool, backed by the local reference SQLite DB
 * (the same data/reference.sqlite the commodities tool reads).
 *
 * The dataset is the GLOBALISE "Weights and Measures in the 18th Century Indian
 * Ocean World" glossary (213 units, 385 period spelling variants, 731
 * conversion relationships), drawn from the *Memoriën van Munten, Maaten, en
 * Gewigten* (1764–1771). Source hdl:10622/MDNVH5, CC-BY-SA-4.0.
 *
 * This is NOT a unit converter. Early-modern VOC units were not stable: a
 * unit's value shifts by place, period, and even the commodity measured (a
 * bahar of pepper ≠ a bahar of cloves), and a unit name often doubles as the
 * name of the measuring container. The conversion ratios are *period-reported
 * claims* tagged with the settlement/commodity context they were recorded for —
 * read them with that context, never as exact arithmetic.
 *
 * The reliably-present content is label + type + spelling variants + the
 * period-reported conversion ratios. Definitions are SPARSE — only ~22% of
 * units carry any, and English text appears in ~6% — so they are a bonus, not
 * the core (mirrors the v2.7.2 commodities reframe).
 *
 * Like commodities, the period spelling variants double as query-expansion
 * fodder for globalise_search_transcriptions, which is spelling-blind.
 */

import { z } from 'zod';
import {
  getReferenceDatabase,
  isReferenceDatabaseAvailable,
  createConnectionState,
} from '../utils/database.js';
import { sanitizeFtsQuery, FTS_OPERATORS, FTS_AUTOQUOTE } from '../utils/fts.js';

export const lookupMeasureInputSchema = z.object({
  query: z.string().optional()
    .describe(`Full-text search (SQLite FTS5) over the unit label, period spelling variants, and the (sparse) definition text. ${FTS_OPERATORS}. Matches on labels/variants rank above matches in the definition body. ${FTS_AUTOQUOTE} Omit to page through all units alphabetically.`),
  from: z.number().int().min(0).default(0)
    .describe('Pagination offset (default: 0)'),
  size: z.number().int().min(1).max(100).default(20)
    .describe('Results per page (1-100, default: 20)'),
});

const measureResultSchema = z.object({
  label: z.string().describe('The unit name as it appears in the dataset (e.g. "Mutsje", "Bahar")'),
  type: z.string().nullable().describe('Unit category: weight, volume, length, area, quantities, or misc. Load-bearing: a few labels (roede/voet/ammonam) are homonyms that differ only by type.'),
  variants: z.array(z.string()).describe('Period spelling variants — feed these to globalise_search_transcriptions for recall (the transcription search is spelling-blind)'),
  definitions: z.array(z.object({
    nl: z.string().optional(),
    en: z.string().optional(),
  })).describe('Period definitions (nl/en only — NO source key). Sparse: most units return [] (only ~22% have any; English ~6%) — a bonus, not the core.'),
  conversions: z.array(z.object({
    ratio: z.string().describe('Period-reported equivalence, e.g. "1 Kan = 8 Mutsje". A self-referential ratio (e.g. "1 Mutsje = 1 Mutsje") attests use in that context without a recorded local equivalence — incomplete, not an error.'),
    context: z.string().nullable().describe('Where/for which commodity this ratio was reported — populated for all current rows; ratios vary by place and good, so always read the ratio against its context.'),
  })).describe('Period-reported conversion relationships in which this unit appears (as either side of the ratio)'),
});

export const lookupMeasureOutputSchema = z.object({
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(measureResultSchema),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean().describe('True when more results exist beyond this page, or when this response was size-capped and trailing results were dropped to fit the budget — in either case page with a higher `from` (the note states how many were kept) to reach the rest.'),
  }),
  databaseInfo: z.object({
    measuresTotal: z.number(),
    available: z.boolean(),
  }),
  note: z.string().optional().describe('Caveats about how this result was computed — e.g. an FTS query whose special-character terms were auto-quoted, or a size-cap that dropped trailing results to fit the response budget (it then states how many of how many were kept and how to recover the rest).'),
});

export type LookupMeasureInput = z.infer<typeof lookupMeasureInputSchema>;
export type LookupMeasureOutput = z.infer<typeof lookupMeasureOutputSchema>;

type MeasureDbRow = {
  unit_id: string;
  label: string;
  type: string | null;
  variants: string | null;
  definitions: string;
};

type ConversionDbRow = {
  ratio: string;
  context: string | null;
};

// FTS5 column weights for bm25(): the unit label outranks a spelling-variant
// hit, which outranks a hit in the (sparse) definition body. Lower bm25 =
// better. Columns are (label, variants, def_text) in the build's FTS schema.
const BM25_WEIGHTS = '10.0, 5.0, 1.0';

/** Split the stored "a; b; c" variants string into a trimmed, non-empty array. */
function splitVariants(value: string | null): string[] {
  if (!value) return [];
  return value.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse the JSON-serialized definitions column back into {nl?, en?} objects.
 * Defensive against malformed JSON (returns []) and strips any key other than
 * nl/en, so the output always matches the schema.
 */
function parseDefinitions(json: string): Array<{ nl?: string; en?: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => {
    const def: { nl?: string; en?: string } = {};
    if (entry && typeof entry === 'object') {
      const nl = (entry as Record<string, unknown>).nl;
      const en = (entry as Record<string, unknown>).en;
      if (typeof nl === 'string') def.nl = nl;
      if (typeof en === 'string') def.en = en;
    }
    return def;
  });
}

function mapRow(row: MeasureDbRow, conversions: ConversionDbRow[]) {
  return {
    label: row.label,
    type: row.type,
    variants: splitVariants(row.variants),
    definitions: parseDefinitions(row.definitions),
    conversions: conversions.map((c) => ({ ratio: c.ratio, context: c.context })),
  };
}

/**
 * Per-connection state whose SQL or result is constant: the FTS probe statement
 * and the unit count. The reference DB is read-only and rebuilt only at deploy,
 * so neither changes for the life of a connection — caching them keeps every
 * call from re-preparing the probe and re-running COUNT(*). createConnectionState
 * (database.ts) owns the handle-keying and the statement cache; `state.prepare`
 * below is shared with the per-call COUNT/SELECT and the conversions lookup, so
 * those SQL strings compile once per connection too.
 */
const getState = createConnectionState((state) => ({
  ftsProbe: state.prepare('SELECT rowid FROM measures_fts WHERE measures_fts MATCH @query LIMIT 1'),
  measuresTotal: (state.prepare('SELECT COUNT(*) AS c FROM measures').get() as { c: number }).c,
}));

/**
 * Look up VOC weights & measures by free text (or page all units alphabetically).
 */
export async function lookupMeasure(input: LookupMeasureInput): Promise<LookupMeasureOutput> {
  if (!isReferenceDatabaseAvailable()) {
    return {
      total: { value: 0, relation: 'eq' },
      results: [],
      pagination: { from: input.from, size: input.size, hasMore: false },
      databaseInfo: { measuresTotal: 0, available: false },
    };
  }

  const db = getReferenceDatabase();
  const state = getState(db);
  const { ftsProbe, measuresTotal } = state;

  // With a text query we JOIN the FTS table, rank by bm25, and COUNT the
  // matches; without one we page all units by label — so the total is just the
  // (cached) unit count, no second COUNT needed.
  const params: Record<string, string | number> = {};
  let selectSql: string;
  let total: number;
  let note: string | undefined;

  if (input.query) {
    const sanitized = sanitizeFtsQuery(ftsProbe, input.query);
    note = sanitized.note;
    params.query = sanitized.query;
    selectSql = `SELECT m.unit_id, m.label, m.type, m.variants, m.definitions
                 FROM measures m JOIN measures_fts f ON m.id = f.rowid
                 WHERE measures_fts MATCH @query
                 ORDER BY bm25(measures_fts, ${BM25_WEIGHTS})
                 LIMIT @limit OFFSET @offset`;
    total = (state.prepare(
      `SELECT COUNT(*) AS c FROM measures m JOIN measures_fts f ON m.id = f.rowid
       WHERE measures_fts MATCH @query`,
    ).get(params) as { c: number }).c;
  } else {
    selectSql = `SELECT unit_id, label, type, variants, definitions FROM measures
                 ORDER BY label COLLATE NOCASE
                 LIMIT @limit OFFSET @offset`;
    total = measuresTotal;
  }

  const rows = state.prepare(selectSql).all({ ...params, limit: input.size, offset: input.from }) as MeasureDbRow[];

  // Conversions per returned row: ≤100 rows/page against a 731-row indexed
  // table is trivial. unit_id stays internal — used only to fetch ratios.
  const convStmt = state.prepare(
    'SELECT ratio, context FROM measure_conversions WHERE from_unit = @uid OR to_unit = @uid',
  );
  const results = rows.map((row) =>
    mapRow(row, convStmt.all({ uid: row.unit_id }) as ConversionDbRow[]),
  );

  return {
    total: { value: total, relation: 'eq' },
    results,
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: total > input.from + rows.length,
    },
    databaseInfo: {
      measuresTotal,
      available: true,
    },
    ...(note ? { note } : {}),
  };
}
