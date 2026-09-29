import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: resolve(import.meta.dirname, '../../apps/api/.env') });

interface ExclusionRow {
  username: string;
  email: string;
  start_date: string;
  end_date: string;
  is_disabled: boolean;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set or empty');
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<ExclusionRow>(`
      SELECT
        u.username,
        u.email,
        to_char(x.start_date, 'YYYY-MM-DD') AS start_date,
        to_char(x.end_date, 'YYYY-MM-DD')   AS end_date,
        x.is_disabled
      FROM unavailability x
      JOIN doctors d ON d.id = x.doctor_id
      JOIN users u   ON u.id = d.user_id
      WHERE u.is_deleted = FALSE
      ORDER BY u.username, x.start_date, x.end_date
    `);

    if (rows.length === 0) {
      console.log('No exclusions found.');
      return;
    }

    console.table(
      rows.map((r) => ({
        doctor: r.username,
        start: r.start_date,
        end: r.end_date,
        disabled: r.is_disabled,
      })),
    );

    console.log('');
    console.log('-- Ready-to-paste block for single-clinic.seed.sql:');
    console.log('INSERT INTO unavailability (doctor_id, start_date, end_date, is_disabled)');
    console.log('SELECT d.id, w.start_date, w.end_date, w.is_disabled');
    console.log('FROM (VALUES');
    console.log(
      rows
        .map(
          (r) =>
            `  ('${r.email}', DATE '${r.start_date}', DATE '${r.end_date}', ${r.is_disabled})`,
        )
        .join(',\n'),
    );
    console.log(') AS w(email, start_date, end_date, is_disabled)');
    console.log('JOIN users u ON u.email = w.email AND u.is_deleted = FALSE');
    console.log('JOIN doctors d ON d.user_id = u.id');
    console.log('WHERE NOT EXISTS (');
    console.log('  SELECT 1 FROM unavailability x');
    console.log('  WHERE x.doctor_id = d.id AND x.start_date = w.start_date AND x.end_date = w.end_date');
    console.log(');');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
