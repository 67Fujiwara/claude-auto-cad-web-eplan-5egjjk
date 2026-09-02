/* 配線を引くだけで線番と電線仕様が付く (A1 + B1)。

   ・pinName  : PLC の入出力点につないだ線の線番は端子名 (500 / X00) になる
   ・termName : 端子 (端子台) につないだ線の線番は端子の器具番号になる
   ・fallback : 端子名の付かないネットは従来どおり図番×100+連番
   ・manualWin: 手で入れた線番は端子名より優先
   ・numOffSw : 設定 (meta.numFromPins=false) で端子名採用を切れる
   ・specRule : 電線仕様が回路の種類で自動で付く — 接地 / 主回路 /
                DC24V (PLC・電源) / その他の制御
   ・specKeep : 手で入れた仕様は上書きされない。空にすると自動に戻る
   ・specOff  : ルールを切る・欄を空にした種類には付けない
   ・dialog   : プロジェクトメニューの設定画面から保存でき、meta に残る
                (マスターファイルごとコピーされる) */
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
  const fresh = () => {
    App.project = newProject("自動ルール"); UI.renumberPages();
    const pg = App.project.pages.find(isDrawingPage);
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    pg.devices.length = 0; pg.wires.length = 0;
    return pg;
  };

  // ── PLC の端子名が線番になる ──
  {
    const pg = fresh();
    const d = addDevice(pg, "ry40nt5p_out", 100, 40);
    const sym = symOf("ry40nt5p_out");
    const fnPins = symFnPins(sym);
    const a0 = devPins(d)[sym.pins.indexOf(fnPins[0])];
    const a10 = devPins(d)[sym.pins.indexOf(fnPins[10])];
    const w0 = addWire(pg, [[a0.x, a0.y], [a0.x + 40, a0.y]]);
    const w10 = addWire(pg, [[a10.x, a10.y], [a10.x + 40, a10.y]]);
    autoNumberWires();
    out.pinName = { w0: w0.num, w10: w10.num, spec0: w0.spec, auto0: !!w0.specAuto };
  }

  // ── 端子台の器具番号 + 連番のフォールバック + 手動優先 ──
  {
    const pg = fresh();
    const t1 = addDevice(pg, "terminal", 100, 100, { tag: "R200" });
    const t2 = addDevice(pg, "terminal", 110, 100, { tag: "S200" });
    const a1 = devPins(t1)[0], a2 = devPins(t2)[0];
    const w1 = addWire(pg, [[a1.x, a1.y], [a1.x, a1.y - 30]]);
    const w2 = addWire(pg, [[a2.x, a2.y], [a2.x, a2.y - 30]]);
    const co = addDevice(pg, "coil", 200, 100, { tag: "-RY1" });
    const ac = devPins(co)[0];
    const w3 = addWire(pg, [[ac.x, ac.y], [ac.x, ac.y - 30]]);   // 端子名なし → 連番
    autoNumberWires();
    out.termName = { w1: w1.num, w2: w2.num };
    out.fallback = { w3: w3.num, seq: /^\d{3,}$/.test(String(w3.num)) };
    setWireNumber(pg, w1, "TEDIRECT");
    autoNumberWires();
    out.manualWin = { w1: w1.num };
    // 設定で切ると端子名は使われない
    projectMeta().numFromPins = false;
    w2.num = null; w2.fixed = false;
    autoNumberWires();
    out.numOffSw = { w2: w2.num, notName: w2.num !== "S200" };
    delete projectMeta().numFromPins;
  }

  // ── 電線仕様のルール (接地 / 主回路 / DC24 / 制御) ──
  {
    const pg = fresh();
    // 接地
    const e1 = addDevice(pg, "prot_earth", 60, 120);
    const pe = devPins(e1)[0];
    const wE = addWire(pg, [[pe.x, pe.y], [pe.x, pe.y - 30]]);
    // 主回路
    const nfb = addDevice(pg, "mcb2", 120, 100);
    const an = devPins(nfb)[0];
    const wM = addWire(pg, [[an.x, an.y], [an.x, an.y - 30]]);
    // 制御 (コイル)
    const co = addDevice(pg, "coil", 200, 100, { tag: "-RY1" });
    const ac = devPins(co)[0];
    const wC = addWire(pg, [[ac.x, ac.y], [ac.x, ac.y - 30]]);
    autoNumberWires();
    out.specRule = { earth: wE.spec, main: wM.spec, ctrl: wC.spec };
    // 手で入れた仕様は守られ、空にすると自動へ戻る
    setWireSpec(pg, wC, "CVV 0.5sq");
    autoNumberWires();
    out.specKeep = { manual: wC.spec };
    setWireSpec(pg, wC, "");
    autoNumberWires();
    out.specKeep.back = wC.spec;
    // ルールを切る / 欄を空にする
    wireSpecRules().on = false;
    delete wC.spec; delete wC.specAuto;
    autoNumberWires();
    out.specOff = { off: wC.spec === undefined };
    wireSpecRules().on = true;
    wireSpecRules().ctrl = "";
    autoNumberWires();
    out.specOff.empty = wC.spec === undefined;
    wireSpecRules().ctrl = "KIV 1.25sq 黄";
  }

  // ── 設定画面 ──
  {
    UI.openAutoRules();
    await new Promise(r => setTimeout(r, 120));
    const q = sel => document.querySelector(sel);
    out.dialog = { has: !!q("#arNum") && !!q("#arEarth") };
    q("#arDc").value = "KIV 0.5sq 青";
    q("#arOk").click();
    await new Promise(r => setTimeout(r, 120));
    out.dialog.saved = projectMeta().wireSpecs.dc24;
  }
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  pinName: R.pinName.w0 === "Y00" && R.pinName.w10 === "Y0A"
    && R.pinName.spec0 === "KIV 0.75sq 青" && R.pinName.auto0 === true,
  termName: R.termName.w1 === "R200" && R.termName.w2 === "S200",
  fallback: R.fallback.seq === true,
  manualWin: R.manualWin.w1 === "TEDIRECT",
  numOffSw: R.numOffSw.notName === true && !!R.numOffSw.w2,
  specRule: R.specRule.earth === "IV 2sq 緑/黄" && R.specRule.main === "KIV 2sq 黒"
    && R.specRule.ctrl === "KIV 1.25sq 黄",
  specKeep: R.specKeep.manual === "CVV 0.5sq" && R.specKeep.back === "KIV 1.25sq 黄",
  specOff: R.specOff.off === true && R.specOff.empty === true,
  dialog: R.dialog.has === true && R.dialog.saved === "KIV 0.5sq 青",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("auto-rules OK");
