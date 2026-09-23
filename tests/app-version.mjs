/* Web アプリ自体の版数表示。

   ・badge : ヘッダーのアプリ名 (ElectraCAD Studio) の横に V1・V2 … の
            バッジが出る。値は APP_VERSION 定数から
   ・noDec : 表示に小数点は出ない (V は整数だけ)
   ・cover : 図面 (表紙) には出さない — アプリの版数は画面のヘッダーだけ */
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
  const el = document.getElementById("brandVer");
  out.text = el ? el.textContent : null;
  out.expected = "V" + Math.trunc(APP_VERSION);
  out.visible = !!el && el.offsetParent !== null;
  // 表紙には出ない (アプリの版数は図面に載せない)
  App.project = newProject("版数はヘッダーだけ"); UI.renumberPages();
  const cover = App.project.pages[0];
  cover.cover = { customer: "○○株式会社", title: "○○装置 電気図面" };
  applySheet(cover);
  out.coverHasV = / V\d|>V\d/.test(kindSVG(cover));
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  badge: R.text === R.expected && R.visible === true,
  noDec: /^V\d+$/.test(R.text || ""),
  cover: R.coverHasV === false,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("app-version OK");
