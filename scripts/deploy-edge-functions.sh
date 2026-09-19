#!/usr/bin/env bash
# Deploy tutoring edge functions to the live Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${SUPABASE_PROJECT_REF:-dntujelwmbypgtxnhyin}"
SITE_URL="${SITE_URL:-https://aidenluo.com}"

echo "Deploying invite-student (+ calendar-feed) to $REF ..."
npx supabase login
npx supabase secrets set "SITE_URL=${SITE_URL}" --project-ref "$REF"
npx supabase functions deploy invite-student --project-ref "$REF"
npx supabase functions deploy calendar-feed --project-ref "$REF"
echo "Done. Try Invite student again on the tutoring admin page."
