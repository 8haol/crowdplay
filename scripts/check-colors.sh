#!/usr/bin/env bash
# UI literals belong in @theme; team/player colours remain data in types.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

find web/src -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) -exec awk '
  FNR == 1 { theme = 0 }
  FILENAME == "web/src/index.css" && /^@theme([[:space:]]|$)/ { theme = 1 }
  theme && /^}/ { theme = 0 }
  FILENAME == "web/src/lib/types.ts" { next }
  theme && /^[[:space:]]+--color-[a-z0-9-]+:[[:space:]]*#[[:xdigit:]]+;[[:space:]]*$/ { next }
  /#[[:xdigit:]]{3,8}([^[:xdigit:]]|$)|rgba?\([[:space:]]*[0-9]/ {
    print FILENAME ":" FNR ":" $0
    failed = 1
  }
  END { if (failed) exit 1 }
' {} + && echo 'colours OK' || { echo 'FAIL: hard-coded colours above'; exit 1; }
