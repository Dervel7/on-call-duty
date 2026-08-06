import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { pino } from 'pino';

config({ path: resolve(import.meta.dirname, '../../apps/api/.env') });

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: { target: 'pino-pretty' },
});

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set or empty');
  }
  return url;
}

async function runSqlFile(client: Client, fileUrl: URL): Promise<void> {
  const content = await readFile(fileUrl, 'utf8');
  const statements = content
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  try {
    await client.connect();
    log.info('applying seed');
    await runSqlFile(client, new URL('../seed.sql', import.meta.url));
    log.info('seed complete');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  log.error({ err }, 'seed failed');
  process.exit(1);
});
