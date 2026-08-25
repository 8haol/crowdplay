#!/usr/bin/env bash
# One-command release gate. Requires a running local Supabase stack.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/3] Frontend lint"
npm --prefix web run lint

echo "[2/3] Production build"
npm --prefix web run build

echo "[3/3] Database regression suite"
bash scripts/test.sh

echo "PREFLIGHT PASSED"
