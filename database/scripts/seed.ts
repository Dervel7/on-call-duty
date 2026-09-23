import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { pino } from 'pino';
import { runSqlFile } from './run-sql-file';

config({ path: resolve(import.meta.dirname, '../../apps/api/.env') });

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: { target: 'pino-pretty' },
});

const SEEDS: Record<string, string> = {
  'single-clinic': '../seeds/single-clinic.seed.sql',
  'multi-clinic': '../seeds/multi-clinic.seed.sql',
};

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set or empty');
  }
  return url;
}

// Reset the target database (drop + recreate), then apply schema + the
// chosen seed. Resetting on every run makes switching between the single-
// and multi-clinic baselines deterministic: upserts alone would leave the
// previous baseline's rows behind.
async function main(): Promise<void> {
  const seedName = process.argv[2] ?? '';
  const seedFile = SEEDS[seedName];
  if (!seedFile) {
    throw new Error(`Unknown seed "${seedName}". Expected one of: ${Object.keys(SEEDS).join(', ')}`);
  }

  const url = requireDatabaseUrl();
  const dbName = new URL(url).pathname.replace(/^\/+/, '');
  // Identifiers cannot be parameterized; restrict to safe characters and
  // quote, so the DDL below can never be injected through DATABASE_URL.
  if (!/^[A-Za-z0-9_]+$/.test(dbName) || dbName.length > 63) {
    throw new Error(`Unsafe database name in DATABASE_URL: "${dbName}"`);
  }

  const admin = new Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    log.info({ database: dbName }, 'resetting database');
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    log.info('applying schema');
    await runSqlFile(client, new URL('../schema.sql', import.meta.url));
    log.info({ seed: seedName }, 'applying seed');
    await runSqlFile(client, new URL(seedFile, import.meta.url));
    log.info({ database: dbName, seed: seedName }, 'seed complete');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  log.error({ err }, 'seed failed');
  process.exit(1);
});
