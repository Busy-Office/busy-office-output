/**
 * Migration runner for the document registry's SQLite schema — one row
 * per artifact, migration in repo. Real, versioned migrations — not an inline CREATE TABLE — so the
 * schema has a history and `serve` can evolve a real on-disk database across
 * releases without hand-editing it.
 *
 * Mechanism: plain numbered `.sql` files under packages/runtime/migrations/
 * (`0001_init.sql`, `0002_...sql`, ...), applied in filename order inside a
 * transaction each, tracked in a `schema_migrations` table so a migration
 * already applied is never re-run. This runs on every `SqliteRegistryStore`
 * construction (including in tests against `:memory:`), which is what makes
 * a fresh `:memory:` database usable at all — there is no separate "run
 * migrations" step in single-process mode (CLAUDE.md: single-process is
 * sacred; nothing about it requires an external migration command).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

/** packages/runtime/migrations, resolved relative to this source file. */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

interface MigrationFile {
  version: number;
  filename: string;
  sql: string;
}

function loadMigrations(migrationsDir: string): MigrationFile[] {
  const filenames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  return filenames.map((filename) => {
    const match = /^(\d+)_/.exec(filename);
    if (!match) {
      throw new Error(
        `Migration filename "${filename}" does not start with a numeric version prefix (e.g. "0001_init.sql").`,
      );
    }
    return {
      version: Number.parseInt(match[1], 10),
      filename,
      sql: readFileSync(join(migrationsDir, filename), 'utf8'),
    };
  });
}

/**
 * Apply every migration in `migrationsDir` not yet recorded in
 * `schema_migrations`, in ascending version order. Idempotent: safe to call
 * on every store construction, including against an already-migrated file.
 */
export function runMigrations(db: DatabaseSync, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      filename    TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  const migrations = loadMigrations(migrationsDir).sort((a, b) => a.version - b.version);
  const recordApplied = db.prepare(
    'INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      recordApplied.run(migration.version, migration.filename, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.filename} failed: ${(err as Error).message}`, { cause: err });
    }
  }
}
