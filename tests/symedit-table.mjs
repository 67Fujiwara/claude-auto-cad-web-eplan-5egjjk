/* シンボル作成画面のパラメーター表 (k:"table")。

   ・toolListed  : ツール一覧に「表」があり、ボタンが出る
   ・place       : 表ツールでクリック → 3列×3行の表が置かれ、選択ツールへ移って
                   その表が選択される
   ・panel       : 左の欄に「表 (選択中)」が現れ、列数=3・行数=3 を映す
   ・colsRows    : 列数 5・行数 4 に変更 → colWs/rowHs とセルの器が追従する
                   (列行の変更)
   ・divDrag     : 罫線 (1本目の縦罫) をドラッグ → その列の幅だけ変わる。
                   右端の外枠ドラッグで最終列も伸びる (サイズ変更)
   ・cellEdit    : セルをダブルクリック → prompt の文字がセルに入り描画される
   ・move        : 表の中をつまんでドラッグ → x,y が動く
   ・rotate      : 回転 90° → 列幅と行高が入れ替わり、セルの中身も転置される
   ・undo        : 元に戻す → 回転前の列数へ戻る
   ・saveReedit  : 登録すると body に罫線と文字が入り、再編集で表のまま開ける */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = {};
await p.evaluate(() => UI.openSymbolEditor());
await p.waitForTimeout(150);

R.toolListed = await p.evaluate(() =>
  SYMEDIT_TOOLS.some(t => t[0] === "table") && !!document.querySelector('.se-tool[data-t="table"]'));

// mm → 画面座標
const scr = (x, y) => p.evaluate(([x2, y2]) => {
  const m = SymEdit.svg.getScreenCTM();
  return { x: m.a * x2 + m.c * y2 + m.e, y: m.b * x2 + m.d * y2 + m.f };
}, [x, y]);

// ── 表ツールで配置 (実クリック) ──
await p.click('.se-tool[data-t="table"]');
{
  const c = await scr(-20, -15);
  await p.mouse.click(c.x, c.y);
}
await p.waitForTimeout(120);
R.place = await p.evaluate(() => {
  const S = SymEdit;
  const t = S.shapes.find(sh => sh.k === "table");
  return {
    made: !!t, cols: t && t.colWs.length, rows: t && t.rowHs.length,
    cellsOk: t && t.cells.length === 3 && t.cells.every(r => r.length === 3),
    tool: S.tool, selected: t && S.shapes[S.sel] === t,
    x: t && t.x, y: t && t.y,
  };
});

R.panel = await p.evaluate(() => ({
  shown: document.querySelector("#seTblProps").style.display !== "none",
  cols: document.querySelector("#seTblCols").value,
  rows: document.querySelector("#seTblRows").value,
}));

// ── 列数・行数の変更 ──
R.colsRows = await p.evaluate(() => {
  const set = (id, v) => {
    const el = document.querySelector(id);
    el.value = String(v);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set("#seTblCols", 5);
  set("#seTblRows", 4);
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return {
    cols: t.colWs.length, rows: t.rowHs.length,
    cellsRows: t.cells.length, cellsCols: t.cells.every(r => r.length === 5),
  };
});

// ── 罫線ドラッグで列幅変更 (1本目の縦罫を +4mm) ──
const t0 = await p.evaluate(() => {
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return { x: t.x, y: t.y, colWs: [...t.colWs], rowHs: [...t.rowHs] };
});
{
  const from = await scr(t0.x + t0.colWs[0], t0.y + 2);
  const to = await scr(t0.x + t0.colWs[0] + 4, t0.y + 2);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 4 });
  await p.mouse.up();
}
await p.waitForTimeout(80);
// 右端の外枠を +6mm → 最終列が伸びる
const t1 = await p.evaluate(() => {
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return { colWs: [...t.colWs], W: symTableWH(t)[0], x: t.x, y: t.y };
});
{
  const from = await scr(t1.x + t1.W, t1.y + 2);
  const to = await scr(t1.x + t1.W + 6, t1.y + 2);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 4 });
  await p.mouse.up();
}
await p.waitForTimeout(80);
R.divDrag = await p.evaluate(([c0]) => {
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return { col0: t.colWs[0], was: c0.colWs[0], last: t.colWs[t.colWs.length - 1], lastWas: c0.colWs[c0.colWs.length - 1] };
}, [t0]);

// ── セルのダブルクリックで文字 ──
R.cellEdit = await p.evaluate(() => {
  const S = SymEdit;
  const t = S.shapes.find(sh => sh.k === "table");
  window.prompt = () => "AC100V";
  const m = S.svg.getScreenCTM();
  const cx = t.x + t.colWs[0] / 2, cy = t.y + t.rowHs[0] / 2;
  S.svg.dispatchEvent(new MouseEvent("dblclick", {
    bubbles: true, clientX: m.a * cx + m.c * cy + m.e, clientY: m.b * cx + m.d * cy + m.f,
  }));
  return {
    cell: t.cells[0][0],
    drawn: S.svg.innerHTML.includes(">AC100V</text>"),
    inBody: symShapesToBody(S.shapes).includes(">AC100V</text>"),
  };
});

// ── 表の中をつまんで移動 ──
const tm = await p.evaluate(() => {
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  SymEdit.sel = SymEdit.shapes.indexOf(t);
  return { x: t.x, y: t.y, c0: t.colWs[0], r0: t.rowHs[0] };
});
{
  const from = await scr(tm.x + tm.c0 / 2, tm.y + tm.r0 / 2);   // 罫線から離れたセル中央
  const to = await scr(tm.x + tm.c0 / 2 + 10, tm.y + tm.r0 / 2 + 5);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 4 });
  await p.mouse.up();
}
await p.waitForTimeout(80);
R.move = await p.evaluate(([o]) => {
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return { dx: t.x - o.x, dy: t.y - o.y, colKept: t.colWs[0] === o.c0 };
}, [tm]);

// ── 回転 90° (列幅・行高の入れ替え + セル転置) ──
R.rotate = await p.evaluate(() => {
  const S = SymEdit;
  const t = S.shapes.find(sh => sh.k === "table");
  S.sel = S.shapes.indexOf(t); S.msel = { shapes: [], pins: [] };
  t.cells[0][1] = "B";                      // 転置の目印
  const before = { colWs: [...t.colWs], rowHs: [...t.rowHs], rows: t.rowHs.length };
  document.querySelector("#seRot").click();
  const okDims = t.colWs.length === before.rowHs.length && t.rowHs.length === before.colWs.length;
  // 旧 (0行,1列) は 新 (1行, 旧行数-1 列) へ
  const okCell = t.cells[1][before.rows - 1] === "B";
  const okW = JSON.stringify(t.rowHs) === JSON.stringify(before.colWs);
  return { okDims, okCell, okW, cols: t.colWs.length, rows: t.rowHs.length };
});

// ── 元に戻す ──
R.undo = await p.evaluate(() => {
  document.querySelector("#seUndo").click();
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  return { cols: t.colWs.length, rows: t.rowHs.length };
});

// ── 登録 → 再編集で表のまま ──
R.saveReedit = await p.evaluate(async () => {
  document.querySelector("#seName").value = "パラメータ表テスト";
  window.confirm = () => true;
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 120));
  const sym = DB_SYMBOLS.find(s => s.name === "パラメータ表テスト");
  const bodyHas = sym && sym.body.includes(">AC100V</text>") && sym.body.includes("<path");
  UI.openSymbolEditor(sym.id);
  await new Promise(r => setTimeout(r, 120));
  const t = SymEdit.shapes.find(sh => sh.k === "table");
  const ok = { saved: !!sym, bodyHas, reeditTable: !!t, cells: t && t.cells[0][0] };
  document.querySelector("#seCancel").click();
  return ok;
});

const checks = {
  noPageErrors: errs.length === 0,
  toolListed: R.toolListed === true,
  place: R.place.made && R.place.cols === 3 && R.place.rows === 3 && R.place.cellsOk
    && R.place.tool === "select" && R.place.selected === true,
  panel: R.panel.shown && R.panel.cols === "3" && R.panel.rows === "3",
  colsRows: R.colsRows.cols === 5 && R.colsRows.rows === 4 && R.colsRows.cellsRows === 4 && R.colsRows.cellsCols === true,
  divDrag: Math.abs(R.divDrag.col0 - (R.divDrag.was + 4)) < 0.6 && Math.abs(R.divDrag.last - (R.divDrag.lastWas + 6)) < 0.6,
  cellEdit: R.cellEdit.cell === "AC100V" && R.cellEdit.drawn && R.cellEdit.inBody,
  move: Math.abs(R.move.dx - 10) < 1.1 && Math.abs(R.move.dy - 5) < 1.1 && R.move.colKept,
  rotate: R.rotate.okDims && R.rotate.okCell && R.rotate.okW,
  undo: R.undo.cols === 5 && R.undo.rows === 4,
  saveReedit: R.saveReedit.saved && R.saveReedit.bodyHas && R.saveReedit.reeditTable && R.saveReedit.cells === "AC100V",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("symedit-table OK");
