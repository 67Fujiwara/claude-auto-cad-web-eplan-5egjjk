/* 大きな DXF (盤の外形図・配置図) を「盤図ページ」として取り込む。

   以前は DXF の要素を 1 本ずつ配線 (作図線) にしていたため、数万要素の
   盤図では画面が固まった (実線 = 導通する配線にすると接続計算で止まる)。

   ・dialog : 3000 要素を超える DXF は「盤図ページ」が既定。作図線の
             選択肢は使えない。拡大縮小・線種の欄は盤図では隠す。
             小さな DXF は従来どおり作図線が既定
   ・page   : 取り込むと表示中ページの直後に盤図ページ (kind panel) が
             1 枚増え、そこを表示する。配線は 1 本も増えない。縮尺は
             A3 に収まる 1:n
   ・geom   : 図形は実寸のまま原点合わせ (左下 = 0,0)。閉じたポリライン
             は辺ごとの線、円・円弧・文字も残る。中央寄せの文字は字幅の
             半分だけ基準点を戻す
   ・fast   : 画面の SVG ノードは線をまとめて数十個に収まる。パン (再描画)
             では盤図の層を作り直さない
   ・out    : 印刷 SVG・DXF 出力に図形が出る
   ・undo   : 元に戻すで取り込み前に戻る
   ・others : DXF の盤図があっても、Panel Studio の盤のページ名に
             「[ID]」が付かない (別の盤としては数えない) */
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
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // ── 盤図相当の DXF (原点 100,50 起点・2000 × 1000 mm) ──
  const o = ["0", "SECTION", "2", "ENTITIES"];
  const L = (x1, y1, x2, y2) => o.push("0", "LINE", "8", "外形", "10", x1, "20", y1, "11", x2, "21", y2);
  L(100, 50, 2100, 50); L(2100, 50, 2100, 1050);
  for (let i = 0; i < 4000; i++) L(200 + (i % 100) * 10, 100 + Math.floor(i / 100) * 10, 205 + (i % 100) * 10, 100 + Math.floor(i / 100) * 10);
  o.push("0", "LWPOLYLINE", "8", "外形", "90", "4", "70", "1",
    "10", "1500", "20", "500", "10", "1600", "20", "500", "10", "1600", "20", "560", "10", "1500", "20", "560");
  o.push("0", "CIRCLE", "8", "穴", "10", "1800", "20", "300", "40", "6");
  o.push("0", "ARC", "8", "外形", "10", "1900", "20", "900", "40", "20", "50", "0", "51", "90");
  o.push("0", "TEXT", "8", "機器型式", "10", "300", "20", "900", "40", "10", "1", "MODEL-TXT");
  o.push("0", "TEXT", "8", "注記", "10", "1000", "20", "700", "40", "20", "1", "CENTER-TXT", "72", "1", "11", "1000", "21", "700");
  o.push("0", "ENDSEC", "0", "EOF");
  const ents = parseDXF(o.join("\n"));

  App.project = newProject("DXF盤図"); UI.renumberPages();
  const pg0 = App.project.pages.find(isDrawingPage);
  App.project.pages.splice(App.project.pages.indexOf(pg0) + 1, 0, newPage("後ろの回路", 0));
  UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(pg0); UI.refresh();
  const nPages = App.project.pages.length, nWires = pg0.wires.length;
  // 作図線を無理に選んでも、大きな DXF は配線にしない (固まらない)
  UI.dxfImportDialog(ents, "盤.dxf");
  [...document.querySelectorAll("#dxMode")].pop().value = "draw";
  [...document.querySelectorAll("#dxOk")].pop().click();
  [...document.querySelectorAll("#dxCancel")].pop().click();
  out.guard = { wires: pg0.wires.length - nWires, pages: App.project.pages.length - nPages };

  // ── dialog ──
  UI.dxfImportDialog(ents, "盤.dxf");
  const md = document.querySelector("#dxMode");
  const optDraw = md.querySelector('option[value="draw"]');
  out.dialog = { mode: md.value, drawDisabled: optDraw.disabled,
    scaleHidden: document.querySelector("#dxScaleRow").style.display === "none",
    styleHidden: document.querySelector("#dxStyleRow").style.display === "none" };
  document.querySelector("#dxOk").click();
  await raf();

  // ── page ──
  const pg = curPage();
  const pd = panelDataOf(pg);
  out.page = { kind: pg.kind, after: App.project.pages.indexOf(pg) === App.project.pages.indexOf(pg0) + 1,
    added: App.project.pages.length - nPages, wires: App.project.pages.reduce((n, p2) => n + p2.wires.length, 0) - nWires,
    scale: pg.scale, dxf: pg.panel.dxf, name: pg.name, ext: pg.panel.extent,
    head: document.body.textContent.includes("DXF の盤図") };

  // ── geom ──
  const E = pd.entities;
  const near = (a, b2) => Math.abs(a - b2) < 0.01;
  out.geom = {
    lines: E.filter(e => e.t === "line").length,
    origin: E.some(e => e.t === "line" && near(e.x1, 0) && near(e.y1, 0) && near(e.x2, 2000) && near(e.y2, 0)),
    closed: E.some(e => e.t === "line" && near(e.x1, 1400) && near(e.y1, 510) && near(e.x2, 1400) && near(e.y2, 450)),
    circle: E.some(e => e.t === "circle" && near(e.cx, 1700) && near(e.cy, 250) && near(e.r, 6)),
    arc: E.some(e => e.t === "arc" && near(e.cx, 1800) && near(e.cy, 850) && e.a0 === 0 && e.a1 === 90),
    text: (() => { const t = E.find(e => e.t === "text" && e.s === "CENTER-TXT");
      return t ? +(900 - t.x - textWidthMM("CENTER-TXT", 20) / 2).toFixed(2) : null; })(),
  };

  // ── fast ──
  const lay = Editor.layers.panel;
  const first = lay.firstChild;
  out.fast = { nodes: lay.querySelectorAll("*").length, hasText: lay.innerHTML.includes("CENTER-TXT"),
    model: lay.innerHTML.includes("MODEL-TXT") };
  Editor.view.tx += 30; requestRender(); await raf();
  out.fast.kept = lay.firstChild === first;
  out.fast.sheetClean = !Editor.layers.sheet.innerHTML.includes("CENTER-TXT");

  // ── out ──
  const svg = exportSheetSVG(pg);
  applySheet(pg);
  const dxf = pageToDXF(pg);
  applySheet(curPage());
  out.out = { svg: svg.includes("CENTER-TXT"),
    svgSegs: (svg.match(/M-?[\d.]+,-?[\d.]+L-?[\d.]+,-?[\d.]+/g) || []).length,
    dxfLines: (dxf.match(/\n\s*LINE\s*\n/g) || []).length };

  // ── others: Panel Studio の盤を後から取り込んでも [ID] が付かない ──
  const r2 = panelInsertPages({ format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-1" }, panel: { model: "BOX-A" },
    sheets: ["cabinet_full", "cabinet_holes", "plate_full", "plate_holes"].map(id => ({
      id, title: id, extent: { w: 100, h: 100 }, entities: [] })) });
  out.others = { n: r2.others,
    names: App.project.pages.filter(p2 => p2.panel && p2.panel.cabId === "BOX-A").map(p2 => p2.name).join("|") };

  // ── undo (Panel Studio の取り込みより前の commit まで戻す) ──
  undo();
  out.undo = { back: !App.project.pages.some(p2 => p2.panel && p2.panel.dxf) };

  // ── 小さな DXF は従来どおり作図線が既定 ──
  App.project = newProject("小さな DXF"); UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(App.project.pages.find(isDrawingPage)); UI.refresh();
  document.querySelectorAll(".modal-back, .modal").forEach(n => n.remove && 0);
  const small = parseDXF(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "50", "21", "0",
    "0", "ENDSEC", "0", "EOF"].join("\n"));
  UI.dxfImportDialog(small, "小.dxf");
  const mds = [...document.querySelectorAll("#dxMode")].pop();
  out.small = { mode: mds.value, hasPanel: !!mds.querySelector('option[value="panel"]'),
    drawEnabled: !mds.querySelector('option[value="draw"]').disabled };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  guard: R.guard.wires === 0 && R.guard.pages === 0,
  dialog: R.dialog.mode === "panel" && R.dialog.drawDisabled === true &&
    R.dialog.scaleHidden === true && R.dialog.styleHidden === true,
  page: R.page.kind === "panel" && R.page.after === true && R.page.added === 1 && R.page.wires === 0 &&
    R.page.scale === "1:10" && R.page.dxf === "盤.dxf" && R.page.name === "盤" &&
    R.page.ext.w === 2000 && R.page.ext.h === 1000 && R.page.head === true,
  geom: R.geom.lines === 4006 && R.geom.origin && R.geom.closed && R.geom.circle && R.geom.arc &&
    R.geom.text !== null && Math.abs(R.geom.text) < 0.05,
  fast: R.fast.nodes < 50 && R.fast.hasText === true && R.fast.model === true && R.fast.kept === true && R.fast.sheetClean === true,
  out: R.out.svg === true && R.out.svgSegs >= 4006 && R.out.dxfLines >= 4006,
  others: R.others.n === 0 && !/\[/.test(R.others.names),
  undo: R.undo.back === true,
  small: R.small.mode === "draw" && R.small.hasPanel === true && R.small.drawEnabled === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("dxf-panel-import OK");
