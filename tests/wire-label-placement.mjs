/* 線番の置き方を、実際の図面と同じ形 (囲みが心線の中央にあり、両側の導体が
   同じ長さ・心線の端に端子台) で確かめる。
   ・線番は自分の線の脇にある (|dy| <= 2.5mm)
   ・箱の中心は必ず自分の線の上にある
   ・1本のケーブルの中で線番の x が揃う
   ・線からのはみ出しは幾何的な下限 (線番の幅 − 空いている導体の長さ) 以内 */
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
  probe.style.cssText = "position:absolute;left:-9999px"; document.body.appendChild(probe);
  const outlinePts = (dev) => {
    const sym = symOf(dev.sym), d = /d="([^"]*)"/.exec(sym.body)[1];
    const el = document.createElementNS(NS, "path"); el.setAttribute("d", d); probe.appendChild(el);
    const L = el.getTotalLength(), out = [];
    for (let i = 0; i < 720; i++) { const q = el.getPointAtLength(L * i / 720); out.push(pinAbs(dev, { x: q.x, y: q.y })); }
    el.remove(); return out;
  };
  /** n芯・半幅 half の対称なケーブル。term=true なら心線の両端に端子台を置く */
  const run = (n, txt, half, term) => {
    const pg = newPage(`t${n}${txt}${half}${term ? "T" : ""}`, App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
    const cx = 200, X0 = cx - half, X1 = cx + half;
    for (let i = 0; i < n; i++) addWire(pg, [[X0, 60 + i * 5], [X1, 60 + i * 5]]);
    const h = symCoresToSpan(n);
    const d1 = addDevice(pg, `cable_core@${h}`, cx, 60, { tag: "-WA" });
    const d2 = addDevice(pg, `shield@${h}`, cx, 60, { tag: "-WAS" });
    if (term) for (let i = 0; i < n; i++) {
      addDevice(pg, "terminal", X0, 60 + i * 5, { tag: `-X1:${i + 1}` });
      addDevice(pg, "terminal", X1, 60 + i * 5, { tag: `-X2:${i + 1}` });
    }
    pg.wires.forEach((w, i) => { if (w.pts[0][1] === w.pts[1][1]) { w.num = txt + (i + 1); w.fixed = true; w.numShow = true; } });
    App.labelRev++;
    const pts = [...outlinePts(d1), ...outlinePts(d2)];
    const encl = devBounds(d2);                       // 遮へい (外側) の外接矩形
    const freeRun = Math.max(0, (encl.x - X0), (X1 - (encl.x + encl.w)));
    const res = { dy: [], x: [], offSeg: 0, pierce: 0, over: 0, width: 0 };
    pg.wires.forEach(w => {
      if (w.pts[0][1] !== w.pts[1][1]) return;
      const pos = wireLabelPos(w, pg); if (!pos) return;
      const bx = wireNumBox(w, pos[0], pos[1], pos[2]);
      res.width = Math.max(res.width, bx.w);
      res.dy.push(+(pos[1] - w.pts[0][1]).toFixed(1));
      res.x.push(+bx.x.toFixed(1));
      // 線番は「空いている導体」に重なっていること (線の端に付いていること)。
      // 中心が線の上に残せるのは 線番の幅 <= 空き導体×2 のときだけなので、
      // 中心ではなく重なりで見る
      const freeL = { x: X0, y: bx.y, w: Math.max(0, encl.x - X0), h: bx.h };
      const freeR = { x: encl.x + encl.w, y: bx.y, w: Math.max(0, X1 - (encl.x + encl.w)), h: bx.h };
      const ovl = Math.max(overlapArea(bx, freeL), overlapArea(bx, freeR)) / Math.max(0.1, bx.h);
      if (ovl < Math.min(1, freeRun) - 0.01) res.offSeg++;                  // 導体に載っていない
      res.over = Math.max(res.over, +(Math.max(0, X0 - bx.x) + Math.max(0, bx.x + bx.w - X1)).toFixed(1));
      if (pts.some(q => q.x >= bx.x && q.x <= bx.x + bx.w && q.y >= bx.y && q.y <= bx.y + bx.h)) res.pierce++;
    });
    res.worstDy = Math.max(...res.dy.map(Math.abs));
    res.xSpread = +(Math.max(...res.x) - Math.min(...res.x)).toFixed(1);
    res.overLimit = +Math.max(0, res.width - freeRun).toFixed(1);           // 幾何的な下限
    return res;
  };
  const out = {};
  // 実図面と同じ形 (囲みが中央・両側の導体が同じ長さ)。
  //  ・28mm 心線 … 囲み 21mm なので空いている導体は片側 3.5mm
  //  ・70mm 心線 + 端子台 … 実務でよくある寸法
  //  ・28mm 心線 + 端子台 … 空いている導体がほぼ残らない限界の図 (別基準)
  ["20", "W2-1", "W2-1234"].forEach(t => {
    out[`4:${t}`] = run(4, t, 14);
    out[`8:${t}`] = run(8, t, 14);
    out[`8:${t}+端子台`] = run(8, t, 35, true);
    out[`8:${t}(長い線)`] = run(8, t, 35);
    out[`※8:${t}+端子台(限界)`] = run(8, t, 14, true);
  });
  probe.remove(); return out;
});
for (const [k, v] of Object.entries(R)) {
  console.log(k.padEnd(20), "dy≤", v.worstDy, "導体に載らず", v.offSeg, "貫通", v.pierce,
    "x幅", v.xSpread, "はみ出し", v.over, "/ 下限", v.overLimit);
}
// ※ 付き = 空いている導体が線番より短い限界の図。整列は幾何的に不可能なので、
//   線の脇にあること (dy) と図記号を貫通しないことだけを見る
const fail = Object.entries(R).filter(([k, v]) => k.startsWith("※")
  ? (v.worstDy > 2.5 || v.pierce > 0)
  : (v.worstDy > 2.5 || v.offSeg > 0 || v.pierce > 0 || v.xSpread > 0.6 || v.over > v.overLimit + 0.6));
console.log("RESULT:", fail.length ? "FAIL " + fail.map(([k]) => k).join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
