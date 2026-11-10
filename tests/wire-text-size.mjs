/* 線番・電線仕様の文字高と太字。A3 の図面を A4 に縮小印刷すると 2.5mm の文字が
   1.8mm になって読めない、への対策。

   ・default : 設定なしは今までどおり 2.5mm・細字 (箱の高さ・画面の font-size・DXF の 40)
   ・size    : プロジェクト設定 (meta.wireNumH=3.5 / meta.wireSpecH=3.0) で線番と仕様の
              文字高が別々に変わる。画面・印刷 SVG・DXF が同じ寸法。線番と仕様は配線の
              反対側に置かれ、配線からのすき間は両方同じ (箱が配線に重ならない)。
              配線の下に置かれる線番も、すき間 1.4mm のまま文字高ぶん下がる
   ・bold    : 全体の太字 (meta.wireNumBold) で画面・印刷に font-weight="bold" が付く
              (等幅書体なので字幅は変わらず、配置はそのまま)。配線ごとの指定
              (w.numBold=false) が全体に勝つ。仕様は別指定 (w.specBold=true で仕様だけ太字)
   ・drc     : 検図の最小文字高 (pageDrawnMinima) が設定した文字高で測られる
   ・range   : 2.5 未満・7 超の値は無視して 2.5mm に戻る
   ・dialog  : プロジェクト › 線番・電線仕様の文字… で選んで適用すると meta に入り、
              標準値 (2.5) は保存しない。線番の配置 (箱) もやり直される
   ・props   : 配線のプロパティに「線番の太さ」「電線仕様の太さ」が出て、
              太字/細字/全体に従う を切り替えられる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("文字"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const w = addWire(pg, [[60, 100], [200, 100]]); w.num = "1201"; w.fixed = true; w.spec = "KIV-1.25sq";
  // 上に長い注記がある配線 → 線番は配線の下に置かれる (基準線が文字高ぶん下がる側)
  const w2 = addWire(pg, [[60, 140], [200, 140]]); w2.num = "1202"; w2.fixed = true;
  pg.texts = pg.texts || [];
  pg.texts.push({ id: "t_obst", x: 130, y: 136, text: "障害物".repeat(14), size: 3.5, anchor: "middle" });
  const below = () => { App.labelRev++; const bx = wireLabelBoxes(w2, wireLabelPos(w2, pg)).num; return { under: bx.y >= 140, gap: +(bx.y - 140).toFixed(3), h: bx.h }; };
  const bump = () => { App.labelRev++; };
  const boxes = () => { bump(); return wireLabelBoxes(w, wireLabelPos(w, pg)); };
  const screen = () => { bump(); renderAll(); const ts = [...document.querySelectorAll("#lyWires text")];
    const n = ts.find(t => t.textContent === "1201"), s = ts.find(t => t.textContent === "KIV-1.25sq");
    return { nFs: n && +n.getAttribute("font-size"), nB: !!(n && n.getAttribute("font-weight") === "bold"),
      sFs: s && +s.getAttribute("font-size"), sB: !!(s && s.getAttribute("font-weight") === "bold") }; };
  const print = () => { bump(); const svg = exportSheetSVG(pg); applySheet(pg);
    const m = /<text[^>]*font-size="([\d.]+)"[^>]*>1201<\/text>/.exec(svg); const mb = /<text[^>]*font-weight="bold"[^>]*>1201<\/text>/.test(svg);
    return { nFs: m && +m[1], nB: mb }; };
  const dxfH = () => { bump(); const t = pageToDXF(pg);
    const g = txt => { const e = t.split("\n0\nTEXT\n").find(s => s.includes("\n1\n" + txt + "\n")); return e ? +(/\n40\n([\d.]+)/.exec(e) || [])[1] : null; };
    return { n: g("1201"), s: g("KIV-1.25sq") }; };
  // ── default ──
  const b0 = boxes();
  out.default = { nH: b0.num.h, sH: b0.spec.h, nW: b0.num.w, scr: screen(), dxf: dxfH(), fs0: svgFontSizeFor("1201", 2.5, true) };
  // ── size ──
  const meta = projectMeta();
  meta.wireNumH = 3.5; meta.wireSpecH = 3;
  const b1 = boxes();
  const gapOf = bx => Math.min(Math.abs(bx.y + bx.h - 100), Math.abs(bx.y - 100));
  out.size = { nH: b1.num.h, sH: b1.spec.h, scr: screen(), prt: print(), dxf: dxfH(), below: below(),
    fsN: svgFontSizeFor("1201", 3.5, true), fsS: svgFontSizeFor("KIV-1.25sq", 3, true),
    opposite: (b1.num.y + b1.num.h <= 100 && b1.spec.y >= 100) || (b1.spec.y + b1.spec.h <= 100 && b1.num.y >= 100),
    sameGap: Math.abs(gapOf(b1.num) - gapOf(b1.spec)) < 0.01, gap: gapOf(b1.num) };
  // ── drc ──
  out.drc = pageDrawnMinima(pg).h;
  meta.wireSpecH = 5; out.drcSpec = pageDrawnMinima(pg).h; meta.wireSpecH = 3;
  // ── range ──
  meta.wireNumH = 2; out.rangeLo = boxes().num.h; meta.wireNumH = 9; out.rangeHi = boxes().num.h; meta.wireNumH = 3.5;
  // ── bold ──
  meta.wireNumBold = true;
  const b2 = boxes();
  out.bold = { sameW: Math.abs(b2.num.w - b1.num.w) < 0.01, scr: screen(), prt: print(), specStillThin: !screen().sB };
  w.numBold = false;                           // 配線ごとの指定が勝つ
  out.bold.own = { w: boxes().num.w, scr: screen() };
  delete meta.wireNumBold; delete w.numBold; w.specBold = true;   // 仕様だけ配線ごとに太字
  out.bold.spec = screen();
  delete w.specBold;
  // ── dialog ──
  UI.wireTextSetup();
  const dlg = { numH: !!document.querySelector("#wtNumH"), cur: document.querySelector("#wtNumH") && document.querySelector("#wtNumH").value };
  document.querySelector("#wtNumH").value = "5"; document.querySelector("#wtSpecH").value = "2.5";
  document.querySelector("#wtSpecB").checked = true;
  document.querySelector("#wtOk").click();
  dlg.meta = JSON.stringify({ n: meta.wireNumH, s: meta.wireSpecH, nb: meta.wireNumBold, sb: meta.wireSpecBold, sInMeta: "wireSpecH" in meta });
  dlg.box = wireLabelBoxes(w, wireLabelPos(w, pg)).num.h;
  // labelRev が進んで配置もやり直されている: 下側の線番は新しい文字高ぶん下がり、配線からのすき間は変わらない
  { const bx = wireLabelBoxes(w2, wireLabelPos(w2, pg)).num; dlg.below = { under: bx.y >= 140, gap: +(bx.y - 140).toFixed(3), h: bx.h }; }
  dlg.closed = !document.querySelector("#wtNumH");
  out.dialog = dlg;
  // ── props ──
  App.selection.clear(); App.selection.add(w.id); UI.showProps();
  const sel = document.querySelector("#pNumBold"), sel2 = document.querySelector("#pSpecBold");
  out.props = { has: !!sel && !!sel2, opts: sel && [...sel.options].map(o => o.textContent).join("|"),
    specDefault: sel2 && sel2.options[0].textContent };
  if (sel) {
    sel.value = "1"; sel.dispatchEvent(new Event("change")); out.props.set1 = w.numBold;
    UI.showProps(); const s2 = document.querySelector("#pNumBold"); out.props.shown = s2.value;
    s2.value = "0"; s2.dispatchEvent(new Event("change")); out.props.set0 = w.numBold;
    UI.showProps(); const s3 = document.querySelector("#pNumBold"); s3.value = ""; s3.dispatchEvent(new Event("change")); out.props.cleared = !("numBold" in w);
  }
  return out;
});

const near = (a, c) => Math.abs(a - c) < 0.01;
const checks = {
  noPageErrors: errs.length === 0,
  default: near(R.default.nH, 2.5) && near(R.default.sH, 2.5) && near(R.default.scr.nFs, R.default.fs0) && !R.default.scr.nB && near(R.default.dxf.n, 2.5),
  size: near(R.size.nH, 3.5) && near(R.size.sH, 3) && near(R.size.scr.nFs, R.size.fsN) && near(R.size.scr.sFs, R.size.fsS) &&
    near(R.size.prt.nFs, R.size.fsN) && near(R.size.dxf.n, 3.5) && near(R.size.dxf.s, 3) && R.size.opposite && R.size.sameGap && R.size.gap > 0.5 &&
    R.size.below.under && near(R.size.below.gap, 1.4) && near(R.size.below.h, 3.5),
  drc: near(R.drc, 3) && near(R.drcSpec, 3.5),
  range: near(R.rangeLo, 2.5) && near(R.rangeHi, 2.5),
  bold: R.bold.sameW && R.bold.scr.nB && R.bold.prt.nB && R.bold.specStillThin &&
    !R.bold.own.scr.nB && near(R.bold.own.w, R.default.nW * 3.5 / 2.5) && R.bold.spec.sB && !R.bold.spec.nB,
  dialog: R.dialog.numH && R.dialog.cur === "3.5" && R.dialog.meta === JSON.stringify({ n: 5, nb: undefined, sb: true, sInMeta: false }).replace('"nb":undefined,', "") &&
    near(R.dialog.box, 5) && R.dialog.closed && R.dialog.below.under && near(R.dialog.below.gap, 1.4) && near(R.dialog.below.h, 5),
  props: R.props.has && /全体の設定に従う \(細字\)\|太字\|細字/.test(R.props.opts) && /太字\)$/.test(R.props.specDefault) &&
    R.props.set1 === true && R.props.shown === "1" && R.props.set0 === false && R.props.cleared === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-text-size OK");
