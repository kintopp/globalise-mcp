#!/usr/bin/env python3
"""
Convert UUID-based thesaurus files to compact namespaced IDs.

Usage:
    python compact_thesaurus_ids.py input.json output.json --namespace CO

To process multiple files and check for cross-file collisions:
    python compact_thesaurus_ids.py --batch config.json
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def uuid_to_short_id(uuid: str, namespace: str, length: int = 6) -> str:
    """
    Convert a UUID to a namespaced short ID.

    Uses SHA-256 hash of the UUID, encoded in base62.
    Deterministic: same UUID always produces same short ID.
    """
    # Hash the UUID
    hash_bytes = hashlib.sha256(uuid.encode()).digest()
    # Convert first 8 bytes to integer
    hash_int = int.from_bytes(hash_bytes[:8], 'big')

    # Encode in base62
    chars = []
    for _ in range(length):
        chars.append(BASE62[hash_int % 62])
        hash_int //= 62

    short_hash = ''.join(reversed(chars))
    return f"{namespace}_{short_hash}"


def build_id_mapping(data: dict, namespace: str) -> dict[str, str]:
    """
    Build a mapping from old UUIDs to new short IDs.

    Extracts all UUIDs from the concepts dict keys.
    """
    mapping = {}

    for uuid in data.get("concepts", {}).keys():
        new_id = uuid_to_short_id(uuid, namespace)
        if new_id in mapping.values():
            # Find the collision
            for old_uuid, existing_id in mapping.items():
                if existing_id == new_id:
                    raise ValueError(f"Collision detected: {new_id} (UUIDs: {old_uuid} and {uuid})")
        mapping[uuid] = new_id

    return mapping


def replace_ids_in_data(data: dict, mapping: dict[str, str]) -> dict:
    """
    Replace all UUID occurrences with their short ID equivalents.
    """
    # Convert to JSON string, replace, convert back
    # This handles all nested occurrences (broader, narrower, lookup values, topConcepts)
    json_str = json.dumps(data)

    # Sort by length descending to avoid partial replacements
    for old_id, new_id in sorted(mapping.items(), key=lambda x: len(x[0]), reverse=True):
        json_str = json_str.replace(f'"{old_id}"', f'"{new_id}"')

    return json.loads(json_str)


def validate_converted_file(data: dict) -> list[str]:
    """
    Validate that all internal references are consistent.

    Returns list of errors (empty if valid).
    """
    concept_ids = set(data.get("concepts", {}).keys())
    errors = []

    # Check broader/narrower references
    for cid, concept in data.get("concepts", {}).items():
        if "broader" in concept and concept["broader"] not in concept_ids:
            errors.append(f"{cid}: invalid broader ref {concept['broader']}")
        for narrower_id in concept.get("narrower", []):
            if narrower_id not in concept_ids:
                errors.append(f"{cid}: invalid narrower ref {narrower_id}")

    # Check lookup values
    for term, target_id in data.get("lookup", {}).items():
        if target_id not in concept_ids:
            errors.append(f"lookup[{term}]: invalid target {target_id}")

    # Check topConcepts
    for top_id in data.get("topConcepts", []):
        if top_id not in concept_ids:
            errors.append(f"topConcepts: invalid ref {top_id}")

    return errors


def check_collisions_across_files(mappings: dict[str, dict[str, str]]) -> list[tuple]:
    """
    Check for ID collisions across multiple file mappings.

    Args:
        mappings: dict of {filename: {old_id: new_id}}

    Returns:
        List of collision tuples: (new_id, file1, file2)
    """
    seen = {}  # new_id -> source file
    collisions = []

    for filename, mapping in mappings.items():
        for old_id, new_id in mapping.items():
            if new_id in seen:
                collisions.append((new_id, seen[new_id], filename))
            else:
                seen[new_id] = filename

    return collisions


def convert_file(input_path: Path, output_path: Path, namespace: str) -> dict[str, str]:
    """
    Convert a single thesaurus file.

    Returns the ID mapping for collision checking.
    """
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Build mapping
    mapping = build_id_mapping(data, namespace)

    # Replace IDs
    converted = replace_ids_in_data(data, mapping)

    # Update metadata
    if "_meta" in converted:
        converted["_meta"]["id_format"] = f"{namespace}_{{base62}}"
        converted["_meta"]["original_id_format"] = "UUID"

    # Validate
    errors = validate_converted_file(converted)
    if errors:
        print(f"Validation errors in {input_path.name}:")
        for e in errors[:10]:
            print(f"  {e}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")
        raise ValueError(f"Validation failed with {len(errors)} errors")

    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(converted, f, ensure_ascii=False, indent=2)

    # Report
    old_size = input_path.stat().st_size
    new_size = output_path.stat().st_size
    reduction = (1 - new_size / old_size) * 100

    print(f"Converted: {input_path.name}")
    print(f"  Concepts: {len(mapping)}")
    print(f"  Size: {old_size:,} -> {new_size:,} bytes ({reduction:.1f}% reduction)")

    return mapping


def main():
    parser = argparse.ArgumentParser(description="Compact thesaurus IDs")
    parser.add_argument("input", nargs="?", help="Input JSON file")
    parser.add_argument("output", nargs="?", help="Output JSON file")
    parser.add_argument("--namespace", "-n", default="TH", help="2-char namespace prefix")
    parser.add_argument("--batch", "-b", help="Batch config JSON file")

    args = parser.parse_args()

    if args.batch:
        # Batch mode: process multiple files
        with open(args.batch, 'r') as f:
            config = json.load(f)

        # Config format:
        # {
        #   "files": [
        #     {"input": "commodities.json", "output": "commodities_compact.json", "namespace": "CO"},
        #     {"input": "places.json", "output": "places_compact.json", "namespace": "PL"}
        #   ]
        # }

        mappings = {}
        for file_config in config["files"]:
            mapping = convert_file(
                Path(file_config["input"]),
                Path(file_config["output"]),
                file_config["namespace"]
            )
            mappings[file_config["input"]] = mapping

        # Check for cross-file collisions
        collisions = check_collisions_across_files(mappings)
        if collisions:
            print(f"\nFound {len(collisions)} cross-file collisions:")
            for new_id, file1, file2 in collisions:
                print(f"  {new_id}: {file1} <-> {file2}")
        else:
            print(f"\nNo collisions across {len(mappings)} files")

    else:
        # Single file mode
        if not args.input or not args.output:
            parser.error("Provide input and output paths, or use --batch")

        if len(args.namespace) != 2:
            parser.error("Namespace must be exactly 2 characters")

        convert_file(Path(args.input), Path(args.output), args.namespace.upper())


if __name__ == "__main__":
    main()
