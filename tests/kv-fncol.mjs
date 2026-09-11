/* PLC 入出力結線図の機能欄 (コメント欄) をドラッグで移動できる。

   ・bodyClean : 下線は body に焼き込まれていない (ioSheet.fnX/fnW を公開し、
                 画面・DXF が機器ごとに引く)
   ・drawn     : 配置した機器のグループに、入出力点の行数ぶんの下線が既定位置で
                 描かれる (電源 0V/24V・コモンの行には無い)
   ・dragMove  : 下線を実マウスでつまんで右へドラッグ → props.fnDx が付き
                 (0.5mm 刻み)、下線が新しい位置で描かれる
   ・devKept   : 機器そのもの (x,y) と行テキスト以外は動かない
   ・textFollow: 機能欄の文言 (deviceRowTexts) の x も一緒に動く
   ・inkShift  : 機能欄の帯 (devInkBoxes の fn 帯) も追従する (ラベル回避用)
   ・dxfFollow : DXF 出力の下線も動いた位置で出る
   ・undoBack  : 元に戻す (undo) でドラッグ前へ戻る
   ・resetBtn  : プロパティ「既定に戻す」で fnDx が消える
   ・inColGrab : 下線の帯以外 (行間の空白) では従来どおり機器の移動になる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = {};
const D = await p.evaluate(async () => {
  const out = {};
  const sym = SYMBOLS_BY_ID["kv_n40at_out"];
  out.bodyClean = !sym.body.includes('stroke-width="0.25"')
    && sym.ioSheet.fnX !== undefined && sym.ioSheet.fnW > 0;
  const pg = newPage("fn", App.project.pages.length + 1);
  pg.paper = sym.sheet.paper; pg.orient = sym.sheet.orient; pg.scale = "NS";
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  const d = addDevice(pg, "kv_n40at_out", 60, 25, {});
  d.props.fn = { "500": "運転表示灯" };
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 250));
  const g = document.querySelector(`g.device[data-id="${d.id}"]`);
  const fx = sym.ioSheet.fnX;
  // 下線は入出力点の行だけ (電源 0V/24V・コモンには無い)
  out.drawn = g && g.innerHTML.includes(`M${fx},`) &&
    (g.innerHTML.match(new RegExp(`M${fx},`, "g")) || []).length === sym.ioSheet.rows.filter(r2 => r2.io).length &&
    sym.ioSheet.rows.some(r2 => !r2.io);
  out.devId = d.id; out.dev = { x: d.x, y: d.y };
  out.fnX = fx; out.fnW = sym.ioSheet.fnW;
  out.row0 = sym.ioSheet.rows[0].y;
  out.text0 = deviceRowTexts(pg, d)[0].x;
  out.view = { tx: Editor.view.tx, ty: Editor.view.ty, s: Editor.view.s };
  return out;
});
Object.assign(R, D);

// 図面座標 → 画面座標
const scr = async (x, y) => {
  const r = await p.evaluate(() => {
    const el = document.querySelector("#canvas") || Editor.svg;
    const bb = Editor.svg.getBoundingClientRect();
    return { left: bb.left, top: bb.top, tx: Editor.view.tx, ty: Editor.view.ty, s: Editor.view.s };
  });
  return { x: r.left + r.tx + x * r.s, y: r.top + r.ty + y * r.s };
};

// ── 下線の帯をつまんで +15mm ドラッグ ──
{
  const gx = R.dev.x + R.fnX + 10, gy = R.dev.y + R.row0 + 1.5;
  const from = await scr(gx, gy);
  const to = await scr(gx + 15, gy);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 5 });
  await p.mouse.up();
}
await p.waitForTimeout(150);
R.after = await p.evaluate(([id, fnX]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === id);
  const g = document.querySelector(`g.device[data-id="${id}"]`);
  const band = devInkBoxes(d).find(r2 => r2.w > 40 && r2.x > d.x);   // 機能欄の帯 (右側の広い帯)
  return {
    fnDx: d.props.fnDx, x: d.x, y: d.y,
    drawnAt: g && g.innerHTML.includes(`M${fnX + (d.props.fnDx || 0)},`),
    text0: deviceRowTexts(pg, d)[0].x,
    bandX: band && band.x,
    dxfHasNew: pageToDXF(pg).includes((d.x + fnX + (d.props.fnDx || 0)).toFixed(3)),
  };
}, [R.devId, R.fnX]);

// ── undo で戻る ──
R.undoBack = await p.evaluate(([id]) => {
  undo();
  const d = curPage().devices.find(x => x.id === id);
  return { fnDx: d.props.fnDx === undefined ? 0 : d.props.fnDx };
}, [R.devId]);

// ── もう一度ドラッグ → プロパティ「既定に戻す」──
{
  const gx = R.dev.x + R.fnX + 10, gy = R.dev.y + R.row0 + 1.5;
  const from = await scr(gx, gy);
  const to = await scr(gx + 10, gy);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 4 });
  await p.mouse.up();
}
await p.waitForTimeout(150);
R.resetBtn = await p.evaluate(async ([id]) => {
  const d = curPage().devices.find(x => x.id === id);
  const before = d.props.fnDx;
  App.selection.clear(); App.selection.add(id);
  UI.refresh(); UI.showProps();
  await new Promise(r => setTimeout(r, 120));
  const btn = document.querySelector("#pFnPos");
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 120));
  return { before, shown: !!btn, after: d.props.fnDx };
}, [R.devId]);

// ── 行間の空白 (下線から離れた y) では機器の移動になる ──
R.inColGrab = await p.evaluate(async ([id, fnX, row0]) => {
  const d = curPage().devices.find(x => x.id === id);
  App.selection.clear();
  const fc = fnColAt(curPage(), d.x + fnX + 10, d.y + row0 + 1.5);
  const miss = fnColAt(curPage(), d.x + fnX + 10, d.y + row0 + 11);   // 行間 (次行まで 20mm)
  return { hits: !!fc, missIsNull: miss === null };
}, [R.devId, R.fnX, R.row0]);

const checks = {
  noPageErrors: errs.length === 0,
  bodyClean: R.bodyClean === true,
  drawn: R.drawn === true,
  dragMove: R.after.fnDx === 15 && R.after.drawnAt === true,
  devKept: R.after.x === R.dev.x && R.after.y === R.dev.y,
  textFollow: Math.abs(R.after.text0 - (R.text0 + 15)) < 0.01,
  inkShift: Math.abs(R.after.bandX - (R.dev.x + R.fnX - 0.25 + 15)) < 0.1,   // 帯の座標は 0.1mm 丸め
  dxfFollow: R.after.dxfHasNew === true,
  undoBack: R.undoBack.fnDx === 0,
  resetBtn: R.resetBtn.before === 10 && R.resetBtn.shown && R.resetBtn.after === undefined,
  inColGrab: R.inColGrab.hits && R.inColGrab.missIsNull,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-fncol OK");
