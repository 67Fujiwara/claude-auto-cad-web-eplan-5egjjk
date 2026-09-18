/* パネル図 (Panel Studio 取り込み) の「図全体を選択して丸ごと移動」。

   取り込んだ図は作図領域の中央に置かれるが、置き場所を動かしたいことが
   ある — 全図形をひとつずつ選ばなくても丸ごと動かせるようにする。

   ・btnSetup : 何も選んでいないときのプロパティに「図全体を選択」ボタンが
               あり、押すと全図形が選ばれる (通常選択は空のまま)
   ・ctrlA    : Ctrl+A でも同じ (パネル図のページでは図の全体を選ぶ)
   ・moveAll  : 全選択して矢印キー → すべての図形が 5mm 動く。
               Ctrl+Z で全部元の座標に戻る
   ・btnSel   : まとまりを選んでいるときのプロパティにも同じボタンがあり、
               押すと選択が全体に広がる
   ・drag     : 全選択のまま図形の上をドラッグ → 選択を保ったまま全体が動く
   ・regular  : 普通の回路ページの Ctrl+A は従来どおり機器・配線を選ぶ */
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
  App.project = newProject("図全体の移動"); UI.renumberPages();
  const data = {
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-MV" }, panel: { model: "MV-BOX", outer: { w: 600, h: 400, d: 250 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 600, h: 400 },
        entities: [
          { t: "line", x1: 0, y1: 0, x2: 600, y2: 0 }, { t: "line", x1: 600, y1: 0, x2: 600, y2: 400 },
          { t: "line", x1: 600, y1: 400, x2: 0, y2: 400 }, { t: "line", x1: 0, y1: 400, x2: 0, y2: 0 },
          { t: "line", x1: 100, y1: 200, x2: 150, y2: 200 },
          { t: "circle", cx: 300, cy: 100, r: 3.5 },
          { t: "text", x: 300, y: 300, h: 5, s: "MCCB" },
        ] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 600, h: 400 },
        entities: [{ t: "circle", cx: 50, cy: 50, r: 2 }] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 500, h: 300 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 500, h: 300 }, entities: [] },
    ],
  };
  panelInsertPages(data);
  UI.renumberPages();
  const pg = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "cabinet_full");
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  zoomFit(); requestRender();
  window.__pg = pg;
  const coords = () => panelDataOf(pg).entities.map(e =>
    e.t === "circle" ? [e.cx, e.cy] : e.t === "text" ? [e.x, e.y] : [e.x1, e.y1, e.x2, e.y2]);
  window.__coords = coords;
  out.n = panelDataOf(pg).entities.length;
  out.before = JSON.stringify(coords());

  // ── btnSetup: 設定パネルのボタンで全選択 ──
  Editor.panelSel = null; App.selection.clear(); UI.showProps();
  const btn = document.querySelector("#props #pnSelAll") || document.getElementById("pnSelAll");
  out.btnSetup = { has: !!btn };
  if (btn) btn.click();
  const sel = panelSelIdxs();
  out.btnSetup.selN = sel ? sel.size : 0;
  out.btnSetup.regularEmpty = App.selection.size === 0;
  out.btnSetup.msg = document.getElementById("stMsg").textContent.includes("図の全体");
  return out;
});

/* ── moveAll: 矢印キーで全体が 5mm 右へ → Ctrl+Z で戻る ── */
await p.keyboard.press("ArrowRight");
await p.waitForTimeout(120);
const MV = await p.evaluate(() => {
  const before = JSON.parse(window.__coords ? "[]" : "[]");
  const now = window.__coords();
  return { now: JSON.stringify(now) };
});
const UNDO = await p.evaluate(() => {
  if (undo()) UI.refresh();
  return { now: JSON.stringify(window.__coords()) };
});

/* ── ctrlA: 一度解除してから Ctrl+A ── */
const CA = await p.evaluate(() => {
  Editor.panelSel = null; App.selection.clear(); UI.showProps(); requestRender();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
  const sel = panelSelIdxs();
  return { selN: sel ? sel.size : 0 };
});

/* ── btnSel: まとまり選択中のプロパティにもボタンがある ── */
const BS = await p.evaluate(() => {
  const pg = window.__pg;
  Editor.panelSel = null; App.selection.clear();
  const { ox, oy } = panelOrigin(pg);
  const cl = panelClusterAt(pg, ox + 125, oy + (400 - 200));   // 機器の線 1 本
  Editor.panelSel = { pageId: pg.id, idxs: new Set(cl.idxs) };
  UI.showProps();
  const btn = document.getElementById("pnSelAll");
  const beforeN = panelSelIdxs().size;
  // 部分選択中の見出し: 選んだまとまりの数だけを数える (全クラスタではない)
  const head = (document.querySelector("#pane-props .prop-head .t2") || {}).textContent || "";
  if (btn) btn.click();
  return { has: !!btn, beforeN, head,
    afterN: panelSelIdxs() ? panelSelIdxs().size : 0 };
});

/* ── drag: 全選択のまま図形の上をドラッグで全体が動く ── */
const DR = await p.evaluate(() => {
  const pg = window.__pg;
  const { ox, oy } = panelOrigin(pg);
  // 機器の線 (100,200)-(150,200) の中点 → 画面座標
  const wx = ox + 125, wy = oy + (400 - 200);
  const r = Editor.svg.getBoundingClientRect();
  const v = Editor.view;
  return { x: r.left + wx * v.s + v.tx, y: r.top + wy * v.s + v.ty,
    before: JSON.stringify(window.__coords()) };
});
await p.mouse.move(DR.x, DR.y);
await p.mouse.down();
await p.mouse.move(DR.x + 60, DR.y, { steps: 4 });
await p.mouse.up();
await p.waitForTimeout(150);
const DR2 = await p.evaluate(() => {
  const sel = panelSelIdxs();
  return { now: JSON.stringify(window.__coords()), selN: sel ? sel.size : 0 };
});

/* ── regular: 普通のページの Ctrl+A は従来どおり ── */
const RG = await p.evaluate(() => {
  const pgD = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pgD); applySheet(pgD);
  pgD.devices.length = 0; pgD.wires.length = 0;
  addDevice(pgD, "coil", 100, 100, { tag: "-K1" });
  addWire(pgD, [[100, 120], [150, 120]]);
  Editor.panelSel = null; App.selection.clear();
  UI.selectAll();
  return { selN: App.selection.size, panelSel: panelSelIdxs() ? 1 : 0 };
});

const shift = (before, after, dx) => {
  const a = JSON.parse(before), b2 = JSON.parse(after);
  return a.length === b2.length && a.every((c, i) =>
    c.every((v, j) => Math.abs(b2[i][j] - (j % 2 === 0 ? v + dx : v)) < 1e-6));
};
const checks = {
  noPageErrors: errs.length === 0,
  btnSetup: R.btnSetup.has === true && R.btnSetup.selN === R.n && R.n === 7 &&
    R.btnSetup.regularEmpty === true && R.btnSetup.msg === true,
  moveAll: shift(R.before, MV.now, 5),
  undoAll: UNDO.now === R.before,
  ctrlA: CA.selN === R.n,
  btnSel: BS.has === true && BS.beforeN === 1 && BS.afterN === R.n &&
    BS.head.includes("1 まとまり / 1 要素"),
  drag: DR2.selN === R.n && (() => {
    const a = JSON.parse(DR.before), b2 = JSON.parse(DR2.now);
    // ドラッグ量は 1mm 刻み — 全要素が同じ量だけ +X に動いている
    const d = b2[0][0] - a[0][0];
    return d > 2 && a.every((c, i) => c.every((v, j) =>
      Math.abs(b2[i][j] - (j % 2 === 0 ? v + d : v)) < 1e-6));
  })(),
  regular: RG.selN === 2 && RG.panelSel === 0,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, MV, UNDO, CA, BS, DR2, RG, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-move-all OK");
