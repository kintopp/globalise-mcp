/**
 * Archival Index tool for querying local SQLite database of VOC document indexes.
 * Provides access to OBP (Digitized Indexes) and Generale Missiven metadata.
 */

import { z } from 'zod';
import { getDatabase, isDatabaseAvailable, type Db, type DbStatement } from '../utils/database.js';
import { ToolError } from '../utils/errors.js';

// Input schema for archival index queries
export const findArchivalDocumentsInputSchema = z.object({
  source: z.enum(['obp', 'gm', 'all']).default('all')
    .describe('Data source: "obp" (Digitized Indexes, ~227K docs), "gm" (Generale Missiven, ~950 letters), "all" (both)'),
  query: z.string().optional()
    .describe('Full-text search in descriptions (SQLite FTS5). A space means AND — all terms must appear; also OR, NOT, prefix*, "exact phrase". Special characters (hyphens, slashes, unbalanced quotes/parens) make FTS5 throw, so the server retries the whole query as one quoted phrase and adds a `note` to the response, silently dropping your operators — quote just the offending term yourself (e.g. kaneel AND "oost-indie") and check the response `note` if results look wrong. Descriptions are one-line catalogue headings, not a subject index, so prefer the structured filters (settlement/year/inventory) for discovery.'),
  inventoryNumber: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Filter by inventory number(s). Single: "1543" or multiple: ["1543", "1068"]'),
  settlement: z.string().optional()
    .describe('Filter by settlement name (OBP only) — the VOC office the papers came *from* (origin), not the subject. Spellings are normalized to one canonical form per place, but it is unpredictable (e.g. "Malakka" NOT "Malacca"; "Ceylon" NOT the period "Ceijlon"), so run once with includeAggregations and copy the exact value from the breakdown. Examples: "Ceylon", "Batavia", "Malakka".'),
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
    .describe('Filter on the IJsberg sub-project flag (GM only). NOT a reliable "has transcriptions" flag: it effectively marks chamber=Zeeland (all 70 Zeeland letters true, all 880 Amsterdam false), yet many Amsterdam inventories ARE transcribed in GLOBALISE. To find letters you can actually read, take the inventoryNumber and probe globalise_search_transcriptions(query="*", size=1) instead of filtering on this.'),
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

// Links to the published RGP (Rijks Geschiedkundige Publicatiën) edition of a
// Generale Missive. Null on the GM object when the missive was not published in
// RGP (~41% are not). Built by buildPublishedEdition() from rgp_volume/rgp_page.
const publishedEditionSchema = z.object({
  retroboekenUrl: z.string().nullable()
    .describe('Retroboeken interactive viewer (page-scan pane) at the missive’s start page; null if rgp_page is missing. Page-precise via the per-volume front-matter offset.'),
  githubPageUrl: z.string().nullable()
    .describe('Raw GitHub per-page plain-text transcription where the missive begins (keyed directly by rgp_page, no offset); null if rgp_page is missing. Long letters spill onto following pages.'),
  githubVolumeUrl: z.string()
    .describe('Raw GitHub full-volume plain-text transcription (entire RGP volume). Plain text only — link-only, never fetched/cached (CC BY-NC-SA 4.0).'),
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
  publishedEdition: publishedEditionSchema.nullable()
    .describe('Links to the published RGP edition (Retroboeken scans + GitHub plain text); null if this missive was not published in RGP (~41% are not).'),
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

type ObpDbRow = {
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

type GmDbRow = {
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

type WhereClause = {
  where: string;
  params: Record<string, string | number>;
};

/**
 * Build common WHERE conditions shared between OBP and GM queries:
 * FTS query, inventory number filter, and year range filter.
 */
function buildCommonConditions(
  input: FindArchivalDocumentsInput,
  ftsTable: string,
): { conditions: string[]; params: Record<string, string | number> } {
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

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
function toWhereClause(conditions: string[], params: Record<string, string | number>): WhereClause {
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

const RETROBOEKEN_BASE = 'https://resources.huygens.knaw.nl/retroboeken/generalemissiven/';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/globalise-huygens/globalise-generale-missiven-rgp/main';

/**
 * Per-volume front-matter offset for Retroboeken: website_page = rgp_page + offset.
 * All 14 verified live 2026-01-01 (offline RETROBOEKEN_MAPPING.md). GitHub per-page
 * files need no offset — they are keyed directly by rgp_page.
 */
const RETROBOEKEN_OFFSETS: Record<string, number> = {
  '1': 23, '2': 13, '3': 13, '4': 15, '5': 15, '6': 15, '7': 11,
  '8': 11, '9': 13, '10': 11, '11': 11, '12': 11, '13': 11, '14': 13,
};

/**
 * Build published-edition links for a Generale Missive from its raw RGP fields.
 *
 * Returns null when the missive has no RGP volume (~392 of 950 are unpublished).
 * The full-volume GitHub link needs only the volume, so it is always present
 * when the object exists — including the one row (inv 3066) that has a volume
 * but a null page. The page-precise Retroboeken and per-page GitHub links require
 * a parseable first page: rgp_page may hold a multi-page list ("172;173",
 * "28; 29; 33", "350-1"), and parseInt reads the leading integer in every case.
 */
function buildPublishedEdition(
  rgpVolume: string | null,
  rgpPage: string | null,
): z.infer<typeof publishedEditionSchema> | null {
  if (!rgpVolume) return null;

  const githubVolumeUrl = `${GITHUB_RAW_BASE}/full_volumes/GM_${rgpVolume}.txt`;

  const firstPage = rgpPage != null ? parseInt(rgpPage, 10) : NaN;
  const hasPage = !Number.isNaN(firstPage);
  const offset = RETROBOEKEN_OFFSETS[rgpVolume];

  const githubPageUrl = hasPage
    ? `${GITHUB_RAW_BASE}/txt/GM${rgpVolume}/${rgpVolume}_${firstPage}.txt`
    : null;
  const retroboekenUrl = hasPage && offset !== undefined
    ? `${RETROBOEKEN_BASE}#source=${rgpVolume}&page=${firstPage + offset}&view=imagePane`
    : null;

  return { retroboekenUrl, githubPageUrl, githubVolumeUrl };
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
    publishedEdition: buildPublishedEdition(row.rgp_volume, row.rgp_page),
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

type Aggregations = NonNullable<FindArchivalDocumentsOutput['aggregations']>;

/**
 * Per-connection state whose SQL or results are constant: the FTS probe
 * statement, the table totals, and (lazily) the unfiltered aggregations.
 * The database is read-only and rebuilt only at deploy, so these cannot
 * change for the life of a connection (R14) — without this, every call ran
 * two full-table COUNT(*)s, and unfiltered calls re-ran GROUP BYs over 227K
 * rows (node:sqlite is synchronous, so each blocks the event loop).
 * Keyed by the db handle so a reopened database (closeDatabase +
 * getDatabase) gets fresh state.
 */
let staticDbState: {
  db: Db;
  ftsProbe: DbStatement;
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
      throw new ToolError(
        `Invalid full-text query: ${query}`,
        'FTS5 syntax error. Wrap multi-word or hyphenated terms in double quotes (e.g. "oost-indie"), and balance any quotes or parentheses.',
      );
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
    throw new ToolError(
      'Incompatible filters: settlement applies only to OBP, while chamber/htrAvailable apply only to GM (Generale Missiven)',
      'Run two queries: source "obp" with settlement, and source "gm" with chamber/htrAvailable.',
    );
  }
  if (input.source === 'obp' && hasGmOnlyFilters) {
    throw new ToolError(
      'chamber and htrAvailable filters apply only to GM (Generale Missiven), not to source "obp"',
      'Use source "gm" or "all" with these filters.',
    );
  }
  if (input.source === 'gm' && hasObpOnlyFilters) {
    throw new ToolError(
      'The settlement filter applies only to OBP (Digitized Indexes), not to source "gm"',
      'Use source "obp" or "all" with the settlement filter.',
    );
  }

  const db = getDatabase();
  const notes: string[] = [];

  // Reject or phrase-escape FTS5 queries that SQLite cannot parse
  let effectiveInput = input;
  if (input.query) {
    const sanitized = sanitizeFtsQuery(db, input.query);
    if (sanitized.note) {
      effectiveInput = { ...input, query: sanitized.query };
      notes.push(sanitized.note);
    }
  }

  // Which sources does this query cover? On source "all", a one-sided filter
  // skips the other source with a note (R7). Decided once here — the result
  // queries and the aggregations below share these clauses, so the two
  // phases cannot drift apart.
  const skipObp = input.source === 'all' && hasGmOnlyFilters;
  const skipGm = input.source === 'all' && hasObpOnlyFilters;
  if (skipObp) notes.push('chamber/htrAvailable filters apply only to GM, so the OBP source was skipped');
  if (skipGm) notes.push('the settlement filter applies only to OBP, so the GM (Generale Missiven) source was skipped');

  const obpClause = (input.source === 'obp' || input.source === 'all') && !skipObp
    ? buildObpWhereClause(effectiveInput)
    : undefined;
  const gmClause = (input.source === 'gm' || input.source === 'all') && !skipGm
    ? buildGmWhereClause(effectiveInput)
    : undefined;

  const results: FindArchivalDocumentsOutput['results'] = [];
  let totalCount = 0;

  // Cached per-connection totals (R14)
  const dbState = getStaticDbState(db);

  if (obpClause) {
    const { where, params } = obpClause;

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

  if (gmClause) {
    const { where, params } = gmClause;

    // Count total (an unfiltered count is the cached table total)
    const gmCount = where === ''
      ? dbState.gmTotal
      : (db.prepare(`SELECT COUNT(*) as count FROM generale_missiven ${where}`).get(params) as { count: number }).count;

    // In combined pagination GM results come after OBP, so the offset shifts
    // down by the OBP count accumulated above
    const gmOffset = input.source === 'all'
      ? Math.max(0, input.from - totalCount)
      : input.from;

    totalCount += gmCount;

    // Get results with pagination
    const limit = input.size - results.length;
    if (gmOffset < gmCount && limit > 0) {
      const selectSql = `SELECT * FROM generale_missiven ${where} ORDER BY date_numeric, inventory_number LIMIT @limit OFFSET @offset`;
      const rows = db.prepare(selectSql).all({ ...params, limit, offset: gmOffset }) as GmDbRow[];

      results.push(...rows.map(mapGmRow));
    }
  }

  let aggregations: FindArchivalDocumentsOutput['aggregations'];
  if (input.includeAggregations) {
    aggregations = {};

    // Unfiltered GROUP BYs scan all ~227K rows — cache them (R14)
    if (obpClause) {
      const obpAggs = obpClause.where === ''
        ? (dbState.obpUnfilteredAggregations ??= computeObpAggregations(db, obpClause))
        : computeObpAggregations(db, obpClause);
      Object.assign(aggregations, obpAggs);
    }

    if (gmClause) {
      const gmAggs = gmClause.where === ''
        ? (dbState.gmUnfilteredAggregations ??= computeGmAggregations(db, gmClause))
        : computeGmAggregations(db, gmClause);
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
