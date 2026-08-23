// Daily SQLite backup for Homin.
// Uses "VACUUM INTO" which produces a consistent snapshot even while the
// API server keeps writing to the live database (WAL-safe).
//
// Usage: node scripts/backup-db.mjs
// Backups land in server/data/backups/, oldest ones are pruned.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'homing.db');
const KEEP = 14;

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(BACKUP_DIR, `homing-${stamp}.db`);

const db = new DatabaseSync(DB_PATH);
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const size = statSync(target).size;
console.log(`[backup] ${target} (${(size / 1024).toFixed(1)} KB)`);

// Prune older backups beyond KEEP
const files = readdirSync(BACKUP_DIR)
  .filter((f) => /^homing-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.test(f))
  .sort();
for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
  rmSync(path.join(BACKUP_DIR, f));
  console.log(`[backup] pruned ${f}`);
}
