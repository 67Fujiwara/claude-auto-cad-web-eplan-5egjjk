/* PLC 入出力結線図の線番の連番入力。

   ・inc      : 連番の増やし方 — R500→R501 (10進・桁上がり R509→R510)、
                X/Y は 16進 (Y09→Y0A、X0F→X10)。数字で終わらない線番は増やせない
   ・chain    : 先頭の行に線番を入れると、下の行の配線へ連番が入る。
                配線の無い行は番号だけ進む (行と番号の対応がずれない)
   ・manual   : 手で入れた線番は上書きしない。連番で入れた線 (chain 印) は
                先頭を入れ直せば付け替わる
   ・hex      : 三菱ユニットでは Y08 → Y09 → Y0A と 16進で進む
   ・uiPath   : プロパティの線番欄から入れても連番が働く
   ・termStrip: 縦に並べた端子 (端子台) でも同じ — 先頭に入れると下の端子の
                配線へ連番。配線の無い端子は番号だけ進み、35mm 超のあきで
                別の端子台とみなして止まる
   ・termHoriz: 横に並べた端子台 (右へ) でも働く
   ・termUi   : 端子台もプロパティの線番欄から働く (chainWireNumbers 経由) */
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
  out.inc = {
    r: incWireNum("R500"), carry: incWireNum("R509"), pad: incWireNum("007"),
    hexA: incWireNum("Y09"), hexF: incWireNum("X0F"), na: incWireNum("N24V") };

  const setupUnit = (sid) => {
    App.project = newProject("連番"); UI.renumberPages();
    const pg = App.project.pages.find(isDrawingPage);
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    pg.devices.length = 0; pg.wires.length = 0;
    const d = addDevice(pg, sid, 100, 40);
    const sym = symOf(sid);
    const fnPins = symFnPins(sym);
    const pins = devPins(d);
    const wireAt = k => {
      const a = pins[sym.pins.indexOf(fnPins[k])];
      return addWire(pg, [[a.x, a.y], [a.x + 40, a.y]]);
    };
    return { pg, d, sym, fnPins, wireAt };
  };

  // ── KV: 行 0,1,2 と 4 に配線 (行 3 は空き) ──
  {
    const u = setupUnit("kv_n40at_out");
    const w0 = u.wireAt(0), w1 = u.wireAt(1), w2 = u.wireAt(2), w4 = u.wireAt(4);
    setWireNumber(u.pg, w0, "R500");
    const n = chainIoWireNumbers(u.pg, w0, "R500");
    out.chain = { n, w1: w1.num, w2: w2.num, w4: w4.num, w1chain: !!w1.chain };
    // 手で入れた線番は守る / chain 印は付け替え可
    setWireNumber(u.pg, w2, "TEBUCHI");
    w2.chain = false;
    setWireNumber(u.pg, w0, "R600");
    const n2 = chainIoWireNumbers(u.pg, w0, "R600");
    out.manual = { n: n2, w1: w1.num, w2: w2.num, w4: w4.num };
  }

  // ── 三菱: 16進の繰り上がり ──
  {
    const u = setupUnit("ry40nt5p_out");
    const w8 = u.wireAt(8), w9 = u.wireAt(9), w10 = u.wireAt(10);
    setWireNumber(u.pg, w8, "Y08");
    const n = chainIoWireNumbers(u.pg, w8, "Y08");
    out.hex = { n, w9: w9.num, w10: w10.num };
  }

  // ── プロパティの線番欄から (実 UI 経路) ──
  {
    const u = setupUnit("kv_n40at_out");
    const w0 = u.wireAt(0), w1 = u.wireAt(1);
    App.selection.clear(); App.selection.add(w0.id); UI.showProps();
    const inp = document.getElementById("pNum");
    inp.value = "R700";
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.uiPath = { w0: w0.num, w1: w1.num };
    App.selection.clear();
  }
  /* ── 端子台 (縦): 5mm ピッチで 6 個 + 30mm 離れた別の端子台 ── */
  {
    App.project = newProject("端子台連番"); UI.renumberPages();
    const pg = App.project.pages.find(isDrawingPage);
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    pg.devices.length = 0; pg.wires.length = 0;
    const ts = [];   // 縦 25mm ピッチ (端子の記号は 20mm 幅 — 重ならない間隔)
    for (let i = 0; i < 6; i++) ts.push(addDevice(pg, "terminal", 100, 100 + i * 25, { tag: String(i + 1) }));
    const far = addDevice(pg, "terminal", 100, 100 + 5 * 25 + 50, { tag: "FAR" });   // 50mm あき = 別の端子台
    const wAt = (d) => { const a = devPins(d)[0]; return addWire(pg, [[a.x, a.y], [a.x - 30, a.y], [a.x - 30, a.y - 10]]); };
    const w0 = wAt(ts[0]), w1 = wAt(ts[1]), w3 = wAt(ts[3]), w5 = wAt(ts[5]);
    const wFar = wAt(far);
    pg.wires.forEach(w => { w.num = null; w.fixed = false; w.numShow = false; });   // 自動採番を消して素の状態に
    setWireNumber(pg, w0, "101");
    const n = chainWireNumbers(pg, w0, "101");
    // 離れた端子台には連番が及ばない (自動採番は別途付くので、chain 印と番号で見る)
    out.termStrip = { n, w1: w1.num, w3: w3.num, w5: w5.num,
      far: wFar.num, farChain: !!wFar.chain, w1chain: !!w1.chain };
  }
  /* ── 端子台 (横) ── */
  {
    const pg = curPage();
    pg.devices.length = 0; pg.wires.length = 0;
    const ts = [];   // 横に 10mm ピッチで並べる (縦向きの端子・配線は上下へ) = 端子台のよくある描き方
    for (let i = 0; i < 3; i++) ts.push(addDevice(pg, "terminal", 100 + i * 10, 200, { tag: String(i + 1) }));
    const wAt = (d) => { const a = devPins(d)[0]; return addWire(pg, [[a.x, a.y], [a.x, a.y - 30]]); };
    const w0 = wAt(ts[0]), w1 = wAt(ts[1]), w2 = wAt(ts[2]);
    pg.wires.forEach(w => { w.num = null; w.fixed = false; w.numShow = false; });
    setWireNumber(pg, w0, "201");
    const n = chainWireNumbers(pg, w0, "201");
    out.termHoriz = { n, w1: w1.num, w2: w2.num };
  }
  /* ── 端子台もプロパティ経路で ── */
  {
    const pg = curPage();
    pg.devices.length = 0; pg.wires.length = 0;
    const t1 = addDevice(pg, "terminal", 100, 100, { tag: "1" });
    const t2 = addDevice(pg, "terminal", 110, 100, { tag: "2" });
    const a1 = devPins(t1)[0], a2 = devPins(t2)[0];
    const w0 = addWire(pg, [[a1.x, a1.y], [a1.x, a1.y - 30]]);
    const w1 = addWire(pg, [[a2.x, a2.y], [a2.x, a2.y - 30]]);
    pg.wires.forEach(w => { w.num = null; w.fixed = false; w.numShow = false; });
    App.selection.clear(); App.selection.add(w0.id); UI.showProps();
    const inp = document.getElementById("pNum");
    inp.value = "301";
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.termUi = { w0: w0.num, w1: w1.num };
    App.selection.clear();
  }
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  inc: R.inc.r === "R501" && R.inc.carry === "R510" && R.inc.pad === "008"
    && R.inc.hexA === "Y0A" && R.inc.hexF === "X10" && R.inc.na === null,
  chain: R.chain.n === 3 && R.chain.w1 === "R501" && R.chain.w2 === "R502"
    && R.chain.w4 === "R504" && R.chain.w1chain === true,
  manual: R.manual.w1 === "R601" && R.manual.w2 === "TEBUCHI" && R.manual.w4 === "R604",
  hex: R.hex.n === 2 && R.hex.w9 === "Y09" && R.hex.w10 === "Y0A",
  uiPath: R.uiPath.w0 === "R700" && R.uiPath.w1 === "R701",
  termStrip: R.termStrip.n === 3 && R.termStrip.w1 === "102" && R.termStrip.w3 === "104"
    && R.termStrip.w5 === "106" && R.termStrip.far !== "107" && R.termStrip.farChain === false
    && R.termStrip.w1chain === true,
  termHoriz: R.termHoriz.n === 2 && R.termHoriz.w1 === "202" && R.termHoriz.w2 === "203",
  termUi: R.termUi.w0 === "301" && R.termUi.w1 === "302",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-chain OK");
