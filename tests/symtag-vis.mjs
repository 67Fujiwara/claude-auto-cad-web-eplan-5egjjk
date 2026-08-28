/* デバイスタグの表示モード (シンボル単位・シンボルDBで変更)。

   ・defaultMode : 既定は「出力時非表示」— 画面には出るが、SVG 出力 (PDF の
                   下地) と DXF には出ない
   ・dbSelect    : シンボルデータベースの各記号に「タグ」の選択があり、
                   既定値 (出力時非表示) が選ばれている
   ・showMode    : 「表示」にすると出力 (SVG/DXF) にも出る
   ・hideMode    : 「非表示」にすると画面からも消える
   ・otherKept   : タグを消しても機能テキスト・端子番号はそのまま出る
   ・perSymbol   : 記号ごとに別のモードを持てる (コイル=表示、ランプ=既定)
   ・persist     : 選択は localStorage に残り、既定へ戻すと消える (掃除)
   ・drcFollows  : 尺度の検図はタグを「出力に出るときだけ」数える */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const pg = newPage("tv", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1; applySheet(pg);
  const d1 = addDevice(pg, "coil", 100, 100, { tag: "-K91" });
  const d2 = addDevice(pg, "lamp", 160, 100, { tag: "-P91" });
  d1.desc = "運転出力";
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));

  const screen = () => Editor.layers.devices.innerHTML;
  const outSVG = () => exportSheetSVG(pg);
  const dxf = () => pageToDXF(pg);
  out.defaultMode = {
    mode: symTagVis(SYMBOLS_BY_ID.coil),
    onScreen: screen().includes(">-K91</text>"),
    inSVG: outSVG().includes(">-K91</text>"),
    inDXF: dxf().includes("-K91"),
  };
  // ── シンボルDB の選択 ──
  UI.openSymDB();
  await new Promise(r => setTimeout(r, 150));
  const sel = document.querySelector('[data-tag="coil"]');
  out.dbSelect = { found: !!sel, value: sel && sel.value };
  // 「表示」へ
  sel.value = "show";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  out.showMode = {
    mode: symTagVis(SYMBOLS_BY_ID.coil),
    inSVG: outSVG().includes(">-K91</text>"),
    inDXF: dxf().includes("-K91"),
    lampStill: !outSVG().includes(">-P91</text>"),    // 他の記号は既定のまま
  };
  out.perSymbol = symTagVis(SYMBOLS_BY_ID.coil) === "show" && symTagVis(SYMBOLS_BY_ID.lamp) === "noprint";
  // 「非表示」へ
  sel.value = "hide";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector(".modal-close").click();
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.hideMode = {
    onScreen: screen().includes(">-K91</text>"),
    inSVG: outSVG().includes(">-K91</text>"),
    descKept: screen().includes("運転出力") && outSVG().includes("運転出力"),
    pinsKept: outSVG().includes(">A1</text>") || screen().includes(">A1</text>"),
  };
  out.persist = {
    stored: JSON.parse(localStorage.getItem("electracad.symTagVis") || "{}").coil === "hide",
  };
  setSymTagVis("coil", "noprint");        // 既定へ戻すと掃除される
  out.persist.cleaned = JSON.parse(localStorage.getItem("electracad.symTagVis") || "{}").coil === undefined;

  // ── 尺度の検図: タグを出力に出すときだけ数える ──
  // 3.5mm のタグしか無いページを 1:2 にすると、印刷 1.75mm < 2.5mm。
  // 既定 (出力時非表示) なら刷られないので黙り、「表示」にすると知らせる
  const pg2 = newPage("tv2", App.project.pages.length + 1);
  App.project.pages.push(pg2); App.pageIdx = App.project.pages.length - 1;
  pg2.scale = "1:2"; applySheet(pg2);
  addDevice(pg2, "earth", 100, 100, { tag: "-E9" });   // タグ以外に文字の無い記号
  // 測れる文字が無いと最小呼びのフォールバックが効くので、印刷しても
  // 読める大きさ (7mm → 用紙上 3.5mm) の注記を 1 つ置いておく
  pg2.texts.push({ id: uid("t"), x: 150, y: 100, text: "NOTE", size: 7 });
  const hits = () => runDRC().filter(i => i.rule === "尺度と用紙上の寸法" && i.page === pg2.no).length;
  const quiet = hits();
  setSymTagVis("earth", "show");
  const warns = hits();
  setSymTagVis("earth", "noprint");
  out.drcFollows = { quiet, warns };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  defaultMode: R.defaultMode.mode === "noprint" && R.defaultMode.onScreen
    && !R.defaultMode.inSVG && !R.defaultMode.inDXF,
  dbSelect: R.dbSelect.found && R.dbSelect.value === "noprint",
  showMode: R.showMode.mode === "show" && R.showMode.inSVG && R.showMode.inDXF && R.showMode.lampStill,
  hideMode: !R.hideMode.onScreen && !R.hideMode.inSVG,
  otherKept: R.hideMode.descKept && R.hideMode.pinsKept,
  perSymbol: R.perSymbol === true,
  persist: R.persist.stored && R.persist.cleaned,
  drcFollows: R.drcFollows.quiet === 0 && R.drcFollows.warns >= 1,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("symtag-vis OK");
