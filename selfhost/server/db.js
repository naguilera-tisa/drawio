import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL no está definida');
  }
  return new pg.Pool({ connectionString });
}

// Migraciones idempotentes; gen_random_uuid() es nativo desde PostgreSQL 13.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS diagrams (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     title       text NOT NULL DEFAULT 'Sin título',
     xml         text NOT NULL DEFAULT '',
     thumbnail   text,
     owner_id    text,
     version     integer NOT NULL DEFAULT 1,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now(),
     deleted_at  timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS diagram_versions (
     id          bigserial PRIMARY KEY,
     diagram_id  uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
     version     integer NOT NULL,
     xml         text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS diagrams_updated_idx ON diagrams (updated_at DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS diagram_versions_idx ON diagram_versions (diagram_id, version DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS diagram_versions_uniq ON diagram_versions (diagram_id, version)`,
];

export async function migrate(pool) {
  for (const sql of MIGRATIONS) {
    await pool.query(sql);
  }
}
