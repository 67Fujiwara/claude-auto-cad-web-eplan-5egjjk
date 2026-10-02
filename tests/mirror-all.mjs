/* 接点ミラー表は全接点を載せる (「+n …」の省略をやめる)。

   ・all    : 接点 6 点のコイルのミラー表に 6 行とも出て、
             「+」の省略行が無い。6 行目の相互参照も読める
   ・grow   : 表は下ぞろえのまま上へ伸びる (1 行目の y が 4 点のときより
             2 行ぶん上がる)。外形寸法 (mirrorTableSize) も 6 行ぶん
   ・boxes  : 検図用の文字矩形 (mirrorLabelBoxes) も全行ぶん出る
   ・dxf    : DXF のミラー表にも 6 行とも出て「+」が無い */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("ミラー全行"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  // 接点は別の葉に置く — コイルの葉の DXF にはミラー表の参照だけが載る
  const pg2 = JSON.parse(JSON.stringify(pg));
  pg2.id = "pgMirror2"; pg2.name = "接点の葉"; pg2.devices = []; pg2.wires = [];
  App.project.pages.push(pg2);
  UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const k1 = addDevice(pg, "coil", 120, 80, { tag: "-SFR_A" });
  const N = 6;
  for (let i = 0; i < N; i++) {
    const c = addDevice(pg2, "aux_no", 160 + i * 20, 80, { tag: "-SFR_A" });
    c.linkTo = k1.id;
  }
  App.labelRev++;
  const svg6 = mirrorSVG(k1);
  const rows6 = (svg6.match(/\/\d+\./g) || []).length;   // 相互参照 (/頁.) の行数
  out.all = { rows: rows6, plus: /＋|>\+\d/.test(svg6) || svg6.includes("+1") || svg6.includes("…") };
  const org6 = mirrorOrigin(k1);
  const size6 = mirrorTableSize(k1);
  out.boxes = mirrorLabelBoxes(k1).length;     // タグ 1 + (端子+参照) × 6 = 13
  // 4 点に減らすと 2 行ぶん下がる (下ぞろえで上に伸びていた)
  const pgd = pg2.devices.filter(d => d.linkTo === k1.id);
  pg2.devices = pg2.devices.filter(d => !(d.linkTo === k1.id && pgd.indexOf(d) >= 4));
  App.labelRev++;
  const org4 = mirrorOrigin(k1);
  const size4 = mirrorTableSize(k1);
  const f = contentScale();
  out.grow = { dy: org4.y0 - org6.y0, dh: size6.h - size4.h, f };
  // DXF (6 点に戻す)
  for (let i = 0; i < 2; i++) {
    const c = addDevice(pg2, "aux_no", 300 + i * 20, 80, { tag: "-SFR_A" });
    c.linkTo = k1.id;
  }
  App.labelRev++;
  const dxf = pageToDXF(pg);
  const at = dxf.indexOf("-SFR_A\n");          // ミラー見出し以降を見る
  const seg = dxf.slice(at);
  out.dxf = { rows: (seg.match(/\/\d+\.[A-Z]\d/g) || []).length,
    plus: /\n\+\d+\n/.test(seg) };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  all: R.all.rows === 6 && R.all.plus === false,
  grow: Math.abs(R.grow.dy - 2 * 4.2 * R.grow.f) < 0.01 &&
    Math.abs(R.grow.dh - 2 * 4.2 * R.grow.f) < 0.01,
  boxes: R.boxes === 13,
  dxf: R.dxf.rows === 6 && R.dxf.plus === false,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("mirror-all OK");
