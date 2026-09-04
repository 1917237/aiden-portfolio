# Supabase

## Layout

| Path | Purpose |
|------|---------|
| `baseline/baseline.sql` | **One-file** schema dump of the live project (generate once — see below) |
| `migrations/` | New changes only, after the baseline (`50-…`, `51-…`) |
| `archive/migrations-01-49/` | Historical step-by-step SQL (do not re-run on the live DB) |
| `functions/` | Edge functions (`calendar-feed`, `invite-student`) |

## Live project (already has data)

Your current Supabase project already applied `01`–`49`. **Do not** re-run the archive files there.

Going forward:

1. Generate `baseline/baseline.sql` from the live DB (snapshot of “what production is”).
2. Put any *new* SQL in `migrations/` and run those in the SQL Editor once.

## New empty project / disaster recovery

1. Create a new Supabase project.
2. Paste/run `baseline/baseline.sql` in the SQL Editor (or via `psql`).
3. Deploy edge functions under `functions/`.
4. Set Auth Site URL + redirect URLs to your domain.
5. Point the website env vars at the new project.

## Generate the baseline (do this next)

See [`baseline/README.md`](./baseline/README.md). Helper script: [`../scripts/dump-supabase-baseline.sh`](../scripts/dump-supabase-baseline.sh).
