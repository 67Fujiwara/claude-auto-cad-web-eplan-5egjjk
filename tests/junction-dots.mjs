/* 接続ドットは「導体が分かれる・集まる点」にだけ打つ (JIS C 0617-3 / IEC 60617)。
   まっすぐ続くだけの継ぎ目や曲がり角には打たない。

   ・straightJoint : 線を 2 本に分けて引いた継ぎ目には打たない
   ・overlapDraw   : 同じ道に重ねて引いた線の端にも打たない (今回の不具合)
   ・corner        : 曲がり角 (2 方向) には打たない
   ・tee           : T 分岐 (3 方向) には打つ
   ・teeAtCorner   : 相手の曲がり角へ突き当てた T にも打つ
   ・yJoint        : 端点が 3 本集まる点にも打つ
   ・fourWay       : 端点が 4 本集まる十字にも打つ
   ・crossOnly     : ただ交差しているだけ (端点が無い) には打たない —
                     回路のつながり (ネット) も別のままで、図と一致する
   ・devTee        : 機器の端子から母線へ落とした線の T には打つ
   ・drawnSVG      : 画面にもその数だけ描かれる */
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
  const mk = () => {
    const pg = newPage("jd" + App.project.pages.length, App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1; applySheet(pg);
    return pg;
  };
  const W = (pg, pts) => addWire(pg, pts, { raw: true });
  const out = {};

  let pg = mk(); W(pg, [[100, 40], [100, 70]]); W(pg, [[100, 70], [100, 100]]);
  out.straightJoint = junctionDots(pg).length;

  pg = mk(); W(pg, [[100, 40], [100, 100]]); W(pg, [[100, 40], [100, 70]]);
  out.overlapDraw = junctionDots(pg).length;

  pg = mk(); W(pg, [[60, 100], [100, 100]]); W(pg, [[100, 100], [100, 60]]);
  out.corner = junctionDots(pg).length;

  pg = mk(); W(pg, [[100, 40], [100, 100]]); W(pg, [[100, 70], [140, 70]]);
  out.tee = junctionDots(pg);

  // 相手の曲がり角へ突き当てる (角の 2 方向 + 枝 1 方向 = 3)
  pg = mk(); W(pg, [[60, 100], [100, 100], [100, 60]]); W(pg, [[100, 100], [140, 100]]);
  out.teeAtCorner = junctionDots(pg).length;

  pg = mk(); W(pg, [[100, 70], [60, 70]]); W(pg, [[100, 70], [140, 70]]); W(pg, [[100, 70], [100, 110]]);
  out.yJoint = junctionDots(pg).length;

  pg = mk(); [[60, 70], [140, 70], [100, 30], [100, 110]].forEach(q => W(pg, [[100, 70], q]));
  out.fourWay = junctionDots(pg).length;

  // ただの交差 (端点が無い) — ドットも無し / ネットも別
  pg = mk();
  const h = W(pg, [[80, 70], [120, 70]]), v = W(pg, [[100, 50], [100, 90]]);
  const nets = computeNets(pg, "closed");
  out.crossOnly = { dots: junctionDots(pg).length,
    sameNet: nets.wireNet.get(h.id) === nets.wireNet.get(v.id) };

  // 機器の端子 → 母線
  pg = mk();
  W(pg, [[60, 100], [200, 100]]);
  const dv = addDevice(pg, "coil", 100, 60, {});
  const pn = devPins(dv)[1];
  W(pg, [[pn.x, pn.y], [pn.x, 100]]);
  out.devTee = junctionDots(pg).length;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  // 画面に描かれたドット (小さい円) の数
  const small = [...Editor.layers.wires.querySelectorAll("circle")].filter(c => +c.getAttribute("r") < 1);
  out.drawnSVG = small.length;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  straightJoint: R.straightJoint === 0,
  overlapDraw: R.overlapDraw === 0,
  corner: R.corner === 0,
  tee: R.tee.length === 1 && R.tee[0][0] === 100 && R.tee[0][1] === 70,
  teeAtCorner: R.teeAtCorner === 1,
  yJoint: R.yJoint === 1,
  fourWay: R.fourWay === 1,
  crossOnly: R.crossOnly.dots === 0 && R.crossOnly.sameNet === false,
  devTee: R.devTee === 1,
  drawnSVG: R.drawnSVG === 1,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("junction-dots OK");
