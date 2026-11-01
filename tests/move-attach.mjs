/* 機器を動かす・回すときに、配線や線番が勝手についてくる/取り残される不具合。

   以前は、両端とも動かす機器の端子に乗っている配線 (選んだ端子どうしを結ぶ線) を
   端点 1 つずつ追従させていたため、2 回目の追従が 1 回目を上書きして片端が元の
   場所に残り、折れ曲がった線と線番が端子にくっついて見えた (端子の丸の中は
   線を抜いて描くので、線番だけが端子についてきたように見える)。

   ・pair    : 端子 2 個 (間の線は選ばない) をマウスで動かすと、間の線は丸ごと
              平行移動し、線番・手決めの線番位置もそのまま付いてくる
   ・nudge   : 矢印キーの移動でも同じ
   ・column  : 端子の列 (端子どうしを縦の線でつないだもの) を横へ動かしても、
              どの線も元の場所に残らず、各線の両端が端子に乗ったまま
   ・oneEnd  : 片端だけ動かす機器に乗っている線は、従来どおり端点が追従して
              直角に折れる (相手側の端は動かない)
   ・cross   : 線番つきの配線の上を横切って端子を動かしても、配線は何も変わらない
   ・rot1    : 1 台の機器を回すと、その機器の端子どうしを結ぶ線 (渡り線) も
              形を保ったまま一緒に回る
   ・rotBlk  : 2 台を選んでブロック回転すると、間の (選んでいない) 線も形を保った
              まま一緒に回り、両端が回ったあとの端子に乗る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const setup = () => p.evaluate(() => {
  App.project = newProject("ついてくる"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage); App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  App.selection.clear();
  return pg.id;
});
const view = () => p.evaluate(() => { const rc = Editor.svg.getBoundingClientRect(), v = Editor.view;
  v.s = 3; v.tx = rc.width / 2 - 160 * 3; v.ty = rc.height / 2 - 120 * 3; UI.refresh(); renderAll(); });
const scr = (x, y) => p.evaluate(([x, y]) => { const r = Editor.svg.getBoundingClientRect(), v = Editor.view;
  return [r.left + v.tx + x * v.s, r.top + v.ty + y * v.s]; }, [x, y]);
const drag = async (path) => {
  let [sx, sy] = await scr(path[0][0], path[0][1]);
  await p.mouse.move(sx, sy); await p.mouse.down();
  for (const [x, y] of path.slice(1)) { const [a, c] = await scr(x, y); await p.mouse.move(a, c, { steps: 4 }); }
  await p.mouse.up(); await p.waitForTimeout(120);
};
const R = {};

// ── pair ──
await setup();
await p.evaluate(() => {
  const pg = curPage();
  const a = addDevice(pg, "term_dot", 100, 100, { tag: "-X1:1" }), c = addDevice(pg, "term_dot", 150, 100, { tag: "-X1:2" });
  const w = addWire(pg, [[100, 100], [150, 100]]); w.num = "2402"; w.fixed = true; w.numAt = [125, 97];
  App.selection.add(a.id); App.selection.add(c.id);
  window.__t = { a: a.id, c: c.id, w: w.id };
});
await view();
await drag([[100, 100], [100, 115], [100, 130]]);
R.pair = await p.evaluate(() => { const pg = curPage(); const w = pg.wires.find(q => q.id === window.__t.w);
  return { pts: JSON.stringify(w.pts), num: w.num, numAt: JSON.stringify(w.numAt), wires: pg.wires.length }; });
// ── nudge (矢印キー ↓ = 5mm) ──
await p.keyboard.press("ArrowDown"); await p.waitForTimeout(100);
R.nudge = await p.evaluate(() => JSON.stringify(curPage().wires.find(q => q.id === window.__t.w).pts));

// ── column (端子の列を縦の線でつないで、横へ動かす) ──
await setup();
await p.evaluate(() => {
  const pg = curPage();
  const ts = [0, 1, 2, 3].map(i => addDevice(pg, "term_dot", 100, 60 + i * 20, { tag: "-X2:" + (i + 1) }));
  [0, 1, 2].forEach(i => { const w = addWire(pg, [[100, 60 + i * 20], [100, 80 + i * 20]]); w.num = String(2410 - i); w.fixed = true; });
  ts.forEach(t => App.selection.add(t.id));
});
await view();
await drag([[100, 60], [130, 60], [160, 60]]);
R.column = await p.evaluate(() => { const pg = curPage();
  const pins = new Set(pg.devices.map(d => d.x + "," + d.y));
  return { leftBehind: pg.wires.filter(w => w.pts.some(q => q[0] === 100)).length,
    onPins: pg.wires.every(w => pins.has(w.pts[0].join(",")) && pins.has(w.pts[w.pts.length - 1].join(","))),
    straight: pg.wires.every(w => w.pts.length === 2 && w.pts[0][0] === 160 && w.pts[1][0] === 160),
    nums: pg.wires.map(w => w.num).join(",") }; });

// ── oneEnd ──
await setup();
await p.evaluate(() => {
  const pg = curPage();
  const a = addDevice(pg, "term_dot", 100, 100, {}); addDevice(pg, "term_dot", 150, 100, {});
  const w = addWire(pg, [[100, 100], [150, 100]]);
  App.selection.add(a.id); window.__t = { w: w.id };
});
await view();
await drag([[100, 100], [100, 115], [100, 130]]);
R.oneEnd = await p.evaluate(() => JSON.stringify(curPage().wires.find(q => q.id === window.__t.w).pts));

// ── cross (線番つきの配線の上を横切って端子を動かす) ──
await setup();
await p.evaluate(() => {
  const pg = curPage();
  [0, 1, 2].forEach(i => { const w = addWire(pg, [[60, 60 + i * 25], [180, 60 + i * 25]]); w.num = String(2402 + i); w.fixed = true; });
  [0, 1, 2].forEach(i => App.selection.add(addDevice(pg, "term_dot", 260, 60 + i * 25, {}).id));
  window.__w0 = JSON.stringify(pg.wires.map(w => [w.pts, w.num]));
});
await view();
await drag([[260, 60], [200, 60], [120, 62], [120, 130], [120, 200]]);
R.cross = await p.evaluate(() => JSON.stringify(curPage().wires.map(w => [w.pts, w.num])) === window.__w0);

// ── rot1 (渡り線つきの機器を 1 台回す) ──
await setup();
R.rot1 = await p.evaluate(() => {
  const pg = curPage();
  const d = addDevice(pg, "aux_no", 100, 100, { tag: "-K1" });            // 端子 (100,100) / (100,120)
  const j = addWire(pg, [[100, 100], [110, 100], [110, 120], [100, 120]]); // 自分の端子どうしの渡り線
  App.selection.clear(); App.selection.add(d.id);
  rotateSelection();
  const pins = devPins(d).map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10].join(","));
  const ends = [j.pts[0], j.pts[j.pts.length - 1]].map(q => q.join(","));
  return { ends, pins, onPins: ends.every(e => pins.includes(e)), pts: JSON.stringify(j.pts) };
});

// ── rotBlk (2 台 + 間の線は選ばない) ──
await setup();
R.rotBlk = await p.evaluate(() => {
  const pg = curPage();
  const a = addDevice(pg, "term_dot", 100, 100, {}), c = addDevice(pg, "term_dot", 140, 100, {});
  const w = addWire(pg, [[100, 100], [100, 90], [140, 90], [140, 100]]);     // U 字
  App.selection.clear(); App.selection.add(a.id); App.selection.add(c.id);
  rotateSelection();
  const ends = [w.pts[0], w.pts[w.pts.length - 1]].map(q => q.join(","));
  return { ends, a: [a.x, a.y].join(","), c: [c.x, c.y].join(","), pts: JSON.stringify(w.pts) };
});

const checks = {
  noPageErrors: errs.length === 0,
  pair: R.pair.pts === "[[100,130],[150,130]]" && R.pair.num === "2402" && R.pair.numAt === "[125,127]" && R.pair.wires === 1,
  nudge: R.nudge === "[[100,135],[150,135]]",
  column: R.column.leftBehind === 0 && R.column.onPins === true && R.column.straight === true && R.column.nums === "2410,2409,2408",
  oneEnd: R.oneEnd === "[[100,130],[150,130],[150,100]]",
  cross: R.cross === true,
  // 渡り線は機器 (100,100) のまわりに +90° 回った形そのまま
  rot1: R.rot1.onPins === true && R.rot1.pts === "[[100,100],[100,110],[80,110],[80,100]]",
  // U 字の線も選んだ 2 台と同じ中心 (120,100) のまわりに回った形のまま
  rotBlk: R.rotBlk.ends.includes(R.rotBlk.a) && R.rotBlk.ends.includes(R.rotBlk.c) &&
    R.rotBlk.pts === "[[120,80],[130,80],[130,120],[120,120]]",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("move-attach OK");
