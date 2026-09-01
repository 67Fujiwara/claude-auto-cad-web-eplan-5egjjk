/* シンボルデータベース統合とシンボル作成の強化。

   ・decompose     : ライブラリ全記号 (寸法違い・結線図下地を除く 100+ 種) の body が
                     作画図形へ分解でき、描き直しても外接箱が 0.6mm 以内で一致する。
                     分解できず raw (塊) で残る記号は曲線持ちの数個だけ
   ・catSwap       : 記号の分類 (パレットの棚) をデータベースで入れ替えられる
                     (近接センサ → アウトプット機器へ移すとパレットの棚が変わる)
   ・dbAll         : シンボルデータベースに全記号が載り、分類の選択・編集ボタンが付く
   ・editOpen      : 規格記号 (コイル) がシンボル編集で個々の図形として開ける
   ・dup           : 選択した図形を「複製」で +5mm ずらして写せる
   ・rotate        : 選択を 90° 回転できる (線の座標が回る)
   ・rotateAll     : 未選択の回転は全体 (端子も 5mm グリッドを保って回る)
   ・insert        : 「シンボルを挿入…」で既存記号 (端子) を作画へ取り込める
                     (クリックした位置に図形と端子が入る)
   ・saveOverride  : 規格記号を上書き保存すると全域 (辞書・配列) が置き換わり、
                     edited フラグと localStorage への保存が付く
   ・revert        : 上書きした規格記号を元の図形へ復元できる
   ・stretchCopy   : 寸法違い記号 (多芯ケーブル) は複製として開く (上書きしない) */
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

// ── 分解の忠実度 (全記号) ──
R.decompose = await p.evaluate(() => {
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px";
  document.body.appendChild(probe);
  const bboxOf = (bd) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("fill", "none"); g.setAttribute("stroke", "#000"); g.setAttribute("stroke-width", "0.5");
    g.innerHTML = bd;
    probe.appendChild(g);
    let r = null;
    try { const bb = g.getBBox(); r = [bb.x, bb.y, bb.width, bb.height]; } catch (e) { }
    g.remove();
    return r;
  };
  let n = 0, rawSyms = 0;
  const bad = [];
  [...SYMBOLS, ...DB_SYMBOLS].forEach(s => {
    if (!s.body || s.stretch || s.unitSheet) return;
    n++;
    const shapes = symBodyToShapes(s.body);
    if (shapes.some(x => x.k === "raw")) rawSyms++;
    const b0 = bboxOf(symBodySVG(s)), b1 = bboxOf(symBodySVG({ ...s, body: symShapesToBody(shapes) }));
    if (!b0 || !b1) { bad.push(s.id + ":empty"); return; }
    const d = Math.max(...b0.map((v, i2) => Math.abs(v - b1[i2])));
    if (d > 0.6) bad.push(`${s.id}:${d.toFixed(2)}`);
  });
  probe.remove();
  return { n, bad, rawSyms };
});

// ── 分類の入れ替え ──
R.catSwap = await p.evaluate(() => {
  const before = symCatOf(SYMBOLS_BY_ID.prox);
  setSymCat("prox", "output");
  UI.buildPalette();
  const catNames = [...document.querySelectorAll("#symTree .sym-cat")].map(el => ({
    name: el.querySelector(".sym-cat-head span:nth-child(3)").textContent,
    items: [...el.querySelectorAll(".sym-name")].map(x => x.textContent),
  }));
  const inOut = catNames.find(c => c.name === "アウトプット機器");
  const inIn = catNames.find(c => c.name === "インプット機器");
  const moved = !!inOut && inOut.items.includes("近接センサ") && !!inIn && !inIn.items.includes("近接センサ");
  setSymCat("prox", "input");   // 元に戻す (既定と同じなら記録も消える)
  UI.buildPalette();
  return { before, moved, after: symCatOf(SYMBOLS_BY_ID.prox), stored: localStorage.getItem("electracad.symCats") };
});

// ── データベースに全記号 ──
R.dbAll = await p.evaluate(() => {
  UI.openSymDB();
  const cards = document.querySelectorAll("#dbGrid .wiz-card").length;
  const catSel = document.querySelectorAll("#dbGrid select[data-cat]").length;
  const editBtn = document.querySelectorAll("#dbGrid [data-edit]").length;
  const seen = new Set();
  const total = [...SYMBOLS, ...DB_SYMBOLS].filter(s => seen.has(s.id) ? false : (seen.add(s.id), true)).length;
  document.querySelector(".modal-close").click();
  return { cards, catSel, editBtn, total, moreThanLib: total > SYMBOLS.length };
});

// ── 規格記号の編集 (分解して開く) ──
R.editOpen = await p.evaluate(() => {
  UI.openSymbolEditor("coil");
  return { editing: SymEdit.editingId, nShapes: SymEdit.shapes.length,
    raw: SymEdit.shapes.filter(s => s.k === "raw").length, pins: SymEdit.pins.length };
});

// ── 複製 (+5mm) ──
R.dup = await p.evaluate(() => {
  const S = SymEdit;
  const n0 = S.shapes.length;
  S.msel = { shapes: [0], pins: [] }; S.sel = -1;
  const src = deepCopy(S.shapes[0]);
  document.querySelector("#seDup").click();
  const added = S.shapes.length - n0;
  const c = S.shapes[S.shapes.length - 1];
  const off = src.k === "line" && c.k === "line"
    ? [c.pts[0][0] - src.pts[0][0], c.pts[0][1] - src.pts[0][1]]
    : [c.x - src.x, c.y - src.y];
  return { added, off, mselOn: S.msel.shapes.length === 1 };
});

// ── 回転 (選択 / 全体) ──
R.rotate = await p.evaluate(() => {
  const S = SymEdit;
  S.undo = [];
  S.shapes = [{ k: "line", pts: [[0, 0], [10, 0]], style: "solid" }];
  S.pins = []; S.msel = { shapes: [0], pins: [] }; S.sel = -1;
  document.querySelector("#seRot").click();
  const sel = deepCopy(S.shapes[0].pts);
  // 全体回転 (端子込み)。中心は外接箱の中心 → 5mm グリッド
  S.shapes = [{ k: "line", pts: [[0, 0], [0, 20]], style: "solid" }];
  S.pins = [{ x: 0, y: 0, n: "1" }, { x: 0, y: 20, n: "2" }];
  S.msel = { shapes: [], pins: [] }; S.sel = -1;
  document.querySelector("#seRot").click();
  return { sel, all: { pts: deepCopy(S.shapes[0].pts), pins: deepCopy(S.pins.map(q => [q.x, q.y])) } };
});

// ── 既存シンボルの挿入 ──
await p.evaluate(() => {
  const S = SymEdit;
  S.shapes = []; S.pins = []; S.msel = { shapes: [], pins: [] }; S.sel = -1; S.tool = "select";
  document.querySelector("#seIns").click();
});
await p.waitForTimeout(120);
await p.evaluate(() => { document.querySelector('[data-ins="terminal"]').click(); });
await p.waitForTimeout(120);
{
  const bb = await (await p.$("#seCanvas")).boundingBox();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
}
R.insert = await p.evaluate(() => {
  const S = SymEdit;
  return { nShapes: S.shapes.length, nPins: S.pins.length,
    pinOnGrid: S.pins.every(q => q.x % 5 === 0 && q.y % 5 === 0),
    pending: !!S.pendingInsert, msel: S.msel.shapes.length + S.msel.pins.length };
});
await p.evaluate(() => { document.querySelector(".modal-close").click(); });

/* ── 規格記号の編集 = 新しい版 (coil~2) として登録される ──
   規格の coil はそのまま。パレットには新しい版だけが出て、
   「元に戻す」で版を退かせるとパレットに規格の coil が戻る */
R.override = await p.evaluate(async () => {
  const origBody = SYMBOLS_BY_ID.coil.body;
  UI.openSymbolEditor("coil");
  SymEdit.shapes.push({ k: "line", pts: [[0, 25], [5, 25]], style: "solid" });
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 60));
  const ver = SYMBOLS_BY_ID["coil~2"];
  const saved = (() => {
    try { return (JSON.parse(localStorage.getItem("electracad.importedSyms")) || []).some(s => s.id === "coil~2" && s.edited); }
    catch (e) { return false; }
  })();
  const inPal = allSymbols().map(s => s.id);
  const out = {
    edited: !!(ver && ver.edited), verOf: ver && ver.verOf,
    stdKept: SYMBOLS_BY_ID.coil.body === origBody,            // 規格側は書き換えない
    bodyChanged: !!ver && ver.body !== origBody, saved,
    stillLogic: !!ver && symCatOf(ver) === "logic",
    palVer: inPal.includes("coil~2"), palStdHidden: !inPal.includes("coil"),
  };
  // 「元に戻す」= 版を退かせる → パレットに規格の coil が戻る。定義は残る
  symRetireVersions("coil");
  const pal2 = allSymbols().map(s => s.id);
  out.reverted = pal2.includes("coil") && !pal2.includes("coil~2")
    && SYMBOLS_BY_ID.coil.body === origBody && !!SYMBOLS_BY_ID["coil~2"];
  saveImportedSymbols();
  return out;
});

// ── 寸法違いは複製として開く ──
R.stretchCopy = await p.evaluate(() => {
  UI.openSymbolEditor("cable_core");
  const r = { editing: SymEdit.editingId, name: document.querySelector("#seName").value, nShapes: SymEdit.shapes.length };
  document.querySelector("#seCancel").click();
  return r;
});

const checks = {
  noPageErrors: errs.length === 0,
  decompose: R.decompose.n >= 100 && R.decompose.bad.length === 0 && R.decompose.rawSyms <= 5,
  catSwap: R.catSwap.before === "input" && R.catSwap.moved && R.catSwap.after === "input" && R.catSwap.stored === "{}",
  dbAll: R.dbAll.cards === R.dbAll.total && R.dbAll.catSel === R.dbAll.total && R.dbAll.editBtn === R.dbAll.total && R.dbAll.moreThanLib,
  editOpen: R.editOpen.editing === "coil" && R.editOpen.nShapes > 1 && R.editOpen.raw === 0 && R.editOpen.pins === 2,
  dup: R.dup.added === 1 && R.dup.off[0] === 5 && R.dup.off[1] === 5 && R.dup.mselOn,
  rotate: JSON.stringify(R.rotate.sel) === "[[5,-5],[5,5]]",
  rotateAll: JSON.stringify(R.rotate.all.pts) === "[[10,10],[-10,10]]" &&
    JSON.stringify(R.rotate.all.pins) === "[[10,10],[-10,10]]",
  insert: R.insert.nShapes >= 2 && R.insert.nPins === 2 && R.insert.pinOnGrid && !R.insert.pending && R.insert.msel > 0,
  override: R.override.edited && R.override.verOf === "coil" && R.override.stdKept
    && R.override.bodyChanged && R.override.saved && R.override.stillLogic
    && R.override.palVer && R.override.palStdHidden,
  revert: R.override.reverted,
  stretchCopy: R.stretchCopy.editing === null && R.stretchCopy.name.includes("複製") && R.stretchCopy.nShapes >= 1,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
