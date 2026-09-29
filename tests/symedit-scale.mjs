/* シンボル作成画面の縮小・拡大 (倍率 %)。

   ・whole50 : 未選択で 50% → 図全体が外接箱の中央を基準に半分になる。
              寸法 (角R・円の半径・文字高さ) も一緒に半分
   ・pins    : 端子も一緒に動き、0.5mm 刻み (微調整と同じ) に乗る
   ・undo    : 「元に戻す」で縮小前の座標に戻る
   ・selOnly : 図形を選んでいるときは選択だけが変わる (他はそのまま)
   ・raw     : 分解できない要素 (raw) は scale() で縮む (SVG に出る)
   ・register: 縮小した姿で登録され、body に縮小後の寸法が入る */
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
  App.project = newProject("縮小の確認"); UI.renumberPages();
  UI.openSymbolEditor();
  const S = SymEdit;
  S.shapes.push(
    { k: "rect", x: -10, y: -10, w: 20, h: 20, r: 2, rc: "nw" },
    { k: "line", pts: [[-10, 0], [10, 0]] },
    { k: "circle", x: 0, y: 15, r: 5 },
    { k: "text", x: 0, y: -15, h: 5, text: "AB" },
    { k: "raw", body: '<path d="M-5,0 H5"/>', dx: 0, dy: 5 },
  );
  S.pins.push({ x: 0, y: -20, n: "1" }, { x: 0, y: 15, n: "2" });
  const undoLen0 = S.undo.length;

  // ── 未選択で 75% → 端子 (0,15) は 11.25 → 0.5 刻みで 11.5 ──
  window.prompt = () => "75";
  document.getElementById("seScale").click();
  out.pins75 = { y: S.pins[1].y, undoGrew: S.undo.length === undoLen0 + 1 };
  document.getElementById("seUndo").click();
  out.undo = { rectW: S.shapes[0].w, pinY: S.pins[1].y, circleR: S.shapes[2].r };

  // ── 未選択で 50% → 全体が半分 ──
  window.prompt = () => "50";
  document.getElementById("seScale").click();
  out.whole50 = {
    rect: [S.shapes[0].x, S.shapes[0].y, S.shapes[0].w, S.shapes[0].h, S.shapes[0].r],
    line: S.shapes[1].pts, circle: [S.shapes[2].x, S.shapes[2].y, S.shapes[2].r],
    text: [S.shapes[3].y, S.shapes[3].h],
    raw: [S.shapes[4].dy, S.shapes[4].sc],
    pins: S.pins.map(q => [q.x, q.y]),
  };
  out.rawSvg = /scale\(0\.5\)/.test(symShapeSVG(S.shapes[4]));

  // ── 選択だけ縮小: 円 (r=2.5) を選んで 200% → 円だけ r=5 に戻る ──
  S.sel = -1; S.msel = { shapes: [2], pins: [] };
  window.prompt = () => "200";
  document.getElementById("seScale").click();
  out.selOnly = { circleR: S.shapes[2].r, rectW: S.shapes[0].w };

  // ── 登録: 縮小後の姿が body に入る ──
  S.msel = { shapes: [], pins: [] };
  document.getElementById("seName").value = "縮小テスト機器";
  window.confirm = () => true;
  document.getElementById("seOk").click();
  await new Promise(r => setTimeout(r, 200));
  const sym = [...DB_SYMBOLS].reverse().find(s => s.name === "縮小テスト機器");
  out.register = { has: !!sym, body: sym && /r="5"/.test(sym.body) && sym.body.includes('data-rr="-5,-5,10,10,1,nw"') };
  return out;
});

const near = (a, b2) => Math.abs(a - b2) < 1e-6;
const checks = {
  noPageErrors: errs.length === 0,
  /* 中心 (0,0)・50%: rect(-5,-5,10,10,R1) / 線 ±5 / 円 (0,7.5,r2.5) /
     文字 y=-7.5 h=2.5 / raw dx,dy=2.5 sc=0.5 */
  whole50: near(R.whole50.rect[0], -5) && near(R.whole50.rect[2], 10) &&
    near(R.whole50.rect[3], 10) && near(R.whole50.rect[4], 1) &&
    near(R.whole50.line[0][0], -5) && near(R.whole50.line[1][0], 5) &&
    near(R.whole50.circle[1], 7.5) && near(R.whole50.circle[2], 2.5) &&
    near(R.whole50.text[0], -7.5) && near(R.whole50.text[1], 2.5) &&
    near(R.whole50.raw[0], 2.5) && near(R.whole50.raw[1], 0.5),
  pins: near(R.pins75.y, 11.5) && R.pins75.undoGrew === true &&
    near(R.whole50.pins[0][1], -10) && near(R.whole50.pins[1][1], 7.5),
  undo: near(R.undo.rectW, 20) && near(R.undo.pinY, 15) && near(R.undo.circleR, 5),
  selOnly: near(R.selOnly.circleR, 5) && near(R.selOnly.rectW, 10),
  raw: R.rawSvg === true,
  register: R.register.has === true && R.register.body === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("symedit-scale OK");
