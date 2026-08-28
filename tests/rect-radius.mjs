/* 四角形の角R をプロパティで変更する — 描いた枠をクリックで選び、
   左の「角R (選択中の四角形)」で丸めたり角へ戻したりできる。
   外形の枠なので電気記号の意味は変わらない (端子・線種は据え置き)。

   ・hidden    : 何も選んでいない / 文字を選んでいるときは欄が出ない
   ・shown     : 四角形を選ぶと欄が出て、現在の R (最初は 0) を映す
   ・setR      : 既定は「一か所 (左上)」— 3mm を入れると r=3・rc=nw が付き、
                 画面には円弧 1 つの path (data-rr つき) で描かれる
   ・whichOne  : 指定した角だけが丸まる (右下だけにすると rc=se)
   ・twoCorners: 2 つ以上の角も指定できる (左上+右下 → rc="nw+se"、円弧 2 個)
   ・allFour   : 4 隅すべてにチェックすると rect の rx で描かれる
   ・noneBack  : すべてのチェックを外すと角のままに戻る
   ・rotCorner : 回転 90° で丸める角も一緒に回る (左上 → 右上)
   ・clamp     : 幅・高さの半分を超える値は自動で頭打ち (裏返らない)
   ・zeroBack  : 0 に戻すと r が消えて角のままになる
   ・multi     : 範囲選択した複数の四角形にまとめて効く
   ・undoBack  : 元に戻すで R が消える
   ・reedit    : 登録 → 再編集で開くと r が引き継がれ、欄にも出る
   ・dxfRound  : DXF 出力は丸角 (直線4 + 円弧4) になる
   ・pinsKept  : 端子・他の図形は変わらない
   ・decompose : 図形一覧を持たない記号 (規格ライブラリ・DXF 取り込み) を
                 編集で開くと、body の rx から角R を引き継いで欄にも出る
   ・oneSaved  : 一か所だけ丸めた枠も登録でき、body だけから開き直しても
                 四角形に戻って角R・角の位置が引き継がれる。DXF は
                 円弧 1 個 + 直線 4 本 (丸めた角だけ円弧) で出る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

await p.evaluate(() => UI.openSymbolEditor());
await p.waitForTimeout(150);

// mm → 画面座標
const scr = (x, y) => p.evaluate(([x2, y2]) => {
  const m = SymEdit.svg.getScreenCTM();
  return { x: m.a * x2 + m.c * y2 + m.e, y: m.b * x2 + m.d * y2 + m.f };
}, [x, y]);

const R = {};
R.hidden = await p.evaluate(() => {
  const S = SymEdit;
  S.shapes.push({ k: "rect", x: -10, y: -8, w: 20, h: 16, style: "solid" });
  S.shapes.push({ k: "text", x: 0, y: 12, text: "CN", h: 3.5 });
  S.pins.push({ x: -15, y: 0, n: "1" });
  S.tool = "select"; S.sel = -1; S.msel = { shapes: [], pins: [] };
  UI.openSymbolEditor === undefined;
  return null;   // 描き直しは下のクリックで起こす
});

// 何も選ばない状態で欄が隠れているか
await p.click('.se-tool[data-t="select"]');
await p.waitForTimeout(120);
R.hidden = await p.evaluate(() => document.querySelector("#seRRow").style.display === "none");

// 四角形をクリックして選ぶ (辺の上)
{
  const c = await scr(-10, 0);
  await p.mouse.click(c.x, c.y);
}
await p.waitForTimeout(120);
R.shown = await p.evaluate(() => ({
  visible: document.querySelector("#seRRow").style.display !== "none",
  value: document.querySelector("#seR").value,
  selIsRect: SymEdit.shapes[SymEdit.sel] && SymEdit.shapes[SymEdit.sel].k === "rect",
}));

const setR = async (v) => p.evaluate(async (v2) => {
  const el = document.querySelector("#seR");
  el.value = String(v2);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
}, v);

/* 丸める角をチェックで指定する (配列で渡した角だけ ON にする) */
const setWhich = async (arr) => p.evaluate(async (want) => {
  const boxes = [...document.querySelectorAll(".seRC")];
  boxes.forEach(cb => { cb.checked = want.includes(cb.value); });
  boxes[0].dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
}, arr);

await setR(3);
R.setR = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  const html = SymEdit.svg.innerHTML;
  const on = [...document.querySelectorAll(".seRC")].filter(cb => cb.checked).map(cb => cb.value).join(",");
  return { r: rc.r, corner: rc.rc, which: on,
    path: /data-rr="[^"]*,nw"/.test(html), arcs: (html.match(/A3,3 /g) || []).length,
    noRx: !/<rect[^>]*rx="3"/.test(html) };
});

await setWhich(["se"]);
R.whichOne = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  const html = SymEdit.svg.innerHTML;
  return { corner: rc.rc, path: /data-rr="[^"]*,se"/.test(html), arcs: (html.match(/A3,3 /g) || []).length };
});

// 2 つの角 (左上 + 右下) — 対角に R を付ける
await setWhich(["nw", "se"]);
R.twoCorners = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  const html = SymEdit.svg.innerHTML;
  return { corner: rc.rc, arcs: (html.match(/A3,3 /g) || []).length,
    path: /data-rr="[^"]*,nw\+se"/.test(html) };
});

await setWhich(["nw", "ne", "se", "sw"]);
R.allFour = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { corner: rc.rc, rx: /<rect[^>]*rx="3"/.test(SymEdit.svg.innerHTML) };
});

// すべて外す → 角のまま
await setWhich([]);
R.noneBack = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { r: rc.r === undefined, rx: !/rx=|data-rr/.test(SymEdit.svg.innerHTML) };
});

// 回転 90° で丸める角が追従する
await setWhich(["nw"]);
await p.evaluate(async () => {
  const el = document.querySelector("#seR");
  el.value = "3"; el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
});
R.rotCorner = await p.evaluate(async () => {
  const S = SymEdit;
  const i = S.shapes.findIndex(sh => sh.k === "rect");
  S.sel = i; S.msel = { shapes: [], pins: [] };
  document.querySelector("#seRot").click();
  await new Promise(r => setTimeout(r, 80));
  const after = S.shapes.find(sh => sh.k === "rect").rc;
  document.querySelector("#seUndo").click();
  await new Promise(r => setTimeout(r, 80));
  return after;
});

// 選び直して頭打ちを見る (回転の undo で選択が外れることがある)
await p.evaluate(() => {
  const S = SymEdit;
  S.sel = S.shapes.findIndex(sh => sh.k === "rect");
  S.msel = { shapes: [], pins: [] };
});
await setR(20);      // 幅 20 / 高さ 16 → 頭打ち 8
R.clamp = await p.evaluate(() => SymEdit.shapes.find(sh => sh.k === "rect").r);

await setR(0);
R.zeroBack = await p.evaluate(() => {
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { r: rc.r === undefined && rc.rc === undefined,
    svg: !/rx=/.test(SymEdit.svg.innerHTML) && !/data-rr/.test(SymEdit.svg.innerHTML) };
});

// 複数選択にまとめて効く
R.multi = await p.evaluate(async () => {
  const S = SymEdit;
  S.shapes.push({ k: "rect", x: 14, y: -8, w: 12, h: 12, style: "solid" });
  S.msel = { shapes: S.shapes.map((sh, i) => sh.k === "rect" ? i : -1).filter(i => i >= 0), pins: [] };
  S.sel = -1;
  document.querySelector("#seR").value = "2";
  document.querySelector("#seR").dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  return S.shapes.filter(sh => sh.k === "rect").map(sh => sh.r).join(",");
});

R.undoBack = await p.evaluate(async () => {
  document.querySelector("#seUndo").click();
  await new Promise(r => setTimeout(r, 80));
  return SymEdit.shapes.filter(sh => sh.k === "rect").every(sh => sh.r === undefined);
});

// 角R を付けて登録 → 再編集 → DXF
R.reedit = await p.evaluate(async () => {
  const S = SymEdit;
  S.msel = { shapes: S.shapes.map((sh, i) => sh.k === "rect" ? i : -1).filter(i => i >= 0), pins: [] };
  [...document.querySelectorAll(".seRC")].forEach(cb => { cb.checked = true; });   // 4隅で登録する
  document.querySelector("#seR").value = "2.5";
  document.querySelector("#seR").dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  document.querySelector("#seName").value = "角R枠テスト";
  window.confirm = () => true;
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 150));
  const sym = DB_SYMBOLS.find(s => s.name === "角R枠テスト");
  const bodyRx = sym && /<rect[^>]*rx="2.5"/.test(sym.body);
  const prims = sym ? dxfSymPrimitives(sym) : [];
  const dxf = {
    arcs: prims.filter(pr => pr.type === "arc" && Math.abs(pr.r - 2.5) < 0.01).length,
    sides: prims.filter(pr => pr.type === "poly" && pr.pts.length === 2).length,
  };
  dxf.rects = prims.length ? (sym.body.match(/<rect /g) || []).length : 0;
  UI.openSymbolEditor(sym.id);
  await new Promise(r => setTimeout(r, 150));
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { bodyRx, dxf, r: rc && rc.r, pins: SymEdit.pins.length };
});
// 再編集で開いた記号の四角形を実クリックして選ぶ → 欄に R が出る
await p.click('.se-tool[data-t="select"]');
await p.waitForTimeout(120);
{
  const c = await scr(-10, 0);
  await p.mouse.click(c.x, c.y);
}
await p.waitForTimeout(120);
R.reedit.field = await p.evaluate(() => {
  const v = document.querySelector("#seR").value;
  document.querySelector("#seCancel").click();
  return v;
});

// ── 図形一覧を持たない記号 (body だけ) を開く → rx から角R を引き継ぐ ──
R.decompose = await p.evaluate(async () => {
  const sym = {
    id: "test_rx_body", db: true, group: "自作", cat: "db", letter: "X", custom: true, nonstd: true,
    name: "rx だけの記号", nameEn: "rx only", desc: "図形一覧を持たない (body から分解する)",
    pins: [{ x: -12, y: 0, n: "1" }], bounds: [-14, -10, 28, 20], sim: "none",
    body: `<rect x="-10" y="-8" width="20" height="16" rx="3"/>`,
  };
  DB_SYMBOLS.push(sym); SYMBOLS_BY_ID[sym.id] = sym;
  UI.openSymbolEditor(sym.id);
  await new Promise(r => setTimeout(r, 150));
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { hasShapes: !sym.shapes, r: rc && rc.r };
});
await p.click('.se-tool[data-t="select"]');
await p.waitForTimeout(120);
{
  const c = await scr(-10, 0);
  await p.mouse.click(c.x, c.y);
}
await p.waitForTimeout(120);
R.decompose.field = await p.evaluate(() => {
  const v = document.querySelector("#seR").value;
  document.querySelector("#seCancel").click();
  return v;
});

// ── 一か所だけ丸めた枠を body だけの記号として開き直す + DXF ──
R.oneSaved = await p.evaluate(async () => {
  UI.openSymbolEditor();
  await new Promise(r => setTimeout(r, 120));
  const S = SymEdit;
  S.shapes.push({ k: "rect", x: -10, y: -8, w: 20, h: 16, style: "solid", r: 3, rc: "se" });
  S.pins.push({ x: -15, y: 0, n: "1" });
  const bodyOne = symShapesToBody(S.shapes);
  const sym = {
    id: "test_one_corner", db: true, group: "自作", cat: "db", letter: "X", custom: true, nonstd: true,
    name: "一か所R の枠", nameEn: "one corner", desc: "右下だけ丸めた枠 (body のみ)",
    pins: [{ x: -15, y: 0, n: "1" }], bounds: [-17, -10, 34, 20], sim: "none", body: bodyOne,
  };
  DB_SYMBOLS.push(sym); SYMBOLS_BY_ID[sym.id] = sym;
  const prims = dxfSymPrimitives(sym);
  const dxf = {
    arcs: prims.filter(pr => pr.type === "arc" && Math.abs(pr.r - 3) < 0.01).length,
    // 直線は連続ぶんがポリラインにまとまるので、線分の本数で数える
    segs: prims.filter(pr => pr.type === "poly").reduce((n, pr) => n + pr.pts.length - 1, 0),
  };
  document.querySelector("#seCancel").click();     // 先に閉じてから開き直す (画面を重ねない)
  await new Promise(r => setTimeout(r, 100));
  UI.openSymbolEditor(sym.id);
  await new Promise(r => setTimeout(r, 150));
  const rc = SymEdit.shapes.find(sh => sh.k === "rect");
  return { hasDataRr: /data-rr="[^"]*,se"/.test(bodyOne), dxf, r: rc && rc.r, corner: rc && rc.rc };
});
await p.click('.se-tool[data-t="select"]');
await p.waitForTimeout(120);
{
  const c = await scr(-10, 0);
  await p.mouse.click(c.x, c.y);
}
await p.waitForTimeout(120);
R.oneSaved.field = await p.evaluate(() => ({
  r: document.querySelector("#seR").value,
  which: [...document.querySelectorAll(".seRC")].filter(cb => cb.checked).map(cb => cb.value).join(","),
}));

const checks = {
  noPageErrors: errs.length === 0,
  hidden: R.hidden === true,
  shown: R.shown.visible && R.shown.value === "0" && R.shown.selIsRect,
  setR: R.setR.r === 3 && R.setR.corner === "nw" && R.setR.which === "nw"
    && R.setR.path && R.setR.arcs === 1 && R.setR.noRx,
  whichOne: R.whichOne.corner === "se" && R.whichOne.path === true && R.whichOne.arcs === 1,
  twoCorners: R.twoCorners.corner === "nw+se" && R.twoCorners.arcs === 2 && R.twoCorners.path === true,
  noneBack: R.noneBack.r === true && R.noneBack.rx === true,
  allFour: R.allFour.corner === "all" && R.allFour.rx === true,
  rotCorner: R.rotCorner === "ne",
  clamp: R.clamp === 8,
  zeroBack: R.zeroBack.r === true && R.zeroBack.svg === true,
  multi: R.multi === "2,2",
  undoBack: R.undoBack === true,
  reedit: R.reedit.bodyRx === true && R.reedit.r === 2.5 && R.reedit.field === "2.5" && R.reedit.pins === 1,
  // 丸角の四角形 1 個につき 円弧4 + 直線4 (この記号は四角形 2 個)
  dxfRound: R.reedit.dxf.arcs === 4 * R.reedit.dxf.rects && R.reedit.dxf.sides === 4 * R.reedit.dxf.rects
    && R.reedit.dxf.rects === 2,
  decompose: R.decompose.hasShapes === true && R.decompose.r === 3 && R.decompose.field === "3",
  oneSaved: R.oneSaved.hasDataRr && R.oneSaved.r === 3 && R.oneSaved.corner === "se"
    && R.oneSaved.field.r === "3" && R.oneSaved.field.which === "se"
    && R.oneSaved.dxf.arcs === 1 && R.oneSaved.dxf.segs === 4,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("rect-radius OK");
