/* パネル図の作図ツール + 破線枠の太さ。

   ・zoneLw  : 破線枠のプロパティに「線の太さ」が出て、画面 SVG と DXF
              (lineweight 370) の両方に効く
   ・lineTool: プロパティの「線」ボタン → ドラッグで線が引ける (1mm 刻み)。
              描いた線は選択済みになる
   ・circle  : 「丸」= 中心からドラッグで半径
   ・arrow   : 「矢印」= 根→先。本体 + 羽 2 本の 3 本がひとまとまりになる
   ・textTool: 「文字」= クリックで記入。panelText オフでも画面と DXF に出る
              (書き足した注記は常に見える)
   ・rotate  : 選んだ図形を R (rotateSelection) で 90° 回せる。undo で戻る
   ・textEdit: 文字を選ぶとプロパティで内容・高さを直せる
   ・esc     : Esc で作図モードが終わる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

/* ── 破線枠の太さ ── */
const ZL = await p.evaluate(async () => {
  App.project = newProject("枠太さ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  UI.insertZone();
  const z = pageZones(pg)[0];
  App.selection.clear(); App.selection.add(z.id);
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const inp = document.getElementById("zLw");
  if (!inp) return { field: false };
  inp.value = "0.7";
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  App.selection.clear();
  const fr = contentScale();
  const svg = zonesSVG(pg, { print: true });
  const dxf = pageToDXF(pg).split(/\r?\n/);
  const i370 = dxf.indexOf("370");
  return { field: true, lw: z.lw,
    svgW: svg.includes(`stroke-width="${0.7 * fr}"`),
    dxf370: i370 >= 0 && dxf[i370 + 1] === "70" };
});

/* ── パネル図 + 作図 ── */
const R = await p.evaluate(() => {
  App.project = newProject("パネル作図"); UI.renumberPages();
  const data = {
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-DRAW" }, panel: { model: "BOX", outer: { w: 600, h: 400, d: 250 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 600, h: 400 }, entities: [
        { t: "line", x1: 0, y1: 0, x2: 600, y2: 0 }, { t: "line", x1: 600, y1: 0, x2: 600, y2: 400 },
        { t: "line", x1: 600, y1: 400, x2: 0, y2: 400 }, { t: "line", x1: 0, y1: 400, x2: 0, y2: 0 },
      ] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 600, h: 400 }, entities: [] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 500, h: 300 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 500, h: 300 }, entities: [] },
    ],
  };
  panelInsertPages(data); UI.renumberPages();
  const pg = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "cabinet_full");
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  zoomFit(); requestRender();
  App.selection.clear(); Editor.panelSel = null;
  UI.showProps();
  const { ox, oy } = panelOrigin(pg);
  const a = screenToWorld(0, 0), bx = screenToWorld(100, 0), by = screenToWorld(0, 100);
  const kx = 100 / (bx.x - a.x), ky = 100 / (by.y - a.y);
  const W2C = (px, py) => ({ x: (ox + px - a.x) * kx, y: (oy + (400 - py) - a.y) * ky });
  return { pgId: pg.id, n0: panelDataOf(pg).entities.length,
    btn: [...document.querySelectorAll(".pnDraw")].map(b2 => b2.dataset.k).join(","),
    line: { s: W2C(200, 100), e: W2C(230, 100) },
    circ: { s: W2C(400, 200), e: W2C(430, 200) },
    arrw: { s: W2C(100, 50), e: W2C(140, 50) },
    txt: W2C(300, 350) };
});

// 線: プロパティのボタンから
await p.evaluate(() => document.querySelector('.pnDraw[data-k="line"]').click());
await p.mouse.move(R.line.s.x, R.line.s.y);
await p.mouse.down();
await p.mouse.move(R.line.e.x, R.line.e.y, { steps: 5 });
await p.mouse.up();
await p.waitForTimeout(120);
const L1 = await p.evaluate(([mk]) => {
  const pg = curPage();
  const ents = panelDataOf(pg).entities;
  const e = ents[mk.n0];
  const sel = panelSelIdxs();
  return { n: ents.length, e, selN: sel ? sel.size : 0, mode: Editor.panelDraw && Editor.panelDraw.kind };
}, [R]);

// 丸・矢印: モードを切り替えてドラッグ
await p.evaluate(() => { Editor.panelDraw = { kind: "circle" }; });
await p.mouse.move(R.circ.s.x, R.circ.s.y);
await p.mouse.down();
await p.mouse.move(R.circ.e.x, R.circ.e.y, { steps: 5 });
await p.mouse.up();
await p.evaluate(() => { Editor.panelDraw = { kind: "arrow" }; });
await p.mouse.move(R.arrw.s.x, R.arrw.s.y);
await p.mouse.down();
await p.mouse.move(R.arrw.e.x, R.arrw.e.y, { steps: 5 });
await p.mouse.up();
await p.waitForTimeout(120);
const L2 = await p.evaluate(([mk]) => {
  const pg = curPage();
  const ents = panelDataOf(pg).entities;
  const circ = ents.find(e => e.t === "circle");
  const arrows = ents.slice(mk.n0 + 2);      // 線 1 + 円 1 の後 = 矢印 3 本
  const clus = panelClusters(pg);
  const arrowClu = arrows.length === 3 &&
    clus.some(c => c.idxs.length === 3 && c.idxs.every(i => i >= mk.n0 + 2));
  return { total: ents.length, circ, arrows, arrowClu };
}, [R]);

// 文字: クリック + prompt
await p.evaluate(() => { window.prompt = () => "現場合わせ"; Editor.panelDraw = { kind: "text" }; });
await p.mouse.click(R.txt.x, R.txt.y);
await p.waitForTimeout(120);
const TX = await p.evaluate(() => {
  const pg = curPage();
  const e = panelDataOf(pg).entities.find(e2 => e2.t === "text");
  delete pg.panelText;         // 「文字も描く」オフのまま
  applySheet(pg);
  const svg = panelSVG(pg);
  const dxf = pageToDXF(pg);
  return { e, svg: svg.includes("現場合わせ"), dxf: dxf.includes("現場合わせ") };
});

/* ── 回転 (描いた線 200,100→230,100 を 90°) ── */
const RO = await p.evaluate(([mk]) => {
  const pg = curPage();
  Editor.panelDraw = null;
  const before = { ...panelDataOf(pg).entities[mk.n0] };
  const cx0 = Math.round((before.x1 + before.x2) / 2);
  const cy0 = Math.round((before.y1 + before.y2) / 2);
  Editor.panelSel = { pageId: mk.pgId, idxs: new Set([mk.n0]) };
  rotateSelection();
  const e1 = { ...panelDataOf(pg).entities[mk.n0] };
  undo();
  const e2 = { ...panelDataOf(pg).entities[mk.n0] };
  return { before, cx0, cy0, rot: e1, back: e2 };
}, [R]);

/* ── 文字のプロパティ編集 ── */
const TE = await p.evaluate(async () => {
  const pg = curPage();
  const ti = panelDataOf(pg).entities.findIndex(e => e.t === "text");
  Editor.panelSel = { pageId: pg.id, idxs: new Set([ti]) };
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const ts = document.getElementById("pPnTs"), th = document.getElementById("pPnTh");
  if (!ts || !th) return { fields: false };
  ts.value = "改訂A";
  ts.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const th2 = document.getElementById("pPnTh");
  th2.value = "7";
  th2.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const e = panelDataOf(pg).entities.find(e2 => e2.t === "text");
  return { fields: true, s: e.s, h: e.h };
});

/* ── Esc で作図モード終了 ── */
const ES = await p.evaluate(() => {
  Editor.panelDraw = { kind: "line" };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return { mode: Editor.panelDraw };
});

const near = (v, want, tol = 1.2) => typeof v === "number" && Math.abs(v - want) <= tol;
const checks = {
  noPageErrors: errs.length === 0,
  zoneLw: ZL.field === true && ZL.lw === 0.7 && ZL.svgW === true && ZL.dxf370 === true,
  lineTool: R.btn === "line,circle,arrow,text" && L1.n === R.n0 + 1 &&
    L1.e && L1.e.t === "line" && near(L1.e.x1, 200) && near(L1.e.y1, 100) &&
    near(L1.e.x2, 230) && near(L1.e.y2, 100) && L1.selN === 1 && L1.mode === "line",
  circle: !!L2.circ && near(L2.circ.cx, 400) && near(L2.circ.cy, 200) && near(L2.circ.r, 30, 1.5),
  arrow: L2.arrows.length === 3 && L2.arrows.every(e => e.t === "line") &&
    near(L2.arrows[0].x1, 100) && near(L2.arrows[0].x2, 140) &&
    L2.arrows.slice(1).every(e =>
      Math.hypot(e.x2 - e.x1, e.y2 - e.y1) >= 3 && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) <= 8.5 &&
      near(e.x1, L2.arrows[0].x2, 0.2) && near(e.y1, L2.arrows[0].y2, 0.2)) &&
    L2.arrowClu === true,
  textTool: !!TX.e && TX.e.note === true && near(TX.e.x, 300) && near(TX.e.y, 350) &&
    TX.svg === true && TX.dxf === true,
  /* 横線を中心で 90° 回すと縦線 (x = 中心、y = 中心 ± 長さ/2)。undo で元へ */
  rotate: RO.rot.x1 === RO.cx0 && RO.rot.x2 === RO.cx0 &&
    RO.rot.y1 === RO.cy0 + (RO.before.x1 - RO.cx0) &&
    RO.rot.y2 === RO.cy0 + (RO.before.x2 - RO.cx0) &&
    RO.back.x1 === RO.before.x1 && RO.back.y1 === RO.before.y1 &&
    RO.back.x2 === RO.before.x2 && RO.back.y2 === RO.before.y2,
  textEdit: TE.fields === true && TE.s === "改訂A" && TE.h === 7,
  esc: ES.mode === null,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, ZL, R: { ...R, line: 0, circ: 0, arrw: 0, txt: 0 }, L1, L2, TX, RO, TE, ES, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-draw OK");
