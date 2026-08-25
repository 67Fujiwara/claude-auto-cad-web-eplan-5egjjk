/* 破線枠 (盤外エリア / 機器グループ) のコピーとコメント。

   ・copyZone     : 破線枠を Ctrl+C / Ctrl+V で複製できる (従来は無視されていた)。
                    コメント・文字高・コメント位置も一緒に写り、id は振り直す
   ・pasteOffset  : 貼り付けた枠は元の枠と重ならない位置へずれる
   ・labelWins    : 破線枠のコメントは動かさず、機器のタグ側が避ける
                    (コメントの箱がラベル配置の障害物に入っている)
   ・labelSize    : コメントの文字高をプロパティで変えられ、描画にも効く
   ・labelDrag    : コメントをマウスでつまんで動かせる (枠そのものは動かない)
   ・labelReset   : 「既定に戻す」で枠の左上へ戻る
   ・labelFollows : 枠を動かすとコメントも一緒に動く (位置は枠からの相対)
   ・fineMove     : 枠だけを動かすときは 0.5mm 刻み (導体の 5mm 格子に縛られない)
   ・fineResize   : 枠のつまみも 0.5mm 刻み
   ・gridKept     : 機器を含めて動かすときは従来どおり 5mm 刻み
                    (端子が格子から外れると配線がつながらなくなる) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

// ── 準備: 枠 1 つと、コメントに重なる位置の機器 ──
await p.evaluate(() => {
  const pg = newPage("zl", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  pg.zones = [{ id: "z1", x: 100, y: 100, w: 60, h: 40, label: "盤外エリア" }];
  // 枠のコメント (y=98.2 付近) にタグが被る位置へコイルを置く
  addDevice(pg, "coil", 115, 105, { tag: "-K1", desc: "" });
  UI.refresh();
});

const R = {};
// ── コピー & 貼り付け ──
R.copy = await p.evaluate(() => {
  App.selection.clear(); App.selection.add("z1");
  const z = curPage().zones[0];
  z.labelSize = 5; z.lx = 8; z.ly = -4;
  copySelection();
  Editor.lastWorld = { x: 200, y: 200 };
  pasteClipboard();
  const zs = curPage().zones;
  const nz = zs[zs.length - 1];
  return { n: zs.length, sameId: nz.id === "z1",
    label: nz.label, size: nz.labelSize, lx: nz.lx, ly: nz.ly,
    x: nz.x, y: nz.y, w: nz.w, h: nz.h, selected: App.selection.has(nz.id) };
});

// ── コメントを避けるか (枠のコメントは動かない) ──
R.avoid = await p.evaluate(() => {
  const pg = curPage();
  // 貼り付けた枠は片づけて 1 つに戻す
  pg.zones = pg.zones.slice(0, 1);
  const z = pg.zones[0];
  delete z.lx; delete z.ly; z.labelSize = 3.5;
  App.labelRev++;
  const lb = zoneLabelBox(z);
  const obs = labelObstacles(pg).some(o => Math.abs(o.x - lb.x) < 0.01 && Math.abs(o.y - lb.y) < 0.01 &&
    Math.abs(o.w - lb.w) < 0.01 && Math.abs(o.h - lb.h) < 0.01);
  const dev = pg.devices[0];
  // ラベルは配列で返る (タグ・機能テキストそれぞれに box が付く)
  const rects = (deviceLabelBoxes(pg, dev) || []).map(o => o.box).filter(Boolean);
  const hit = rects.some(r => rectsOverlap(r, lb));
  return { inObstacles: obs, labelBox: lb, nRects: rects.length, overlaps: hit, rects };
});

// ── 文字高がプロパティで変わり描画に効く ──
R.size = await p.evaluate(async () => {
  App.selection.clear(); App.selection.add("z1"); UI.showProps();
  const inp = document.querySelector("#zLh");
  const before = zoneLabelSize(curPage().zones[0]);
  inp.value = "6";
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  const z = curPage().zones[0];
  // 描画された font-size (文字高 6mm 相当) を読む
  const el = [...Editor.svg.querySelectorAll("text")].find(t => t.textContent === "盤外エリア");
  return { before, after: zoneLabelSize(z), fs: el && +el.getAttribute("font-size"),
    want: el ? svgFontSizeFor("盤外エリア", 6) : null };
});

// ── マウスでコメントを動かす ──
{
  const geo = await p.evaluate(() => {
    const z = curPage().zones[0];
    delete z.lx; delete z.ly; z.labelSize = 5;
    App.selection.clear(); App.selection.add(z.id);
    requestRender();
    const lb = zoneLabelBox(z);
    const r = Editor.svg.getBoundingClientRect();
    const v = Editor.view;
    const toScr = (x, y) => [r.left + v.tx + x * v.s, r.top + v.ty + y * v.s];
    const [sx, sy] = toScr(lb.x + lb.w / 2, lb.y + lb.h / 2);
    const [ex, ey] = toScr(lb.x + lb.w / 2 + 12, lb.y + lb.h / 2 + 20);
    return { sx, sy, ex, ey, zx: z.x, zy: z.y };
  });
  await p.mouse.move(geo.sx, geo.sy);
  await p.mouse.down();
  await p.mouse.move(geo.ex, geo.ey, { steps: 6 });
  await p.mouse.up();
  R.drag = await p.evaluate((g) => {
    const z = curPage().zones[0];
    return { lx: z.lx, ly: z.ly, zx: z.x, zy: z.y, movedZone: z.x !== g.zx || z.y !== g.zy };
  }, geo);
}

// ── 既定に戻す / 枠と一緒に動く ──
R.reset = await p.evaluate(async () => {
  const z = curPage().zones[0];
  const moved = { lx: z.lx, ly: z.ly };
  App.selection.clear(); App.selection.add(z.id); UI.showProps();
  document.querySelector("#zLreset").click();
  await new Promise(r => setTimeout(r, 60));
  const z2 = curPage().zones[0];
  const back = z2.lx === undefined && z2.ly === undefined;
  // 枠を動かすとコメントも付いてくる
  z2.lx = 8; z2.ly = -4;
  const before = zoneLabelPos(z2);
  z2.x += 25; z2.y += 15;
  const after = zoneLabelPos(z2);
  return { moved, back,
    follows: Math.abs(after.x - before.x - 25) < 0.01 && Math.abs(after.y - before.y - 15) < 0.01 };
});

// ── 枠だけの移動は 0.5mm 刻み / 機器を含むときは 5mm 刻み ──
{
  const geo = await p.evaluate(() => {
    const pg = curPage();
    const z = pg.zones[0];
    z.x = 100; z.y = 100; delete z.lx; delete z.ly;
    App.selection.clear(); App.selection.add(z.id);
    requestRender();
    const r = Editor.svg.getBoundingClientRect();
    const v = Editor.view;
    const toScr = (x, y) => [r.left + v.tx + x * v.s, r.top + v.ty + y * v.s];
    // 枠の上辺 (機器やコメントに当たらない位置) をつまむ
    const [sx, sy] = toScr(z.x + z.w - 6, z.y);
    return { sx, sy, s: v.s, zx: z.x, zy: z.y, devX: pg.devices[0].x, devId: pg.devices[0].id };
  });
  // 3.5mm ぶん動かす → 5mm 刻みなら 5mm へ飛ぶ。0.5mm 刻みなら 3.5mm 前後に留まる
  await p.mouse.move(geo.sx, geo.sy);
  await p.mouse.down();
  await p.mouse.move(geo.sx + 3.5 * geo.s, geo.sy + 3.5 * geo.s, { steps: 5 });
  await p.mouse.up();
  R.fine = await p.evaluate((g) => {
    const z = curPage().zones[0];
    return { dx: +(z.x - g.zx).toFixed(2), dy: +(z.y - g.zy).toFixed(2) };
  }, geo);

  // つまみ (右下の角) を 3.5mm 引っぱる
  const geo2 = await p.evaluate(() => {
    const z = curPage().zones[0];
    const r = Editor.svg.getBoundingClientRect();
    const v = Editor.view;
    return { sx: r.left + v.tx + (z.x + z.w) * v.s, sy: r.top + v.ty + (z.y + z.h) * v.s,
      s: v.s, w: z.w, h: z.h };
  });
  await p.mouse.move(geo2.sx, geo2.sy);
  await p.mouse.down();
  await p.mouse.move(geo2.sx + 3.5 * geo2.s, geo2.sy + 3.5 * geo2.s, { steps: 5 });
  await p.mouse.up();
  R.fineResize = await p.evaluate((g) => {
    const z = curPage().zones[0];
    return { dw: +(z.w - g.w).toFixed(2), dh: +(z.h - g.h).toFixed(2) };
  }, geo2);

  // 機器も一緒に選ぶと 5mm 刻みに戻る
  const geo3 = await p.evaluate(() => {
    const pg = curPage();
    const z = pg.zones[0], dev = pg.devices[0];
    App.selection.clear(); App.selection.add(z.id); App.selection.add(dev.id);
    requestRender();
    const r = Editor.svg.getBoundingClientRect();
    const v = Editor.view;
    return { sx: r.left + v.tx + (z.x + z.w - 6) * v.s, sy: r.top + v.ty + z.y * v.s,
      s: v.s, zx: z.x, devX: dev.x, devY: dev.y };
  });
  await p.mouse.move(geo3.sx, geo3.sy);
  await p.mouse.down();
  await p.mouse.move(geo3.sx + 1.5 * geo3.s, geo3.sy + 1.5 * geo3.s, { steps: 5 });
  await p.mouse.up();
  R.grid = await p.evaluate((g) => {
    const pg = curPage();
    return { zdx: +(pg.zones[0].x - g.zx).toFixed(2), devdx: +(pg.devices[0].x - g.devX).toFixed(2) };
  }, geo3);
}

const c = R.copy;
/** 0.5mm 刻みで動いたか (5mm 格子では作れない値になっているか) */
const fine = v => typeof v === "number" && Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 &&
  Math.abs(v - 3.5) <= 0.6 && Math.abs(v % 5) > 1e-6;
const checks = {
  noPageErrors: errs.length === 0,
  copyZone: c.n === 2 && !c.sameId && c.label === "盤外エリア" && c.size === 5 && c.lx === 8 && c.ly === -4 &&
    c.w === 60 && c.h === 40 && c.selected,
  pasteOffset: !(c.x === 100 && c.y === 100),
  labelWins: R.avoid.inObstacles === true && R.avoid.nRects >= 1 && R.avoid.overlaps === false,
  labelSize: R.size.before === 3.5 && R.size.after === 6 &&
    typeof R.size.fs === "number" && Math.abs(R.size.fs - R.size.want) < 0.01,
  labelDrag: typeof R.drag.lx === "number" && R.drag.lx > 2.5 + 6 && R.drag.ly > -1.8 + 10 && !R.drag.movedZone,
  labelReset: R.reset.back === true,
  labelFollows: R.reset.follows === true,
  // 画面のピクセル刻みで ±0.5mm 前後ぶれるので、「0.5 の倍数で 5 の倍数でない」で見る
  fineMove: fine(R.fine.dx) && fine(R.fine.dy),
  fineResize: fine(R.fineResize.dw) && fine(R.fineResize.dh),
  gridKept: R.grid.zdx === 0 && R.grid.devdx === 0,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
