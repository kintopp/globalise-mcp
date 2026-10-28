/**
 * Hash of a SQLite DB's logical content: user_version, schema, and every
 * ordinary table's rows. Compared by content, not bytes, because ANALYZE output
 * (sqlite_stat*) and page layout vary with the SQLite build (Homebrew's has
 * STAT4, official Node's doesn't).
 *
 * CLI: npx tsx scripts/db-content-hash.ts a.sqlite b.sqlite
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function serialize(values: unknown[]): string {
  return JSON.stringify(values, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return { hex: Buffer.from(v).toString('hex') };
    return v;
  });
}

export function dbContentHash(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const hash = createHash('sha256');
    const feed = (values: unknown[]): void => { hash.update(serialize(values) + '\n'); };

    feed([(db.prepare('PRAGMA user_version').get() as Row).user_version]);

    const schema = db
      .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
      .all() as Row[];
    for (const r of schema) feed([r.type, r.name, r.tbl_name, r.sql]);

    for (const r of schema) {
      if (r.type !== 'table' || /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(String(r.sql))) continue;
      const name = String(r.name);
      const cols = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Row[];
      const order = cols.map((_, i) => i + 1).join(', ');
      feed([name]);
      const stmt = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${order}`);
      stmt.setReadBigInts(true);
      for (const row of stmt.iterate()) feed(Object.values(row as Row));
    }
    return hash.digest('hex');
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    for (const p of process.argv.slice(2)) console.log(`${dbContentHash(p)}  ${p}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
