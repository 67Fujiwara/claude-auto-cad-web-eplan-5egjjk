#!/bin/sh
# ElectraCAD Studio 回帰テスト。Playwright (playwright-core) で index.html を開いて確かめる。
#   使い方: sh tests/run.sh      (Chrome の場所は CHROME で上書きできる)
set -e
cd "$(dirname "$0")"
# Chrome の既定 (chromium-1194) が無い環境では、Playwright が置いた最新の chromium を使う
if [ -z "$CHROME" ] && [ ! -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ] && [ -x /opt/pw-browsers/chromium ]; then
  CHROME=/opt/pw-browsers/chromium; export CHROME
fi
if ! node -e "import('playwright-core')" 2>/dev/null; then
  echo "playwright-core が入っていません: tests/ で npm install してください (npm i)"
  exit 2
fi
fail=0
for t in *.mjs; do
  printf '%-28s' "$t"
  if node "$t" > "/tmp/ecad-test-$t.log" 2>&1; then echo "ok"; else echo "FAIL"; tail -5 "/tmp/ecad-test-$t.log"; fail=1; fi
done
exit $fail
