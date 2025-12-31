#!/usr/bin/env node
/**
 * Export weights-measures.json to TSV files for inspection
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load JSON
const jsonPath = join(__dirname, '../src/resources/weights-measures.json');
const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));

// Helper to escape TSV fields
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Replace tabs with spaces, newlines with literal \n
  return str.replace(/\t/g, ' ').replace(/\n/g, '\\n').replace(/\r/g, '');
}

// 1. Export units (basic info)
const unitsRows = [['unit_id', 'label', 'type']];
for (const [unitId, unit] of Object.entries(data.units)) {
  unitsRows.push([
    escapeField(unitId),
    escapeField(unit.label),
    escapeField(unit.type)
  ]);
}

const unitsTsv = unitsRows.map(row => row.join('\t')).join('\n');
writeFileSync('weights-measures-units.tsv', unitsTsv, 'utf-8');
console.log(`✓ Exported ${unitsRows.length - 1} units to weights-measures-units.tsv`);

// 2. Export definitions (one row per definition)
const defRows = [['unit_id', 'label', 'text_nl', 'text_en', 'source']];
for (const [unitId, unit] of Object.entries(data.units)) {
  if (unit.definitions && unit.definitions.length > 0) {
    for (const def of unit.definitions) {
      defRows.push([
        escapeField(unitId),
        escapeField(unit.label),
        escapeField(def.text_nl || ''),
        escapeField(def.text_en || ''),
        escapeField(def.source || '')
      ]);
    }
  }
}

const defTsv = defRows.map(row => row.join('\t')).join('\n');
writeFileSync('weights-measures-definitions.tsv', defTsv, 'utf-8');
console.log(`✓ Exported ${defRows.length - 1} definitions to weights-measures-definitions.tsv`);

// 3. Export lookup (variant spellings)
const lookupRows = [['variant', 'unit_id', 'label']];
for (const [variant, unitId] of Object.entries(data.lookup)) {
  const unit = data.units[unitId];
  lookupRows.push([
    escapeField(variant),
    escapeField(unitId),
    escapeField(unit?.label || 'UNKNOWN')
  ]);
}

// Sort by unit_id, then variant
lookupRows.slice(1).sort((a, b) => {
  if (a[1] !== b[1]) return a[1].localeCompare(b[1]);
  return a[0].localeCompare(b[0]);
});

const lookupTsv = lookupRows.map(row => row.join('\t')).join('\n');
writeFileSync('weights-measures-lookup.tsv', lookupTsv, 'utf-8');
console.log(`✓ Exported ${lookupRows.length - 1} variants to weights-measures-lookup.tsv`);

// 4. Export metadata
const metaRows = [['key', 'value']];
for (const [key, value] of Object.entries(data._meta)) {
  if (typeof value === 'object') {
    metaRows.push([key, JSON.stringify(value, null, 2)]);
  } else {
    metaRows.push([escapeField(key), escapeField(value)]);
  }
}

const metaTsv = metaRows.map(row => row.join('\t')).join('\n');
writeFileSync('weights-measures-meta.tsv', metaTsv, 'utf-8');
console.log(`✓ Exported metadata to weights-measures-meta.tsv`);

console.log('\n📊 Summary:');
console.log(`   Units: ${unitsRows.length - 1}`);
console.log(`   Definitions: ${defRows.length - 1}`);
console.log(`   Variants: ${lookupRows.length - 1}`);
console.log(`   Version: ${data._meta.version}`);
