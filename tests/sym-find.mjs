/* 作ったシンボルが「見当たらない」を防ぐ。

   データベースの棚はパレットに追加 (ピン) した記号しか出さないため、
   別の PC で作った図面を開いたときや棚の削除・ピンの喪失で、
   機器は描けるのに記号が探せなくなることがあった。

   ・mergePin  : 自作シンボルを同梱した図面を開くと、その記号が自動で
                 パレットへ出る (ピンされる)
   ・healPin   : 辞書には有るのにピンが外れている記号も、それを使う図面を
                 開き直せばパレットへ戻る
   ・searchAll : 検索中はピンの有無によらず全記号から探せる。検索を消せば
                 棚は従来どおり (ピンだけ) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const mkSym = (id, name) => ({
    id, db: true, group: "自作", cat: "db", letter: "INV", name, nameEn: name,
    desc: "テスト用の自作シンボル", pins: [{ x: 0, y: 0, n: "1" }, { x: 0, y: 20, n: "2" }],
    sim: "none", bounds: [-6, -2, 12, 24], body: '<rect x="-5" y="4" width="10" height="12"/>',
    imported: true, custom: true, nonstd: true,
  });

  // ── 自作シンボル同梱の図面 (別 PC で作った体) を開く ──
  const sym1 = mkSym("usr_findme1", "インバーター 0.1Kw (試験)");
  const proj = newProject("持ち込み");
  const pg0 = proj.pages.find(pg => !pg.kind);
  pg0.devices.push({ id: "dv1", sym: "usr_findme1", x: 100, y: 100, tag: "-INV1" });
  proj.symbols = [sym1];
  dbSetPinned(dbPinnedList().filter(x => x !== "usr_findme1"));
  App.project = JSON.parse(JSON.stringify(proj));
  mergeProjectSymbols();
  UI.buildPalette();
  out.mergePin = {
    pinned: dbPinnedList().includes("usr_findme1"),
    inPalette: document.getElementById("symTree").textContent.includes("インバーター 0.1Kw (試験)"),
  };

  // ── 辞書には有るがピンが外れた記号 → 使っている図面を開き直すと戻る ──
  dbSetPinned(dbPinnedList().filter(x => x !== "usr_findme1"));
  UI.buildPalette();
  out.healPin = { gone: !document.getElementById("symTree").textContent.includes("インバーター 0.1Kw (試験)") };
  mergeProjectSymbols();          // 図面を開いたときに必ず通る道
  UI.buildPalette();
  out.healPin.back = dbPinnedList().includes("usr_findme1")
    && document.getElementById("symTree").textContent.includes("インバーター 0.1Kw (試験)");

  // ── 検索中はピンが無くても見つかる ──
  const sym2 = mkSym("usr_findme2", "特注ブロワ制御器");
  DB_SYMBOLS.push(sym2); SYMBOLS_BY_ID[sym2.id] = sym2;   // ピンはしない
  UI.buildPalette();
  out.searchAll = { hidden: !document.getElementById("symTree").textContent.includes("特注ブロワ制御器") };
  UI.buildPalette("特注ブロワ");
  out.searchAll.found = document.getElementById("symTree").textContent.includes("特注ブロワ制御器");
  UI.buildPalette("");
  out.searchAll.hiddenAgain = !document.getElementById("symTree").textContent.includes("特注ブロワ制御器");

  // 後片付け
  dbSetPinned(dbPinnedList().filter(x => x !== "usr_findme1"));
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  mergePin: R.mergePin.pinned === true && R.mergePin.inPalette === true,
  healPin: R.healPin.gone === true && R.healPin.back === true,
  searchAll: R.searchAll.hidden === true && R.searchAll.found === true && R.searchAll.hiddenAgain === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("sym-find OK");
