/**
 * Budget-aware trimming of a tool result before it is serialized into the
 * (duplicated) text + structuredContent channels. The result object is trimmed
 * IN PLACE — it is freshly built per request and never shared. See plan 005.
 *
 * Two reductions, tried in order: (1) optional `compact` (shrink heavy
 * per-record fields, keeps more records), then (2) drop tail records.
 */

/** UTF-8 byte length of a value's compact JSON serialization. */
export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Describes how to shrink one tool's result.
 * - `items`: the array whose TAIL elements can be dropped losslessly (a live
 *   reference INTO the result).
 * - `onTrim`: repair surrounding metadata after dropping (set hasMore, note...).
 *   Receives the active byte budget as its third arg so a note can cite the cap
 *   without reaching into index.ts's env-derived config — this is what keeps the
 *   module PURE (no `process.env`) and therefore importable by the test.
 * - `compact` (optional): a one-shot field-projection that shrinks heavy
 *   per-record fields in place; returns true if it changed anything. Tried
 *   BEFORE dropping whole records.
 * Return null when the result has no trimmable array.
 */
export type TrimStrategy = (result: Record<string, unknown>) => {
  items: unknown[];
  onTrim: (kept: number, original: number, budgetBytes: number) => void;
  compact?: () => boolean;
} | null;

export interface TrimReport {
  trimmed: boolean;
  compacted?: boolean;
  kept?: number;
  original?: number;
  /** Over budget but nothing could be trimmed (no strategy / already empty). */
  overBudgetIrreducible?: boolean;
  bytes: number;
}

/**
 * Trim `result` in place so its single-copy JSON serialization fits
 * `budgetBytes`. At most ~12 serializations (compact + estimate + bounded shave).
 */
export function fitResultToBudget(
  result: Record<string, unknown>,
  strategy: TrimStrategy | undefined,
  budgetBytes: number,
): TrimReport {
  let bytes = jsonByteLength(result);
  if (bytes <= budgetBytes) return { trimmed: false, bytes };

  const sel = strategy?.(result);
  if (!sel) return { trimmed: false, overBudgetIrreducible: true, bytes };

  // (1) Field-projection first — shrink heavy per-record fields before dropping
  // whole records, so more records survive.
  let compacted = false;
  if (sel.compact && sel.compact()) {
    compacted = true;
    bytes = jsonByteLength(result);
    if (bytes <= budgetBytes) return { trimmed: false, compacted, bytes };
  }

  // (2) Drop tail records.
  if (sel.items.length === 0) {
    return { trimmed: false, compacted, overBudgetIrreducible: true, bytes };
  }
  const original = sel.items.length;
  const perItem = Math.max(1, bytes / original);
  let kept = Math.max(0, Math.min(original, Math.floor(budgetBytes / perItem)));
  sel.items.length = kept;
  sel.onTrim(kept, original, budgetBytes);

  let guard = 0;
  while (kept > 0 && jsonByteLength(result) > budgetBytes && guard < 10) {
    kept = Math.floor(kept * 0.85);
    sel.items.length = kept;
    sel.onTrim(kept, original, budgetBytes);
    guard++;
  }

  return { trimmed: true, compacted, kept, original, bytes: jsonByteLength(result) };
}

// ---------------------------------------------------------------------------
// Concrete per-tool strategies (pure). index.ts imports these and passes one to
// fitResultToBudget per tool; the test imports the SAME functions, so what is
// tested is exactly what ships — no inline copy to drift.
// ---------------------------------------------------------------------------

/**
 * Trim strategy for the list tools (search, find, commodity, measure): drop tail
 * elements of `result.results`, flag `pagination.hasMore`, and append an
 * actionable note citing the budget it was trimmed to. `total` is left untouched
 * so it still reports the true match count.
 */
export const recordListTrim: TrimStrategy = (result) => {
  const items = result.results as unknown[] | undefined;
  if (!Array.isArray(items)) return null;
  return {
    items,
    onTrim: (kept, original, budgetBytes) => {
      const pagination = result.pagination as Record<string, unknown> | undefined;
      if (pagination) pagination.hasMore = true;
      const dropped = original - kept;
      const trimNote = `Response size-capped: returned ${kept} of ${original} fetched results (dropped ${dropped} to fit ~${Math.round(budgetBytes / 1000)}KB). The total count is unaffected — page with a higher \`from\`, narrow your filters, or lower \`size\`.`;
      result.note = result.note ? `${String(result.note)} ${trimNote}` : trimNote;
    },
  };
};

/** Snippet-compaction limits for search before any whole results are dropped. */
export const SEARCH_COMPACT_MAX_FRAGMENTS = 1;
export const SEARCH_COMPACT_FRAGMENT_CHARS = 200;

/**
 * Search trim: first shrink each hit's highlightedFragments (keep 1, ≤200 chars)
 * to fit more results, then fall back to dropping whole results.
 */
export const searchResultTrim: TrimStrategy = (result) => {
  const base = recordListTrim(result);
  if (!base) return null;
  return {
    ...base,
    compact: () => {
      const items = result.results as Array<{ highlightedFragments?: string[] }> | undefined;
      if (!Array.isArray(items)) return false;
      let changed = false;
      for (const r of items) {
        const frags = r.highlightedFragments;
        if (Array.isArray(frags) && frags.length > 0) {
          const next = frags.slice(0, SEARCH_COMPACT_MAX_FRAGMENTS).map((f) =>
            f.length > SEARCH_COMPACT_FRAGMENT_CHARS ? `${f.slice(0, SEARCH_COMPACT_FRAGMENT_CHARS)}…` : f,
          );
          if (next.length !== frags.length || next.some((f, i) => f !== frags[i])) {
            r.highlightedFragments = next;
            changed = true;
          }
        }
      }
      if (changed) {
        const note = `Response size-capped: highlighted snippets were shortened (kept ${SEARCH_COMPACT_MAX_FRAGMENTS} per hit, ≤${SEARCH_COMPACT_FRAGMENT_CHARS} chars). Lower \`size\` or \`fragmentSize\` for full snippets.`;
        result.note = result.note ? `${String(result.note)} ${note}` : note;
      }
      return changed;
    },
  };
};
