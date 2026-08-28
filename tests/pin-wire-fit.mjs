/* 端子と配線が合わなくなる不具合の回帰テスト。

   端子どうしの吸着 (align-snap) で機器は 0.5mm 単位に置けるようになったが、
   配線側が 5mm 格子のままだと、格子から外れた端子に線が届かない。

   ・drawSnap  : 配線ツールで端子の近くをクリックすると、端子ちょうどに
                 つながる (格子へ丸め戻されない)
   ・dragSnap  : 引いてある配線をドラッグして端子の高さへ寄せると、
                 端子の高さにぴったり合う (2.5mm 以内)
   ・gridKept  : 端子から離れた所は従来どおり 5mm 格子に乗る
   ・devMove   : 機器を動かしても、つながっている配線は端子から外れない
   ・attachSelf: 自分につながっている配線は吸着の相手にしない
                 (自分の写しに引き寄せられて 5mm 動くことがない)
   ・netOK     : 端子が格子から外れていても回路はつながる (検図が黙る) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const info = await p.evaluate(async () => {
  const pg = newPage("pwf", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  const d = addDevice(pg, "conn_io8", 120, 60, { tag: "-CN3" });
  d.y = 62.5;                       // 端子が 5mm 格子から外れた状態 (吸着で置いた姿)
  UI.setTool("wire");
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const bb = Editor.svg.getBoundingClientRect();
  return { did: d.id, pins: devPins(d).map(q => [q.x, q.y]),
    bb: [bb.left, bb.top], view: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const S = (x, y) => ({ x: info.bb[0] + info.view[0] + x * info.view[2], y: info.bb[1] + info.view[1] + y * info.view[2] });

// ── 配線ツールで 1 番端子へ引く (端子の 2mm ほど手前をクリック) ──
{
  const a = S(80, 60);
  await p.mouse.click(a.x, a.y);
  await p.waitForTimeout(100);
  const c = S(info.pins[0][0] - 1.5, info.pins[0][1] + 1.2);
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(150);
}
const R = {};
R.drawSnap = await p.evaluate(([did]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === did);
  const pin = devPins(d)[0];
  const w = pg.wires[pg.wires.length - 1];
  const e = w.pts[w.pts.length - 1];
  return { gap: +Math.hypot(e[0] - pin.x, e[1] - pin.y).toFixed(3), pts: w.pts };
}, [info.did]);
R.gridKept = await p.evaluate(() => {
  const w = curPage().wires[curPage().wires.length - 1];
  return w.pts[0][0] % 5 === 0 && w.pts[0][1] % 5 === 0;     // 端子から離れた始点は格子上
});

// ── 別の配線を引いて、ドラッグで 2 番端子の高さへ寄せる ──
const dragInfo = await p.evaluate(async ([did]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === did);
  const pin = devPins(d)[1];
  // 端子の x まで伸ばしておく → 高さが合えば端子につながる
  const w = addWire(pg, [[70, pin.y + 2.5], [pin.x, pin.y + 2.5]], { raw: true });
  UI.setTool("select");
  App.selection.clear(); App.selection.add(w.id);
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  return { wid: w.id, y0: pin.y + 2.5, pinY: pin.y };
}, [info.did]);
{
  const from = S(85, dragInfo.y0), to = S(85, dragInfo.y0 - 2.4);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(150);
}
R.dragSnap = await p.evaluate(([wid, pinY]) => {
  const w = curPage().wires.find(x => x.id === wid);
  return { y: w.pts[0][1], gap: +(w.pts[0][1] - pinY).toFixed(3) };
}, [dragInfo.wid, dragInfo.pinY]);

// ── 機器を動かしても配線は端子から外れない / 自分の配線に吸い寄せられない ──
const devInfo = await p.evaluate(([did]) => {
  const d = curPage().devices.find(x => x.id === did);
  App.selection.clear(); App.selection.add(d.id);
  UI.refresh();
  return { x: d.x, y: d.y };
}, [info.did]);
{
  const from = S(devInfo.x, devInfo.y + 10), to = S(devInfo.x + 10, devInfo.y + 10);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(150);
}
R.devMove = await p.evaluate(([did]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === did);
  const pin = devPins(d)[0];
  const w = pg.wires[0];
  const e = w.pts[w.pts.length - 1];
  return { moved: d.x - 120, gap: +Math.hypot(e[0] - pin.x, e[1] - pin.y).toFixed(3), devY: d.y };
}, [info.did]);
R.attachSelf = R.devMove.moved === 10 && R.devMove.devY === 62.5;   // 自分の線に引かれて余計に動かない

R.netOK = await p.evaluate(([did]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === did);
  const nets = computeNets(pg, "closed");
  return {
    same: nets.pinNet(d, 0) === nets.wireNet.get(pg.wires[0].id),
    /* 未接続は「配線していない端子」に出るのが正しい。ここでは配線した
       1 番端子について出ていないことを見る (格子から外れていても拾えるか) */
    msgs: runDRC().filter(i => i.page === pg.no && /未接続/.test(i.msg)).map(i => i.msg),
    pin0: devPins(d)[0].name,          // 配線した端子の名前 (S1)
    pin1: devPins(d)[1].name,          // ドラッグで合わせた端子 (S2)
  };
}, [info.did]);

const checks = {
  noPageErrors: errs.length === 0,
  drawSnap: R.drawSnap.gap === 0,
  gridKept: R.gridKept === true,
  dragSnap: R.dragSnap.gap === 0,
  devMove: R.devMove.gap === 0,
  attachSelf: R.attachSelf === true,
  /* 配線した 2 本の端子 (S1・ドラッグで寄せた S2) には未接続が出ないこと。
     残りの端子に出るのは正しい挙動なので数は問わない */
  netOK: R.netOK.same === true
    && !R.netOK.msgs.some(m => m.includes(` ${R.netOK.pin0} `))
    && !R.netOK.msgs.some(m => m.includes(` ${R.netOK.pin1} `)),
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("pin-wire-fit OK");
