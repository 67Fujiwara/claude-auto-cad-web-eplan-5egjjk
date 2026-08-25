/* 接地 (アース) 記号の縮小と、批評 (大ベテラン + JIS 審査官) の是正の担保。

   ・smaller  : 接地4種の実描画の外接箱が 幅 ≤ 11.5mm・下端 ≤ 14mm
                (旧: 一般 12mm 幅・PE/FE 16mm 高・フレーム 14.5mm 幅 — どれかに
                戻ると必ず引っ掛かる)
   ・ratio    : 一般接地の横棒は 比 1 : 2/3 : 1/3 (8/5.33/2.67)・等間隔 2mm
   ・enclosed : PE の円・FE のひし形が中の棒を余裕をもって囲む。円・ひし形の
                寸法と棒は body から実測し、輪郭までの隙 (芯々) ≥ 0.55mm
   ・slash45  : フレーム接続の斜線は 45° (dx = dy)・左右対称・等ピッチ
   ・pinKept  : 4種とも端子は (0,0) のまま (既存図面の配線が生きる) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px";
  document.body.appendChild(probe);
  const bboxOf = (bd) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("fill", "none"); g.setAttribute("stroke", "#000"); g.setAttribute("stroke-width", "0.5");
    g.innerHTML = bd;
    probe.appendChild(g);
    const bb = g.getBBox();
    g.remove();
    return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
  };
  const barsOf = (body) => [...body.matchAll(/M(-[\d.]+),([\d.]+) H([\d.]+)/g)]
    .map(m => ({ y: +m[2], hw: +m[3] }));
  const out = { sizes: {}, pins: {} };
  ["earth", "prot_earth", "func_earth", "chassis_earth"].forEach(id => {
    const s = SYMBOLS_BY_ID[id];
    out.sizes[id] = bboxOf(s.body);
    out.pins[id] = s.pins.map(q => [q.x, q.y]);
  });
  out.bars = barsOf(SYMBOLS_BY_ID.earth.body);

  // PE: 円の寸法と中の棒を body から実測し、棒の端点→円周の隙を計算
  {
    const body = SYMBOLS_BY_ID.prot_earth.body;
    const cm = /<circle cx="(-?[\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(body);
    const bars = barsOf(body);
    out.pe = cm && bars.length === 3 ? {
      r: +cm[3],
      minGap: Math.min(...bars.flatMap(bb => [[bb.hw, bb.y], [-bb.hw, bb.y]])
        .map(([x, y]) => +cm[3] - Math.hypot(x - +cm[1], y - +cm[2]))),
    } : null;
  }
  // FE: ひし形の頂点と中の棒を実測し、棒の端点→斜辺の垂直距離を計算
  {
    const body = SYMBOLS_BY_ID.func_earth.body;
    const dm = /M0,([\d.]+) L(-[\d.]+),([\d.]+) L0,([\d.]+) L([\d.]+),\3 Z/.exec(body);
    const bars = barsOf(body);
    out.fe = dm && bars.length === 3 ? (() => {
      const top = +dm[1], hw = +dm[5], cy = +dm[3], bot = +dm[4];
      const hh = cy - top;
      const norm = Math.hypot(hw, hh);
      // 上半分の斜辺: hh*x - hw*y + hw*top = 0 / 下半分: hh*x + hw*y - hw*bot = 0
      const gaps = bars.flatMap(bb => [[bb.hw, bb.y], [-bb.hw, bb.y]]).flatMap(([x, y]) => [
        Math.abs(hh * Math.abs(x) - hw * y + hw * top) / norm,
        Math.abs(hh * Math.abs(x) + hw * y - hw * bot) / norm,
      ]);
      const inside = bars.every(bb => Math.abs(bb.hw) / hw + Math.abs(bb.y - cy) / hh < 1);
      return { hw, hh, minGap: Math.min(...gaps), inside };
    })() : null;
  }
  // フレーム: 斜線 4 本の dx / dy / 始点
  {
    const body = SYMBOLS_BY_ID.chassis_earth.body;
    out.slash = [...body.matchAll(/M(-?[\d.]+),5 L(-?[\d.]+),([\d.]+)/g)]
      .map(m => ({ x0: +m[1], dx: +m[1] - +m[2], dy: +m[3] - 5 }));
  }
  probe.remove();
  return out;
});

const near = (a, b2, tol = 0.05) => Math.abs(a - b2) <= tol;
const sz = R.sizes;
const checks = {
  noPageErrors: errs.length === 0,
  smaller: Object.values(sz).every(v => v.w <= 11.5 && (v.y + v.h) <= 14),
  ratio: R.bars.length === 3 &&
    near(R.bars[0].hw, 4) && near(R.bars[1].hw, R.bars[0].hw * 2 / 3) && near(R.bars[2].hw, R.bars[0].hw / 3) &&
    near(R.bars[1].y - R.bars[0].y, 2) && near(R.bars[2].y - R.bars[1].y, 2),
  enclosed: R.pe && R.pe.minGap >= 0.55 && R.fe && R.fe.inside && R.fe.minGap >= 0.55,
  slash45: R.slash.length === 4 && R.slash.every(s => near(s.dx, s.dy, 0.01)) &&
    near(R.slash[0].x0, -R.slash[3].x0, 0.01) && near(R.slash[1].x0, -R.slash[2].x0, 0.01) &&
    near(R.slash[1].x0 - R.slash[0].x0, 8 / 3, 0.01) && near(R.slash[2].x0 - R.slash[1].x0, 8 / 3, 0.01),
  pinKept: Object.values(R.pins).every(ps => ps.length === 1 && ps[0][0] === 0 && ps[0][1] === 0),
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
