/* 配線の性質の取りこぼしを防ぐ。

   ・spliceKeep: 端子を配線へ割り込ませて分割しても、線の太さの倍率 (scale)・
                 電線仕様・線番非表示の印がそのまま残る (細くならない)
   ・strokeSame: 分割後の描画の線幅が分割前と同じ
   ・numRevive : 線番の表示を担っていた区間を作図線に変えると、表示が
                 残りの導体区間へ立て直される (番号が消えっぱなしにならない) */
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
  App.project = newProject("性質保持"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;

  // ── 太さ倍率つきの配線へ端子を割り込ませる ──
  const w0 = addWire(pg, [[60, 100], [160, 100]]);
  w0.scale = 2.5; w0.spec = "KIV-1.25sq"; w0.numOff = true; w0.num = "901"; w0.fixed = true;
  const swOf = id => {
    const m = new RegExp(`data-id="${id}" class="wire"`).exec(wiresSVG(pg, {}));
    const seg = wiresSVG(pg, {}).split(`data-id="${id}"`)[0];
    const m2 = /stroke-width="([\d.]+)" fill="none"[^>]*$/.exec(seg);
    return m2 ? +m2[1] : -1;
  };
  const swBefore = swOf(w0.id);
  const term = addDevice(pg, "term_dot", 100, 100);
  spliceDeviceIntoWires(pg, term);
  const halves = pg.wires;
  out.spliceKeep = {
    n: halves.length,
    scales: halves.map(w => w.scale), specs: halves.map(w => w.spec),
    numOffs: halves.map(w => !!w.numOff), nums: halves.map(w => w.num),
  };
  out.strokeSame = { before: swBefore, after: halves.map(w => swOf(w.id)) };

  // ── 線番の表示を担う区間を作図線に変える → 残りへ立て直し ──
  pg.devices.length = 0; pg.wires.length = 0;
  const co = addDevice(pg, "coil", 60, 100, { tag: "-RY1" });
  const la = addDevice(pg, "lamp", 200, 100, { tag: "-PL1" });
  const pa = devPins(co)[1], pb = devPins(la)[0];
  const wA = addWire(pg, [[pa.x, pa.y], [pa.x, 160], [180, 160]]);   // 長い区間 (表示を担う)
  const wB = addWire(pg, [[180, 160], [pb.x, pb.y]]);
  autoNumberWires();
  const shown0 = pg.wires.find(w => w.num && w.numShow !== false);
  out.numRevive = { numbered: !!wA.num && wA.num === wB.num, shownFirst: shown0 && shown0.id };

  // 実際のプロパティ経路で線種を変える (確認ダイアログは許可)
  window.confirm = () => true;
  App.selection.clear(); App.selection.add(shown0.id); UI.showProps();
  const sel = document.getElementById("pStyle");
  sel.value = "dashed";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  const other = pg.wires.find(w => w.id !== shown0.id);
  out.numRevive.after = {
    changedCond: isWireConductive(shown0), otherNum: other.num,
    otherShown: other.numShow !== false && !!other.num,
  };
  App.selection.clear();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  spliceKeep: R.spliceKeep.n === 2
    && R.spliceKeep.scales.every(v => v === 2.5)
    && R.spliceKeep.specs.every(v => v === "KIV-1.25sq")
    && R.spliceKeep.numOffs.every(v => v === true)
    && R.spliceKeep.nums.every(v => v === "901"),
  strokeSame: R.strokeSame.before > 0 && R.strokeSame.after.every(v => v === R.strokeSame.before),
  numRevive: R.numRevive.numbered === true && !!R.numRevive.shownFirst
    && R.numRevive.after.changedCond === false
    && !!R.numRevive.after.otherNum && R.numRevive.after.otherShown === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-keep OK");
