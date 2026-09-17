#!/usr/bin/env bash
# One-shot local production deploy (build here, static upload to Vercel).
set -euo pipefail
cd "$(dirname "$0")/.."

ORG_ID="$(python3 -c 'import json;print(json.load(open(".vercel/repo.json"))["projects"][0]["orgId"])')"
PROJECT_ID="$(python3 -c 'import json;print(json.load(open(".vercel/repo.json"))["projects"][0]["id"])')"
TOKEN="$(python3 -c 'import json;from pathlib import Path;a=json.loads(Path.home().joinpath("Library/Application Support/com.vercel.cli/auth.json").read_text());print(a.get("token") or a.get("accessToken"))')"
export TOKEN ORG_ID PROJECT_ID
export VERCEL_ORG_ID="$ORG_ID" VERCEL_PROJECT_ID="$PROJECT_ID" VERCEL_TOKEN="$TOKEN"
export NODE_OPTIONS=--max-old-space-size=6144

echo "Disabling remote build on project..."
curl -sS -X PATCH "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${ORG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"framework":null,"buildCommand":"","installCommand":"","outputDirectory":"","commandForIgnoringBuildStep":"exit 0"}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print({k:d.get(k) for k in ("framework","buildCommand","installCommand","commandForIgnoringBuildStep")})'

echo "Cancelling stuck deployments..."
python3 - <<'PY'
import json, os, urllib.request
token=os.environ["TOKEN"]; org=os.environ["ORG_ID"]; project=os.environ["PROJECT_ID"]
req=urllib.request.Request(
  f"https://api.vercel.com/v6/deployments?projectId={project}&teamId={org}&limit=10",
  headers={"Authorization":f"Bearer {token}"},
)
deps=json.loads(urllib.request.urlopen(req).read().decode()).get("deployments",[])
for d in deps:
  state=d.get("readyState") or d.get("state"); uid=d["uid"]
  print(uid, state)
  if state in ("BUILDING","QUEUED","INITIALIZING","ANALYZING"):
    r=urllib.request.Request(
      f"https://api.vercel.com/v12/deployments/{uid}/cancel?teamId={org}",
      data=b"{}", method="PATCH",
      headers={"Authorization":f"Bearer {token}","Content-Type":"application/json"},
    )
    try:
      urllib.request.urlopen(r); print("cancelled", uid)
    except Exception as e:
      print("cancel failed", uid, e)
PY

echo "Building..."
npm ci
npm run build
mkdir -p .vercel
printf '%s\n' "{\"orgId\":\"${ORG_ID}\",\"projectId\":\"${PROJECT_ID}\"}" > .vercel/project.json
cp vercel.json dist/vercel.json

echo "Deploying dist..."
npx vercel deploy dist --prod --yes --token="$TOKEN"
