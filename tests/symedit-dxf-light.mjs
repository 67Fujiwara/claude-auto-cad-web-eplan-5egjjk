/* DXF から取り込んだシンボルの軽量化。

   取り込んだ線分を 1 本ずつ <path> にすると、数千個の要素が図面に置くたび・作画画面で
   ドラッグするたびに作り直されて重い。
   ・compact  : 端点がつながる LINE は 1 本の折れ線につながる (円を 120 分割した 3 個 +
               4 辺の箱 2 個 + 離れた 1 本 → 図形 6 個)。箱と円は閉じた線 (closed) になる
   ・thin     : 円の 120 点は Douglas–Peucker (0.02mm) で間引かれ、どの点も元の円周から
               0.02mm 以内。離れた 1 本・箱の角は動かない
   ・oneElem  : body は飾りの無い実線・円弧をまとめた <path> 1 個 (円弧 ARC も同じ path)。
               破線・塗り・個別線幅の図形は別要素のまま
   ・roundtrip: body → 図形 (symBodyToShapes) で同じ数の折れ線・円弧に戻る (再編集できる)
   ・dxf      : 図面に置いて DXF 出力すると、線分の端点の集合がまとめる前と同じ
   ・canvas   : 図面の機器 1 台が要素数個 (数千個ではない)
   ・editor   : 作画画面でも取り込み後の図形は path 1 個。選んだ図形だけ個別に強調される。
               ドラッグ中、外接矩形 (getBBox) の測り直しは座標が変わった回だけ */
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

// 合成 DXF: 円 (120 分割) × 3、箱 × 2、離れた線 1 本、円弧 1 個、破線レイヤは無し
let dxf = "0\nSECTION\n2\nENTITIES\n";
const L = (x1, y1, x2, y2) => { dxf += `0\nLINE\n8\n0\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n`; };
const circles = [[0, 0, 6], [20, 0, 7], [40, 0, 8]];
circles.forEach(([cx, cy, r]) => { for (let i = 0; i < 120; i++) { const a0 = i / 120 * Math.PI * 2, a1 = (i + 1) / 120 * Math.PI * 2;
  L(cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1)); } });
[[0, 20], [10, 20]].forEach(([x, y]) => { L(x, y, x + 4, y); L(x + 4, y + 4, x + 4, y); L(x, y + 4, x + 4, y + 4); L(x, y, x, y + 4); });   // 向きばらばらの 4 辺
L(30, 20, 38, 26);
dxf += "0\nARC\n8\n0\n10\n30\n20\n30\n40\n5\n50\n0\n51\n90\n";
dxf += "0\nENDSEC\n0\nEOF\n";
const tmp = path.join(os.tmpdir(), `symlight-${process.pid}.dxf`);
fs.writeFileSync(tmp, dxf);

const R = await p.evaluate((dxf) => {
  const out = {};
  const ents = parseDXF(dxf);
  const shapes = dxfEntsToShapes(ents, { scale: 1 });
  out.ents = ents.length;
  const lines = shapes.filter(s => s.k === "line"), arcs = shapes.filter(s => s.k === "arc");
  out.compact = { shapes: shapes.length, lines: lines.length, arcs: arcs.length,
    closed: lines.filter(s => s.closed).length, pts: lines.reduce((a, s) => a + s.pts.length, 0) };
  // thin: 円の点が元の円周から 0.02mm 以内 (中心は点の重心)
  const big = lines.filter(s => s.closed && s.pts.length > 10);
  out.thin = { circles: big.length, maxDev: 0, ptsEach: big.map(s => s.pts.length).join(","),
    boxes: lines.filter(s => s.closed && s.pts.length === 4).length, lone: lines.filter(s => !s.closed && s.pts.length === 2).length };
  big.forEach(s => {
    const cx = s.pts.reduce((a, q) => a + q[0], 0) / s.pts.length, cy = s.pts.reduce((a, q) => a + q[1], 0) / s.pts.length;
    const rs = s.pts.map(q => Math.hypot(q[0] - cx, q[1] - cy)); const r = rs.reduce((a, v) => a + v, 0) / rs.length;
    rs.forEach(v => { out.thin.maxDev = Math.max(out.thin.maxDev, Math.abs(v - r)); });
  });
  // oneElem
  const body = symShapesToBody(shapes);
  out.oneElem = { elems: (body.match(/<(path|circle|rect|text)\b/g) || []).length, hasArc: /A5,5 0 0 1/.test(body) || / A5,5 /.test(body) || /A5,5/.test(body) };
  const mixed = symShapesToBody([...shapes, { k: "line", pts: [[0, 0], [5, 5]], style: "dash" }, { k: "line", pts: [[0, 0], [5, 0]], style: "solid", fill: true }]);
  out.oneElem.mixed = (mixed.match(/<path\b/g) || []).length;
  // roundtrip
  const back = symBodyToShapes(body);
  out.roundtrip = { lines: back.filter(s => s.k === "line").length, arcs: back.filter(s => s.k === "arc").length,
    closed: back.filter(s => s.k === "line" && s.closed).length };
  // dxf: まとめる前 (1 図形 1 path) と同じ端点集合
  const bodySep = shapes.map(sh => symShapeSVG(sh)).join("");
  App.project = newProject("軽量化"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage); App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const mk = (id, bd) => { const sym = { id, db: true, group: "自作", cat: "db", letter: "E", name: id, nameEn: id, desc: "", pins: [{ x: 0, y: 0, n: "1" }],
    sim: "none", lw: 0.25, bounds: symShapesBounds(shapes, []), body: bd, shapes, imported: true, custom: true, nonstd: true };
    DB_SYMBOLS.push(sym); SYMBOLS_BY_ID[id] = sym; return sym; };
  mk("lt_merged", body); mk("lt_sep", bodySep);
  const segs = (symId) => { pg.devices.length = 0; addDevice(pg, symId, 100, 100, {}); App.labelRev++;
    const t = pageToDXF(pg);
    return t.split("\n0\nLINE\n").slice(1).filter(s => s.startsWith("8\nSYMBOL") || /\n8\nSYM/.test("\n" + s)).map(s => {
      const g = c => (new RegExp(`\\n${c}\\n(-?[\\d.]+)`).exec("\n" + s) || [])[1]; return [g(10), g(20), g(11), g(21)].join(","); }).sort(); };
  const a = segs("lt_merged"), c = segs("lt_sep");
  out.dxf = { n: a.length, same: JSON.stringify(a) === JSON.stringify(c) && a.length > 100 };
  // canvas
  pg.devices.length = 0; addDevice(pg, "lt_merged", 100, 100, {}); App.labelRev++; renderAll();
  out.canvas = document.querySelectorAll("#lyDevices *").length;
  return out;
}, dxf);

// ── editor ──
await p.evaluate(() => UI.openSymbolEditor());
await p.waitForSelector("#seDxf");
const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#seDxf")]);
await fc.setFiles(tmp);
await p.waitForSelector("#dsOk");
await p.click("#dsOk");
await p.waitForFunction(() => /DXF を読み込みました/.test(document.body.textContent));
const E = await p.evaluate(() => {
  const svg = document.querySelector("#seCanvas");
  const paths0 = svg.querySelectorAll("path").length;
  // 図形をクリックして選ぶ → その図形だけ個別の path (強調) になる
  const rc = svg.getBoundingClientRect();
  let calls = 0; const orig = symShapesBounds; symShapesBounds = function (...a) { calls++; return orig.apply(this, a); };
  const ev = (type, x, y, buttons) => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: rc.left + x, clientY: rc.top + y, button: 0, buttons }));
  // 離れた 1 本 (30,20)-(38,26) の中点あたりをつまむ: 作画座標 → 画面座標は symEditXY の逆が要るので、大きく動かして測る代わりに
  // ドラッグ 10 回で getBBox の測り直しが「座標が変わった回」だけ (≤ 10) で、動かさないホバー 10 回では 0 回
  // 何も無い隅で範囲選択のドラッグ → 動かすたびに描き直す (選択枠が出る) が、図形は動いて
  // いないので外接矩形の測り直し (getBBox) は 0 回
  ev("mousedown", 6, 6, 1);
  let redrawn = false;
  for (let i = 1; i <= 10; i++) { ev("mousemove", 6 + i * 5, 6 + i * 4, 1); redrawn = redrawn || !!svg.querySelector('rect[stroke-dasharray="1 0.8"]'); }
  ev("mouseup", 56, 46, 0);
  const dragCalls = calls; calls = 0;
  symShapesBounds = orig;
  return { paths0, dragCalls, redrawn, nodes: svg.querySelectorAll("*").length };
});
fs.unlinkSync(tmp);

const checks = {
  noPageErrors: errs.length === 0,
  compact: R.compact.shapes === 7 && R.compact.lines === 6 && R.compact.arcs === 1 && R.compact.closed === 5 && R.compact.pts < 200 && R.ents === 370,
  thin: R.thin.circles === 3 && R.thin.maxDev <= 0.021 && R.thin.boxes === 2 && R.thin.lone === 1 && R.thin.ptsEach.split(",").every(n => +n >= 30 && +n <= 70),
  oneElem: R.oneElem.elems === 1 && R.oneElem.hasArc && R.oneElem.mixed === 3,
  roundtrip: R.roundtrip.lines === 6 && R.roundtrip.arcs === 1 && R.roundtrip.closed === 5,
  dxf: R.dxf.same === true,
  canvas: R.canvas < 12,
  editor: E.paths0 <= 4 && E.redrawn === true && E.dragCalls === 0 && E.nodes < 40,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, E, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("symedit-dxf-light OK");
