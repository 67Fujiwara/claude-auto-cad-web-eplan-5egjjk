/* 図枠の向き (縦置き / 横置き) が、設定 → 図枠・表題欄・格子参照・保存・DXF・
   印刷まで一貫して効くことを確かめる。

   ・作図領域が用紙の長短を入れ替えた寸法になること (A3 横 420×297 / 縦 297×420)
   ・格子参照の区分数も入れ替わること (JIS Z 8311 表2 の値を縦横で読み替える)
   ・表題欄が右下の輪郭線に接すること (JIS Z 8311)
   ・表題欄の用紙欄が「A3 縦」と読めること (画面と DXF で同じ表記)
   ・DXF の図枠が同じ寸法で出ること
   ・ページごとの設定と全ページ既定の両方が効くこと
   ・保存 → 読込で向きが残ること */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
const R = await p.evaluate(() => {
  const out = { size: {}, div: {}, title: {}, label: {}, dxf: {}, page: "", save: "", frame: {} };
  const pg = App.project.pages[0]; App.pageIdx = 0;
  ["landscape", "portrait"].forEach(o => {
    ["A4", "A3", "A2"].forEach(paper => {
      pg.paper = paper; pg.orient = o; applySheet(pg);
      const k = `${paper}/${o}`;
      out.size[k] = `${SHEET.w}x${SHEET.h}`;
      out.div[k] = `${SHEET.cols}x${SHEET.rows}`;
      const tb = titleBlockRect(), fr = frameRect();
      // 表題欄は右下の輪郭線に接する
      out.title[k] = `${(tb.x + tb.w - (fr.x + fr.w)).toFixed(2)},${(tb.y + tb.h - (fr.y + fr.h)).toFixed(2)}`;
      out.frame[k] = `${fr.w}x${fr.h}`;
      out.label[k] = paperLabel(pageSheetMeta(pg));
    });
  });
  // DXF が同じ寸法で出るか (縦置き A3)
  pg.paper = "A3"; pg.orient = "portrait"; applySheet(pg);
  const t = pageToDXF(pg);
  out.dxf.ext = (/\$EXTMAX\n10\n([\d.]+)\n20\n([\d.]+)/.exec(t) || []).slice(1).join("x");
  out.dxf.label = /A3 \\U\+7E26|A3 縦/.test(t) ? "あり" : "なし";
  // ページごとの設定 / 全ページ既定
  delete pg.paper; delete pg.orient;
  projectMeta().orient = "portrait"; applySheet(pg);
  out.page = `既定=縦 → ${SHEET.w}x${SHEET.h}`;
  pg.orient = "landscape"; applySheet(pg);
  out.page += ` / このページだけ横 → ${SHEET.w}x${SHEET.h}`;
  // 保存 → 読込
  const json = JSON.stringify(App.project);
  const back = JSON.parse(json);
  out.save = `meta=${(back.meta || {}).orient} page=${back.pages[0].orient}`;
  delete pg.orient; delete projectMeta().orient; applySheet(pg);
  return out;
});
/* 実際の操作経路 (図枠・表題欄の設定ダイアログ) でも切り替わるか。
   モデルだけ通っても、設定から変えられなければ要求を満たさない */
await p.evaluate(() => { App.pageIdx = 0; applySheet(curPage()); });
await p.evaluate(() => UI.sheetSetup());
await p.waitForSelector("#tbOrient");
const before = await p.evaluate(() => `${SHEET.w}x${SHEET.h}`);
await p.selectOption("#tbOrient", "portrait");
await p.selectOption("#tbScope", "all");
await p.waitForTimeout(200);
const info = await p.$eval("#tbInfo", el => el.textContent);
await p.click("#tbOk");
await p.waitForTimeout(500);
const dlg = await p.evaluate(() => ({
  size: `${SHEET.w}x${SHEET.h}`,
  meta: projectMeta().orient,
  title: (exportSheetSVG().match(/A3 縦/) || [])[0] || "なし",
  open: !!document.querySelector("#tbOrient"),
}));
console.log("ダイアログ操作:", before, "→", JSON.stringify(dlg), "/ 試算:", info.slice(0, 40));
R.dialog = dlg; R.dialogBefore = before;
R.dialogInfo = /297 × 420 mm/.test(info);
console.log(JSON.stringify(R, null, 1));
const eq = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);
const checks = {
  size: eq(R.size, { "A4/landscape": "297x210", "A3/landscape": "420x297", "A2/landscape": "594x420",
                     "A4/portrait": "210x297", "A3/portrait": "297x420", "A2/portrait": "420x594" }),
  div: eq(R.div, { "A4/landscape": "6x4", "A3/landscape": "8x6", "A2/landscape": "12x8",
                   "A4/portrait": "4x6", "A3/portrait": "6x8", "A2/portrait": "8x12" }),
  // 表題欄は右下の輪郭線にぴったり接する (ずれ 0)
  titleAtCorner: Object.values(R.title).every(v => v === "0.00,0.00"),
  label: R.label["A3/portrait"] === "A3 縦" && R.label["A3/landscape"] === "A3",
  dxfSize: R.dxf.ext === "297.000x420.000",
  dxfLabel: R.dxf.label === "あり",
  perPage: R.page === "既定=縦 → 297x420 / このページだけ横 → 420x297",
  saved: R.save === "meta=portrait page=landscape",
  // 設定ダイアログから切り替えられること (要求そのもの)
  dialogApplied: R.dialogBefore === "420x297" && R.dialog.size === "297x420" && R.dialog.meta === "portrait",
  dialogTitle: R.dialog.title === "A3 縦",       // 表題欄にも出る
  dialogInfo: R.dialogInfo === true,             // 試算の表示も向きに追従する
  dialogClosed: R.dialog.open === false,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
