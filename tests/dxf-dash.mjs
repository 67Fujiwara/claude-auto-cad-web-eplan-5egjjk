/* DXF に出した遮へい (破線の長円) が、画面と同じ線種として開けることを確かめる。

   ・輪郭の各要素 (端部の半円 2 つ + 直線部 2 本) の LTYPE が、画面の
     stroke-dasharray と一致すること (既製の DASHED = 0.25mm 線用の 3/0.75 を
     当てると別の線種になる)
   ・円弧が弦の列でなく ARC として出ていること — 弦 (約 1.6mm) は破線の周期
     (約 7.6mm) より短く、AutoCAD は各弦を実線で描いてしまう
   ・破線を掛けた要素が「1 周期以上」か「線素 1 つぶん (線全体が 1 本の線素)」の
     どちらかであること。中途半端に周期より短いと AutoCAD が実線で描く
   ・長さ 0 の要素が無いこと (AUDIT がエラーにする)
   ・ARC の実形状が画面の外形と一致すること (回転させた場合も)
   ・ドレン線の付け根が破線の線素の上に乗ること (n=1〜24)

   1 芯 (直線部 0mm)・2 芯 (直線部 5mm = 周期より短い)・3 芯・回転 180 を必ず
   通す — 破綻するのはこの端の寸法で、そこを外した試験は主張を担保しない。 */
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
  const out = {};
  const pg = newPage("dxf", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  const cases = [[1, 0], [2, 0], [3, 0], [4, 0], [12, 0], [8, 270], [8, 90], [4, 180], [2, 180]];
  const devs = cases.map(([n, rot], k) =>
    addDevice(pg, `shield@${symCoresToSpan(n)}`, 60 + k * 60, 60, { tag: `-S${k}`, rot }));
  const txt = pageToDXF(pg);
  // 画面側の破線寸法 (芯数ごと)
  out.screen = [];
  cases.forEach(([n]) => {
    const sym = symOf(`shield@${symCoresToSpan(n)}`);
    [...scaleSymbolGeom(sym.body, 1, sym).matchAll(/stroke-dasharray="([^"]+)"/g)]
      .forEach(m => { if (!out.screen.includes(m[1])) out.screen.push(m[1]); });
  });
  // LTYPE 表
  out.ltypes = {};
  [...txt.matchAll(/0\nLTYPE\n2\n([^\n]+)\n70\n0\n3\n[^\n]*\n72\n65\n73\n\d+\n40\n[\d.]+((?:\n49\n-?[\d.]+)*)/g)]
    .forEach(m => { out.ltypes[m[1]] = [...m[2].matchAll(/\n49\n(-?[\d.]+)/g)].map(q => Number(q[1])); });
  // SYMBOL 層の LINE / ARC
  const arcs = [...txt.matchAll(/0\nARC\n8\nSYMBOL\n(?:6\n([^\n]+)\n)?10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n40\n([\d.]+)\n50\n([\d.]+)\n51\n([\d.]+)/g)]
    .map(m => ({ lt: m[1] || null, cx: +m[2], cy: +m[3], r: +m[4], a0: +m[5], a1: +m[6] }));
  const lines = [...txt.matchAll(/0\nLINE\n8\nSYMBOL\n(?:6\n([^\n]+)\n)?10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n11\n(-?[\d.]+)\n21\n(-?[\d.]+)/g)]
    .map(m => ({ lt: m[1] || null, x0: +m[2], y0: +m[3], x1: +m[4], y1: +m[5] }));
  out.arcCount = arcs.length;
  out.dashedLines = lines.filter(l => l.lt && /^DASH/.test(l.lt)).length;
  out.zeroLen = lines.filter(l => Math.hypot(l.x1 - l.x0, l.y1 - l.y0) < 0.001).length;
  // 破線が掛かった要素の LTYPE がすべて画面の寸法と一致するか
  const want = new Set(out.screen.map(d => d.split(/\s+/).map(Number).map(v => v.toFixed(3)).join("_")));
  const seen = new Set([...arcs, ...lines].filter(e => e.lt && /^DASH/.test(e.lt)).map(e => e.lt));
  out.ltypeMatch = [...seen].every(name => {
    const pat = out.ltypes[name];
    if (!pat) return false;
    return want.has(pat.map(v => Math.abs(v).toFixed(3)).join("_"));
  });
  out.seen = [...seen];
  // 破線を掛けた要素が「1 周期以上」か「線素 1 つぶん」のどちらかか
  out.tooShort = [];
  [...arcs, ...lines].forEach(e => {
    if (!e.lt || !/^DASH/.test(e.lt)) return;
    const pat = (out.ltypes[e.lt] || []).map(Math.abs);
    const per = pat.reduce((s, v) => s + v, 0), el = pat[0] || 0;
    const len = e.r !== undefined
      ? e.r * (((e.a1 - e.a0 + 360) % 360) || 360) * Math.PI / 180
      : Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
    if (len < per - 0.01 && Math.abs(len - el) > 0.01) {
      out.tooShort.push(`${e.lt} ${len.toFixed(2)}mm (周期 ${per.toFixed(2)} 線素 ${el.toFixed(2)})`);
    }
  });
  /* ドレン線の付け根が線素の上に乗るか (n=1〜24)。
     ISO 128-20 / JIS Z 8312 が求めるのは「線が非連続線に接続するときは線素で
     接続する」ことなので、ここは規格そのものの要求。半径や周期をいじると
     黙って壊れるため試験で固定する。
     付け根は下側の半円の 45° 位置 = 半円の始点から r×45° = 5.4978mm */
  out.drainPhase = [];
  for (let n = 1; n <= 24; n++) {
    const sym = symOf(`shield@${symCoresToSpan(n)}`);
    const g = scaleSymbolGeom(sym.body, 1, sym);
    // 破線の path をすべて拾い、ドレン線 (破線でない path) の始点が
    // どの破線 path のどこに乗るかを実測する。角度を決め打ちにすると、
    // 引出し口を動かしても落ちない「飾りの判定」になる
    const dashed = [...g.matchAll(/<path d="([^"]*)" stroke-dasharray="([\d.]+) ([\d.]+)"/g)];
    const plain = [...g.matchAll(/<path d="([^"]*)"\s*\/>/g)].map(m => m[1]);
    const lead = plain.find(d => /^M[\d.]+,[\d.]+ L10,/.test(d));
    if (!lead || !dashed.length) { out.drainPhase.push(`${n}芯: ドレン線か破線が見つからない`); continue; }
    const p0 = lead.match(/^M([\d.-]+),([\d.-]+)/).slice(1).map(Number);
    let best = null;
    dashed.forEach(m => {
      const el = document.createElementNS(NS, "path"); el.setAttribute("d", m[1]); probe.appendChild(el);
      const L = el.getTotalLength();
      for (let i = 0; i <= 2000; i++) {
        const q = el.getPointAtLength(L * i / 2000);
        const dd = Math.hypot(q.x - p0[0], q.y - p0[1]);
        if (!best || dd < best.d) best = { d: dd, s: L * i / 2000, e: +m[2], per: +m[2] + +m[3] };
      }
      el.remove();
    });
    if (best.d > 0.1) { out.drainPhase.push(`${n}芯: 付け根が輪郭に乗っていない (${best.d.toFixed(2)}mm)`); continue; }
    const ph = best.s % best.per;
    if (ph >= best.e - 0.02) out.drainPhase.push(`${n}芯: 位相 ${ph.toFixed(2)} ≥ 線素 ${best.e.toFixed(2)} (すき間の上)`);
  }
  // ARC の形が画面の外形と一致するか
  const ref = [];
  devs.forEach(dev => {
    // 遮へいの輪郭は「端部の半円 2 つ + 直線部 2 本」に分かれているので、
    // body の全ての path を1本につないでサンプルする
    const sym = symOf(dev.sym);
    const d = (sym.body.match(/<path d="([^"]*)"/g) || []).map(m => /d="([^"]*)"/.exec(m)[1]).join(" ");
    const el = document.createElementNS(NS, "path"); el.setAttribute("d", d); probe.appendChild(el);
    const L = el.getTotalLength();
    for (let i = 0; i < 1800; i++) { const q = el.getPointAtLength(L * i / 1800); ref.push(pinAbs(dev, { x: q.x, y: q.y })); }
    el.remove();
  });
  let worst = 0;
  arcs.forEach(a => {
    let a0 = a.a0, a1 = a.a1; if (a1 < a0) a1 += 360;
    for (let k = 0; k <= 40; k++) {
      const t = (a0 + (a1 - a0) * k / 40) * Math.PI / 180;
      const x = a.cx + a.r * Math.cos(t), y = SHEET.h - (a.cy + a.r * Math.sin(t));
      let best = Infinity;
      ref.forEach(q => { const dd = Math.hypot(q.x - x, q.y - y); if (dd < best) best = dd; });
      worst = Math.max(worst, best);
    }
  });
  out.arcFit = +worst.toFixed(3);
  probe.remove(); return out;
});
console.log(JSON.stringify(R, null, 1));
const checks = {
  arcAsArc: R.arcCount === 18,                   // 遮へい 9 個 × 端部 2 個
  arcDashed: R.seen.length > 0 && R.seen.every(n => /^DASH_/.test(n)),
  dashedLines: R.dashedLines === 16,             // 直線部: 1 芯は 0 本、他 8 個 × 2 本
  ltypeMatch: R.ltypeMatch === true,             // 画面の寸法と一致
  noShortDash: R.tooShort.length === 0,          // 破線として描ける長さがある
  noZeroLen: R.zeroLen === 0,                    // 長さ 0 の要素が無い
  arcFit: R.arcFit < 0.06,                       // 画面の外形と一致 (mm)
  drainOnDash: R.drainPhase.length === 0,        // ドレン線の付け根が線素の上
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
