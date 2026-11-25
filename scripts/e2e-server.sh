#!/usr/bin/env bash
# Builds the app and runs web + worker against a throwaway database for browser tests.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=production E2E_BUILD=1
export DATABASE_URL=${E2E_DATABASE_URL:-postgres://localhost/event_photos_e2e}
export APP_URL=${E2E_APP_URL:-http://localhost:3200} APP_SECRET=e2e-secret-e2e-secret-e2e-secret-000
export STORAGE_DRIVER=disk STORAGE_DIR=.data/e2e-storage ALLOW_LOCAL_DRIVERS=1
export MAIL_OUTBOX_FILE=.data/e2e-mail.jsonl REPORT_EMAIL=report@example.test
export TRUSTED_PROXY_HOPS=0
case "$DATABASE_URL" in *event_photos_e2e) ;; *) echo "Refusing to reset $DATABASE_URL" >&2; exit 1 ;; esac
mkdir -p .data && rm -rf .data/e2e-storage && : > .data/e2e-mail.jsonl
psql "$DATABASE_URL" -qc 'drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public' 2>/dev/null
npx tsx scripts/migrate.ts
[ "${E2E_SKIP_BUILD:-}" = 1 ] || npx next build
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
if [ -f src/jobs/worker.ts ]; then npx tsx src/jobs/worker.ts & pids+=($!); fi
npx next start -p "${E2E_PORT:-3200}" & pids+=($!)
wait
