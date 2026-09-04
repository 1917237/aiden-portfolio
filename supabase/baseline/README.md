# Database baseline

`baseline.sql` is the **single** schema file for this tutoring app: tables, functions, triggers, RLS, grants — matching the live Supabase project after all archived migrations through `49`.

It is **not** checked in until you generate it from your project (so we don’t invent a fake dump).

## Option A — script (recommended)

1. In Supabase: **Project Settings → Database → Connection string → URI**  
   Use the **direct** connection (port `5432`), not the pooler, for dumps when possible.  
   Copy the URI (replace `[YOUR-PASSWORD]` with the DB password).
2. Install Postgres client tools once (macOS):

   ```bash
   brew install libpq
   brew link --force libpq
   ```

   Confirm: `which pg_dump`

3. From the repo root:

   ```bash
   export DATABASE_URL='postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres'
   ./scripts/dump-supabase-baseline.sh
   ```

4. Commit `supabase/baseline/baseline.sql` when it looks right.

## Option B — Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase db dump -f supabase/baseline/baseline.sql
```

## If dump fails: “could not translate host name” / unknown host

Supabase **direct** hosts (`db.….supabase.co`) are often **IPv6-only**. Many Macs/Wi‑Fi networks can’t resolve or reach them.

**Fix:** use the **Session pooler** URI instead (Connect → Session pooler):

```text
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

Notes:

- User is `postgres.PROJECT_REF` (not just `postgres`).
- Prefer **Session** mode / port **5432** for `pg_dump` (not Transaction / 6543).
- Keep the whole URI in **single quotes** in Terminal.


| Included | Usually not included |
|----------|----------------------|
| Tables, columns, indexes | Your **student rows** / real data |
| Functions, triggers, RLS | Auth users (managed by Supabase Auth) |
| Grants on public schema | Storage buckets, secrets, edge function code |

Data stays in the live project. The baseline is for **recreating the structure** on a new project or documenting production.

## After the baseline exists

- Archive under `../archive/migrations-01-49/` is history only.
- New features → `../migrations/50-your-change.sql` (run on live, then keep in git).
