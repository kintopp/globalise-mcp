/**
 * Shared language shape and mappers.
 *
 * Upstream reports page languages in two shapes: search results carry parallel
 * `langIso[]` / `langLabel[]` arrays, while document metadata carries a
 * `lang: { iso, label }[]` object array. Both are omitted entirely on pages
 * with no language metadata (e.g. zero-token blank scans) rather than returned
 * as empty arrays, so every mapper must guard. These helpers centralize both
 * the output shape and the guarding so consumers stay one-liners and can't
 * forget the guard (the omission previously crashed search on blank pages).
 */

import { z } from 'zod';
import type { PageMetadata } from './types.js';

/** A detected language: ISO code plus human-readable label. */
export const languageSchema = z.object({
  code: z.string(),
  label: z.string(),
});

export type Language = z.infer<typeof languageSchema>;

/**
 * Map document metadata's `lang` object array to {@link Language}[].
 * Guards `lang` itself (omitted on pages with no language metadata).
 */
export function mapPageLanguages(lang?: PageMetadata['lang']): Language[] {
  return (lang ?? []).map((l) => ({ code: l.iso, label: l.label }));
}

/**
 * Map a search result's parallel `langIso` / `langLabel` arrays to
 * {@link Language}[]. Both are omitted on blank scans, so guard both; fall back
 * to the ISO code when a label is missing.
 */
export function zipLanguages(langIso?: string[], langLabel?: string[]): Language[] {
  return (langIso ?? []).map((code, i) => ({ code, label: langLabel?.[i] || code }));
}
