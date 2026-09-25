# Seeds

This folder holds the idempotent baseline seeds for the Doctor On-Call Duty
database. Both seeds reset-and-rebuild the same schema; they only differ in how
many clinics they create.

| File | Baseline |
|---|---|
| `single-clinic.seed.sql` | One clinic (`Main Clinic`) with the full staff: 1 administrator, 9 doctors (dr1–dr9), plus the vendor superadmin |
| `multi-clinic.seed.sql` | Six clinics with distributed staff |

---

## How to run `single-clinic.seed.sql`

### Option 1 — Recommended: the seed script (resets the database)

This is the standard way. It **drops and recreates the target database**, applies
`database/schema.sql`, then applies the seed. Use it for a fresh, deterministic
setup.

**Prerequisites**

1. Node >= 20 and pnpm >= 10.
2. A running PostgreSQL server (default dev expectation: `localhost:5432`).
3. `apps/api/.env` exists (copy from `apps/api/.env.example`) and its
   `DATABASE_URL` points at the database to seed, e.g.
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/oncall`.
   The seed script reads `DATABASE_URL` from that file — not from your shell.
4. Dependencies installed: `pnpm install` (from the repository root).

**Steps**

1. Open a terminal in the repository root.
2. Run:

   ```powershell
   pnpm db:seed:single
   ```

3. Wait for the log lines `applying schema` → `applying seed` → `seed complete`.

> **Warning:** this deletes all data in the target database (`DROP DATABASE` +
> `CREATE DATABASE`). To switch baselines later, run `pnpm db:seed:multi` the
> same way.

### Option 2 — Manual: run the SQL file with `psql`

Use this to apply only the seed SQL to an existing database, without the
automatic reset.

1. Make sure the schema exists first — the seed inserts into tables created by
   `database/schema.sql`. On a fresh database, apply the schema first:

   ```powershell
   psql -U postgres -c "DROP DATABASE IF EXISTS oncall WITH (FORCE);"
   psql -U postgres -c "CREATE DATABASE oncall;"
   psql -U postgres -d oncall -f database/schema.sql
   ```

2. Apply the seed:

   ```powershell
   psql -U postgres -d oncall -f database/seeds/single-clinic.seed.sql
   ```

   Adjust `-U` (user) and the database name to match your `DATABASE_URL`. Add
   `-h` / `-p` if the server is not on `localhost:5432`.

3. Every statement is an idempotent upsert, so re-running the seed file is
   safe. Unlike Option 1 it does **not** wipe pre-existing rows, so it is not a
   full reset (e.g. leftover rows from the multi-clinic baseline would remain).

### Verify the result

```powershell
psql -U postgres -d oncall -c "SELECT email, role, clinic_id FROM users WHERE is_deleted = FALSE ORDER BY role, email;"
psql -U postgres -d oncall -c "SELECT count(*) AS doctors FROM doctors;"
```

Expected after `single-clinic.seed.sql`: 11 users (1 superadmin, 1
administrator, 9 doctors) and 9 doctor records.

---

## Seeded accounts (password: `changeme123` — change on first login)

| Email | Username | Role |
|---|---|---|
| `superadmin@oncall.local` | `superadmin` | Superadmin |
| `admin@oncall.local` | `admin` | Administrator |
| `dr1@oncall.local` … `dr9@oncall.local` | `dr1` … `dr9` | Doctor |

Sample unavailability rows are generated deterministically (window: September
2026); `dr3` and `dr8` arrive with disabled unavailability records.
