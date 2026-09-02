/* 図面注記の複数行 (Enter で改行)。

   ・propArea : プロパティの「内容」が textarea で、改行を入れると保存される
   ・tspans   : 2 行の注記は 2 つの tspan で描かれ、行送りは文字高 × 1.5
   ・bounds   : 外接箱 (検図・ラベルよけ) が行数ぶん高くなる
   ・hit      : 2 行目の位置をクリックしても注記がつかめる
   ・dxf      : DXF には 1 行ずつ TEXT で出る (両方の行が入る) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("複数行"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0; pg.texts.length = 0;
  pg.texts.push({ id: "tm1", x: 120, y: 80, text: "NOTE-A", size: 5 });
  const t = pg.texts[0];

  // ── プロパティで改行を入れる ──
  App.selection.clear(); App.selection.add("tm1"); UI.showProps();
  const el = document.getElementById("pTxt");
  out.propArea = { tag: el.tagName };
  el.value = "NOTE-A\nNOTE-B";
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  out.propArea.saved = t.text;

  // ── 描画 (tspan と行送り) ──
  const svg = textsSVG(pg, { print: true });
  const dys = [...svg.matchAll(/dy="([\d.]+)"/g)].map(m => +m[1]);
  out.tspans = { n: (svg.match(/<tspan /g) || []).length, dy: dys[1],
    want: t.size * contentScale() * 1.5,
    both: svg.includes("NOTE-A") && svg.includes("NOTE-B") };

  // ── 外接箱が高くなる ──
  const b2 = textBounds(t);
  const b1 = textBounds({ ...t, text: "NOTE-A" });
  out.bounds = { one: b1.h, two: b2.h, taller: b2.h > b1.h + t.size };

  // ── 2 行目をつかめる ──
  const hit = hitTest(t.x, t.y + t.size * contentScale() * 1.5 - 1);
  out.hit = { type: hit && hit.type, id: hit && hit.obj.id };

  // ── DXF に両方の行が出る ──
  const dxf = pageToDXF(pg); applySheet(pg);
  out.dxf = { a: dxf.includes("NOTE-A"), b: dxf.includes("NOTE-B") };
  App.selection.clear();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  propArea: R.propArea.tag === "TEXTAREA" && R.propArea.saved === "NOTE-A\nNOTE-B",
  tspans: R.tspans.n === 2 && Math.abs(R.tspans.dy - R.tspans.want) < 0.01 && R.tspans.both === true,
  bounds: R.bounds.taller === true,
  hit: R.hit.type === "text" && R.hit.id === "tm1",
  dxf: R.dxf.a === true && R.dxf.b === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("text-multiline OK");
