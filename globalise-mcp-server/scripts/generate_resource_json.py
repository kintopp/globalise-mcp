#!/usr/bin/env python3
"""
Generate weights-measures.json from TSV source files.

Parses the GLOBALISE Weights and Measures dataset and produces
a JSON resource optimized for LLM query expansion.
"""

import csv
import json
import re
from pathlib import Path

# File paths
BASE_DIR = Path(__file__).parent
GLOSSARY_TSV = BASE_DIR / "Glossary of weights and measures.tsv"
LABELS_TSV = BASE_DIR / "Labels for weights and measures.tsv"
OUTPUT_JSON = BASE_DIR / "weights-measures.json"


def normalize_type(raw_type: str) -> str:
    """Normalize unit type to lowercase standard form."""
    t = raw_type.strip().lower()
    if t in ("weight", "weight "):
        return "weight"
    if t in ("liquid measure",):
        return "volume"
    if t in ("dry measure",):
        return "volume"
    if t in ("volume",):
        return "volume"
    if t in ("length",):
        return "length"
    if t in ("area",):
        return "area"
    if t in ("quantities",):
        return "quantities"
    if t in ("maat", "measure", "misc"):
        return "misc"
    return "misc"


def extract_english_definition(row: dict) -> str:
    """Extract and condense the English definition from glossary row."""
    # Try definition_en_1 first, then definition_en_2
    en1 = row.get("definition_en_1", "").strip()
    en2 = row.get("definition_en_2", "").strip()

    # Prefer the longer/more complete one
    definition = en1 if len(en1) >= len(en2) else en2
    if not definition and en1:
        definition = en1
    if not definition and en2:
        definition = en2

    # If still no English, try to use Dutch as fallback indicator
    if not definition:
        nl1 = row.get("definition_nl_1", "").strip()
        if nl1:
            return "(Dutch definition only in source)"
        return ""

    # Clean up the definition
    definition = re.sub(r'\s+', ' ', definition)  # Normalize whitespace
    return definition


def main():
    # Parse glossary for unit definitions
    units = {}
    with open(GLOSSARY_TSV, 'r', encoding='utf-8') as f:
        # Skip the "Table 1" header line
        first_line = f.readline()
        reader = csv.DictReader(f, delimiter='\t')

        for row in reader:
            unit_id = row.get("Unit_ID", "").strip()
            if not unit_id:
                continue

            pref_label = row.get("pref_label", "").strip()
            raw_type = row.get("type", "").strip()
            definition = extract_english_definition(row)

            units[unit_id] = {
                "label": pref_label,
                "type": normalize_type(raw_type),
                "definition": definition
            }

    # Parse labels for lookup index
    lookup = {}
    with open(LABELS_TSV, 'r', encoding='utf-8') as f:
        # Skip the "Table 1" header line
        first_line = f.readline()
        reader = csv.DictReader(f, delimiter='\t')

        for row in reader:
            label = row.get("label", "").strip()
            unit_id = row.get("unit_ID", "").strip()

            if not label or not unit_id:
                continue

            # Normalize to lowercase for lookup
            key = label.lower()

            # Only add if unit exists in glossary
            if unit_id in units:
                # Handle duplicates (same label -> different units)
                # Keep first occurrence (usually pref_label mapping)
                if key not in lookup:
                    lookup[key] = unit_id

    # Also add pref_labels from glossary to lookup
    for unit_id, data in units.items():
        key = data["label"].lower()
        if key not in lookup:
            lookup[key] = unit_id

    # Build final JSON structure
    resource = {
        "_meta": {
            "name": "VOC Weights & Measures Reference",
            "version": "1.0",
            "description": "Historical units of weight, volume, length, and quantity used in Dutch East India Company (VOC) trade records. Based on the Memoriën van Munten, Maaten, en Gewigten (1764-1771), administrative reports documenting local measurement systems across VOC settlements in Asia.",
            "source": "GLOBALISE Project, Huygens Institute",
            "source_url": "https://hdl.handle.net/10622/MDNVH5",
            "license": "CC-BY-SA-4.0",
            "citation": "Vellinga, Henrike; Nijman, Brecht; Kuruppath, Manjusha, 2024, 'GLOBALISE - Weights and Measures in the 18th Century Indian Ocean World', IISH Data Collection, V1",
            "units_count": len(units),
            "variants_count": len(lookup)
        },
        "units": units,
        "lookup": dict(sorted(lookup.items()))  # Sort for readability
    }

    # Write output
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(resource, f, indent=2, ensure_ascii=False)

    print(f"Generated {OUTPUT_JSON}")
    print(f"  Units: {len(units)}")
    print(f"  Lookup entries: {len(lookup)}")

    # Calculate approximate size
    json_str = json.dumps(resource, ensure_ascii=False)
    print(f"  Approximate size: {len(json_str) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
