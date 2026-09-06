/* 図面上の表。

   ・insert   : 挿入メニュー相当 (UI.insertTable) で 3×3 の表が置かれ、
               1 行目の左上に「タイトル」が入って選択状態になる
   ・cellEdit : 間口をダブルクリックすると入力欄が出て、Enter で確定。
               1 行目は全列を結合したタイトル行 (太字・全幅の中央)
   ・merge    : 1 行目には列の仕切り線が無く、どこを突いても 0_0 の記入。
               表に注記の文字が重なっていても間口の記入が開く
   ・resize   : 選択中に列の仕切りの■をつまんで動かすと、その列の幅が変わる
   ・addDel   : プロパティから行・列を追加/削除できる (消えた列の文字も消える)
   ・move     : 表をつかんで動かせる
   ・print    : 印刷用 SVG にも表が出る
   ・dxf      : DXF に罫線と文字 (Fit 幅) が出る
   ・del      : Delete で表が消える */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = {};
Object.assign(R, await p.evaluate(() => {
  App.project = newProject("表"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  UI.refresh(true); zoomFit();
  UI.insertTable();
  const tb = pageTables(curPage())[0];
  return { insert: { made: !!tb, cols: tb.cols.length, rows: tb.rows.length,
    title: tb.cells["0_0"], selected: App.selection.has(tb.id) } };
}));
await p.waitForTimeout(300);
const S = await p.evaluate(() => {
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], v: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const at = (x, y) => ({ x: S.bb[0] + S.v[0] + x * S.v[2], y: S.bb[1] + S.v[1] + y * S.v[2] });
const T = await p.evaluate(() => { const tb = pageTables(curPage())[0]; return { x: tb.x, y: tb.y }; });

// ── 間口 (2 行目 2 列目) をダブルクリックして記入 ──
let c = at(T.x + 45, T.y + 12);
await p.mouse.dblclick(c.x, c.y);
await p.waitForTimeout(250);
R.cellInput = await p.evaluate(() => !!document.querySelector("#overlay-root input"));
await p.keyboard.type("W600");
await p.keyboard.press("Enter");
await p.waitForTimeout(200);
Object.assign(R, await p.evaluate(() => {
  const tb = pageTables(curPage())[0];
  const svg = tablesSVG(curPage(), { print: true });
  // 1 行目 (結合タイトル行): 仕切り縦線は 2 行目 (y + rows[0]) から始まる
  const rc = tableRect(tb);
  const divTop = new RegExp("M" + (tb.x + tb.cols[0]) + "," + (tb.y + tb.rows[0]) + " V");
  // タイトル行のどこ (右端の列の位置) を突いても 0_0
  const cTitle = tableCellAt(tb, tb.x + rc.w - 3, tb.y + 2);
  return { cellEdit: { saved: tb.cells["1_1"] === "W600",
    boldTitle: /font-weight="bold">タイトル</.test(svg), drawn: svg.includes("W600") },
    merge: { divFromRow2: divTop.test(svg), noTopDiv: !svg.includes("M" + (tb.x + tb.cols[0]) + "," + tb.y + " V"),
      titleAnywhere: !!cTitle && cTitle.r === 0 && cTitle.c === 0 && cTitle.w === rc.w } };
}));
// 表に重なる注記の文字があっても、間口のダブルクリックが開く
await p.evaluate(() => {
  const tb = pageTables(curPage())[0];
  curPage().texts.push({ id: "tov", x: tb.x + 45, y: tb.y + 14, text: "重なる注記", size: 5 });
  UI.refresh(false);
});
await p.waitForTimeout(150);
{
  const c2 = at(T.x + 45, T.y + 12);
  await p.mouse.dblclick(c2.x, c2.y);
  await p.waitForTimeout(250);
  R.overlap = await p.evaluate(() => {
    const inp = document.querySelector("#overlay-root input");
    const ok = !!inp && inp.value !== "重なる注記";   // 文字編集ではなく間口の記入
    if (inp) { inp.blur(); }
    const pg2 = curPage();
    pg2.texts = pg2.texts.filter(t2 => t2.id !== "tov");
    UI.refresh(false);
    return ok;
  });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(150);
}

// ── 列の仕切り (列 0 の右端・上辺の■) をつまんで +10mm ──
await p.evaluate(() => { const tb = pageTables(curPage())[0]; App.selection.clear(); App.selection.add(tb.id); UI.refresh(false); });
await p.waitForTimeout(200);
// 列のつまみは 2 行目の上端 (1 行目は結合タイトル行で仕切りが無い)
const g0 = at(T.x + 30, T.y + 8);
await p.mouse.move(g0.x, g0.y);
await p.mouse.down();
const g1 = at(T.x + 40, T.y + 8);
await p.mouse.move(g1.x, g1.y, { steps: 4 });
await p.mouse.up();
await p.waitForTimeout(200);
R.resize = await p.evaluate(() => {
  const tb = pageTables(curPage())[0];
  return { col0: tb.cols[0], others: tb.cols[1] === 30 && tb.cols[2] === 30 };
});

// ── プロパティで行・列の追加/削除 ──
Object.assign(R, await p.evaluate(() => {
  const tb = pageTables(curPage())[0];
  App.selection.clear(); App.selection.add(tb.id); UI.showProps();
  const has = ["#tbAddCol", "#tbAddRow", "#tbDelCol", "#tbDelRow"].every(id2 => document.querySelector(id2));
  document.querySelector("#tbAddCol").click();
  document.querySelector("#tbAddRow").click();
  const grew = tb.cols.length === 4 && tb.rows.length === 4;
  tb.cells["1_3"] = "消える文字";
  document.querySelector("#tbDelCol").click();
  const colDel = tb.cols.length === 3 && tb.cells["1_3"] === undefined;
  document.querySelector("#tbDelRow").click();
  return { addDel: { has, grew, colDel, rows: tb.rows.length } };
}));

// ── 移動 (本体をつかむ) と DXF・印刷 ──
Object.assign(R, await p.evaluate(() => {
  const tb = pageTables(curPage())[0];
  const x0 = tb.x, y0 = tb.y;
  // 汎用移動 (attachSelection → applyMove) を直接呼ぶ
  App.selection.clear(); App.selection.add(tb.id);
  const att = buildMoveAttachment();
  applyMove(att, 15, 10);
  const moved = tb.x === x0 + 15 && tb.y === y0 + 10;
  const dxf = pageToDXF(curPage()); applySheet(curPage());
  const dxfOk = dxf.includes("タイトル") &&
    /0\nTEXT\n8\nTEXT\n7\nJP\n[\s\S]{0,80}?72\n5\n/.test(dxf.slice(dxf.indexOf("1\n" + dxfEscape("W600")) - 300)) &&
    dxf.includes("W600");
  const prt = exportSheetSVG(curPage()).includes("W600");
  return { move: moved, dxf: dxfOk, print: prt };
}));

// ── Delete で消える ──
c = at(0, 0); // 適当な場所は不要 — キーで消す
await p.evaluate(() => { UI.refresh(false); Editor.svg.focus(); });
await p.keyboard.press("Delete");
await p.waitForTimeout(200);
R.del = await p.evaluate(() => pageTables(curPage()).length === 0);

const checks = {
  noPageErrors: errs.length === 0,
  insert: R.insert.made === true && R.insert.cols === 3 && R.insert.rows === 3 &&
    R.insert.title === "タイトル" && R.insert.selected === true,
  cellEdit: R.cellInput === true && R.cellEdit.saved === true &&
    R.cellEdit.boldTitle === true && R.cellEdit.drawn === true,
  merge: R.merge.divFromRow2 === true && R.merge.noTopDiv === true &&
    R.merge.titleAnywhere === true && R.overlap === true,
  resize: Math.abs(R.resize.col0 - 40) <= 0.5 && R.resize.others === true,   // マウス丸めで ±0.5mm
  addDel: R.addDel.has === true && R.addDel.grew === true && R.addDel.colDel === true && R.addDel.rows === 3,
  move: R.move === true,
  dxf: R.dxf === true,
  print: R.print === true,
  del: R.del === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("table OK");
