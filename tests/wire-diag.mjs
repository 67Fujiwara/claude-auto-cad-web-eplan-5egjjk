/* 配線の斜め直結 (Alt)。

   ・diagSeg  : Alt を押してクリックすると直角に折らず、斜めの 1 本で結ばれる
   ・tipSnap  : Alt 中は近くの「線の先端」に吸着する — 先端と先端を
               斜めの線でつなげる (クリックが 2mm ずれても先端に乗る)
   ・ortho    : Alt なしは従来どおり直角に折れる (退行なし)
   ・dxf      : 斜めの線も DXF にそのまま出る (始点・終点が一致) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

// ページ準備: 作図線 2 本 (先端が離れている)
await p.evaluate(() => {
  App.project = newProject("斜め線"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  // 先端はわざと格子 (5mm) から外す — 格子吸着では乗れず、先端吸着だけが効く座標
  const w1 = addWire(pg, [[60, 61.2], [101.3, 61.2]], { raw: true }); w1.aux = true;
  const w2 = addWire(pg, [[138.6, 99.4], [180, 99.4]], { raw: true }); w2.aux = true;
  UI.setTool("wire"); UI.refresh(true); zoomFit();
});
await p.waitForTimeout(300);
const S = await p.evaluate(() => {
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], v: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const at = (x, y) => ({ x: S.bb[0] + S.v[0] + x * S.v[2], y: S.bb[1] + S.v[1] + y * S.v[2] });

// ── Alt で先端 (100,60) → 先端 (140,100) を斜めに ──
// クリックは先端から少しずらす (吸着の検査)
let c = at(102.2, 62);
await p.keyboard.down("Alt");
await p.mouse.click(c.x, c.y);
await p.waitForTimeout(120);
c = at(137.8, 98.6);
await p.mouse.click(c.x, c.y);
await p.waitForTimeout(120);
await p.keyboard.up("Alt");
await p.keyboard.press("Enter");
await p.waitForTimeout(200);

const R = await p.evaluate(() => {
  const pg = curPage();
  const w = pg.wires[pg.wires.length - 1];
  const out = { n: pg.wires.length, pts: w.pts };
  out.diagSeg = w.pts.length === 2 &&
    Math.abs(w.pts[0][0] - w.pts[1][0]) > 1 && Math.abs(w.pts[0][1] - w.pts[1][1]) > 1;
  out.tipSnap = w.pts[0][0] === 101.3 && w.pts[0][1] === 61.2 && w.pts[1][0] === 138.6 && w.pts[1][1] === 99.4;
  const dxf = pageToDXF(pg); applySheet(pg);
  out.dxf = new RegExp("10\\n101\\.300\\n20\\n" + (SHEET.h - 61.2).toFixed(3).replace(".", "\\.") +
    "\\n11\\n138\\.600\\n21\\n" + (SHEET.h - 99.4).toFixed(3).replace(".", "\\.")).test(dxf);
  return out;
});

// ── Alt なしは直角 (退行なし) ──
await p.evaluate(() => { cancelDraft(); UI.setTool("wire"); });
let c1 = at(60, 130);
await p.mouse.click(c1.x, c1.y);
await p.waitForTimeout(120);
let c2 = at(100, 160);
await p.mouse.click(c2.x, c2.y);
await p.waitForTimeout(120);
await p.keyboard.press("Enter");
await p.waitForTimeout(200);
const R2 = await p.evaluate(() => {
  const pg = curPage();
  const w = pg.wires[pg.wires.length - 1];
  UI.setTool("select");
  // 全区間が水平か垂直
  let ortho = w.pts.length >= 3;
  for (let i = 0; i < w.pts.length - 1; i++) {
    const h2 = Math.abs(w.pts[i][1] - w.pts[i + 1][1]) < 0.01;
    const v2 = Math.abs(w.pts[i][0] - w.pts[i + 1][0]) < 0.01;
    if (!h2 && !v2) ortho = false;
  }
  return { ortho, pts: w.pts };
});

const checks = {
  noPageErrors: errs.length === 0,
  diagSeg: R.diagSeg === true,
  tipSnap: R.tipSnap === true,
  dxf: R.dxf === true,
  ortho: R2.ortho === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, R2, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-diag OK");
