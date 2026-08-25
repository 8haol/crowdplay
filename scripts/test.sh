#!/usr/bin/env bash
# Run every SQL test in supabase/tests/ against the local Supabase database.
# Tests are transactional (begin ... rollback) and leave no data behind.
#
# Usage:
#   ./scripts/test.sh                 # against local `supabase start` stack
#   DATABASE_URL=postgres://... ./scripts/test.sh   # against any Postgres
#
# Requires either psql on PATH, or Docker (uses the supabase_db container).
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

run_sql() {
  if command -v psql > /dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"
  else
    local container
    container=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)
    if [ -z "$container" ]; then
      echo "No psql and no running supabase_db container. Run 'npx supabase start' first." >&2
      exit 1
    fi
    docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1"
  fi
}

fail=0
for f in supabase/tests/*.sql; do
  echo "=== $f"
  if run_sql "$f"; then
    echo "    OK"
  else
    echo "    FAILED: $f" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "SOME TESTS FAILED" >&2
  exit 1
fi
echo "ALL TESTS PASSED"
