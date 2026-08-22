/* 線番 (電線番号) の置き方を、実図面と同じ形で網羅的に確かめる。

   シーンは「芯数 {2,4,8,12} × 線番の桁数 {1〜7} × 向き {横,縦} × 長さ {長,短}」
   の直積 (112 通り)。囲みは心線の中央、両側の導体は同じ長さ。線番は必ず
   桁上がりをまたぐ連番 (9,10,11 … / 999999,1000000 …) にして、同じケーブルの
   中で線番の幅が混ざる場合を必ず通す。

   ・長 … 心線 70mm・両端に端子台 (実務でよくある寸法)
   ・短 … 心線 28mm・端子台なし。囲みが心線のほとんどを占め、線番の置き場所が
          残らない限界の図。桁数が多いと線番は導体の延長上へ出る

   判定 (全シーン共通):
   ・脇      線番の箱は自分の線のすぐ脇にある (≤2.5mm)
   ・隣      隣の心線 (5mm 隣) の上に載っていない
   ・載らず  線番は空いている導体の上にある (図記号の外接矩形の外)
   ・貫通    図記号の実際の外形線を踏んでいない
   ・x幅     ケーブルの中で線番の列が割れていない
             (中心・手前の端・奥の端 のどれかが 0.6mm 以内で揃う)
   ・はみ    線からのはみ出しは幾何的な下限 (線番の幅 − 空いている導体) 以内
   ・離れ    線番の箱は必ず自分の線に触れている (白紙の上に浮かない)

   「載らず・貫通」は、線番が幾何的に収まらない図 (はみ出しの下限 > 0) では
   避けられないので、そのときは検図が「図記号と重なる」と知らせることを見る。 */
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
  /** n芯・線番 dig 桁・vert:縦向き・半長 half・term:端子台つき の対称なケーブル */
  const run = (n, dig, vert, half, term) => {
    const pg = newPage(`m${n}_${dig}_${vert}_${half}`, App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
    const A = 200, B = 60, L0 = A - half, L1 = A + half;
    const mk = (u, v) => vert ? [v, u] : [u, v];       // u=心線方向 v=並び方向
    for (let i = 0; i < n; i++) addWire(pg, [mk(L0, B + i * 5), mk(L1, B + i * 5)]);
    const h = symCoresToSpan(n), o = vert ? { rot: 270 } : {};
    const d1 = addDevice(pg, `cable_core@${h}`, ...mk(A, B), { tag: "-WA", ...o });
    const d2 = addDevice(pg, `shield@${h}`, ...mk(A, B), { tag: "-WAS", ...o });
    if (term) for (let i = 0; i < n; i++) {
      addDevice(pg, "terminal", ...mk(L0, B + i * 5), { tag: `-X1:${i + 1}` });
      addDevice(pg, "terminal", ...mk(L1, B + i * 5), { tag: `-X2:${i + 1}` });
    }
    // 必ず桁上がりをまたぐ連番にして、線番の幅が混ざる場合を通す
    const base = dig === 1 ? 0 : Math.pow(10, dig - 1) - 1;
    let k = 0;
    pg.wires.forEach(w => { w.num = String(base + (k++)); w.fixed = true; w.numShow = true; });
    App.labelRev++;
    const pts = [...outlinePts(d1), ...outlinePts(d2)];            // 実際の外形線
    const bb = [devBounds(d1), devBounds(d2)];                     // 図記号が占める範囲
    const e0 = Math.min(...bb.map(r => vert ? r.y : r.x));
    const e1 = Math.max(...bb.map(r => vert ? r.y + r.h : r.x + r.w));
    const freeRun = Math.max(0, e0 - L0, L1 - e1);                 // 空いている導体
    const res = { anch: [], c: [], u0: [], u1: [], offSeg: 0, pierce: 0, nb: 0, over: 0, width: 0, far: 0 };
    pg.wires.forEach(w => {
      const pos = wireLabelPos(w, pg); if (!pos) return;
      const bx = wireNumBox(w, pos[0], pos[1], pos[2]);
      res.width = Math.max(res.width, vert ? bx.h : bx.w);
      const wv = vert ? w.pts[0][0] : w.pts[0][1];                 // 自線の位置
      const v0 = vert ? bx.x : bx.y, v1 = vert ? bx.x + bx.w : bx.y + bx.h;
      res.anch.push(+Math.max(0, v0 - wv, wv - v1).toFixed(1));
      if (v0 < wv + 5 - 0.05 && v1 > wv + 5 + 0.05) res.nb++;      // 隣の心線に載った
      if (v1 > wv - 5 + 0.05 && v0 < wv - 5 - 0.05) res.nb++;
      const b0 = vert ? bx.y : bx.x, b1 = vert ? bx.y + bx.h : bx.x + bx.w;
      res.c.push(+((b0 + b1) / 2).toFixed(1)); res.u0.push(+b0.toFixed(1)); res.u1.push(+b1.toFixed(1));
      const ov = (a0, a1) => Math.max(0, Math.min(b1, a1) - Math.max(b0, a0));
      if (Math.max(ov(L0, e0), ov(e1, L1)) < Math.min(1, freeRun) - 0.01) res.offSeg++;
      res.over = Math.max(res.over, +(Math.max(0, L0 - b0) + Math.max(0, b1 - L1)).toFixed(1));
      res.far = Math.max(res.far, +Math.max(0, b0 - L1, L0 - b1).toFixed(1));
      if (pts.some(q => q.x >= bx.x && q.x <= bx.x + bx.w && q.y >= bx.y && q.y <= bx.y + bx.h)) res.pierce++;
    });
    const sp = a => +(Math.max(...a) - Math.min(...a)).toFixed(1);
    res.worstAnch = Math.max(...res.anch);
    res.spread = [sp(res.c), sp(res.u0), sp(res.u1)];               // 中心 / 手前の端 / 奥の端
    res.xSpread = Math.min(...res.spread);
    res.overLimit = +Math.max(0, res.width - freeRun).toFixed(1);   // はみ出しの幾何的な下限
    res.limit = res.overLimit > 0;                                  // 置き場所が残らない図
    res.drcTold = runDRC().some(i => /線番.*重なって/.test(i.msg));
    return res;
  };
  const out = {};
  for (const n of [2, 4, 8, 12]) for (const dig of [1, 2, 3, 4, 5, 6, 7]) for (const vert of [0, 1]) {
    const V = vert ? "縦" : "横";
    out[`${n}芯/${dig}桁/${V}/長`] = run(n, dig, vert, 35, true);
    out[`${n}芯/${dig}桁/${V}/短`] = run(n, dig, vert, 14, false);
  }
  probe.remove(); return out;
});
const fail = [];
for (const [k, v] of Object.entries(R)) {
  const bad = [];
  if (v.worstAnch > 2.5) bad.push("脇");
  if (v.nb > 0) bad.push("隣");
  if (v.xSpread > 0.6) bad.push("x幅");
  if (v.over > v.overLimit + 0.6) bad.push("はみ");
  if (v.far > 0) bad.push("離れ");
  if (!v.limit && (v.offSeg > 0 || v.pierce > 0)) bad.push("重なり");
  if (v.limit && (v.offSeg > 0 || v.pierce > 0) && !v.drcTold) bad.push("検図もれ");
  if (bad.length) fail.push([k, bad]);
  console.log((bad.length ? "NG " : "ok ") + k.padEnd(16),
    "脇", v.worstAnch, "隣", v.nb, "載らず", v.offSeg, "貫通", v.pierce,
    "列", v.xSpread, `(${v.spread.join("/")})`, "はみ", v.over, "/", v.overLimit,
    "離れ", v.far, v.limit ? (v.drcTold ? "限界:検図○" : "限界") : "");
}
console.log("RESULT:", fail.length ? "FAIL " + fail.map(([k, b2]) => `${k}[${b2}]`).join(",") : `ok (${Object.keys(R).length}件)`);
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
