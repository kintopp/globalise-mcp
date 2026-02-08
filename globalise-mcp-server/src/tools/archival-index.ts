/**
 * Archival Index tool for querying local SQLite database of VOC document indexes.
 * Provides access to OBP (Digitized Indexes) and Generale Missiven metadata.
 */

import { z } from 'zod';
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

  const db = getDatabase();
  const results: FindArchivalDocumentsOutput['results'] = [];
  let totalCount = 0;

  // Get database totals
  const obpTotal = (db.prepare('SELECT COUNT(*) as count FROM obp_documents').get() as { count: number }).count;
  const gmTotal = (db.prepare('SELECT COUNT(*) as count FROM generale_missiven').get() as { count: number }).count;

  // Query OBP if source includes it
  if (input.source === 'obp' || input.source === 'all') {
    // Skip OBP if settlement filter is invalid for GM-only query
    if (!(input.source === 'all' && (input.chamber || input.htrAvailable !== undefined))) {
      const { where, params } = buildObpWhereClause(input);

      // Count total
      const countSql = `SELECT COUNT(*) as count FROM obp_documents ${where}`;
      const countResult = db.prepare(countSql).get(params) as { count: number };
      totalCount += countResult.count;

      // Get results with pagination (only if we have room in results)
      if (input.source === 'obp' || results.length < input.size) {
        // For OBP, offset is simply input.from (OBP results come first in combined pagination)
        const offset = input.from;
        const limit = input.size - results.length;

        if (offset < countResult.count && limit > 0) {
          const selectSql = `SELECT * FROM obp_documents ${where} ORDER BY year_earliest, inventory_number, folio_start LIMIT @limit OFFSET @offset`;
          const rows = db.prepare(selectSql).all({ ...params, limit, offset }) as ObpDbRow[];

          results.push(...rows.map(mapObpRow));
        }
      }
    }
  }

  // Query GM if source includes it
  if (input.source === 'gm' || input.source === 'all') {
    // Skip GM if OBP-only filters are set
    if (!(input.source === 'all' && input.settlement)) {
      const { where, params } = buildGmWhereClause(input);

      // Count total
      const countSql = `SELECT COUNT(*) as count FROM generale_missiven ${where}`;
      const countResult = db.prepare(countSql).get(params) as { count: number };
      const gmCount = countResult.count;

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
    const includesObp = input.source === 'obp' || input.source === 'all';
    const includesGm = input.source === 'gm' || input.source === 'all';

    if (includesObp) {
      const { where, params } = buildObpWhereClause(input);

      const settlementRows = db.prepare(
        `SELECT settlement, COUNT(*) as count FROM obp_documents ${appendNotNull(where, 'settlement')} GROUP BY settlement ORDER BY count DESC LIMIT 20`
      ).all(params) as { settlement: string; count: number }[];
      if (settlementRows.length > 0) {
        aggregations.settlements = settlementRows;
      }

      const invRows = db.prepare(
        `SELECT inventory_number, COUNT(*) as count FROM obp_documents ${where} GROUP BY inventory_number ORDER BY count DESC LIMIT 20`
      ).all(params) as { inventory_number: string; count: number }[];
      if (invRows.length > 0) {
        aggregations.inventories = invRows.map(r => ({ inventoryNumber: r.inventory_number, count: r.count }));
      }
    }

    if (includesGm) {
      const { where, params } = buildGmWhereClause(input);

      const chamberRows = db.prepare(
        `SELECT chamber, COUNT(*) as count FROM generale_missiven ${appendNotNull(where, 'chamber')} GROUP BY chamber ORDER BY count DESC`
      ).all(params) as { chamber: string; count: number }[];
      if (chamberRows.length > 0) {
        aggregations.chambers = chamberRows;
      }
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
      obpTotal,
      gmTotal,
      available: true,
    },
  };
}
