#!/usr/bin/env node
/**
 * Validation script for weights-measures.json
 *
 * Compares the JSON dictionary against the original TSV source files to ensure:
 * 1. All units from the Glossary TSV are present in the JSON
 * 2. All label variants from the Labels TSV are in the lookup table
 * 3. Lookup mappings correctly point to the right unit IDs
 * 4. Definitions match the source data
 * 5. Unit types are correct
 *
 * Usage: node scripts/validate-weights-measures.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const JSON_PATH = join(__dirname, '../src/resources/weights-measures.json');
const TSV_DIR = join(__dirname, '../../offline/GLOBALISE - Weights and Measures in the 18th-Century Indian Ocean World');
const GLOSSARY_TSV = join(TSV_DIR, 'Glossary of weights and measures.tsv');
const LABELS_TSV = join(TSV_DIR, 'Labels for weights and measures.tsv');

// Parse TSV file
function parseTSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  // Skip "Table 1" header if present
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
  return rows;
}

// Normalize label for lookup comparison (lowercase, trim)
function normalizeLabel(label) {
  return label.toLowerCase().trim();
}

// Main validation
function validate() {
  console.log('='.repeat(60));
  console.log('WEIGHTS & MEASURES VALIDATION');
  console.log('='.repeat(60));
  console.log();

  // Load files
  let json, glossaryRows, labelsRows;

  try {
    json = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    console.log(`✓ Loaded JSON: ${Object.keys(json.units).length} units, ${Object.keys(json.lookup).length} lookup entries`);
  } catch (e) {
    console.error(`✗ Failed to load JSON: ${e.message}`);
    process.exit(1);
  }

  try {
    glossaryRows = parseTSV(readFileSync(GLOSSARY_TSV, 'utf-8'));
    console.log(`✓ Loaded Glossary TSV: ${glossaryRows.length} rows`);
  } catch (e) {
    console.error(`✗ Failed to load Glossary TSV: ${e.message}`);
    process.exit(1);
  }

  try {
    labelsRows = parseTSV(readFileSync(LABELS_TSV, 'utf-8'));
    console.log(`✓ Loaded Labels TSV: ${labelsRows.length} rows`);
  } catch (e) {
    console.error(`✗ Failed to load Labels TSV: ${e.message}`);
    process.exit(1);
  }

  console.log();

  const issues = {
    missingUnits: [],
    missingLabels: [],
    wrongMappings: [],
    typeMismatches: [],
    definitionIssues: [],
    extraUnits: [],
    extraLookups: []
  };

  // 1. Check all units from Glossary are in JSON
  console.log('1. Checking unit coverage...');
  const glossaryUnitIds = new Set();

  for (const row of glossaryRows) {
    const unitId = row.Unit_ID || row['Unit_ID'];
    if (!unitId) continue;
    glossaryUnitIds.add(unitId);

    if (!json.units[unitId]) {
      issues.missingUnits.push({
        id: unitId,
        label: row.pref_label,
        type: row.type
      });
    }
  }

  console.log(`   Found ${glossaryUnitIds.size} units in Glossary TSV`);
  console.log(`   JSON has ${Object.keys(json.units).length} units`);

  // Check for extra units in JSON not in Glossary
  for (const unitId of Object.keys(json.units)) {
    if (!glossaryUnitIds.has(unitId)) {
      issues.extraUnits.push({
        id: unitId,
        label: json.units[unitId].label
      });
    }
  }

  // 2. Check all labels from Labels TSV are in lookup
  console.log('2. Checking label/variant coverage...');

  // Build a map of label -> [unitIds] (some labels map to multiple units)
  const labelToUnits = new Map(); // label -> Set of unitIds

  for (const row of labelsRows) {
    const label = row.label;
    const unitId = row.unit_ID || row['unit_ID'];
    if (!label || !unitId) continue;

    const normalizedLabel = normalizeLabel(label);
    if (!labelToUnits.has(normalizedLabel)) {
      labelToUnits.set(normalizedLabel, new Set());
    }
    labelToUnits.get(normalizedLabel).add(unitId);
  }

  // Count ambiguous labels
  const ambiguousLabels = [...labelToUnits.entries()].filter(([_, units]) => units.size > 1);
  console.log(`   Found ${labelToUnits.size} unique labels in Labels TSV`);
  console.log(`   Of which ${ambiguousLabels.length} are ambiguous (map to multiple units)`);
  console.log(`   JSON lookup has ${Object.keys(json.lookup).length} entries`);

  // Check each label
  for (const [normalizedLabel, validUnitIds] of labelToUnits) {
    if (!json.lookup[normalizedLabel]) {
      // Missing from lookup entirely
      issues.missingLabels.push({
        label: normalizedLabel,
        normalizedLabel: normalizedLabel,
        expectedUnitIds: [...validUnitIds],
        unitLabel: 'multiple'
      });
    } else if (!validUnitIds.has(json.lookup[normalizedLabel])) {
      // Maps to a unit that's not in the valid set - this is a real error
      issues.wrongMappings.push({
        label: normalizedLabel,
        normalizedLabel: normalizedLabel,
        expectedUnitIds: [...validUnitIds],
        actualUnitId: json.lookup[normalizedLabel],
        unitLabel: 'invalid mapping'
      });
    }
    // If it maps to one of the valid units, it's correct (even if ambiguous)
  }

  // Check for extra lookups in JSON not in Labels TSV
  for (const [label, unitId] of Object.entries(json.lookup)) {
    if (!labelToUnits.has(label)) {
      issues.extraLookups.push({
        label: label,
        unitId: unitId,
        unitLabel: json.units[unitId]?.label || 'UNKNOWN'
      });
    }
  }

  // 3. Check unit types match
  console.log('3. Checking unit types...');
  const typeMapping = {
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

  for (const row of glossaryRows) {
    const unitId = row.Unit_ID || row['Unit_ID'];
    if (!unitId || !json.units[unitId]) continue;

    const tsvType = (row.type || '').toLowerCase().trim();
    const jsonType = json.units[unitId].type;
    const expectedType = typeMapping[tsvType] || tsvType;

    if (expectedType && jsonType !== expectedType) {
      issues.typeMismatches.push({
        unitId: unitId,
        label: json.units[unitId].label,
        tsvType: tsvType,
        expectedType: expectedType,
        jsonType: jsonType
      });
    }
  }

  // 4. Check definitions structure (new format with definitions array)
  console.log('4. Checking definitions coverage...');
  for (const row of glossaryRows) {
    const unitId = row.Unit_ID || row['Unit_ID'];
    if (!unitId || !json.units[unitId]) continue;

    const unit = json.units[unitId];
    const hasTsvDef1 = (row.definition_nl_1 || row.definition_en_1 || '').trim();
    const hasTsvDef2 = (row.definition_nl_2 || row.definition_en_2 || '').trim();
    const tsvDefCount = (hasTsvDef1 ? 1 : 0) + (hasTsvDef2 ? 1 : 0);
    const jsonDefCount = unit.definitions ? unit.definitions.length : 0;

    // Check if definition counts match
    if (tsvDefCount !== jsonDefCount) {
      issues.definitionIssues.push({
        unitId: unitId,
        label: unit.label,
        issue: `TSV has ${tsvDefCount} definitions, JSON has ${jsonDefCount}`
      });
    }
  }

  // Report results
  console.log();
  console.log('='.repeat(60));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(60));
  console.log();

  let hasErrors = false;

  if (issues.missingUnits.length > 0) {
    hasErrors = true;
    console.log(`✗ MISSING UNITS (${issues.missingUnits.length}):`);
    issues.missingUnits.forEach(u => {
      console.log(`  - ${u.id}: ${u.label} (${u.type})`);
    });
    console.log();
  }

  if (issues.missingLabels.length > 0) {
    hasErrors = true;
    console.log(`✗ MISSING LABELS in lookup (${issues.missingLabels.length}):`);
    issues.missingLabels.slice(0, 20).forEach(l => {
      console.log(`  - "${l.label}" → ${l.expectedUnitId} (${l.unitLabel})`);
    });
    if (issues.missingLabels.length > 20) {
      console.log(`  ... and ${issues.missingLabels.length - 20} more`);
    }
    console.log();
  }

  if (issues.wrongMappings.length > 0) {
    hasErrors = true;
    console.log(`✗ WRONG MAPPINGS (${issues.wrongMappings.length}):`);
    issues.wrongMappings.forEach(m => {
      console.log(`  - "${m.label}": expected ${m.expectedUnitId}, got ${m.actualUnitId}`);
    });
    console.log();
  }

  if (issues.typeMismatches.length > 0) {
    console.log(`⚠ TYPE MISMATCHES (${issues.typeMismatches.length}):`);
    issues.typeMismatches.forEach(t => {
      console.log(`  - ${t.unitId} (${t.label}): TSV="${t.tsvType}" → expected="${t.expectedType}", JSON="${t.jsonType}"`);
    });
    console.log();
  }

  if (issues.definitionIssues.length > 0) {
    console.log(`⚠ DEFINITION COUNT MISMATCHES (${issues.definitionIssues.length}):`);
    issues.definitionIssues.slice(0, 10).forEach(d => {
      console.log(`  - ${d.unitId} (${d.label}): ${d.issue}`);
    });
    if (issues.definitionIssues.length > 10) {
      console.log(`  ... and ${issues.definitionIssues.length - 10} more`);
    }
    console.log();
  }

  if (issues.extraUnits.length > 0) {
    console.log(`ℹ EXTRA UNITS in JSON not in TSV (${issues.extraUnits.length}):`);
    issues.extraUnits.forEach(u => {
      console.log(`  - ${u.id}: ${u.label}`);
    });
    console.log();
  }

  if (issues.extraLookups.length > 0) {
    console.log(`ℹ EXTRA LOOKUPS in JSON not in Labels TSV (${issues.extraLookups.length}):`);
    issues.extraLookups.slice(0, 10).forEach(l => {
      console.log(`  - "${l.label}" → ${l.unitId} (${l.unitLabel})`);
    });
    if (issues.extraLookups.length > 10) {
      console.log(`  ... and ${issues.extraLookups.length - 10} more`);
    }
    console.log();
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Units in Glossary TSV:     ${glossaryUnitIds.size}`);
  console.log(`Units in JSON:             ${Object.keys(json.units).length}`);
  console.log(`Labels in Labels TSV:      ${labelToUnits.size}`);
  console.log(`Lookups in JSON:           ${Object.keys(json.lookup).length}`);
  console.log();
  console.log(`Missing units:             ${issues.missingUnits.length}`);
  console.log(`Missing labels:            ${issues.missingLabels.length}`);
  console.log(`Wrong mappings:            ${issues.wrongMappings.length}`);
  console.log(`Type mismatches:           ${issues.typeMismatches.length}`);
  console.log(`Definition differences:    ${issues.definitionIssues.length}`);
  console.log(`Extra units in JSON:       ${issues.extraUnits.length}`);
  console.log(`Extra lookups in JSON:     ${issues.extraLookups.length}`);
  console.log();

  if (hasErrors) {
    console.log('❌ VALIDATION FAILED - Critical issues found');
    process.exit(1);
  } else if (issues.typeMismatches.length > 0 || issues.definitionIssues.length > 0 ||
             issues.extraUnits.length > 0 || issues.extraLookups.length > 0) {
    console.log('⚠️  VALIDATION PASSED WITH WARNINGS');
    process.exit(0);
  } else {
    console.log('✅ VALIDATION PASSED');
    process.exit(0);
  }
}

validate();
