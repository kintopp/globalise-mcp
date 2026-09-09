/**
 * Inventory-number scoping for search_transcriptions: expands `inventoryRange`
 * specs into explicit numbers and intersects them with a year-resolved set.
 *
 * Upstream's `terms.invNr` is a flat OR-list, so ranges and year windows have to
 * be materialised client-side. Verified live: a ~10K-value list (the whole
 * corpus span) filters in ~60 ms, so expansion is cheap.
 */

import { ToolError } from './errors.js';

/** Numeric extent of the transcribed corpus (NL-HaNA 1.04.02); ranges are clamped to it. */
export const CORPUS_INVENTORY_MIN = 1053;
export const CORPUS_INVENTORY_MAX = 11024;

const RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

/**
 * Collapse a `string | string[]` inventory-number input to a trimmed array, or
 * `undefined` when effectively empty (`[]`, `""`, all-blank). Shared by both
 * tools so an empty filter behaves like no filter and never reaches SQL as
 * `IN ()` or upstream as a blank term.
 */
export function normalizeInventoryList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const cleaned = (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

/** Parse "A-B" (inclusive, A ≤ B) and clamp it to the corpus extent. */
export function parseInventoryRange(spec: string): { from: number; to: number } {
  const m = RANGE_RE.exec(spec);
  if (!m) {
    throw new ToolError(
      `Invalid inventoryRange "${spec}"`,
      'Write it as two inventory numbers joined by a hyphen, e.g. "1053-4454" (inclusive). Lettered part-inventories like 9014A cannot be expressed as a range — list them in inventoryNumber.',
    );
  }
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from > to) {
    throw new ToolError(
      `Invalid inventoryRange "${spec}": start is greater than end`,
      `Did you mean "${to}-${from}"?`,
    );
  }
  if (to < CORPUS_INVENTORY_MIN || from > CORPUS_INVENTORY_MAX) {
    throw new ToolError(
      `inventoryRange "${spec}" lies outside the corpus`,
      `Transcribed inventories run from ${CORPUS_INVENTORY_MIN} to ${CORPUS_INVENTORY_MAX}.`,
    );
  }
  return { from: Math.max(from, CORPUS_INVENTORY_MIN), to: Math.min(to, CORPUS_INVENTORY_MAX) };
}

/** Expand one or more "A-B" specs into the union of their inventory numbers, in order. */
export function expandInventoryRanges(specs: string[]): string[] {
  const seen = new Set<string>();
  for (const spec of specs) {
    const { from, to } = parseInventoryRange(spec);
    for (let n = from; n <= to; n++) seen.add(String(n));
  }
  return [...seen];
}

/**
 * Combine explicit numbers, range expansions and a year-resolved set into one
 * `invNr` list. Explicit and ranges union; a year set (when given) intersects
 * with that union or stands alone. `undefined` means "no inventory filter"; an
 * empty array means the filters exclude everything — callers must short-circuit
 * rather than send it, because an empty terms list upstream is no filter at all.
 */
export function resolveInventoryScope(
  explicit?: string[],
  fromRanges?: string[],
  fromYears?: string[],
): string[] | undefined {
  const union = explicit?.length
    ? [...new Set([...explicit, ...(fromRanges ?? [])])]
    : (fromRanges ?? []);
  if (fromYears === undefined) return union.length ? union : undefined;
  if (union.length === 0) return fromYears;
  const years = new Set(fromYears);
  return union.filter((n) => years.has(n));
}
