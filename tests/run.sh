#!/bin/sh
# ElectraCAD Studio 回帰テスト。Playwright (playwright-core) で index.html を開いて確かめる。
#   使い方: sh tests/run.sh      (Chrome の場所は CHROME で上書きできる)
set -e
cd "$(dirname "$0")"
fail=0
for t in *.mjs; do
  printf '%-28s' "$t"
  if node "$t" > "/tmp/ecad-test-$t.log" 2>&1; then echo "ok"; else echo "FAIL"; tail -5 "/tmp/ecad-test-$t.log"; fail=1; fi
done
exit $fail
