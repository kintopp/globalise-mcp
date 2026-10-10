/**
 * Parser for data/sources/commodities.tsv, shared by build-commodities-db.ts
 * and test-commodities-quoting.ts so the test exercises the parser itself, not
 * only the committed reference.sqlite.gz it produced.
 */

import { parse } from 'csv-parse';
import { createReadStream } from 'fs';

export type CommodityRow = {
  uuid: string;
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

function strOrNull(val: string | undefined): string | null {
  if (val === undefined) return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

export async function parseCommoditiesTsv(path: string): Promise<CommodityRow[]> {
  console.log('Parsing commodities TSV...');
  const rows: CommodityRow[] = [];

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      delimiter: '\t',
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      // The TSV is RFC-4180: fields containing a comma are wrapped in "…" and
      // internal quotes are doubled (""). Decode that structure rather than
      // importing the quotes as literal text. (escape defaults to '"', so ""→".)
      quote: '"',
    });

    createReadStream(path)
      .pipe(parser)
      .on('data', (record: Record<string, string>) => {
        const uuid = (record['id'] || '').trim();
        if (!uuid) return; // skip any blank-id row
        rows.push({
          uuid,
          pref_nl: strOrNull(record['prefLabel_nl']),
          pref_en: strOrNull(record['prefLabel_en']),
          alt_labels: strOrNull(record['altLabels']),
          definition: record['definition'] || '',
          definition_language: strOrNull(record['definitionLanguage']),
          definition_source: strOrNull(record['definitionSource']),
          definition_source_desc: strOrNull(record['definitionSource_desc']),
          confidence: strOrNull(record['confidence']),
          definition_source_url: strOrNull(record['definitionSource_url']),
        });
      })
      .on('end', () => {
        console.log(`  Parsed ${rows.length} commodity rows`);
        resolve(rows);
      })
      .on('error', reject);
  });
}
