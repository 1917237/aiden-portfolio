# Database baseline

`baseline.sql` is the **single** schema file for this tutoring app: tables, functions, triggers, RLS, grants.

It matches production structure through late-cancel waive inbox support.

## Option A — script (recommended)

1. In Supabase: **Project Settings → Database → Connection string → URI**  
   Prefer the **Session pooler** URI if direct `db.*` fails DNS (IPv6).  
   Copy the URI (replace `[YOUR-PASSWORD]` with the DB password).
2. Install Postgres client tools once (macOS):

   ```bash
   brew install libpq
   brew link --force libpq
   ```

   Confirm: `which pg_dump`

3. From the repo root:

   ```bash
   export DATABASE_URL='postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres'
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

Use the **Session pooler** URI (Connect → Session pooler):

```text
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

## What’s in the dump

| Included | Usually not included |
|----------|----------------------|
| Tables, columns, indexes | Your **student rows** / real data |
| Functions, triggers, RLS | Auth users (managed by Supabase Auth) |
| Grants on public schema | Storage buckets, secrets, edge function code |

Data stays in the live project. The baseline is for **recreating the structure** on a new project.

## After regenerating

- Keep archive `01`–`49` as history only.
- Put brand-new changes in `../migrations/50-….sql`, run on live, then fold into baseline (or re-dump) so you stay on one schema file.
