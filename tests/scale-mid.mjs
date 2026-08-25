/* 尺度のふるまいと中間尺度 (ISO 5455) の追加。

   ・halfExact  : 1:2 は作図領域が 2 倍 (A3 → 840×594) = 印刷でちょうど 1/2。
                  「1/2 がすごく小さい」は正しい挙動であることの担保
   ・midListed  : 1:1.25 / 1:1.5 が尺度の選択肢 (SCALES・表題欄ダイアログ) に並ぶ
   ・midApplies : ページ尺度 1:1.25 で作図領域が 525×371.25 になり、
                  表題欄の尺度欄に 1:1.25 が印字される
   ・drcGuard   : 縮小で JIS Z 8313 の文字下限 2.5mm を割る内容 (線番 2.5mm) が
                  あるページは検図「尺度と用紙上の寸法」が知らせる。
                  3.5mm の文字しか無いページは 1:1.25 (用紙上 2.8mm) で沈黙 */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  out.halfExact = { f: scaleFactor("1:2") };
  out.factors = { f125: scaleFactor("1:1.25"), f15: scaleFactor("1:1.5") };
  out.midListed = SCALES.includes("1:1.25") && SCALES.includes("1:1.5") &&
    SCALES.indexOf("1:1") < SCALES.indexOf("1:1.25") && SCALES.indexOf("1:1.5") < SCALES.indexOf("1:2");

  // ページ尺度 1:1.25 を適用
  const pg = newPage("mid", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  pg.scale = "1:1.25";
  applySheet(pg);
  out.midApplies = { f: SHEET.f, w: SHEET.w, h: SHEET.h };
  UI.refresh();
  await new Promise(r => setTimeout(r, 80));
  const tb = [...Editor.svg.querySelectorAll("text")].map(t => t.textContent);
  out.titleShows = tb.includes("1:1.25");

  // 3.5mm の文字だけのページ → 1:1.25 は下限 2.5mm を保つ (2.8mm) → 検図は沈黙
  addDevice(pg, "earth", 100, 100, { tag: "-E1" });   // タグ 3.5mm のみ (端子番号・小文字なし)
  const drcOf = () => runDRC().filter(i => i.rule === "尺度と用紙上の寸法" && i.page === pg.no).length;
  out.quietAt125 = drcOf();
  // 2.5mm の線番を足す → 用紙上 2mm → 検図が知らせる
  const w2 = addWire(pg, [[100, 60], [100, 80]]);
  w2.num = "101";
  out.warnAt125 = drcOf();
  // 尺度を 1:1 に戻せば沈黙
  pg.scale = "1:1"; applySheet(pg);
  out.quietAt1 = drcOf();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  halfExact: R.halfExact.f === 2,
  midListed: R.midListed && R.factors.f125 === 1.25 && R.factors.f15 === 1.5,
  midApplies: R.midApplies.f === 1.25 && Math.abs(R.midApplies.w - 525) < 0.01 && Math.abs(R.midApplies.h - 371.25) < 0.01,
  titleShows: R.titleShows === true,
  drcGuard: R.quietAt125 === 0 && R.warnAt125 >= 1 && R.quietAt1 === 0,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
