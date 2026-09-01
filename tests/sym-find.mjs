/* 作ったシンボルが「見当たらない」を防ぐ。

   データベースの棚はパレットに追加 (ピン) した記号しか出さないため、
   別の PC で作った図面を開いたときや棚の削除・ピンの喪失で、
   機器は描けるのに記号が探せなくなることがあった。

   ・mergePin  : 自作シンボルを同梱した図面を開くと、その記号が自動で
                 パレットへ出る (ピンされる)
   ・healPin   : 辞書には有るのにピンが外れている記号も、それを使う図面を
                 開き直せばパレットへ戻る
   ・searchAll : 検索中はピンの有無によらず全記号から探せる。検索を消せば
                 棚は従来どおり (ピンだけ)
   ・revive    : 退役印つきの版だけを同梱した図面 (過去の付け替えの名残) を
                 開くと、元 id に生きた定義が無ければ退役を解いてパレットに出す
   ・keepRetired: 元 id に生きた定義があるときは図面の版は退役のまま、
                 パレットには生きた側が出る (ライブラリ優先) */
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

  /* ── 退役印つきの版だけを同梱した図面 (実際に報告のあった形) ── */
  const orphan = { ...mkSym("usr_zz1~2", "退役版インバータ"), verOf: "usr_zz1", retired: true };
  const proj2 = newProject("退役救済");
  const pgz = proj2.pages.find(pg => !pg.kind);
  pgz.devices.push({ id: "dz1", sym: "usr_zz1~2", x: 100, y: 100, tag: "-INV9" });
  proj2.symbols = [orphan];
  App.project = JSON.parse(JSON.stringify(proj2));
  mergeProjectSymbols();
  UI.buildPalette();
  out.revive = {
    retired: !!(SYMBOLS_BY_ID["usr_zz1~2"] || {}).retired,
    inPalette: document.getElementById("symTree").textContent.includes("退役版インバータ"),
    pinned: dbPinnedList().includes("usr_zz1~2"),
  };

  /* ── 元 id に生きた定義があるとき: 版は退役のまま、生きた側が出る ── */
  const live = mkSym("usr_zz2", "生きてる方");
  DB_SYMBOLS.push(live); SYMBOLS_BY_ID[live.id] = live;
  const older = { ...mkSym("usr_zz2~2", "生きてる方"), verOf: "usr_zz2", retired: true,
    body: '<rect x="-4" y="5" width="8" height="10"/>' };
  const proj3 = newProject("退役維持");
  const pgy = proj3.pages.find(pg => !pg.kind);
  pgy.devices.push({ id: "dy1", sym: "usr_zz2~2", x: 100, y: 100, tag: "-INV8" });
  proj3.symbols = [older];
  App.project = JSON.parse(JSON.stringify(proj3));
  mergeProjectSymbols();
  UI.buildPalette();
  out.keepRetired = {
    retired: !!(SYMBOLS_BY_ID["usr_zz2~2"] || {}).retired,
    livePinned: dbPinnedList().includes("usr_zz2"),
    verNotPinned: !dbPinnedList().includes("usr_zz2~2"),
  };

  // 後片付け
  dbSetPinned(dbPinnedList().filter(x => !/^usr_(findme1|zz)/.test(x)));
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  mergePin: R.mergePin.pinned === true && R.mergePin.inPalette === true,
  healPin: R.healPin.gone === true && R.healPin.back === true,
  searchAll: R.searchAll.hidden === true && R.searchAll.found === true && R.searchAll.hiddenAgain === true,
  revive: R.revive.retired === false && R.revive.inPalette === true && R.revive.pinned === true,
  keepRetired: R.keepRetired.retired === true && R.keepRetired.livePinned === true
    && R.keepRetired.verNotPinned === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("sym-find OK");
