/**
 * Archival Index tool for querying local SQLite database of VOC document indexes.
 * Provides access to OBP (Digitized Indexes) and Generale Missiven metadata.
 */

import { z } from 'zod';
import type { Statement } from 'better-sqlite3';
import { getDatabase, isDatabaseAvailable } from '../utils/database.js';

// Input schema for archival index queries
export const findArchivalDocumentsInputSchema = z.object({
  source: z.enum(['obp', 'gm', 'all']).default('all')
    .describe('Data source: "obp" (Digitized Indexes, ~227K docs), "gm" (Generale Missiven, ~950 letters), "all" (both)'),
  query: z.string().optional()
    .describe('Full-text search in descriptions. Supports FTS5 syntax: AND, OR, NOT, prefix*, "exact phrase"'),
  inventoryNumber: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Filter by inventory number(s). Single: "1543" or multiple: ["1543", "1068"]'),
  settlement: z.string().optional()
    .describe('Filter by settlement name (OBP only). Examples: "Ceylon", "Batavia", "Malacca"'),
  yearFrom: z.number().int().optional()
    .describe('Filter by earliest year (inclusive). Example: 1700'),
  yearTo: z.number().int().optional()
    .describe('Filter by latest year (inclusive). Example: 1750'),
  folioFrom: z.number().int().optional()
    .describe('Filter by folio range start (OBP only, requires inventoryNumber)'),
  folioTo: z.number().int().optional()
    .describe('Filter by folio range end (OBP only, requires inventoryNumber)'),
  chamber: z.string().optional()
    .describe('Filter by VOC chamber (GM only). Values: "Amsterdam", "Zeeland"'),
  htrAvailable: z.boolean().optional()
    .describe('Filter for letters with HTR transcriptions available (GM only)'),
  from: z.number().int().min(0).default(0)
    .describe('Pagination offset (default: 0)'),
  size: z.number().int().min(1).max(500).default(25)
    .describe('Results per page (1-500, default: 25)'),
  includeAggregations: z.boolean().default(true)
    .describe('Include aggregation counts for settlements, years, inventories (default: true)'),
});

// OBP document result type
const obpDocumentSchema = z.object({
  type: z.literal('obp'),
  id: z.number(),
  idCsv: z.number().nullable(),
  idTanap: z.number().nullable(),
  description: z.string(),
  inventoryNumber: z.string(),
  section: z.string().nullable(),
  folioStart: z.number().nullable(),
  folioEnd: z.number().nullable(),
  yearEarliest: z.number().nullable(),
  yearLatest: z.number().nullable(),
  settlement: z.string().nullable(),
  locationTanap: z.string().nullable(),
  geographicalCoverage: z.string().nullable(),
  documentType: z.string().nullable(),
});

// GM document result type
const gmDocumentSchema = z.object({
  type: z.literal('gm'),
  id: z.number(),
  idCsv: z.number().nullable(),
  idTanap: z.number().nullable(),
  description: z.string(),
  inventoryNumber: z.string(),
  chamber: z.string().nullable(),
  folioStart: z.number().nullable(),
  folioEnd: z.number().nullable(),
  scanStart: z.number().nullable(),
  scanEnd: z.number().nullable(),
  yearEarliest: z.number().nullable(),
  yearLatest: z.number().nullable(),
  dateDisplay: z.string().nullable(),
  dateNumeric: z.string().nullable(),
  scanUrlFirst: z.string().nullable(),
  scanUrlLast: z.string().nullable(),
  htrAvailable: z.boolean(),
  rgpVolume: z.string().nullable(),
  rgpPage: z.string().nullable(),
});

// Output schema
export const findArchivalDocumentsOutputSchema = z.object({
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(z.discriminatedUnion('type', [obpDocumentSchema, gmDocumentSchema])),
  aggregations: z.object({
    settlements: z.array(z.object({
      settlement: z.string(),
      count: z.number(),
    })).optional(),
    years: z.array(z.object({
      year: z.number(),
      count: z.number(),
    })).optional(),
    inventories: z.array(z.object({
      inventoryNumber: z.string(),
      count: z.number(),
    })).optional(),
    chambers: z.array(z.object({
      chamber: z.string(),
      count: z.number(),
    })).optional(),
  }).optional(),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean(),
  }),
  databaseInfo: z.object({
    obpTotal: z.number(),
    gmTotal: z.number(),
    available: z.boolean(),
  }),
  note: z.string().optional().describe('Caveats about how this result was computed (e.g. a source skipped because a filter does not apply to it)'),
});

export type FindArchivalDocumentsInput = z.infer<typeof findArchivalDocumentsInputSchema>;
export type FindArchivalDocumentsOutput = z.infer<typeof findArchivalDocumentsOutputSchema>;

interface ObpDbRow {
  id: number;
  id_csv: number | null;
  id_tanap: number | null;
  description: string;
  inventory_number: string;
  section: string | null;
  folio_start: number | null;
  folio_end: number | null;
  year_earliest: number | null;
  year_latest: number | null;
  settlement: string | null;
  location_tanap: string | null;
  geographical_coverage: string | null;
  document_type: string | null;
}

interface GmDbRow {
  id: number;
  id_csv: number | null;
  id_tanap: number | null;
  description: string;
  inventory_number: string;
  chamber: string | null;
  folio_start: number | null;
  folio_end: number | null;
  scan_start: number | null;
  scan_end: number | null;
  year_earliest: number | null;
  year_latest: number | null;
  date_display: string | null;
  date_numeric: string | null;
  scan_url_first: string | null;
  scan_url_last: string | null;
  htr_available: number;
  rgp_volume: string | null;
  rgp_page: string | null;
}

interface WhereClause {
  where: string;
  params: Record<string, unknown>;
}

/**
 * Build common WHERE conditions shared between OBP and GM queries:
 * FTS query, inventory number filter, and year range filter.
 */
function buildCommonConditions(
  input: FindArchivalDocumentsInput,
  ftsTable: string,
): { conditions: string[]; params: Record<string, unknown> } {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (input.query) {
    conditions.push(`id IN (SELECT rowid FROM ${ftsTable} WHERE ${ftsTable} MATCH @query)`);
    params.query = input.query;
  }

  if (input.inventoryNumber) {
    const invNumbers = Array.isArray(input.inventoryNumber) ? input.inventoryNumber : [input.inventoryNumber];
    const placeholders = invNumbers.map((_, i) => `@inv${i}`).join(', ');
    conditions.push(`inventory_number IN (${placeholders})`);
    for (let i = 0; i < invNumbers.length; i++) {
      params[`inv${i}`] = invNumbers[i];
    }
  }

  if (input.yearFrom !== undefined) {
    conditions.push('(year_latest >= @yearFrom OR year_latest IS NULL)');
    params.yearFrom = input.yearFrom;
  }
  if (input.yearTo !== undefined) {
    conditions.push('(year_earliest <= @yearTo OR year_earliest IS NULL)');
    params.yearTo = input.yearTo;
  }

  return { conditions, params };
}

/**
 * Format conditions into a WHERE clause string.
 */
function toWhereClause(conditions: string[], params: Record<string, unknown>): WhereClause {
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

/**
 * Build WHERE clause for OBP queries.
 */
function buildObpWhereClause(input: FindArchivalDocumentsInput): WhereClause {
  const { conditions, params } = buildCommonConditions(input, 'obp_fts');

  if (input.settlement) {
    conditions.push('settlement = @settlement');
    params.settlement = input.settlement;
  }

  if (input.inventoryNumber) {
    if (input.folioFrom !== undefined) {
      conditions.push('(folio_end >= @folioFrom OR folio_end IS NULL)');
      params.folioFrom = input.folioFrom;
    }
    if (input.folioTo !== undefined) {
      conditions.push('(folio_start <= @folioTo OR folio_start IS NULL)');
      params.folioTo = input.folioTo;
    }
  }

  return toWhereClause(conditions, params);
}

/**
 * Build WHERE clause for GM queries.
 */
function buildGmWhereClause(input: FindArchivalDocumentsInput): WhereClause {
  const { conditions, params } = buildCommonConditions(input, 'gm_fts');

  if (input.chamber) {
    conditions.push('chamber = @chamber');
    params.chamber = input.chamber;
  }

  if (input.htrAvailable !== undefined) {
    conditions.push('htr_available = @htrAvailable');
    params.htrAvailable = input.htrAvailable ? 1 : 0;
  }

  return toWhereClause(conditions, params);
}

/**
 * Map an OBP database row to the output format.
 */
function mapObpRow(row: ObpDbRow) {
  return {
    type: 'obp' as const,
    id: row.id,
    idCsv: row.id_csv,
    idTanap: row.id_tanap,
    description: row.description,
    inventoryNumber: row.inventory_number,
    section: row.section,
    folioStart: row.folio_start,
    folioEnd: row.folio_end,
    yearEarliest: row.year_earliest,
    yearLatest: row.year_latest,
    settlement: row.settlement,
    locationTanap: row.location_tanap,
    geographicalCoverage: row.geographical_coverage,
    documentType: row.document_type,
  };
}

/**
 * Map a GM database row to the output format.
 */
function mapGmRow(row: GmDbRow) {
  return {
    type: 'gm' as const,
    id: row.id,
    idCsv: row.id_csv,
    idTanap: row.id_tanap,
    description: row.description,
    inventoryNumber: row.inventory_number,
    chamber: row.chamber,
    folioStart: row.folio_start,
    folioEnd: row.folio_end,
    scanStart: row.scan_start,
    scanEnd: row.scan_end,
    yearEarliest: row.year_earliest,
    yearLatest: row.year_latest,
    dateDisplay: row.date_display,
    dateNumeric: row.date_numeric,
    scanUrlFirst: row.scan_url_first,
    scanUrlLast: row.scan_url_last,
    htrAvailable: row.htr_available === 1,
    rgpVolume: row.rgp_volume,
    rgpPage: row.rgp_page,
  };
}

/**
 * Append a NOT NULL condition to an existing WHERE clause.
 */
function appendNotNull(where: string, column: string): string {
  return where
    ? `${where} AND ${column} IS NOT NULL`
    : `WHERE ${column} IS NOT NULL`;
}

type Db = ReturnType<typeof getDatabase>;

type Aggregations = NonNullable<FindArchivalDocumentsOutput['aggregations']>;

/**
 * Per-connection state whose SQL or results are constant: the FTS probe
 * statement, the table totals, and (lazily) the unfiltered aggregations.
 * The database is read-only and rebuilt only at deploy, so these cannot
 * change for the life of a connection (R14) — without this, every call ran
 * two full-table COUNT(*)s, and unfiltered calls re-ran GROUP BYs over 227K
 * rows (better-sqlite3 is synchronous, so each blocks the event loop).
 * Keyed by the db handle so a reopened database (closeDatabase +
 * getDatabase) gets fresh state.
 */
let staticDbState: {
  db: Db;
  ftsProbe: Statement;
  obpTotal: number;
  gmTotal: number;
  obpUnfilteredAggregations?: Pick<Aggregations, 'settlements' | 'inventories'>;
  gmUnfilteredAggregations?: Pick<Aggregations, 'chambers'>;
} | null = null;

function getStaticDbState(db: Db) {
  if (staticDbState?.db !== db) {
    staticDbState = {
      db,
      // Syntax errors are query-side, so probing one FTS table covers both
      ftsProbe: db.prepare('SELECT rowid FROM obp_fts WHERE obp_fts MATCH @query LIMIT 1'),
      obpTotal: (db.prepare('SELECT COUNT(*) as count FROM obp_documents').get() as { count: number }).count,
      gmTotal: (db.prepare('SELECT COUNT(*) as count FROM generale_missiven').get() as { count: number }).count,
    };
  }
  return staticDbState;
}

/** OBP aggregations (top settlements and inventories) for the given WHERE clause. */
function computeObpAggregations(db: Db, { where, params }: WhereClause): Pick<Aggregations, 'settlements' | 'inventories'> {
  const aggs: Pick<Aggregations, 'settlements' | 'inventories'> = {};

  const settlementRows = db.prepare(
    `SELECT settlement, COUNT(*) as count FROM obp_documents ${appendNotNull(where, 'settlement')} GROUP BY settlement ORDER BY count DESC LIMIT 20`
  ).all(params) as { settlement: string; count: number }[];
  if (settlementRows.length > 0) {
    aggs.settlements = settlementRows;
  }

  const invRows = db.prepare(
    `SELECT inventory_number, COUNT(*) as count FROM obp_documents ${where} GROUP BY inventory_number ORDER BY count DESC LIMIT 20`
  ).all(params) as { inventory_number: string; count: number }[];
  if (invRows.length > 0) {
    aggs.inventories = invRows.map(r => ({ inventoryNumber: r.inventory_number, count: r.count }));
  }

  return aggs;
}

/** GM aggregations (chamber counts) for the given WHERE clause. */
function computeGmAggregations(db: Db, { where, params }: WhereClause): Pick<Aggregations, 'chambers'> {
  const aggs: Pick<Aggregations, 'chambers'> = {};

  const chamberRows = db.prepare(
    `SELECT chamber, COUNT(*) as count FROM generale_missiven ${appendNotNull(where, 'chamber')} GROUP BY chamber ORDER BY count DESC`
  ).all(params) as { chamber: string; count: number }[];
  if (chamberRows.length > 0) {
    aggs.chambers = chamberRows;
  }

  return aggs;
}

/**
 * Validate an FTS5 query against the database, since raw user input like
 * "oost-indie" or an unbalanced quote makes SQLite throw a syntax error (R7).
 * On a syntax error, retry with the whole query phrase-escaped in double
 * quotes; if even that fails, throw a structured error with a suggestion.
 *
 * Returns the query to use plus a note when it was rewritten.
 */
function sanitizeFtsQuery(
  db: Db,
  query: string,
): { query: string; note?: string } {
  const probe = getStaticDbState(db).ftsProbe;

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
      throw {
        error: `Invalid full-text query: ${query}`,
        suggestion: 'FTS5 syntax error. Wrap multi-word or hyphenated terms in double quotes (e.g. "oost-indie"), and balance any quotes or parentheses.',
      };
    }
  }
}

/**
 * Query the archival index database.
 */
export async function findArchivalDocuments(input: FindArchivalDocumentsInput): Promise<FindArchivalDocumentsOutput> {
  // Check database availability
  if (!isDatabaseAvailable()) {
    return {
      total: { value: 0, relation: 'eq' },
      results: [],
      pagination: { from: input.from, size: input.size, hasMore: false },
      databaseInfo: { obpTotal: 0, gmTotal: 0, available: false },
    };
  }

  // Source-specific filters: combining filters that exclude every source
  // would silently return total: 0 and mislead the model into concluding
  // no documents exist (R7) — reject the combination instead.
  const hasObpOnlyFilters = input.settlement !== undefined;
  const hasGmOnlyFilters = input.chamber !== undefined || input.htrAvailable !== undefined;

  if (hasObpOnlyFilters && hasGmOnlyFilters) {
    throw {
      error: 'Incompatible filters: settlement applies only to OBP, while chamber/htrAvailable apply only to GM (Generale Missiven)',
      suggestion: 'Run two queries: source "obp" with settlement, and source "gm" with chamber/htrAvailable.',
    };
  }
  if (input.source === 'obp' && hasGmOnlyFilters) {
    throw {
      error: 'chamber and htrAvailable filters apply only to GM (Generale Missiven), not to source "obp"',
      suggestion: 'Use source "gm" or "all" with these filters.',
    };
  }
  if (input.source === 'gm' && hasObpOnlyFilters) {
    throw {
      error: 'The settlement filter applies only to OBP (Digitized Indexes), not to source "gm"',
      suggestion: 'Use source "obp" or "all" with the settlement filter.',
    };
  }

  const db = getDatabase();
  const notes: string[] = [];

  // Reject or phrase-escape FTS5 queries that SQLite cannot parse
  let effectiveInput = input;
  if (input.query) {
    const sanitized = sanitizeFtsQuery(db, input.query);
    if (sanitized.query !== input.query) {
      effectiveInput = { ...input, query: sanitized.query };
      if (sanitized.note) notes.push(sanitized.note);
    }
  }

  const results: FindArchivalDocumentsOutput['results'] = [];
  let totalCount = 0;

  // Cached per-connection totals (R14)
  const dbState = getStaticDbState(db);

  // Query OBP if source includes it (skipped when a GM-only filter is set)
  if (input.source === 'obp' || input.source === 'all') {
    if (input.source === 'all' && hasGmOnlyFilters) {
      notes.push('chamber/htrAvailable filters apply only to GM, so the OBP source was skipped');
    } else {
      const { where, params } = buildObpWhereClause(effectiveInput);

      // Count total (an unfiltered count is the cached table total)
      const obpCount = where === ''
        ? dbState.obpTotal
        : (db.prepare(`SELECT COUNT(*) as count FROM obp_documents ${where}`).get(params) as { count: number }).count;
      totalCount += obpCount;

      // OBP results come first in combined pagination, so the offset is input.from
      const offset = input.from;
      const limit = input.size;

      if (offset < obpCount) {
        const selectSql = `SELECT * FROM obp_documents ${where} ORDER BY year_earliest, inventory_number, folio_start LIMIT @limit OFFSET @offset`;
        const rows = db.prepare(selectSql).all({ ...params, limit, offset }) as ObpDbRow[];

        results.push(...rows.map(mapObpRow));
      }
    }
  }

  // Query GM if source includes it (skipped when an OBP-only filter is set)
  if (input.source === 'gm' || input.source === 'all') {
    if (input.source === 'all' && hasObpOnlyFilters) {
      notes.push('the settlement filter applies only to OBP, so the GM (Generale Missiven) source was skipped');
    } else {
      const { where, params } = buildGmWhereClause(effectiveInput);

      // Count total (an unfiltered count is the cached table total)
      const gmCount = where === ''
        ? dbState.gmTotal
        : (db.prepare(`SELECT COUNT(*) as count FROM generale_missiven ${where}`).get(params) as { count: number }).count;

      // Calculate offset for GM results
      let gmOffset = 0;
      if (input.source === 'all') {
        // If querying all, GM results come after OBP
        const obpCountForPaging = totalCount; // OBP count before adding GM
        gmOffset = Math.max(0, input.from - obpCountForPaging);
      } else {
        gmOffset = input.from;
      }

      totalCount += gmCount;

      // Get results with pagination
      const limit = input.size - results.length;
      if (gmOffset < gmCount && limit > 0) {
        const selectSql = `SELECT * FROM generale_missiven ${where} ORDER BY date_numeric, inventory_number LIMIT @limit OFFSET @offset`;
        const rows = db.prepare(selectSql).all({ ...params, limit, offset: gmOffset }) as GmDbRow[];

        results.push(...rows.map(mapGmRow));
      }
    }
  }

  let aggregations: FindArchivalDocumentsOutput['aggregations'];
  if (input.includeAggregations) {
    aggregations = {};
    // Mirror the query skip logic above: no aggregations for a skipped source
    const includesObp = (input.source === 'obp' || input.source === 'all') &&
      !(input.source === 'all' && hasGmOnlyFilters);
    const includesGm = (input.source === 'gm' || input.source === 'all') &&
      !(input.source === 'all' && hasObpOnlyFilters);

    // Unfiltered GROUP BYs scan all ~227K rows — cache them (R14)
    if (includesObp) {
      const clause = buildObpWhereClause(effectiveInput);
      const obpAggs = clause.where === ''
        ? (dbState.obpUnfilteredAggregations ??= computeObpAggregations(db, clause))
        : computeObpAggregations(db, clause);
      Object.assign(aggregations, obpAggs);
    }

    if (includesGm) {
      const clause = buildGmWhereClause(effectiveInput);
      const gmAggs = clause.where === ''
        ? (dbState.gmUnfilteredAggregations ??= computeGmAggregations(db, clause))
        : computeGmAggregations(db, clause);
      Object.assign(aggregations, gmAggs);
    }
  }

  return {
    total: { value: totalCount, relation: 'eq' },
    results,
    aggregations,
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: totalCount > input.from + results.length,
    },
    databaseInfo: {
      obpTotal: dbState.obpTotal,
      gmTotal: dbState.gmTotal,
      available: true,
    },
    ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
  };
}
