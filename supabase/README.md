# Supabase

## Layout

| Path | Purpose |
|------|---------|
| `baseline/baseline.sql` | **One-file** schema for a new project (or disaster recovery) |
| `migrations/` | Empty until the next change after this baseline |
| `archive/migrations-01-49/` | Historical step-by-step SQL (do not re-run on the live DB) |
| `functions/` | Edge functions (`calendar-feed`, `invite-student`) |

## Live project (already has data)

Your current Supabase project already applied archive `01`–`49`. **Do not** re-run the archive or the full baseline there.

If late-cancel waive columns are not on live yet, scroll to the bottom of `baseline/baseline.sql` and run only the section:

**“Late-cancel waive inbox …”**

once in the SQL Editor (it is idempotent).

## New empty project / domain go-live DB

1. Create a new Supabase project.
2. Paste/run **all** of `baseline/baseline.sql` in the SQL Editor (or via `psql`).
3. Deploy edge functions under `functions/`.
4. Set Auth Site URL + redirect URLs to your domain.
5. Point the website env vars at the new project.

## Regenerate the baseline later

See [`baseline/README.md`](./baseline/README.md). Helper: [`../scripts/dump-supabase-baseline.sh`](../scripts/dump-supabase-baseline.sh).
