/** Join response-note fragments with a space; `undefined` when none apply. */
export function joinNotes(...parts: (string | undefined | null)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(' ') : undefined;
}
