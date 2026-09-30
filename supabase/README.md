# Supabase

## Layout

| Path | Purpose |
|------|---------|
| `baseline/baseline.sql` | **One-file** schema for a new project (or disaster recovery) |
| `migrations/` | Empty until the next change after this baseline |
| `archive/migrations-01-49/` | Historical step-by-step SQL (do not re-run on the live DB) |
| `functions/` | Edge functions (`calendar-feed`, `google-calendar`, `invite-student`) |

### `calendar-feed` (Google / Apple subscribe)

Calendar apps fetch the ICS URL **without** a login header. That function must allow public access, secured only by the private `?token=` query param:

1. Supabase Dashboard → **Edge Functions** → **calendar-feed** → Details / configuration  
2. Turn **off** “Verify JWT” (or “Verify JWT with legacy secret”)  
3. Or deploy with:  
   `npx supabase functions deploy calendar-feed --project-ref <ref> --no-verify-jwt`

See `[functions.calendar-feed] verify_jwt = false` in `config.toml`.

### `google-calendar` (instant sync)

Every booking change pings this function (via `pg_net` triggers from migration 56). It creates, moves or deletes the lesson in the admin's Google Calendar with the student as a guest (`sendUpdates=all`, so Google emails them). Event ids are the booking uuid without dashes.

One-time setup:

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project → **APIs & Services → Library** → enable **Google Calendar API**.
2. **OAuth consent screen** → External → add your email as a test user → then **Publish app** (Testing mode refresh tokens expire after 7 days).
3. **Credentials → Create credentials → OAuth client ID** → Web application → Authorized redirect URI:  
   `https://dntujelwmbypgtxnhyin.supabase.co/functions/v1/google-calendar/callback`
4. Set secrets and deploy (JWT verification off; the function checks admin sessions and the sync secret itself):  
   `npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... SITE_URL=https://aidenluo.com --project-ref dntujelwmbypgtxnhyin`  
   `npx supabase functions deploy google-calendar --project-ref dntujelwmbypgtxnhyin --no-verify-jwt`
5. Run `migrations/56-google-calendar-sync.sql`, then on `/tutoring/calendar` click **Connect Google Calendar**.

## Live project (already has data)

Your current Supabase project already applied archive `01`–`49`. **Do not** re-run the archive or the full baseline there.

If late-cancel waive columns are not on live yet, scroll to the bottom of `baseline/baseline.sql` and run only the section:

**“Late-cancel waive inbox …”**

once in the SQL Editor (it is idempotent).

**Portfolio CMS:** run `migrations/50-portfolio-cms.sql` once in the SQL Editor so the Portfolio admin tab can save site/projects/media. If Seed fails with `permission denied … 42501`, also run `migrations/51-portfolio-grants.sql`.

## New empty project / domain go-live DB

1. Create a new Supabase project.
2. Paste/run **all** of `baseline/baseline.sql` in the SQL Editor (or via `psql`).
3. Deploy edge functions under `functions/`.
4. Set Auth Site URL + redirect URLs to your domain.
5. Point the website env vars at the new project.

## Regenerate the baseline later

See [`baseline/README.md`](./baseline/README.md). Helper: [`../scripts/dump-supabase-baseline.sh`](../scripts/dump-supabase-baseline.sh).
