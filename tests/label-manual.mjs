/* 機器の明示 (タグ・接点の相互参照) の位置。

   ・stable : 中央寄せ・2 行の注記 (外部I/F入力02 / (DC24V)) が同じ行に来ても、
             離れた接点 (-CR2) のタグは左のまま。以前は注記の障害物の箱が
             「基点から右へ全文 1 行分」で、見えない所まで伸びてタグを押し出した
   ・obst   : 注記の障害物は実際の外接箱 (textBounds) と同じ
   ・hint   : 機器を選ぶと、つかめる明示 (タグ / 相互参照) に破線の枠が出る
   ・xref   : 相互参照をマウスでドラッグすると、その位置 (機器からの相対、0.5mm
             刻み) に描かれる。DXF にも同じ位置で出る。元に戻すで戻る
   ・tag    : タグをドラッグすると機能テキストも同じ間隔で付いてくる
   ・follow : 機器を動かすと、動かした明示も一緒に付いてくる
   ・unsel  : 選んでいない機器の明示はドラッグで動かない
   ・avoid  : 手で置いた相互参照・タグの上には、ほかの機器のタグが来ない
             (手で置いたタグは先に置き、左にある機器のタグでも避ける)
   ・reset  : プロパティの「明示の位置を自動に戻す」で自動の位置に戻る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const setup = await p.evaluate(() => {
  App.project = newProject("明示の位置"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  const pg2 = JSON.parse(JSON.stringify(pg)); pg2.id = "pgCoil"; pg2.name = "コイル"; pg2.devices = []; pg2.wires = []; pg2.texts = [];
  App.project.pages.push(pg2); UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0; pg.texts = [];
  const coil = addDevice(pg2, "coil", 100, 100, { tag: "-CR2" });
  const c2 = addDevice(pg, "aux_no", 268, 106, { tag: "-CR2" }); c2.linkTo = coil.id; c2.desc = "運転";
  addWire(pg, [[268, 106], [360, 106]]); addWire(pg, [[268, 126], [360, 126]]);
  const out = {};
  // ── stable / obst ──
  const t = { id: "t1", x: 197, y: 117, text: "外部I/F入力02\n(DC24V)", anchor: "middle", size: 5 };
  const side = () => { App.labelRev++; const tg = deviceLabelBoxes(pg, c2).find(o => o.isTag); return tg.anchor + "@" + Math.round(tg.x); };
  pg.texts = [{ ...t, y: 170 }]; const away = side();
  pg.texts = [t]; const inRow = side();
  const ob = labelObstacles(pg).find(o => o.owner === null && !o.wire);
  const tb = textBounds(t);
  out.stable = { away, inRow };
  out.obst = ["x", "y", "w", "h"].every(k => Math.abs(ob[k] - tb[k]) < 1e-6);
  pg.texts = [];
  App.labelRev++; UI.refresh(); zoomFit();
  window.__ids = { c2: c2.id };
  return out;
});
await p.waitForTimeout(200);
// 画面座標へ
const scr = (x, y) => p.evaluate(([x, y]) => { const r = Editor.svg.getBoundingClientRect(), v = Editor.view;
  return [r.left + v.tx + x * v.s, r.top + v.ty + y * v.s]; }, [x, y]);
const grips = () => p.evaluate(() => { const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  return devLabelGrips(pg, d).map(g => ({ kind: g.kind, cx: g.box.x + g.box.w / 2, cy: g.box.y + g.box.h / 2 })); });
const drag = async (x, y, dx, dy) => {
  const [sx, sy] = await scr(x, y), [ex, ey] = await scr(x + dx, y + dy);
  await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 3 });
  await p.mouse.move(ex, ey, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(120);
};
// ズーム (つかみやすく)
await p.evaluate(() => { const r = Editor.svg.getBoundingClientRect(), v = Editor.view;
  v.s = 6; v.tx = r.width / 2 - 268 * 6; v.ty = r.height / 2 - 115 * 6; requestRender(); });
await p.waitForTimeout(150);

// ── unsel: 選んでいないとき相互参照をドラッグしても動かない ──
let g0 = await grips();
const xr0 = g0.find(g => g.kind === "xref");
await drag(xr0.cx, xr0.cy, 10, 3);
const unsel = await p.evaluate(() => !curPage().devices.find(q => q.id === window.__ids.c2).xrefAt);
// ── hint ──
await p.evaluate(() => { App.selection.clear(); App.selection.add(window.__ids.c2); UI.showProps(); requestRender(); });
await p.waitForTimeout(120);
const hint = await p.evaluate(() => document.querySelectorAll("#lyOverlay .lbl-grip").length);
// ── xref ──
g0 = await grips();
const xa = g0.find(g => g.kind === "xref");
const before = await p.evaluate(() => { const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2); const xr = deviceXrefBox(pg, d); return { x: xr.x, y: xr.y }; });
await drag(xa.cx, xa.cy, 10, 3);
const xref = await p.evaluate((before) => {
  const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  const xr = deviceXrefBox(pg, d);
  const txt = [...document.querySelectorAll("#lyDevices text")].find(t2 => t2.textContent === xr.text);
  applySheet(pg);
  const dxf = pageToDXF(pg);
  const i = dxf.indexOf(xr.text);
  const seg = dxf.slice(Math.max(0, i - 400), i);
  const xs = [...seg.matchAll(/\n\s*10\s*\n([-\d.]+)/g)].map(m => +m[1]);
  return { at: d.xrefAt, moved: [+(xr.x - before.x).toFixed(2), +(xr.y - before.y).toFixed(2)],
    drawn: !!txt && Math.abs(+txt.getAttribute("x") - xr.x) < 0.01, dxfX: xs.length ? +(xs[xs.length - 1] - xr.x).toFixed(2) : null,
    msg: document.body.textContent.includes("相互参照の位置を動かしました"),
    propsBtn: !!document.querySelector("#pLblAuto") };
}, before);
const undoX = await p.evaluate(() => { undo(); App.labelRev++; const d = curPage().devices.find(q => q.id === window.__ids.c2);
  return !d.xrefAt; });
await p.evaluate(() => { redo(); App.labelRev++; App.selection.clear(); App.selection.add(window.__ids.c2); requestRender(); });
await p.waitForTimeout(120);
// ── tag ──
g0 = await grips();
const ta = g0.find(g => g.kind === "tag");
const tb0 = await p.evaluate(() => { const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  const bx = deviceLabelBoxes(pg, d); const tg = bx.find(o => o.isTag), ds = bx.find(o => !o.isTag);
  return { tx: tg.x, ty: tg.y, gap: ds.y - tg.y, dgx: ds.x - tg.x }; });
await drag(ta.cx, ta.cy, -6, -8);
const tag = await p.evaluate((tb0) => { const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  App.labelRev++;
  const bx = deviceLabelBoxes(pg, d); const tg = bx.find(o => o.isTag), ds = bx.find(o => !o.isTag);
  return { user: !!(d.tagAt && d.tagAt.user), moved: [+(tg.x - tb0.tx).toFixed(2), +(tg.y - tb0.ty).toFixed(2)],
    gapKept: Math.abs((ds.y - tg.y) - tb0.gap) < 1e-6 && Math.abs((ds.x - tg.x) - tb0.dgx) < 1e-6 }; }, tb0);
// ── follow ──
const follow = await p.evaluate(() => { const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  const a = deviceXrefBox(pg, d), ta2 = deviceLabelBoxes(pg, d).find(o => o.isTag);
  d.x += 20; App.labelRev++;
  const b2 = deviceXrefBox(pg, d), tb2 = deviceLabelBoxes(pg, d).find(o => o.isTag);
  d.x -= 20; App.labelRev++;
  return [+(b2.x - a.x).toFixed(2), +(tb2.x - ta2.x).toFixed(2)].join(","); });
// ── avoid: 別の接点のタグが来る場所へ相互参照を置く ──
const avoid = await p.evaluate(() => { const pg = curPage();
  const other = addDevice(pg, "aux_no", 200, 160, { tag: "-CR9" });
  App.labelRev++;
  const tg = deviceLabelBoxes(pg, other).find(o => o.isTag);
  const d = pg.devices.find(q => q.id === window.__ids.c2);
  const keep = { xrefAt: d.xrefAt, tagAt: d.tagAt };
  delete d.tagAt;
  // c2 の相互参照を、CR9 のタグがある所へ置く
  const h = deviceXrefBox(pg, d).box.h;
  d.xrefAt = { dx: tg.box.x - d.x, dy: tg.box.y + h - d.y };
  App.labelRev++;
  const tg2 = deviceLabelBoxes(pg, other).find(o => o.isTag);
  const xb = deviceXrefBox(pg, d).box;
  const ov = overlapArea(tg2.box, xb);
  pg.devices = pg.devices.filter(q => q !== other);
  delete d.xrefAt;
  // 手で置いたタグも同じ: 左にある (先に配置される) 機器のタグの場所へ c2 のタグを置く
  const other2 = addDevice(pg, "aux_no", 150, 160, { tag: "-CR8" });
  App.labelRev++;
  const tgA = deviceLabelBoxes(pg, other2).find(o => o.isTag);
  d.tagAt = { dx: tgA.x - d.x, dy: tgA.y - d.y, anchor: tgA.anchor, user: true };
  App.labelRev++;
  const tgB = deviceLabelBoxes(pg, other2).find(o => o.isTag), mine = deviceLabelBoxes(pg, d).find(o => o.isTag);
  const ov2 = overlapArea(tgB.box, mine.box);
  pg.devices = pg.devices.filter(q => q !== other2);
  d.xrefAt = keep.xrefAt; d.tagAt = keep.tagAt;
  App.labelRev++;
  return { moved: Math.abs(tg2.x - tg.x) + Math.abs(tg2.y - tg.y) > 0.5, overlap: +ov.toFixed(3), tagOverlap: +ov2.toFixed(3) }; });
// ── reset ──
await p.evaluate(() => { App.selection.clear(); App.selection.add(window.__ids.c2); UI.showProps(); });
await p.waitForTimeout(100);
const reset = await p.evaluate(() => { const btn = document.querySelector("#pLblAuto"); if (!btn) return { btn: false };
  btn.click(); const pg = curPage(), d = pg.devices.find(q => q.id === window.__ids.c2);
  return { btn: true, cleared: !d.xrefAt && !d.tagAt, tagLeft: deviceLabelBoxes(pg, d).find(o => o.isTag).anchor }; });

const R = { ...setup, unsel, hint, xref, undoX, tag, follow, avoid, reset };
const checks = {
  noPageErrors: errs.length === 0,
  stable: R.stable.away === R.stable.inRow && /^end@/.test(R.stable.inRow),
  obst: R.obst === true,
  hint: R.hint === 2,
  xref: !!R.xref.at && R.xref.moved[0] === 10 && R.xref.moved[1] === 3 && R.xref.drawn === true &&
    R.xref.dxfX === 0 && R.xref.msg === true && R.xref.propsBtn === true && R.undoX === true,
  tag: R.tag.user === true && R.tag.moved[0] === -6 && R.tag.moved[1] === -8 && R.tag.gapKept === true,
  follow: R.follow === "20,20",
  unsel: R.unsel === true,
  avoid: R.avoid.moved === true && R.avoid.overlap === 0 && R.avoid.tagOverlap === 0,
  reset: R.reset.btn === true && R.reset.cleared === true && R.reset.tagLeft === "end",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("label-manual OK");
