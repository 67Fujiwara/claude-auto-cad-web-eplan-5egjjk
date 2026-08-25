/* 接地 (アース) 記号の寸法。「小さくしたい」と「印刷して読める」の両立を、
   批評 (電気設計の大ベテラン + JIS/IEC 審査官) が出した下限で縛る。

   寸法はすべて body から実測する。判定はどれも「線の縁どうし」で測る —
   中心線で測ると線幅 0.5mm ぶん甘くなり、実際には触れている図を通してしまう。

   ・smaller   : 4記号の外接箱を記号ごとに縛る (縮小前のどの版も超える上限)
   ・ratio     : 横棒 3 本は 1 : 2/3 : 1/3、等間隔、間隔 = 最長棒の 1/4。
                 囲みの中 (PE/FE) も同じ規則に従う
   ・minElem   : 最短の棒 ≥ 1.5mm (線幅 0.5mm の 3 倍)。これ以下は棒でなく
                 点に見え、同じ図面の一般接地と別物になる
   ・printGap  : 棒どうしのすき間 ≥ 0.7mm (JIS Z 8312 の平行線の下限)
   ・enclosed  : PE の円・FE のひし形と中身のあき ≥ 0.7mm。記号は端が丸い線
                 (stroke-linecap="round") で描かれるので、棒の外形は端点から
                 全方向へ線幅の半分ふくらむ。そのふくらみを含めた外形と囲みの
                 内縁で測る (端を平と見なすと 0.25mm ぶん甘くなり、実際には
                 下限を割っている図を通してしまう)
   ・slashFit  : フレーム接続の斜線は正確な 45°・等ピッチ・左右の端が横棒の
                 端に立つ (横棒からはみ出さない)・斜線どうしのすき間 ≥ 0.7mm
   ・pinKept   : 4記号とも端子は (0,0) のまま (既存図面の配線が生きる) */
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
  const LW = LINE_W.thick, HW = LW / 2;        // 図記号の線幅とその半分
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px";
  document.body.appendChild(probe);
  const bboxOf = (bd) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("fill", "none"); g.setAttribute("stroke", "#000"); g.setAttribute("stroke-width", String(LW));
    g.innerHTML = bd;
    probe.appendChild(g);
    const bb = g.getBBox();
    g.remove();
    return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
  };
  /** 横棒 (M-h,y H h) を拾う */
  const barsOf = (body) => [...body.matchAll(/M(-[\d.]+),([\d.]+) H([\d.]+)/g)]
    .map(m => ({ y: +m[2], hw: +m[3] }));
  /* 棒の端点。実際の描画は端が丸い線なので、外形はこの点から全方向へ HW ふくらむ。
     判定側で HW を差し引く (cap = "round" を実装と合わせて確かめる) */
  const endsOf = (bs) => bs.map(bb => [bb.hw, bb.y]);

  // 実際の描画の端点処理 (これが round なら棒の外形は端点から HW ふくらむ)
  const cap = (/stroke-linecap="([a-z]+)"/.exec(symBodySVG(SYMBOLS_BY_ID.earth)) || [])[1] || "butt";
  const CAP = cap === "butt" ? 0 : HW;      // 端のふくらみ
  const out = { lw: LW, cap, sizes: {}, pins: {}, bars: {} };
  ["earth", "prot_earth", "func_earth", "chassis_earth"].forEach(id => {
    const s = SYMBOLS_BY_ID[id];
    out.sizes[id] = bboxOf(s.body);
    out.pins[id] = s.pins.map(q => [q.x, q.y]);
    const bs = barsOf(s.body);
    if (bs.length === 3) {
      out.bars[id] = {
        hw: bs.map(q => q.hw), gaps: [+(bs[1].y - bs[0].y).toFixed(3), +(bs[2].y - bs[1].y).toFixed(3)],
      };
    }
  });

  // PE: 棒の外形 (端点 + 端の丸み) → 円の内縁 (r − 線幅の半分)
  {
    const body = SYMBOLS_BY_ID.prot_earth.body;
    const cm = /<circle cx="(-?[\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(body);
    const cs = endsOf(barsOf(body));
    out.pe = cm && cs.length ? {
      r: +cm[3],
      clear: Math.min(...cs.map(([x, y]) => (+cm[3] - HW) - (Math.hypot(x - +cm[1], y - +cm[2]) + CAP))),
    } : null;
  }
  // FE: 棒の外形 → ひし形の斜辺の内縁 (垂直距離 − 端の丸み − 線幅の半分)
  {
    const body = SYMBOLS_BY_ID.func_earth.body;
    const dm = /M0,([\d.]+) L(-[\d.]+),([\d.]+) L0,([\d.]+) L([\d.]+),\3 Z/.exec(body);
    const cs = endsOf(barsOf(body));
    out.fe = dm && cs.length ? (() => {
      const top = +dm[1], hw = +dm[5], cy = +dm[3];
      const hh = cy - top, n = Math.hypot(hw, hh);
      return {
        hw, hh,
        clear: Math.min(...cs.map(([x, y]) => (hw * hh - hh * Math.abs(x) - hw * Math.abs(y - cy)) / n - HW - CAP)),
      };
    })() : null;
  }
  // フレーム接続: 横棒と斜線
  {
    const body = SYMBOLS_BY_ID.chassis_earth.body;
    const bar = barsOf(body)[0];
    const sl = [...body.matchAll(/M(-?[\d.]+),([\d.]+) L(-?[\d.]+),([\d.]+)/g)]
      .filter(m => +m[3] !== +m[1] && +m[4] !== +m[2])          // 斜めの線分だけ
      .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] }));
    out.slash = bar ? {
      barHw: bar.hw,
      n: sl.length,
      angles: sl.map(s => +(Math.atan2(Math.abs(s.y1 - s.y0), Math.abs(s.x1 - s.x0)) * 180 / Math.PI).toFixed(3)),
      pitch: sl.slice(1).map((s, i) => +(s.x0 - sl[i].x0).toFixed(3)),
      // 斜線が占める左右の端 (横棒からはみ出していないか)
      minX: Math.min(...sl.flatMap(s => [s.x0, s.x1])),
      maxX: Math.max(...sl.flatMap(s => [s.x0, s.x1])),
    } : null;
  }
  probe.remove();
  return out;
});

const LW = R.lw, MIN_GAP = 0.7, MIN_ELEM = 3 * LW;
const near = (a, b2, tol = 0.02) => Math.abs(a - b2) <= tol;
const sz = R.sizes, bars = R.bars;
const barSyms = ["earth", "prot_earth", "func_earth"];
const checks = {
  noPageErrors: errs.length === 0,
  // 計算の前提 (端の丸み) が実装と一致していること
  capRound: R.cap === "round",
  // 記号ごとの上限 [幅, 下端]。縮小前のどの版もこの箱には入らない
  smaller: Object.entries({ earth: [6.5, 8.5], prot_earth: [8.2, 11.5], func_earth: [11, 14], chassis_earth: [6.5, 7.2] })
    .every(([id, [w, bot]]) => sz[id] && sz[id].w <= w && (sz[id].y + sz[id].h) <= bot),
  ratio: [...barSyms, "chassis_earth"].every(id => id === "chassis_earth" ? !bars[id] : (() => {
    const b2 = bars[id];
    if (!b2) return false;
    const max = b2.hw[0] * 2;
    return near(b2.hw[1], b2.hw[0] * 2 / 3) && near(b2.hw[2], b2.hw[0] / 3) &&
      near(b2.gaps[0], b2.gaps[1]) && near(b2.gaps[0], max / 4);
  })()),
  minElem: barSyms.every(id => bars[id] && bars[id].hw[2] * 2 >= MIN_ELEM - 0.001),
  printGap: barSyms.every(id => bars[id] && bars[id].gaps.every(g => g - LW >= MIN_GAP - 0.001)),
  enclosed: R.pe && R.pe.clear >= MIN_GAP && R.fe && R.fe.clear >= MIN_GAP,
  slashFit: R.slash && R.slash.n >= 3 &&
    R.slash.angles.every(a => near(a, 45, 0.01)) &&
    R.slash.pitch.every(v => near(v, R.slash.pitch[0])) &&
    R.slash.pitch[0] * Math.sin(Math.PI / 4) - LW >= MIN_GAP - 0.001 &&
    near(R.slash.minX, -R.slash.barHw) && near(R.slash.maxX, R.slash.barHw),
  pinKept: Object.values(R.pins).every(ps => ps.length === 1 && ps[0][0] === 0 && ps[0][1] === 0),
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
