/* 線番 (電線番号) の置き方を、実図面と同じ形で網羅的に確かめる。

   シーンは「芯数 {2,3,4,8,12,24} × 線番の桁数 {1〜7} × 向き {横,縦} × 長さ {長,短}」
   の直積 (168 通り)。囲みは心線の中央、両側の導体は同じ長さ。線番は必ず
   桁上がりをまたぐ連番 (9,10,11 … / 999999,1000000 …) にして、同じケーブルの
   中で線番の幅が混ざる場合を必ず通す。

   ・長 … 心線 70mm (実務でよくある寸法)
   ・短 … 心線 40mm。囲み 21mm と端子台を差し引くと空いている導体は片側 7.5mm
          しかなく、桁数が多い線番は入りきらない限界の図
   どちらも端子台の 2 ピンを結線し、ドレン線を片端で FE へ落とした「図面として
   成立する形」にする (検図が 0 件であることも合否条件にする)。
   なお心線 28mm に端子台を付けた図は、囲み 21mm + 端子 24mm×2 が心線より長く、
   導体が全て図記号に覆われる = 人が描けない図なので試験に含めない

   判定 (全シーン共通):
   ・脇      線番の箱は自分の線のすぐ脇にある (≤2.5mm)
   ・隣      **自分の線までの距離が、隣の心線までの距離より 1.0mm 以上近い**。
             「隣の中心線をまたぐか」だけを見ると、標準の逃がし量では原理的に
             またぎ得ず、判定が飾りになる (実際そうなっていた)
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
  /** n芯・線番 dig 桁・vert:縦向き・半長 half の対称なケーブル。
      心線の両端に端子台、ドレン線は片端で FE へ落とす (図面として成立する形) */
  let sceneNo = 0;
  /** opt.shift: 囲みを心線方向へずらす (囲みが中央にない図)
      opt.twin : 並び方向に離して 2 本目のケーブルを置く (隣のケーブルが障害物) */
  const run = (n, dig, vert, half, opt = {}) => {
    const id = ++sceneNo;
    const pg = newPage(`m${id}`, App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
    const A = 200 + (opt.shift || 0), B = 60, L0 = 200 - half, L1 = 200 + half, E = 20;
    const mk = (u, v) => vert ? [v, u] : [u, v];       // u=心線方向 v=並び方向
    // 心線は端子の外側まで伸ばし、端子の 2 ピンを両方とも結線する
    const cores = [];
    for (let i = 0; i < n; i++) cores.push(addWire(pg, [mk(L0 - E, B + i * 5), mk(L1 + E, B + i * 5)]));
    const h = symCoresToSpan(n), o = vert ? { rot: 270 } : {};
    const d1 = addDevice(pg, `cable_core@${h}`, ...mk(A, B), { tag: `-W${id}`, ...o });
    const d2 = addDevice(pg, `shield@${h}`, ...mk(A, B), { tag: `-W${id}S`, ...o });
    for (let i = 0; i < n; i++) {
      // 端子は 2 ピンが心線に沿って並ぶ向きに置く。端子1点ごとの連番タグは、
      // 5mm ピッチで横書きすると必ず互いに重なる (実際の端子台図は端子番号を
      // 端子台記号側にまとめて書く)。ここでは端子は「線番の障害物」として
      // 置くのが目的なので、タグは付けない
      addDevice(pg, "terminal", ...mk(L0, B + i * 5), { tag: "", rot: vert ? 180 : 90 });
      addDevice(pg, "terminal", ...mk(L1, B + i * 5), { tag: "", rot: vert ? 0 : 270 });
    }
    // ドレン線を片端で FE へ落とす (これが唯一の正しい描き方)
    const dp = devPins(d2)[0], fe = pinAbs(d2, { x: 10, y: h + 10 });
    addWire(pg, [[dp.x, dp.y], [fe.x, fe.y]]);
    addDevice(pg, "func_earth", fe.x, fe.y, { tag: `-FE${id}`, rot: d2.rot || 0 });
    if (opt.twin) {
      // 2 本目は、1 本目のドレン線・FE 記号に掛からない距離に置く
      const B2 = B + n * 5 + 60;
      const c2 = [];
      for (let i = 0; i < n; i++) c2.push(addWire(pg, [mk(L0 - E, B2 + i * 5), mk(L1 + E, B2 + i * 5)]));
      const e1 = addDevice(pg, `cable_core@${h}`, ...mk(200, B2), { tag: `-W${id}b`, ...o });
      const e2 = addDevice(pg, `shield@${h}`, ...mk(200, B2), { tag: `-W${id}bS`, ...o });
      for (let i = 0; i < n; i++) {
        addDevice(pg, "terminal", ...mk(L0, B2 + i * 5), { tag: "", rot: vert ? 180 : 90 });
        addDevice(pg, "terminal", ...mk(L1, B2 + i * 5), { tag: "", rot: vert ? 0 : 270 });
      }
      const dq = devPins(e2)[0], fq = pinAbs(e2, { x: 10, y: h + 10 });
      addWire(pg, [[dq.x, dq.y], [fq.x, fq.y]]);
      addDevice(pg, "func_earth", fq.x, fq.y, { tag: `-FE${id}b`, rot: e2.rot || 0 });
      c2.forEach((w, i) => { w.num = String(700 + i); w.fixed = true; w.numShow = true; });
      void e1;
    }
    // 線番は必ず桁上がりをまたぐ連番にして、線番の幅が混ざる場合を通す
    const base = dig === 1 ? 0 : Math.pow(10, dig - 1) - 1;
    cores.forEach((w, i) => { w.num = String(base + i); w.fixed = true; w.numShow = true; });
    App.labelRev++;
    const pts = [...outlinePts(d1), ...outlinePts(d2)];            // 実際の外形線
    const bb = [devBounds(d1), devBounds(d2)];                     // 囲みが占める範囲
    const e0 = Math.min(...bb.map(r => vert ? r.y : r.x));
    const e1 = Math.max(...bb.map(r => vert ? r.y + r.h : r.x + r.w));
    // 線番を置ける導体は「端子台の内側の縁」から「囲みの縁」まで。端子の下の
    // 導体は図記号に覆われていて使えないので、心線の端ではなくここで測る
    let T0 = -1e9, T1 = 1e9;
    pg.devices.forEach(d => {
      if (symOf(d.sym).id !== "terminal") return;
      const r = devBounds(d);
      const [r0, r1] = vert ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
      if (r1 <= e0 + 0.01) T0 = Math.max(T0, r1);
      if (r0 >= e1 - 0.01) T1 = Math.min(T1, r0);
    });
    const U0 = Math.max(L0 - E, T0), U1 = Math.min(L1 + E, T1);    // 使える導体の範囲
    const freeRun = Math.max(0, e0 - U0, U1 - e1);                 // 空いている導体
    const res = { anch: [], c: [], u0: [], u1: [], offSeg: 0, pierce: 0, nb: 0, ink: 99, margin: 99, over: 0, width: 0, far: 0 };
    const wvs = cores.map(o2 => vert ? o2.pts[0][0] : o2.pts[0][1]);
    const HW = LINE_W.thick / 2;                                   // 導体の線幅の半分
    cores.forEach(w => {
      const pos = wireLabelPos(w, pg); if (!pos) return;
      const bx = wireNumBox(w, pos[0], pos[1], pos[2]);
      res.width = Math.max(res.width, vert ? bx.h : bx.w);
      const wv = vert ? w.pts[0][0] : w.pts[0][1];                 // 自線の位置
      const v0 = vert ? bx.x : bx.y, v1 = vert ? bx.x + bx.w : bx.y + bx.h;
      const distTo = t => Math.max(0, v0 - t, t - v1);
      const own = distTo(wv);
      res.anch.push(+own.toFixed(1));
      res.ink = Math.min(res.ink, +(own - HW).toFixed(2));         // 自線とのインク間隔
      let other = Infinity;
      wvs.forEach(t => { if (Math.abs(t - wv) > 0.01) other = Math.min(other, distTo(t)); });
      if (other < Infinity) {
        res.margin = Math.min(res.margin, +(other - own).toFixed(1));
        if (other <= own) res.nb++;                                // 隣のほうが近い = 読めない
      }
      const b0 = vert ? bx.y : bx.x, b1 = vert ? bx.y + bx.h : bx.x + bx.w;
      res.c.push(+((b0 + b1) / 2).toFixed(1)); res.u0.push(+b0.toFixed(1)); res.u1.push(+b1.toFixed(1));
      const ov = (a0, a1) => Math.max(0, Math.min(b1, a1) - Math.max(b0, a0));
      if (Math.max(ov(U0, e0), ov(e1, U1)) < Math.min(1, freeRun) - 0.01) res.offSeg++;
      res.over = Math.max(res.over, +(Math.max(0, U0 - b0) + Math.max(0, b1 - U1)).toFixed(1));
      res.far = Math.max(res.far, +Math.max(0, b0 - U1, U0 - b1).toFixed(1));
      if (pts.some(q => q.x >= bx.x && q.x <= bx.x + bx.w && q.y >= bx.y && q.y <= bx.y + bx.h)) res.pierce++;
    });
    const sp = a => +(Math.max(...a) - Math.min(...a)).toFixed(1);
    res.worstAnch = Math.max(...res.anch);
    res.spread = [sp(res.c), sp(res.u0), sp(res.u1)];               // 中心 / 手前の端 / 奥の端
    res.xSpread = Math.min(...res.spread);
    res.overLimit = +Math.max(0, res.width - freeRun).toFixed(1);   // はみ出しの幾何的な下限
    res.limit = res.overLimit > 0;                                  // 置き場所が残らない図
    const drc = runDRC().filter(i => i.page === pg.no);              // このシーンの検図だけ見る
    res.drcTold = drc.some(i => /線番.*重なって/.test(i.msg));
    // 図面の作りに起因する指摘 (芯数の不一致・ドレン線の未接地・端子の浮きなど) は
    // 0 でなければならない。線番が図記号に重なる指摘だけは、置き場所が残らない
    // 限界の図で出るのが正しいので別に数える
    const ovl = drc.filter(i => i.rule === "textOverlap");
    const listed = ovl.filter(i => !/^文字の重なりは他に/.test(i.msg));
    // 並べて出た重なりが全部「線番が図記号に乗った」なら、打ち切りのまとめ行も
    // 同じ種類とみなす (20 件で打ち切られるため個別には出てこない)
    const allNum = listed.length > 0 && listed.every(i => /^線番/.test(i.msg));
    const build = drc.filter(i => i.rule !== "textOverlap")
      .concat(listed.filter(i => !/^線番/.test(i.msg)))
      .concat(allNum ? [] : ovl.filter(i => /^文字の重なりは他に/.test(i.msg)));
    res.drcAll = build.length;
    res.drcMsg = build.slice(0, 4).map(i => i.msg);
    return res;
  };
  const out = {};
  for (const n of [2, 3, 4, 8, 12, 24]) for (const dig of [1, 2, 3, 4, 5, 6, 7]) for (const vert of [0, 1]) {
    const V = vert ? "縦" : "横";
    out[`${n}芯/${dig}桁/${V}/長`] = run(n, dig, vert, 35);
    out[`${n}芯/${dig}桁/${V}/短`] = run(n, dig, vert, 20);
  }
  // 対称な図だけでは足りない。囲みが中央にない図・並んだ 2 本のケーブルも回す
  for (const n of [4, 12]) for (const dig of [2, 5]) for (const vert of [0, 1]) {
    const V = vert ? "縦" : "横";
    out[`${n}芯/${dig}桁/${V}/偏り-10`] = run(n, dig, vert, 35, { shift: -10 });
    out[`${n}芯/${dig}桁/${V}/偏り+15`] = run(n, dig, vert, 35, { shift: 15 });
    out[`${n}芯/${dig}桁/${V}/2本並び`] = run(n, dig, vert, 35, { twin: true });
  }
  probe.remove(); return out;
});
const LW = 0.5;                    // 導体の線幅 — 線番のインクはこれ以上離す
const fail = [];
for (const [k, v] of Object.entries(R)) {
  const bad = [];
  if (v.worstAnch > 2.5) bad.push("脇");
  if (v.nb > 0 || v.margin < 0.95) bad.push("隣");
  if (v.drcAll > 0) bad.push("検図" + v.drcAll);
  if (v.xSpread > 0.6) bad.push("x幅");
  if (v.over > v.overLimit + 0.6) bad.push("はみ");
  if (v.far > 0) bad.push("離れ");
  if (v.ink < LW - 0.01) bad.push("インク");
  if (!v.limit && (v.offSeg > 0 || v.pierce > 0)) bad.push("重なり");
  if (v.limit && (v.offSeg > 0 || v.pierce > 0) && !v.drcTold) bad.push("検図もれ");
  if (bad.length) fail.push([k, bad]);
  console.log((bad.length ? "NG " : "ok ") + k.padEnd(16),
    "脇", v.worstAnch, "インク", v.ink, "隣差", v.margin, "載らず", v.offSeg, "貫通", v.pierce,
    "列", v.xSpread, `(${v.spread.join("/")})`, "はみ", v.over, "/", v.overLimit,
    "離れ", v.far, v.limit ? (v.drcTold ? "限界:検図○" : "限界") : "", v.drcAll ? "検図:" + v.drcMsg.join(" / ") : "");
}
console.log("RESULT:", fail.length ? "FAIL " + fail.map(([k, b2]) => `${k}[${b2}]`).join(",") : `ok (${Object.keys(R).length}件)`);
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
