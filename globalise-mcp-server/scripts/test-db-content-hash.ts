/**
 * Tests for dbContentHash (db-content-hash.ts).
 *
 * Failure modes guarded:
 *  - insertion/rowid order changes the hash (same data, different build order);
 *  - ANALYZE output (sqlite_stat*) changes the hash, so CI would flag a SQLite
 *    build difference as a data difference;
 *  - a real difference goes unseen: a changed TEXT value, an extra row, a changed
 *    BLOB byte, a schema change with identical rows, a user_version change;
 *  - the hash is unstable between calls, or a missing file does not throw.
 *
 * Run with: npm run test:db-content-hash
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, finish, safe } from './test-utils.js';
import { dbContentHash } from './db-content-hash.js';

const dir = mkdtempSync(join(tmpdir(), 'gl-hash-'));

interface Opts {
  order?: number[];
  analyze?: boolean;
  text?: string;
  extraRow?: boolean;
  blobByte?: number;
  extraColumn?: boolean;
  userVersion?: number;
}

function make(name: string, o: Opts = {}): string {
  const path = join(dir, `${name}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE t (a INTEGER, b TEXT, c BLOB${o.extraColumn ? ', d TEXT' : ''});
    CREATE INDEX t_b ON t(b);
    CREATE VIRTUAL TABLE f USING fts5(body);`);
  const ins = db.prepare('INSERT INTO t (a, b, c) VALUES (?, ?, ?)');
  const fts = db.prepare('INSERT INTO f (rowid, body) VALUES (?, ?)');
  for (const i of o.order ?? [1, 2, 3]) {
    const text = i === 2 && o.text ? o.text : `row ${i}`;
    ins.run(i, text, new Uint8Array([i, 0, i === 3 && o.blobByte !== undefined ? o.blobByte : 7]));
  }
  // FTS5 segment layout depends on insert order by design; build order is fixed.
  for (const i of [1, 2, 3]) fts.run(i, `body ${i}`);
  if (o.extraRow) ins.run(4, 'row 4', new Uint8Array([4]));
  if (o.analyze ?? true) db.exec('ANALYZE');
  if (o.userVersion !== undefined) db.exec(`PRAGMA user_version = ${o.userVersion}`);
  db.close();
  return path;
}

const a = make('a');
const b = make('b', { order: [3, 2, 1], analyze: false });
const c = make('c');
{
  // Only planner statistics differ.
  const db = new DatabaseSync(c);
  db.exec(`DELETE FROM sqlite_stat1; INSERT INTO sqlite_stat1 VALUES ('t', NULL, '99')`);
  db.close();
}
const hashA = dbContentHash(a);

check(dbContentHash(a) === hashA, 'hash is stable across calls');
check(dbContentHash(b) === hashA, 'insertion order and missing ANALYZE do not change the hash');
check(dbContentHash(c) === hashA, 'sqlite_stat* contents do not change the hash');
check(dbContentHash(make('d', { text: 'changed' })) !== hashA, 'a changed TEXT value changes the hash');
check(dbContentHash(make('e', { extraRow: true })) !== hashA, 'an extra row changes the hash');
check(dbContentHash(make('f', { blobByte: 8 })) !== hashA, 'a changed BLOB byte changes the hash');
check(dbContentHash(make('g', { extraColumn: true })) !== hashA, 'a schema change with identical rows changes the hash');
check(dbContentHash(make('h', { userVersion: 9 })) !== hashA, 'a user_version change changes the hash');

check(safe(() => (dbContentHash(join(dir, 'missing.sqlite')), false), true), 'a missing file throws');

rmSync(dir, { recursive: true, force: true });
finish('db-content-hash');
