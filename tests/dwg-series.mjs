/* 図番の A/B 2 系列 (基準図番が空欄のときの自動採番)。

   図番を手入力で固定したページは、ページの種類ではなく「入力した図番の
   系列」で数える。以前は回路図面のページに A-010 と固定しても B 系列の
   1 枚に数えたため、後ろの回路が B-001 → B-002 にずれた。

   ・manualA : 回路図面のページを A-010 に固定しても、回路は B-001 から
              変わらない (目次の表示も B-001)
   ・countA  : A に固定したページは A 系列の 1 枚に数える — 後ろに足した
              書類ページ (機器リスト) が同じ A 番号にならない
   ・manualB : B-001 に固定したページは B 系列に数え、次の回路は B-002
   ・other   : A/B で始まらない図番 (X-1 など) はどちらの系列も消費しない
   ・plain   : 固定ページが無ければ従来どおり A-001〜 / B-001〜 */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  const dwgOf = name => pageDwgNo(App.project.pages.find(pg => pg.name === name));
  const fresh = () => {
    App.project = newProject("図番の系列"); UI.renumberPages();
    const pages = App.project.pages;
    const main = pages.find(isDrawingPage);
    const c2 = newPage("回路 2", 0);
    pages.splice(pages.indexOf(main) + 1, 0, c2);
    UI.renumberPages();
    return pages;
  };
  const fixed = (name, no) => {
    const pg = newPage(name, 0); pg.dwgNo = no; pg.dwgNoManual = true; return pg;
  };

  // ── plain ──
  let pages = fresh();
  out.plain = { main: dwgOf("メイン回路"), c2: dwgOf("回路 2"), spec2: dwgOf("仕様 (2)") };

  // ── manualA: 回路の前に A-005 固定の図面ページ ──
  pages = fresh();
  const first = pages.findIndex(isDrawingPage);
  pages.splice(first, 0, fixed("制御盤 (架台含め)", "A-005"));
  UI.renumberPages();
  const toc = pages.find(pg => pg.kind === "toc");
  applySheet(toc);
  const tocSvg = kindSVG(toc);
  out.manualA = { fix: dwgOf("制御盤 (架台含め)"), main: dwgOf("メイン回路"), c2: dwgOf("回路 2"),
    toc: tocSvg.includes("B-001") && !tocSvg.includes("B-003") };

  // ── countA: 固定 A-005 の後ろに機器リストを足すと A-006 ──
  const parts = newPage("機器リスト確認", 0, "parts");
  pages.splice(pages.findIndex(pg => pg.name === "制御盤 (架台含め)") + 1, 0, parts);
  UI.renumberPages();
  const all = pages.map(pg => pageDwgNo(pg));
  out.countA = { parts: dwgOf("機器リスト確認"), uniq: new Set(all).size === all.length };

  // ── manualB: 回路の先頭に B-001 固定 ──
  pages = fresh();
  pages.splice(pages.findIndex(isDrawingPage), 0, fixed("固定の回路", "B-001"));
  UI.renumberPages();
  out.manualB = { fix: dwgOf("固定の回路"), main: dwgOf("メイン回路"), c2: dwgOf("回路 2") };

  // ── other: X-1 固定はどちらも消費しない ──
  pages = fresh();
  pages.splice(pages.findIndex(isDrawingPage), 0, fixed("別番号の図", "X-1"));
  pages.splice(pages.findIndex(pg => pg.kind === "spec"), 0, fixed("別番号の書類", "Z-9"));
  UI.renumberPages();
  out.other = { main: dwgOf("メイン回路"), c2: dwgOf("回路 2"), spec2: dwgOf("仕様 (2)") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  plain: R.plain.main === "B-001" && R.plain.c2 === "B-002" && R.plain.spec2 === "A-004",
  manualA: R.manualA.fix === "A-005" && R.manualA.main === "B-001" && R.manualA.c2 === "B-002" &&
    R.manualA.toc === true,
  countA: R.countA.parts === "A-006" && R.countA.uniq === true,
  manualB: R.manualB.fix === "B-001" && R.manualB.main === "B-002" && R.manualB.c2 === "B-003",
  other: R.other.main === "B-001" && R.other.c2 === "B-002" && R.other.spec2 === "A-004",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("dwg-series OK");
