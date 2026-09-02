/* PLC 入出力結線図の線番の連番入力。

   ・inc      : 連番の増やし方 — R500→R501 (10進・桁上がり R509→R510)、
                X/Y は 16進 (Y09→Y0A、X0F→X10)。数字で終わらない線番は増やせない
   ・chain    : 先頭の行に線番を入れると、下の行の配線へ連番が入る。
                配線の無い行は番号だけ進む (行と番号の対応がずれない)
   ・manual   : 手で入れた線番は上書きしない。連番で入れた線 (chain 印) は
                先頭を入れ直せば付け替わる
   ・hex      : 三菱ユニットでは Y08 → Y09 → Y0A と 16進で進む
   ・uiPath   : プロパティの線番欄から入れても連番が働く */
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
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-chain OK");
