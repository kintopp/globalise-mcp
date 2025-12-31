#!/usr/bin/env node
/**
 * Regenerates weights-measures.json from the source TSV files.
 *
 * This script:
 * 1. Reads Glossary TSV for units, types, and definitions (Dutch + English, no sources)
 * 2. Reads Labels TSV for spelling variants (lookup table)
 * 3. Reads Conversions TSV for unit conversion relationships
 * 4. Applies policy for ambiguous terms: prefer pref labels over alt labels
 * 5. Outputs JSON optimized for LLM use (search + conversion assistance)
 *
 * Structure:
 * {
 *   "_meta": { ... },
 *   "units": {
 *     "SU_0007": {
 *       "label": "Bahar",
 *       "type": "weight",
 *       "definitions": [{ "nl": "...", "en": "..." }]
 *     }
 *   },
 *   "lookup": { "bahar": "SU_0007", ... },
 *   "conversions": [
 *     { "from": "SU_0095", "to": "SU_0011", "ratio": "1 gantang = 13.33 lb", "context": "rice, Batavia" }
 *   ]
 * }
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const OUTPUT_PATH = join(__dirname, '../src/resources/weights-measures.json');
const TSV_DIR = join(__dirname, '../../offline/resources/GLOBALISE - Weights and Measures in the 18th-Century Indian Ocean World');
const GLOSSARY_TSV = join(TSV_DIR, 'Glossary of weights and measures.tsv');
const LABELS_TSV = join(TSV_DIR, 'Labels for weights and measures.tsv');
const CONVERSIONS_TSV = join(TSV_DIR, 'Conversions for weight and measures.tsv');

// Parse TSV file
function parseTSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const startIndex = lines[0].toLowerCase().startsWith('table') ? 1 : 0;
  const headers = lines[startIndex].split('\t').map(h => h.trim());
  const rows = [];

  for (let i = startIndex + 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

// Clean up definition text (remove surrounding quotes, normalize whitespace)
function cleanDefinition(text) {
  if (!text) return '';
  let cleaned = text.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// Map TSV type to normalized type
function normalizeType(tsvType) {
  const typeMap = {
    'weight': 'weight',
    'liquid measure': 'volume',
    'dry measure': 'volume',
    'volume': 'volume',
    'length': 'length',
    'area': 'area',
    'quantities': 'quantities',
    'measure': 'misc',
    'maat': 'misc'
  };
  const normalized = (tsvType || '').toLowerCase().trim();
  return typeMap[normalized] || normalized || 'misc';
}

function normalizeLabel(label) {
  return label.toLowerCase().trim();
}

function regenerate() {
  console.log('Regenerating weights-measures.json from source TSVs...\n');

  // Load source files
  const glossary = parseTSV(readFileSync(GLOSSARY_TSV, 'utf-8'));
  const labels = parseTSV(readFileSync(LABELS_TSV, 'utf-8'));
  const conversionsData = parseTSV(readFileSync(CONVERSIONS_TSV, 'utf-8'));

  console.log(`Loaded Glossary: ${glossary.rows.length} units`);
  console.log(`Loaded Labels: ${labels.rows.length} label variants`);
  console.log(`Loaded Conversions: ${conversionsData.rows.length} conversion records`);

  // Build units from Glossary (keep SU_xxxx IDs)
  const units = {};
  let defCount = 0;

  for (const row of glossary.rows) {
    const unitId = row.Unit_ID;
    if (!unitId) continue;

    const definitions = [];

    // Definition set 1 (no source)
    const nl1 = cleanDefinition(row.definition_nl_1);
    const en1 = cleanDefinition(row.definition_en_1);

    if (nl1 || en1) {
      definitions.push({
        ...(nl1 && { nl: nl1 }),
        ...(en1 && { en: en1 })
      });
      defCount++;
    }

    // Definition set 2 (no source)
    const nl2 = cleanDefinition(row.definition_nl_2);
    const en2 = cleanDefinition(row.definition_en_2);

    if (nl2 || en2) {
      definitions.push({
        ...(nl2 && { nl: nl2 }),
        ...(en2 && { en: en2 })
      });
      defCount++;
    }

    units[unitId] = {
      label: row.pref_label || '',
      type: normalizeType(row.type),
      ...(definitions.length > 0 && { definitions })
    };
  }

  console.log(`Built ${Object.keys(units).length} units with ${defCount} definition entries`);

  // Build lookup from Labels TSV with ambiguity policy
  const labelMappings = new Map();

  labels.rows.forEach((row, index) => {
    const label = row.label;
    const unitId = row.unit_ID;
    const isPref = (row.skosxl_label || '').toLowerCase() === 'pref';

    if (!label || !unitId) return;

    const normalizedLabel = normalizeLabel(label);

    if (!labelMappings.has(normalizedLabel)) {
      labelMappings.set(normalizedLabel, []);
    }

    labelMappings.get(normalizedLabel).push({
      unitId,
      isPref,
      order: index
    });
  });

  // Apply policy: prefer pref labels, otherwise first occurrence
  const lookup = {};
  const ambiguous = [];

  for (const [label, mappings] of labelMappings) {
    if (mappings.length === 1) {
      lookup[label] = mappings[0].unitId;
    } else {
      const prefMappings = mappings.filter(m => m.isPref);
      if (prefMappings.length >= 1) {
        lookup[label] = prefMappings[0].unitId;
        ambiguous.push({
          label,
          chosen: prefMappings[0].unitId,
          reason: 'preferred label',
          alternatives: mappings.filter(m => m.unitId !== prefMappings[0].unitId).map(m => m.unitId)
        });
      } else {
        const first = mappings.reduce((a, b) => a.order < b.order ? a : b);
        lookup[label] = first.unitId;
        ambiguous.push({
          label,
          chosen: first.unitId,
          reason: 'first occurrence',
          alternatives: mappings.filter(m => m.unitId !== first.unitId).map(m => m.unitId)
        });
      }
    }
  }

  // Sort lookup alphabetically
  const sortedLookup = {};
  Object.keys(lookup).sort().forEach(key => {
    sortedLookup[key] = lookup[key];
  });

  console.log(`Built lookup with ${Object.keys(sortedLookup).length} entries`);
  console.log(`Resolved ${ambiguous.length} ambiguous terms`);

  // Build conversions array
  const conversions = [];

  for (const row of conversionsData.rows) {
    const fromId = row.from_Unit_ID;
    const toId = row.to_unit_ID;  // lowercase 'u' in source TSV
    const fromAmount = row.from_amount;
    const toAmountMin = row.to_amount_min;
    const toAmountMax = row.to_amount_max;
    const commodity = row.commodity;
    const location = row.location_standard || row.location;

    if (!fromId || !toId) continue;

    // Get unit labels for readable ratio
    const fromLabel = units[fromId]?.label || row.from_unit_standard || fromId;
    const toLabel = units[toId]?.label || row.to_unit_standard || toId;

    // Build ratio string
    let ratio;
    if (toAmountMin === toAmountMax || !toAmountMax) {
      ratio = `1 ${fromLabel} = ${toAmountMin} ${toLabel}`;
    } else {
      ratio = `1 ${fromLabel} = ${toAmountMin}-${toAmountMax} ${toLabel}`;
    }

    // Build context (commodity + location)
    const contextParts = [];
    if (commodity) contextParts.push(commodity);
    if (location) contextParts.push(location);
    const context = contextParts.join(', ');

    conversions.push({
      from: fromId,
      to: toId,
      ratio,
      ...(context && { context })
    });
  }

  console.log(`Built ${conversions.length} conversions`);

  // Build final JSON
  const json = {
    _meta: {
      name: "VOC Weights & Measures Reference",
      version: "3.0",
      description: "Historical units of weight, volume, length, and quantity used in Dutch East India Company (VOC) trade records. Based on the Memoriën van Munten, Maaten, en Gewigten (1764-1771). Use for query expansion and understanding historical measurements.",
      source: "GLOBALISE Project, Huygens Institute",
      source_url: "https://hdl.handle.net/10622/MDNVH5",
      license: "CC-BY-SA-4.0",
      citation: "Vellinga, Henrike; Nijman, Brecht; Kuruppath, Manjusha, 2024, 'GLOBALISE - Weights and Measures in the 18th Century Indian Ocean World', IISH Data Collection, V1",
      units_count: Object.keys(units).length,
      variants_count: Object.keys(sortedLookup).length,
      conversions_count: conversions.length,
      structure: {
        units: "Each unit has label, type, and optional definitions array (nl/en)",
        lookup: "Maps spelling variants (lowercase) to unit IDs for query expansion",
        conversions: "Unit conversion relationships with ratio and optional context (commodity, location)"
      }
    },
    units,
    lookup: sortedLookup,
    conversions
  };

  // Write output
  writeFileSync(OUTPUT_PATH, JSON.stringify(json, null, 2) + '\n');

  const fileSizeKB = (JSON.stringify(json).length / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${OUTPUT_PATH}`);
  console.log(`  File size: ${fileSizeKB} KB`);

  // Report ambiguous terms
  if (ambiguous.length > 0) {
    console.log('\nAmbiguous terms (same spelling → multiple units):');
    for (const item of ambiguous) {
      console.log(`  "${item.label}" → ${item.chosen} (${item.reason}), also: ${item.alternatives.join(', ')}`);
    }
  }

  // Stats
  const unitsWithDefs = Object.values(units).filter(u => u.definitions && u.definitions.length > 0).length;
  const unitsWithEnglish = Object.values(units).filter(u =>
    u.definitions && u.definitions.some(d => d.en)
  ).length;
  const unitsWithDutch = Object.values(units).filter(u =>
    u.definitions && u.definitions.some(d => d.nl)
  ).length;

  console.log('\nDefinition coverage:');
  console.log(`  Units with any definition: ${unitsWithDefs}`);
  console.log(`  Units with English: ${unitsWithEnglish}`);
  console.log(`  Units with Dutch: ${unitsWithDutch}`);
  console.log(`  Units with no definition: ${Object.keys(units).length - unitsWithDefs}`);

  // Conversion stats
  const uniqueFromUnits = new Set(conversions.map(c => c.from)).size;
  const uniqueToUnits = new Set(conversions.map(c => c.to)).size;
  console.log('\nConversion coverage:');
  console.log(`  Conversion records: ${conversions.length}`);
  console.log(`  Unique 'from' units: ${uniqueFromUnits}`);
  console.log(`  Unique 'to' units: ${uniqueToUnits}`);
}

regenerate();
