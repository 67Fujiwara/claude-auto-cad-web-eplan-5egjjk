/* シンボルの版管理 — 編集しても置いてある機器 (別の案件を含む) の絵は変わらない。

   ・verNew    : 既存シンボルを編集すると同じ id を上書きせず、新しい版
                 (coil~2, verOf="coil") として登録される。規格の coil は不変
   ・placedKeep: 編集より前に置いた機器は元の id のままで、絵も元のまま
   ・addNew    : 編集の後はパレットに新しい版だけが出て、追加するとその版になる
   ・editAgain : もう一度編集すると coil~3。系譜 (verOf) は "coil" のまま
   ・noChange  : 何も変えずに登録しても版は増えない
   ・otherProj : 編集より前に保存した別の案件を開き直しても、規格の絵のまま
                 (編集が別プロジェクトへ波及しない)
   ・legacy    : 旧式データ (同じ id のまま中身が違うシンボルを同梱した図面) を
                 開くと、別の版として取り込み機器を付け替える。ライブラリは不変
   ・carry     : タグ表示などの記号ごとの設定は新しい版へ引き継がれる
   ・retire    : 「元に戻す」で版を退かせるとパレットに規格の記号が戻る。
                 置いてある機器の定義は残る
   ・lsMigrate : 旧式の localStorage (規格 id を上書き保存) は起動時に
                 版へ移される。規格の定義はきれいなまま */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
await p.evaluate(() => localStorage.removeItem("electracad.importedSyms"));

const R = await p.evaluate(async () => {
  const out = {};
  const origBody = SYMBOLS_BY_ID.coil.body;

  // 「別の案件」: 編集より前に保存した図面 (規格の coil を使用)
  App.project = newProject("案件X"); UI.renumberPages();
  let pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  addDevice(pg, "coil", 100, 100, { tag: "-KX" });
  syncProjectSymbols();
  const projX = JSON.stringify(App.project);

  // 今の案件でも coil を 1 つ置いてから編集する
  App.project = newProject("案件Y"); UI.renumberPages();
  pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  const devOld = addDevice(pg, "coil", 100, 100, { tag: "-K1" });
  setSymTagVis("coil", "show");

  // ── 編集 (シンボル編集の画面から登録) ──
  UI.openSymbolEditor("coil");
  SymEdit.shapes.push({ k: "line", pts: [[0, 25], [5, 25]], style: "solid" });
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 80));

  const ver = SYMBOLS_BY_ID["coil~2"];
  out.verNew = { exists: !!ver, verOf: ver && ver.verOf,
    stdKept: SYMBOLS_BY_ID.coil.body === origBody,
    verChanged: !!ver && ver.body !== origBody };
  out.placedKeep = { sym: devOld.sym, body: symOf(devOld.sym).body === origBody };

  const pal = allSymbols().map(s => s.id);
  const devNew = addDevice(pg, "coil~2", 140, 100, { tag: "-K2" });
  out.addNew = { palVer: pal.includes("coil~2"), palStd: pal.includes("coil"),
    newBody: symOf(devNew.sym).body !== origBody };
  out.carry = { tagVis: symTagVis(ver) };

  // ── もう一度編集 → coil~3 ──
  UI.openSymbolEditor("coil~2");
  SymEdit.shapes.push({ k: "line", pts: [[0, 25], [-5, 25]], style: "solid" });
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 80));
  out.editAgain = { exists: !!SYMBOLS_BY_ID["coil~3"],
    verOf: SYMBOLS_BY_ID["coil~3"] && SYMBOLS_BY_ID["coil~3"].verOf };

  // ── 何も変えずに登録 → 版は増えない ──
  UI.openSymbolEditor("coil~3");
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 80));
  out.noChange = { noVer4: !SYMBOLS_BY_ID["coil~4"] };

  // ── 別の案件を開き直す → 規格の絵のまま ──
  App.project = JSON.parse(projX);
  mergeProjectSymbols();
  UI.renumberPages(); App.pageIdx = 0; applySheet(App.project.pages.find(isDrawingPage));
  const dx = App.project.pages.flatMap(p2 => p2.devices).find(d => d.tag === "-KX");
  out.otherProj = { sym: dx.sym, body: symOf(dx.sym).body === origBody };

  // ── 旧式データ: 同じ id のまま中身が違うシンボルを同梱した図面 ──
  const legacyBody = origBody + '<path d="M0,30 H5"/>';
  const legacySym = { ...SYMBOLS_BY_ID.coil, body: legacyBody, imported: true, edited: true };
  const legacy = JSON.parse(projX);
  legacy.symbols = [legacySym];
  App.project = legacy;
  mergeProjectSymbols();
  const dl = App.project.pages.flatMap(p2 => p2.devices).find(d => d.tag === "-KX");
  out.legacy = { remapped: dl.sym !== "coil" && dl.sym.startsWith("coil~"),
    devBody: symOf(dl.sym).body === legacyBody,
    stdKept: SYMBOLS_BY_ID.coil.body === origBody,
    palLatest: (symLatestMap().coil || {}).id };

  // ── 「元に戻す」= 版を退かせる ──
  symRetireVersions("coil");
  const pal2 = allSymbols().map(s => s.id);
  out.retire = { palStd: pal2.includes("coil"),
    palVerGone: !pal2.includes("coil~2") && !pal2.includes("coil~3"),
    defsKept: !!SYMBOLS_BY_ID["coil~2"] && !!SYMBOLS_BY_ID["coil~3"] };
  setSymTagVis("coil", "noprint");
  return out;
});

/* ── 旧式の localStorage: 規格 id をそのまま上書きして保存していた形 ── */
await p.evaluate(() => {
  const legacy = { ...SYMBOLS_BY_ID.coil, body: SYMBOLS_BY_ID.coil.body + '<path d="M0,31 H5"/>', imported: true, edited: true };
  delete legacy.verOf; delete legacy.retired;
  localStorage.setItem("electracad.importedSyms", JSON.stringify([legacy]));
  localStorage.removeItem("electracad.project.v1");   // 前段の図面と切り離す
});
await p.reload();
await p.waitForTimeout(900);
R.lsMigrate = await p.evaluate(() => {
  const std = SYMBOLS_BY_ID.coil;
  const ver = SYMBOLS_BY_ID["coil~2"];
  const pal = allSymbols().map(s => s.id);
  const saved = JSON.parse(localStorage.getItem("electracad.importedSyms") || "[]");
  return { stdClean: !std.imported && !std.edited, ver: !!ver && ver.verOf === "coil",
    palVer: pal.includes("coil~2") && !pal.includes("coil"),
    savedVer: saved.some(s2 => s2.id === "coil~2") && !saved.some(s2 => s2.id === "coil") };
});
await p.evaluate(() => localStorage.removeItem("electracad.importedSyms"));

const checks = {
  noPageErrors: errs.length === 0,
  verNew: R.verNew.exists === true && R.verNew.verOf === "coil"
    && R.verNew.stdKept === true && R.verNew.verChanged === true,
  placedKeep: R.placedKeep.sym === "coil" && R.placedKeep.body === true,
  addNew: R.addNew.palVer === true && R.addNew.palStd === false && R.addNew.newBody === true,
  editAgain: R.editAgain.exists === true && R.editAgain.verOf === "coil",
  noChange: R.noChange.noVer4 === true,
  otherProj: R.otherProj.sym === "coil" && R.otherProj.body === true,
  legacy: R.legacy.remapped === true && R.legacy.devBody === true
    && R.legacy.stdKept === true && R.legacy.palLatest === "coil~3",
  carry: R.carry.tagVis === "show",
  retire: R.retire.palStd === true && R.retire.palVerGone === true && R.retire.defsKept === true,
  lsMigrate: R.lsMigrate.stdClean === true && R.lsMigrate.ver === true
    && R.lsMigrate.palVer === true && R.lsMigrate.savedVer === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("sym-versions OK");
