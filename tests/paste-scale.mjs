/* 尺度の違うページへのコピペ — 貼り付け先の縮尺に合う (大きさがちぐはぐにならない)。

   ・sameSize : 1:5 のページから 1:2 のページへ貼っても、記号の倍率 (scale) は
                付かず、貼り付け先に元から置いた記号と同じ大きさで描かれる
   ・wireKeep : 配線も太さの倍率が付かない (座標はそのまま写る)
   ・textKeep : 注記の文字高も変わらない
   ・pinStay  : 記号と配線の位置関係 (端子に乗った端点) が崩れない */
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
  App.project = newProject("尺度コピペ"); UI.renumberPages();
  const pages = App.project.pages.filter(isDrawingPage);
  const pg1 = pages[0], pg2 = pages[1] || (() => { const np = newPage("回路2", 99); App.project.pages.push(np); UI.renumberPages(); return np; })();
  pg1.scale = "1:5"; pg2.scale = "1:2";
  App.pageIdx = App.project.pages.indexOf(pg1); applySheet(pg1);
  pg1.devices.length = 0; pg1.wires.length = 0; pg1.texts.length = 0;

  const d0 = addDevice(pg1, "terminal", 100, 100, { tag: "X1" });
  const pin = devPins(d0)[0];
  const w0 = addWire(pg1, [[pin.x, pin.y], [pin.x + 40, pin.y]]);
  pg1.texts.push({ id: "t0", x: 120, y: 80, text: "注記A", size: 5 });
  App.selection.clear();
  App.selection.add(d0.id); App.selection.add(w0.id); App.selection.add("t0");
  copySelection();

  // 1:2 のページへ貼る
  App.pageIdx = App.project.pages.indexOf(pg2); applySheet(pg2);
  pg2.devices.length = 0; pg2.wires.length = 0; pg2.texts.length = 0;
  Editor.lastWorld = { x: 100, y: 100 };
  pasteClipboard();
  const d1 = pg2.devices[0], w1 = pg2.wires[0], t1 = pg2.texts[0];
  out.sameSize = { devScale: devScale(d1), hasScale: "scale" in d1 };
  out.wireKeep = { wScale: objScale(w1), hasScale: "scale" in w1 };
  out.textKeep = { size: t1.size };
  // 端子に乗っていた配線端点が、貼り付け後も端子の上にある
  const pin1 = devPins(d1)[0];
  out.pinStay = {
    on: Math.abs(w1.pts[0][0] - pin1.x) < 0.01 && Math.abs(w1.pts[0][1] - pin1.y) < 0.01,
    len: Math.abs(w1.pts[1][0] - w1.pts[0][0]),
  };
  App.selection.clear();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  sameSize: R.sameSize.devScale === 1 && R.sameSize.hasScale === false,
  wireKeep: R.wireKeep.wScale === 1 && R.wireKeep.hasScale === false,
  textKeep: R.textKeep.size === 5,
  pinStay: R.pinStay.on === true && R.pinStay.len === 40,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("paste-scale OK");
