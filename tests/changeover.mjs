/* c接点 (切替接点) — JIS C 0617-7 07-02-04 / IEC 60617。

   ・symbol     : 補助接点 (c接点) がライブラリ (ロジック機器) にあり、
                  端子は 11 (共通)・12 (b側)・14 (a側) の 3 点
   ・restNC     : 不動作時は共通-b側が閉、動作時は共通-a側が閉 (break-before-make)
   ・noShort    : b側→0V / a側→+24V の常套回路でも短絡と誤検図しない
   ・linkedNum  : コイル連動の 2 個目は 21/22/24 に自動繰り上げ
   ・mirror     : コイル下のミラー表に 11·12·14 が出る (画面・DXF とも)
   ・drawn      : 図面と DXF に記号が出る
   ・dbFixed    : データベースの切替接点も切替として通電計算される
                  (端子の並びは a側 → b側 → 共通) */
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
  const out = {};
  const sym = symOf("aux_co");
  out.symbol = {
    found: !!sym, cat: sym && sym.cat, jis: sym && sym.jis, sim: sym && sym.sim,
    linked: !!(sym && sym.linked),
    pins: sym ? sym.pins.map(q => [q.x, q.y, q.n]) : null,
    inPalette: [...document.querySelectorAll("#symTree .sym-name")].some(x => x.textContent === sym.name),
  };

  App.project = newProject("c接点");
  UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  const d = addDevice(pg, "aux_co", 100, 100, {});
  // 不動作 / 動作の閉じ方 (通電計算モード)
  App.sim.states = {}; App.sim.timers = {};
  const pairs = m => JSON.stringify(conductivePairs(d, m));
  out.restNC = { rest: pairs("sim") };
  App.sim.states[d.id] = true;
  out.restNC.act = pairs("sim");
  App.sim.states = {};
  out.restNC.open = pairs("open");     // 機器を跨いで線番・ネットが破断する

  // ── 短絡の誤検図が出ないこと (b側 0V / a側 +24V) ──
  const ps = addDevice(pg, "psu24", 60, 50, {});
  const pins = i => devPins(d)[i];
  const pp = devPins(ps);        // L(50,50) N(70,50) +V(50,80) -V(70,80)
  // +24V → a側(14) は右回りで、0V → b側(12) は真下へ (線が重ならない経路)
  addWire(pg, [[50, 80], [50, 55], [120, 55], [120, 100], [100, 100]], { raw: true });
  addWire(pg, [[70, 80], [70, 100], [90, 100]], { raw: true });
  const lamp = addDevice(pg, "lamp", 100, 160, {});
  const lp = devPins(lamp);
  addWire(pg, [[pins(2).x, pins(2).y], [lp[0].x, lp[0].y]], { raw: true });     // 共通(11) → ランプ
  addWire(pg, [[lp[1].x, lp[1].y], [lp[1].x, 200], [70, 200], [70, 100]], { raw: true });  // ランプ → 0V
  out.wired = { p24: !!pp[2], com: [pins(2).x, pins(2).y], a: [pins(0).x, pins(0).y], b: [pins(1).x, pins(1).y] };
  const drc = runDRC();
  out.noShort = { shorts: drc.filter(i => /短絡/.test(i.msg)).map(i => i.msg) };

  // ── 連動接点の自動繰り上げ ──
  const coil = addDevice(pg, "coil", 200, 100, {});
  const c1 = addDevice(pg, "aux_co", 240, 100, { linkTo: coil.id });
  const c2 = addDevice(pg, "aux_co", 280, 100, { linkTo: coil.id });
  out.linkedNum = {
    first: [0, 1, 2].map(i => effectivePinName(c1, i)),
    second: [0, 1, 2].map(i => effectivePinName(c2, i)),
  };

  // ── ミラー表 (画面・DXF) ──
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.mirror = {
    label: contactPinLabel(c1),
    svg: Editor.layers.devices.innerHTML.includes("11·12·14"),
    // DXF の非 ASCII は \U+xxxx 形式で書き出される
    dxf: pageToDXF(pg).split(/\r?\n/).includes("11\\U+00B712\\U+00B714"),
  };

  // ── 図面・DXF に記号が出る ──
  out.drawn = {
    svg: Editor.layers.devices.innerHTML.includes("M-10,0 V7 H-2.6"),
    dxfLines: (pageToDXF(pg).match(/\nLINE\n/g) || []).length,
  };

  // ── データベースの切替接点 ──
  const dbs = symOf("changeover");
  const dd = addDevice(pg, "changeover", 340, 100, {});
  App.sim.states = {};
  out.dbFixed = {
    sim: dbs.sim, pins: dbs.pins.map(q => q.n),
    rest: JSON.stringify(conductivePairs(dd, "sim")),
  };
  App.sim.states[dd.id] = true;
  out.dbFixed.act = JSON.stringify(conductivePairs(dd, "sim"));
  App.sim.states = {};
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  symbol: R.symbol.found && R.symbol.cat === "logic" && R.symbol.jis === "07-02-04"
    && R.symbol.sim === "changeover" && R.symbol.linked && R.symbol.inPalette
    && JSON.stringify(R.symbol.pins) === JSON.stringify([[0, 0, "14"], [-10, 0, "12"], [0, 20, "11"]]),
  restNC: R.restNC.rest === "[[1,2]]" && R.restNC.act === "[[0,2]]" && R.restNC.open === "[]",
  noShort: R.noShort.shorts.length === 0,
  linkedNum: JSON.stringify(R.linkedNum.first) === JSON.stringify(["14", "12", "11"])
    && JSON.stringify(R.linkedNum.second) === JSON.stringify(["24", "22", "21"]),
  mirror: R.mirror.label === "11·12·14" && R.mirror.svg === true && R.mirror.dxf === true,
  drawn: R.drawn.svg === true && R.drawn.dxfLines > 10,
  dbFixed: R.dbFixed.sim === "changeover" && JSON.stringify(R.dbFixed.pins) === JSON.stringify(["NO", "NC", "COM"])
    && R.dbFixed.rest === "[[1,2]]" && R.dbFixed.act === "[[0,2]]",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("changeover OK");
