#!/usr/bin/env bash
# Dump live Supabase public schema into supabase/baseline/baseline.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/supabase/baseline/baseline.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to your Supabase Postgres URI first."
  echo "Example:"
  echo "  export DATABASE_URL='postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres'"
  echo "Then:"
  echo "  ./scripts/dump-supabase-baseline.sh"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. On macOS:"
  echo "  brew install libpq && brew link --force libpq"
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

{
  echo "-- Tutoring app schema baseline"
  echo "-- Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "-- Source: live Supabase (pg_dump --schema-only)"
  echo "-- Do not re-run archive/migrations-01-49 on a DB that already has this schema."
  echo ""
  pg_dump \
    --schema-only \
    --no-owner \
    --no-privileges \
    --schema=public \
    "$DATABASE_URL"
} >"$OUT"

echo "Wrote $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
echo "Review the file, then commit it."
