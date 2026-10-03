/* 図枠の尺度の選択肢 (1:1.75 / 1:6 / 1:7 / 1:8 / 1:9 の追加)。

   ・list  : 尺度の一覧に新しい刻みが入り、昇順の正しい位置に並ぶ
   ・ui    : 図枠・表題欄の設定の尺度プルダウンにも出る
   ・apply : 選ぶと作図領域が 用紙 × 尺度 に張り替わる (1:7 = A3 の 7 倍) */
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
  App.project = newProject("尺度の刻み"); UI.renumberPages();
  out.list = SCALES.join(",");
  out.factor = { v175: scaleFactor("1:1.75"), v7: scaleFactor("1:7") };
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg);
  pg.scale = "1:7"; applySheet(pg);
  out.apply = { w: SHEET.w, h: SHEET.h };
  pg.scale = null; applySheet(pg);
  UI.sheetSetup();
  await new Promise(r => setTimeout(r, 200));
  const sel = document.getElementById("tbScale");
  out.ui = sel ? [...sel.options].map(o => o.value).join(",") : null;
  const cancels = document.querySelectorAll("#tbCancel");
  if (cancels.length) cancels[cancels.length - 1].click();
  return out;
});

const NEW = ["1:1.75", "1:6", "1:7", "1:8", "1:9"];
const order = "1:1.5,1:1.75,1:2,1:5,1:6,1:7,1:8,1:9,1:10";
const checks = {
  noPageErrors: errs.length === 0,
  list: NEW.every(s => R.list.includes(s)) && R.list.includes(order),
  ui: R.ui !== null && NEW.every(s => R.ui.includes(s)) && R.ui.includes(order),
  apply: R.factor.v175 === 1.75 && R.factor.v7 === 7 &&
    R.apply.w === 420 * 7 && R.apply.h === 297 * 7,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("scale-options OK");
