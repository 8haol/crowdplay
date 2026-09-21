#!/usr/bin/env bash
# 隐喻词只允许写在文案字典里。
set -euo pipefail
cd "$(dirname "$0")/.."
words='人生护照|LIFE PASSPORT|Life Passport|人生事件|人生盲盒|LIFE EVENT|Grace Token|GRACE TOKEN|恩典站|人生编号|LIFE NO|开始游戏|站挑战|独立同行|二人同行|三人同行|JOURNEY COMPLETE|天选之子|时运不济|人生过山车|波澜不惊|最快通关'
hits=$(grep -rnE "$words" web/src/play web/src/screen web/src/staff web/src/lib/ui.tsx web/src/lib/JoinQr.tsx \
  | grep -v 'previewData.ts' || true)
if [ -n "$hits" ]; then echo "$hits"; echo "FAIL: hard-coded copy above"; exit 1; fi
echo "copy OK"
