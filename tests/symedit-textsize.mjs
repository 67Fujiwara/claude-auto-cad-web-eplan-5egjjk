/* シンボル作成の文字の高さ。

   従来は文字ツールで置く文字が 3.5mm 固定で、置いたあとも変えられなかった。

   ・field      : 左の欄に「文字の高さ」があり、既定は図記号の標準 3.5mm
   ・newText    : 欄で選んだ高さで新しい文字が置かれる
   ・resize     : 文字を選んでから欄を変えると、その文字の高さが変わる
   ・reflect    : 文字を選ぶと、その文字の高さが欄に映る
                  (一覧に無い高さ — 取り込んだ図面の文字など — も選択肢に出る)
   ・rendered   : 変えた高さが作画キャンバスの描画 (font-size) に効く
   ・saved      : 登録したシンボルの body にその高さ (data-h) が残る
   ・undoable   : 高さの変更は「元に戻す」で戻せる
   ・othersKept : 文字以外 (線・円) は選んでいても高さの変更で壊れない */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const wait = () => new Promise(r => setTimeout(r, 60));
  const setTh = async (v) => {
    const sel = document.querySelector("#seTh");
    if (!sel) return;
    sel.value = String(v);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
  };
  UI.openSymbolEditor();
  const S = SymEdit;
  const thEl = document.querySelector("#seTh");
  out.field = { exists: !!thEl, init: thEl ? thEl.value : null };

  // ── 選んだ高さで新しい文字が置かれる ──
  await setTh(7);
  const oldPrompt = window.prompt;
  window.prompt = () => "PLC";
  S.tool = "text";
  S.svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  await wait();
  window.prompt = oldPrompt;
  const t1 = S.shapes.filter(x => x.k === "text").pop();
  out.newText = { h: t1 && t1.h, text: t1 && t1.text };

  // ── 選んでから高さを変える ──
  // 「元に戻す」は shapes を写しで差し替えるので、添字は都度探し直す
  const idxOfText = () => S.shapes.findIndex(x => x.k === "text" && x.text === "PLC");
  const hOfText = () => { const i = idxOfText(); return i >= 0 ? S.shapes[i].h : null; };
  S.tool = "select";
  const i1 = idxOfText();
  S.msel = { shapes: [i1], pins: [] }; S.sel = -1;
  const undoBefore = S.undo.length;
  await setTh(10);
  out.resize = { h: hOfText(), undoGrew: S.undo.length > undoBefore };

  // 描画に効くか
  const el = [...S.svg.querySelectorAll("text")].find(e => e.textContent === "PLC");
  out.rendered = { fs: el && +el.getAttribute("font-size"), want: svgFontSizeFor("PLC", 10, false, { noMin: true }) };

  // ── 元に戻す ──
  document.querySelector("#seUndo").click();
  await wait();
  const iU = idxOfText();
  out.undone = iU >= 0 ? S.shapes[iU].h : null;

  // ── 選ぶと欄に映る (一覧に無い高さも) ──
  const i2 = idxOfText();
  if (i2 < 0) return { ...out, reflect: {}, othersKept: {}, saved: {} };   // 前段が壊れている
  S.shapes[i2].h = 4.2;                     // 取り込み図面のような半端な高さ
  S.msel = { shapes: [], pins: [] }; S.sel = -1;
  S.tool = "select";
  // 実際にその文字をクリックして選ぶ (作画座標 → 画面座標は SVG の行列で求める)
  {
    const t = S.shapes[i2];
    const m = S.svg.getScreenCTM();
    const pt = S.svg.createSVGPoint();
    pt.x = t.x; pt.y = t.y;
    const q = pt.matrixTransform(m);
    S.svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: q.x, clientY: q.y }));
  }
  await wait();
  const sel2 = document.querySelector("#seTh");
  out.reflect = sel2 ? { value: sel2.value, hasOpt: [...sel2.options].some(o => o.value === "4.2") } : {};

  // ── 文字以外が選択に混ざっても壊れない ──
  S.shapes.push({ k: "line", pts: [[0, 0], [10, 0]], style: "solid" });
  const iLine = S.shapes.length - 1;
  S.msel = { shapes: [idxOfText(), iLine], pins: [] }; S.sel = -1;
  await setTh(5);
  out.othersKept = { textH: hOfText(), line: S.shapes[iLine].k, pts: S.shapes[iLine].pts.length,
    lineHasH: S.shapes[iLine].h !== undefined };

  // ── 登録したシンボルに残る ──
  document.querySelector("#seName").value = "文字高テスト";
  document.querySelector("#seOk").click();
  await wait();
  const sym = DB_SYMBOLS.find(x => x.name === "文字高テスト");
  out.saved = { found: !!sym, dataH: sym && (/data-h="([\d.]+)"/.exec(sym.body) || [])[1] };
  return out;
});

const near = (a, b2, tol = 0.01) => typeof a === "number" && Math.abs(a - b2) <= tol;
const checks = {
  noPageErrors: errs.length === 0,
  field: R.field.exists && R.field.init === "3.5",
  newText: R.newText.text === "PLC" && R.newText.h === 7,
  resize: R.resize.h === 10 && R.resize.undoGrew === true,
  rendered: near(R.rendered.fs, R.rendered.want),
  undoable: R.undone === 7,
  reflect: R.reflect.value === "4.2" && R.reflect.hasOpt === true,
  othersKept: R.othersKept.textH === 5 && R.othersKept.line === "line" &&
    R.othersKept.pts === 2 && R.othersKept.lineHasH === false,
  saved: R.saved.found && R.saved.dataH === "5",
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
