#!/usr/bin/env node
/**
 * Regenerates the lookup table from the Labels TSV with a consistent policy:
 *
 * Policy for ambiguous terms (same spelling → multiple units):
 * 1. If the term is a PREFERRED label (pref) for one unit, use that unit
 * 2. If the term is only an ALTERNATE label (alt) for multiple units,
 *    prefer the unit where it appears FIRST in the TSV (often the primary/general unit)
 *
 * This ensures deterministic, documented behavior for ambiguous historical terms.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const JSON_PATH = join(__dirname, '../src/resources/weights-measures.json');
const TSV_DIR = join(__dirname, '../../offline/GLOBALISE - Weights and Measures in the 18th-Century Indian Ocean World');
const LABELS_TSV = join(TSV_DIR, 'Labels for weights and measures.tsv');

// Parse TSV
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
  return rows;
}

function normalizeLabel(label) {
  return label.toLowerCase().trim();
}

function regenerateLookup() {
  console.log('Loading data...');
  const json = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
  const labelsRows = parseTSV(readFileSync(LABELS_TSV, 'utf-8'));

  // Build a map of label -> [{unitId, isPref, order}]
  const labelMappings = new Map();

  labelsRows.forEach((row, index) => {
    const label = row.label;
    const unitId = row.unit_ID || row['unit_ID'];
    const isPref = (row.skosxl_label || '').toLowerCase() === 'pref';

    if (!label || !unitId) return;

    const normalizedLabel = normalizeLabel(label);

    if (!labelMappings.has(normalizedLabel)) {
      labelMappings.set(normalizedLabel, []);
    }

    labelMappings.get(normalizedLabel).push({
      unitId,
      isPref,
      order: index,
      originalLabel: label
    });
  });

  // Build new lookup with policy
  const newLookup = {};
  const ambiguousReport = [];

  for (const [label, mappings] of labelMappings) {
    if (mappings.length === 1) {
      // Unambiguous - just use it
      newLookup[label] = mappings[0].unitId;
    } else {
      // Ambiguous - apply policy
      // First, check if any mapping is a pref label
      const prefMappings = mappings.filter(m => m.isPref);

      if (prefMappings.length === 1) {
        // One pref label - use that unit
        newLookup[label] = prefMappings[0].unitId;
        ambiguousReport.push({
          label,
          chosen: prefMappings[0].unitId,
          reason: 'preferred label',
          alternatives: mappings.filter(m => m.unitId !== prefMappings[0].unitId).map(m => m.unitId)
        });
      } else if (prefMappings.length > 1) {
        // Multiple pref labels (shouldn't happen) - use first
        newLookup[label] = prefMappings[0].unitId;
        ambiguousReport.push({
          label,
          chosen: prefMappings[0].unitId,
          reason: 'first of multiple pref labels',
          alternatives: mappings.filter(m => m.unitId !== prefMappings[0].unitId).map(m => m.unitId)
        });
      } else {
        // All are alt labels - use first occurrence
        const first = mappings.reduce((a, b) => a.order < b.order ? a : b);
        newLookup[label] = first.unitId;
        ambiguousReport.push({
          label,
          chosen: first.unitId,
          reason: 'first occurrence (all alt labels)',
          alternatives: mappings.filter(m => m.unitId !== first.unitId).map(m => m.unitId)
        });
      }
    }
  }

  // Report ambiguous terms
  console.log('\nAmbiguous terms resolved:');
  console.log('='.repeat(60));
  for (const item of ambiguousReport) {
    console.log(`"${item.label}" → ${item.chosen} (${item.reason})`);
    console.log(`   alternatives: ${item.alternatives.join(', ')}`);
  }

  // Compare with current lookup
  console.log('\nChanges from current lookup:');
  console.log('='.repeat(60));
  let changes = 0;
  for (const [label, newUnitId] of Object.entries(newLookup)) {
    const oldUnitId = json.lookup[label];
    if (oldUnitId && oldUnitId !== newUnitId) {
      changes++;
      console.log(`"${label}": ${oldUnitId} → ${newUnitId}`);
    }
  }
  console.log(`\nTotal changes: ${changes}`);

  // Update JSON
  json.lookup = newLookup;

  // Sort lookup alphabetically for readability
  const sortedLookup = {};
  Object.keys(json.lookup).sort().forEach(key => {
    sortedLookup[key] = json.lookup[key];
  });
  json.lookup = sortedLookup;

  // Write back
  writeFileSync(JSON_PATH, JSON.stringify(json, null, 2) + '\n');
  console.log(`\n✓ Updated ${JSON_PATH}`);
  console.log(`  Total lookup entries: ${Object.keys(newLookup).length}`);
}

regenerateLookup();
