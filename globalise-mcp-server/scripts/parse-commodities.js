#!/usr/bin/env node
/**
 * Parses commodities.trig (RDF/SKOS) and converts to JSON for MCP resource.
 *
 * Usage:
 *   node scripts/parse-commodities.js [--stats-only]
 *
 * Options:
 *   --stats-only  Just print statistics, don't write output
 *
 * Design decisions:
 * - Full UUIDs as concept IDs (future-proof for PoolParty links)
 * - Excludes "NOT YET CLASSIFIED" concepts UNLESS they have alt labels or definitions
 * - Includes narrower arrays for bidirectional hierarchy navigation
 * - Strips citation metadata from definitions
 * - No external links (dropped for simplicity)
 * - No source fields (stripped for size)
 *
 * Output: src/resources/commodities.json
 *
 * Requires: npm install n3
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Parser } from 'n3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const INPUT_PATH = join(__dirname, '../../offline/resources/GLOBALISE - Thesaurus - Commodities/commodities.trig');
const OUTPUT_PATH = join(__dirname, '../src/resources/commodities.json');

// SKOS namespace prefixes
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

// Commodities concept scheme URI
const COMMODITIES_SCHEME = 'https://digitaalerfgoed.poolparty.biz/globalise/be873c02-658f-4764-a010-f00840f7f087';

// "NOT YET CLASSIFIED" top concept
const NOT_YET_CLASSIFIED_URI = 'https://digitaalerfgoed.poolparty.biz/globalise/18e9046f-4851-4ce6-813c-16a477a98231';

// Extract language from literal
function getLang(literal) {
  return literal.language || '';
}

// Extract text from literal
function getText(literal) {
  return literal.value || '';
}

// Extract full UUID from PoolParty URI
function getFullId(uri) {
  // URI format: https://digitaalerfgoed.poolparty.biz/globalise/{uuid}
  const parts = uri.split('/');
  return parts[parts.length - 1];
}

// Clean definition text (remove HTML, normalize whitespace)
function cleanDefinition(text) {
  if (!text) return '';
  return text
    .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim();
}

// Strip citation metadata from definition
// Removes everything after "Geciteerd uit:", "Cited from:", etc.
function stripCitationMetadata(text) {
  if (!text) return '';
  const markers = [
    /\s*Geciteerd uit:.*/si,
    /\s*Cited from:.*/si,
    /\s*Geparafraseerd uit:.*/si,
    /\s*Paraphrased from:.*/si,
    /\s*Bron:\s*http.*/si,
    /\s*Geclassificeerd op:.*/si,
    /\s*Classified on:.*/si,
  ];

  let cleaned = text;
  for (const marker of markers) {
    cleaned = cleaned.replace(marker, '');
  }
  return cleaned.trim();
}

// Check if concept should be included
function shouldInclude(conceptData) {
  // Always exclude the "NOT YET CLASSIFIED" category itself
  if (conceptData.uri === NOT_YET_CLASSIFIED_URI) return false;

  // For concepts under "NOT YET CLASSIFIED", only include if they have
  // alt labels OR definitions (otherwise they're bare labels with no value)
  if (conceptData.broader === NOT_YET_CLASSIFIED_URI) {
    const hasAltLabels = conceptData.altLabels.length > 0;
    const hasDefinitions = conceptData.definitions.length > 0;
    return hasAltLabels || hasDefinitions;
  }

  return true;
}

async function parseCommodities() {
  const args = process.argv.slice(2);
  const statsOnly = args.includes('--stats-only');

  console.log('Parsing commodities.trig with n3...\n');

  // Read and parse TriG file
  const content = readFileSync(INPUT_PATH, 'utf-8');
  const parser = new Parser({ format: 'TriG' });

  // Collect all quads
  const quads = [];
  try {
    const parsed = parser.parse(content);
    quads.push(...parsed);
  } catch (err) {
    console.error('Parse error:', err.message);
    process.exit(1);
  }

  console.log(`Parsed ${quads.length} RDF quads`);

  // Build concept map from quads
  const concepts = new Map();
  const topConcepts = new Set();

  for (const quad of quads) {
    const subject = quad.subject.value;
    const predicate = quad.predicate.value;
    const object = quad.object;

    // Only process concepts in the commodities scheme
    if (predicate === `${SKOS}inScheme` && object.value === COMMODITIES_SCHEME) {
      if (!concepts.has(subject)) {
        concepts.set(subject, {
          uri: subject,
          prefLabels: {},
          altLabels: [],
          broader: null,
          narrower: [],
          definitions: [],
          isTopConcept: false
        });
      }
    }
  }

  console.log(`Found ${concepts.size} concepts in commodities scheme`);

  // Second pass: extract properties
  for (const quad of quads) {
    const subject = quad.subject.value;
    const predicate = quad.predicate.value;
    const object = quad.object;

    if (!concepts.has(subject)) continue;
    const concept = concepts.get(subject);

    switch (predicate) {
      case `${SKOS}prefLabel`:
        const prefLang = getLang(object);
        concept.prefLabels[prefLang || 'und'] = getText(object);
        break;

      case `${SKOS}altLabel`:
        concept.altLabels.push({
          text: getText(object),
          lang: getLang(object)
        });
        break;

      case `${SKOS}broader`:
        concept.broader = object.value;
        break;

      case `${SKOS}narrower`:
        concept.narrower.push(object.value);
        break;

      case `${SKOS}definition`:
        concept.definitions.push(cleanDefinition(getText(object)));
        break;

      case `${SKOS}topConceptOf`:
        if (object.value === COMMODITIES_SCHEME) {
          concept.isTopConcept = true;
          topConcepts.add(subject);
        }
        break;
    }
  }

  // Statistics
  let notYetClassifiedCount = 0;
  let notYetClassifiedIncluded = 0;
  let classifiedCount = 0;
  let withEnglish = 0;
  let withDutch = 0;
  let withDefinition = 0;
  let withAltLabels = 0;

  for (const [, data] of concepts) {
    if (data.broader === NOT_YET_CLASSIFIED_URI) {
      notYetClassifiedCount++;
      if (shouldInclude(data)) notYetClassifiedIncluded++;
    } else {
      classifiedCount++;
    }
    if (data.prefLabels['en']) withEnglish++;
    if (data.prefLabels['nl']) withDutch++;
    if (data.definitions.length > 0) withDefinition++;
    if (data.altLabels.length > 0) withAltLabels++;
  }

  console.log('\nStatistics:');
  console.log(`  Total concepts: ${concepts.size}`);
  console.log(`  Classified: ${classifiedCount}`);
  console.log(`  "NOT YET CLASSIFIED": ${notYetClassifiedCount} (including ${notYetClassifiedIncluded} with alt labels or definitions)`);
  console.log(`  Top concepts: ${topConcepts.size}`);
  console.log(`  With Dutch label: ${withDutch}`);
  console.log(`  With English label: ${withEnglish}`);
  console.log(`  With definition: ${withDefinition}`);
  console.log(`  With alt labels: ${withAltLabels}`);

  if (statsOnly) {
    console.log('\n--stats-only mode, not writing output');
    return;
  }

  // Build output JSON
  const uriToId = new Map();
  const outputConcepts = {};
  const lookup = {};
  let includedCount = 0;

  // First pass: assign IDs (only for concepts we'll include)
  for (const [uri, data] of concepts) {
    if (!shouldInclude(data)) continue;
    const id = getFullId(uri);
    uriToId.set(uri, id);
  }

  // Second pass: build output
  for (const [uri, data] of concepts) {
    if (!shouldInclude(data)) continue;

    const id = uriToId.get(uri);
    includedCount++;

    // Build concept entry
    const entry = {};

    // Preferred labels
    if (data.prefLabels['nl']) entry.prefLabel_nl = data.prefLabels['nl'];
    if (data.prefLabels['en']) entry.prefLabel_en = data.prefLabels['en'];

    // Alternative labels (deduplicated, sorted)
    if (data.altLabels.length > 0) {
      const altSet = new Set(data.altLabels.map(a => a.text.toLowerCase()));
      entry.altLabels = [...altSet].sort();
    }

    // Broader (convert URI to ID, only if parent is included)
    if (data.broader && uriToId.has(data.broader)) {
      entry.broader = uriToId.get(data.broader);
    }

    // Narrower (convert URIs to IDs, only include children that are included)
    if (data.narrower.length > 0) {
      const narrowerIds = data.narrower
        .filter(uri => uriToId.has(uri))
        .map(uri => uriToId.get(uri))
        .sort();
      if (narrowerIds.length > 0) {
        entry.narrower = narrowerIds;
      }
    }

    // Definition (first one, cleaned and stripped)
    if (data.definitions.length > 0) {
      let def = data.definitions.find(d => d.length > 0);
      if (def) {
        def = stripCitationMetadata(def);
        if (def.length > 500) {
          def = def.substring(0, 500) + '...';
        }
        if (def) entry.definition = def;
      }
    }

    outputConcepts[id] = entry;

    // Build lookup entries
    const addToLookup = (text, conceptId) => {
      if (!text) return;
      const normalized = text.toLowerCase().trim();
      if (normalized.length < 2) return;
      // Don't overwrite if already exists (prefer pref labels)
      if (!lookup[normalized]) {
        lookup[normalized] = conceptId;
      }
    };

    // Add pref labels to lookup
    addToLookup(data.prefLabels['nl'], id);
    addToLookup(data.prefLabels['en'], id);

    // Add alt labels to lookup
    for (const alt of data.altLabels) {
      addToLookup(alt.text, id);
    }
  }

  // Sort lookup alphabetically
  const sortedLookup = {};
  Object.keys(lookup).sort().forEach(key => {
    sortedLookup[key] = lookup[key];
  });

  // Build final JSON
  const json = {
    _meta: {
      name: "VOC Commodities Thesaurus",
      version: "1.0",
      description: "Trade goods from Dutch East India Company (VOC) archives. A SKOS thesaurus of commodities shipped in the early modern Indian Ocean World, sourced from the Boekhouder Generaal Batavia and Monsoon Traders datasets.",
      source: "GLOBALISE Project, Huygens Institute",
      source_url: "https://hdl.handle.net/10622/YAWDOV",
      license: "CC-BY-SA-4.0",
      citation: "Pepping, K.; Vellinga, H.; Kuruppath, M.; Van Wissen, L.; Van Rossum, M., 2023, 'GLOBALISE Thesaurus - Commodities', IISH Data Collection, V1",
      concepts_count: includedCount,
      variants_count: Object.keys(sortedLookup).length,
      note: "Some concepts involve enslaved persons recorded as 'people treated as commodities'. This reflects historical violence documented in VOC records. See datasheet: https://hdl.handle.net/10622/YAWDOV",
      structure: {
        concepts: "Each concept has prefLabel_nl/en, optional altLabels array, broader parent ID, narrower child IDs, and definition",
        lookup: "Maps spelling variants (lowercase) to concept IDs for query expansion",
        topConcepts: "Root categories of the commodity hierarchy (SITC-based classification)"
      }
    },
    concepts: outputConcepts,
    lookup: sortedLookup,
    topConcepts: [...topConcepts].map(uri => uriToId.get(uri)).filter(Boolean).sort()
  };

  // Write output
  writeFileSync(OUTPUT_PATH, JSON.stringify(json, null, 2) + '\n');

  const fileSizeKB = (JSON.stringify(json).length / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${OUTPUT_PATH}`);
  console.log(`  Concepts included: ${includedCount}`);
  console.log(`  Lookup entries: ${Object.keys(sortedLookup).length}`);
  console.log(`  File size: ${fileSizeKB} KB`);

  // Count concepts with narrower
  const withNarrower = Object.values(outputConcepts).filter(c => c.narrower && c.narrower.length > 0).length;
  console.log(`  Concepts with narrower: ${withNarrower}`);

  // Sample output
  console.log('\nSample concepts:');
  const sampleIds = Object.keys(outputConcepts).slice(0, 3);
  for (const id of sampleIds) {
    const c = outputConcepts[id];
    console.log(`  ${id}: ${c.prefLabel_nl || c.prefLabel_en} ${c.altLabels ? `(+${c.altLabels.length} variants)` : ''}`);
  }
}

parseCommodities().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
