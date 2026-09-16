/* パネル図の作図ツール + 破線枠の太さ。

   ・zoneLw  : 破線枠のプロパティに「線の太さ」が出て、画面 SVG と DXF
              (lineweight 370) の両方に効く
   ・lineTool: プロパティの「線」ボタン → ドラッグで線が引ける (1mm 刻み)。
              描いた線は選択済みになり、モードは 1 回で終わる (残ったままだと
              次のドラッグが全部線になる)。作図ボタンは選択中も出ている
   ・circle  : 「丸」= 中心からドラッグで半径
   ・arrow   : 「矢印」= 根→先の専用図形 1 個。先端は塗り三角で、太さを
              変えると先端も釣り合って大きくなる (つぶれない)。
              DXF には 軸線 + SOLID で出る
   ・noGroup : 書き足した図形は既存の図形と重なっても束ねない
              (自分で引いた線がキャビネットとグループになってしまうため)
   ・textTool: 「文字」= クリックで記入。panelText オフでも画面と DXF に出る
              (書き足した注記は常に見える)
   ・rotate  : 選んだ図形を R (rotateSelection) で 90° 回せる。undo で戻る
   ・textEdit: 文字を選ぶとプロパティで内容・高さを直せる
   ・width   : 描いた線・矢印を選んで「線の太さ」を変えると画面 SVG と
              DXF (lineweight 370) に効く
   ・toolFix : 配線ツール中でも作図ボタンを押すと選択ツールへ切り替わって
              描ける (切り替えないとクリックが図面側に取られる)
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
  // 破線枠を使ったページの線種テーブルには DASHED が載る (使った線種は残す)
  const ltNames = [];
  dxf.forEach((v, i2) => {
    if (v === "LTYPE" && dxf[i2 - 1] === "0") {
      for (let j = i2 + 1; j < i2 + 20; j++) if (dxf[j] === "2") { ltNames.push(dxf[j + 1]); break; }
    }
  });
  return { field: true, lw: z.lw,
    svgW: svg.includes(`stroke-width="${0.7 * fr}"`),
    hasDashed: ltNames.includes("DASHED"),
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
        { t: "line", x1: 100, y1: 380, x2: 140, y2: 380 },
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
  return { n: ents.length, e, selN: sel ? sel.size : 0, mode: Editor.panelDraw && Editor.panelDraw.kind,
    btns: document.querySelectorAll(".pnDraw").length };
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
  const arrow = ents.find(e => e.t === "arrow");
  applySheet(pg);
  const f = sheetScale();
  const svg = panelSVG(pg);
  const dxf = pageToDXF(pg);
  const hd = arrow && panelArrowHead(arrow, f);
  const hdThick = arrow && panelArrowHead({ ...arrow, w: 0.7 }, f);
  // 書き足した線は既存図形 (枠の下辺 y=0) をまたいでも束ねない。
  // さらに、独立した取り込み線 (y=380) と枠 (y=400) を橋渡しするように
  // 引いても、2 つの図形がつながってしまわないこと
  const { ox, oy } = panelOrigin(pg);
  const li = panelAddEnts(pg, panelDrawEnts("line", 300, -20, 300, 40))[0];
  const cl = panelClusterAt(pg, ox + 300, oy + (400 - 10));
  panelAddEnts(pg, panelDrawEnts("line", 120, 370, 120, 410));   // 橋渡し
  const clus = panelClusters(pg);
  const frame = clus.find(c => c.idxs.length === 4);
  const lone = clus.find(c => c.idxs.length === 1 &&
    panelDataOf(pg).entities[c.idxs[0]].y1 === 380 && !panelDataOf(pg).entities[c.idxs[0]].add);
  return { total: ents.length, circ, arrow,
    head: { svgFill: (svg.match(/Z" fill="/g) || []).length,
      dxfSolid: /\n0\r?\nSOLID\r?\n8\r?\nPANEL/.test(dxf),
      hl: hd && hd.hl, hlThick: hdThick && hdThick.hl },
    noGroup: { own: cl ? cl.idxs.length : 0, ownIdx: !!cl && cl.idxs[0] === li,
      frame: frame ? frame.idxs.length : 0, lone: !!lone } };
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

/* ── 太さの変更 (描いた線 + 矢印の 4 本) ── */
const LW = await p.evaluate(async ([mk]) => {
  const pg = curPage();
  const idxs = [];
  panelDataOf(pg).entities.forEach((e, i) => { if (e.add && (e.t === "line" || e.t === "arrow")) idxs.push(i); });
  Editor.panelSel = { pageId: pg.id, idxs: new Set(idxs) };
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const inp = document.getElementById("pPnLw");
  if (!inp) return { field: false };
  inp.value = "0.7";
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const es = panelDataOf(pg).entities;
  applySheet(pg);
  const f = sheetScale();
  const svg = panelSVG(pg);
  const dxf = pageToDXF(pg).split(/\r?\n/);
  const i370 = dxf.indexOf("370");
  return { field: true, n: idxs.length, allW: idxs.every(i => es[i].w === 0.7),
    svgW: svg.includes(`stroke-width="${0.7 * f}"`),
    dxf370: i370 >= 0 && dxf[i370 + 1] === "70" };
}, [R]);

/* ── 配線ツール中でもボタンで描ける (選択ツールへ自動切替) ── */
const TF = await p.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  Editor.panelSel = null; App.selection.clear();
  UI.setTool("wire");
  UI.showProps();
  await new Promise(r => setTimeout(r, 120));
  const btn = document.querySelector('.pnDraw[data-k="arrow"]');
  if (!btn) return { btn: false };
  btn.click();
  return { btn: true, tool: App.tool, mode: Editor.panelDraw && Editor.panelDraw.kind };
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
  zoneLw: ZL.field === true && ZL.lw === 0.7 && ZL.svgW === true && ZL.dxf370 === true &&
    ZL.hasDashed === true,
  lineTool: R.btn === "line,circle,arrow,text" && L1.n === R.n0 + 1 &&
    L1.e && L1.e.t === "line" && near(L1.e.x1, 200) && near(L1.e.y1, 100) &&
    near(L1.e.x2, 230) && near(L1.e.y2, 100) && L1.selN === 1 &&
    L1.mode === null && L1.btns === 4,
  circle: !!L2.circ && near(L2.circ.cx, 400) && near(L2.circ.cy, 200) && near(L2.circ.r, 30, 1.5),
  /* 矢印 = 専用図形 1 個。先端の塗り三角が画面 (fill パス) と DXF (SOLID) に
     出て、太さを上げると先端も大きくなる */
  arrow: !!L2.arrow && L2.arrow.t === "arrow" && L2.arrow.add === true &&
    near(L2.arrow.x1, 100) && near(L2.arrow.y1, 50) &&
    near(L2.arrow.x2, 140) && near(L2.arrow.y2, 50) &&
    L2.head.svgFill >= 1 && L2.head.dxfSolid === true &&
    L2.head.hlThick > L2.head.hl,
  /* 書き足した線は枠をまたいでも 1 本だけで選ばれ、枠のまとまりも増えない */
  noGroup: L2.noGroup.own === 1 && L2.noGroup.ownIdx === true &&
    L2.noGroup.frame === 4 && L2.noGroup.lone === true,
  textTool: !!TX.e && TX.e.note === true && near(TX.e.x, 300) && near(TX.e.y, 350) &&
    TX.svg === true && TX.dxf === true,
  /* 横線を中心で 90° 回すと縦線 (x = 中心、y = 中心 ± 長さ/2)。undo で元へ */
  rotate: RO.rot.x1 === RO.cx0 && RO.rot.x2 === RO.cx0 &&
    RO.rot.y1 === RO.cy0 + (RO.before.x1 - RO.cx0) &&
    RO.rot.y2 === RO.cy0 + (RO.before.x2 - RO.cx0) &&
    RO.back.x1 === RO.before.x1 && RO.back.y1 === RO.before.y1 &&
    RO.back.x2 === RO.before.x2 && RO.back.y2 === RO.before.y2,
  textEdit: TE.fields === true && TE.s === "改訂A" && TE.h === 7,
  width: LW.field === true && LW.n === 4 && LW.allW === true &&
    LW.svgW === true && LW.dxf370 === true,
  toolFix: TF.btn === true && TF.tool === "select" && TF.mode === "arrow",
  esc: ES.mode === null,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, ZL, R: { ...R, line: 0, circ: 0, arrw: 0, txt: 0 }, L1, L2, TX, RO, TE, LW, TF, ES, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-draw OK");
