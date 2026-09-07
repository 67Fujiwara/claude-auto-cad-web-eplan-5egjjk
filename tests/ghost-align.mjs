/* パレット配置の整列吸着 — 微調整した機器の隣に並べられる。

   ・snapY   : 0.5mm 微調整で格子から外れた機器の隣へゴーストを持って
              いくと、端子の行 (y) に吸着して同じ高さに置ける
   ・grid    : 揃う相手が近くに無いところでは従来どおり 5mm 格子
   ・altOff  : Alt を押している間は格子のまま (吸着しない)
   ・guide   : 吸着中は目印の線が出る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

await p.evaluate(() => {
  App.project = newProject("整列配置"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const d0 = addDevice(pg, "lamp", 100, 100, { tag: "-PL1" });
  d0.y = 100.5;                                          // Shift+矢印の 0.5mm 微調整に相当
  UI.refresh(true); zoomFit();
});
await p.waitForTimeout(250);
const S = await p.evaluate(() => {
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], v: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const at = (x, y) => ({ x: S.bb[0] + S.v[0] + x * S.v[2], y: S.bb[1] + S.v[1] + y * S.v[2] });

// ── ゴーストを隣 (y は 1.5mm ずれた位置) へ → 端子の行 100.5 に吸着 ──
await p.evaluate(() => startGhost("lamp"));
let c = at(140, 99);
await p.mouse.move(c.x, c.y);
await p.waitForTimeout(150);
const R = { snap: await p.evaluate(() => ({ x: Editor.ghost.x, y: Editor.ghost.y, ay: Editor.ghost.ay })) };
R.guide = await p.evaluate(() => overlaySVG(curPage()).includes(`M0,${Editor.ghost.ay} H`));
await p.mouse.click(c.x, c.y);
await p.waitForTimeout(200);
R.placed = await p.evaluate(() => {
  const pg = curPage();
  const d = pg.devices[pg.devices.length - 1];
  return { x: d.x, y: d.y, n: pg.devices.length };
});

// ── 相手が居ない遠くでは格子どおり ──
c = at(300, 202);
await p.mouse.move(c.x, c.y);
await p.waitForTimeout(150);
R.far = await p.evaluate(() => ({ x: Editor.ghost.x, y: Editor.ghost.y }));

// ── Alt 中は吸着しない ──
await p.keyboard.down("Alt");
c = at(140, 99);
await p.mouse.move(c.x, c.y);
await p.waitForTimeout(150);
R.alt = await p.evaluate(() => ({ y: Editor.ghost.y, ay: Editor.ghost.ay }));
await p.keyboard.up("Alt");
await p.keyboard.press("Escape");

const checks = {
  noPageErrors: errs.length === 0,
  snapY: R.snap.y === 100.5 && R.snap.x === 140 && R.snap.ay != null,
  placed: R.placed.y === 100.5 && R.placed.x === 140 && R.placed.n === 2,
  grid: R.far.x === 300 && R.far.y === 200,
  altOff: R.alt.y === 100 && R.alt.ay == null,
  guide: R.guide === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("ghost-align OK");
