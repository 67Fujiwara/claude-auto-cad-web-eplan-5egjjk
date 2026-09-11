/* シンプル図枠 (他社様式への切替: meta.frameStyle = "plain")。

   ・plainStrip : 下端の帯に 改訂内容/Qty (改訂欄)・企業名・作成日・製図・
                検図・承認・管理番号・頁 が出る。標準表題欄の 尺度・図面番号・
                投影法・ページ名 の欄は出ない
   ・pageNo00  : 頁は 00 始まり (表紙 = 00、5 ページ目 = 04)
   ・noScale   : 尺度を変えても帯に尺度は書かれない
   ・noMirror  : 接点ミラー表を描かない (画面・当たり判定とも)。位置参照は
                ページ番号のみ (区画帯が無いので区画は指せない)
   ・dxfOut    : DXF にも同じ帯 (管理番号・頁・企業名) が出て、尺度は出ない
   ・stdBack   : 標準様式に戻すと 尺度欄・接点ミラーが復活する */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("様式確認"); UI.renumberPages();
  const meta = projectMeta();
  meta.frameStyle = "plain";
  meta.author = "サンプル電機株式会社";
  meta.ctrlNo = "A000000ELE";
  meta.approver = "承認者X";
  const cover = App.project.pages[0];
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = 0; applySheet(cover);
  const svgCover = sheetSVG(cover, { print: true });
  out.plainStrip = {
    has: ["管理番号", "頁", "改訂内容", "Qty", "サンプル電機株式会社", "作成日", "製図", "検図", "承認", "A000000ELE", "承認者X"]
      .every(t => svgCover.includes(t)),
    none: ["尺度", "図面番号", "投影法", "ページ名"].every(t => !svgCover.includes(t)),
  };
  out.pageNo = { cover: plainPageNo(cover), p5: plainPageNo(pg) };
  // 尺度を変えても帯に出ない
  pg.scale = "1:2.5"; applySheet(pg);
  const svgPg = sheetSVG(pg, { print: true });
  out.noScale = !svgPg.includes("1:2.5") && !svgPg.includes("尺度");
  // 接点ミラー
  pg.devices.length = 0; pg.wires.length = 0;
  const k1 = addDevice(pg, "coil", 120, 100, { tag: "-KA1" });
  const c1 = addDevice(pg, "aux_no", 160, 100, { tag: "-KA1" });
  c1.linkTo = k1.id;
  out.noMirror = { svg: mirrorSVG(k1) === "", boxes: mirrorLabelBoxes(k1).length === 0,
    loc: devLocation(c1), dwg: pageDwgNo(pg) };
  const dxf = pageToDXF(cover);
  out.dxfOut = {
    has: ["管理番号", "A000000ELE", "00", "サンプル電機株式会社"].every(t => dxf.includes(t)),
    none: !dxf.includes("尺度"),
  };
  // 標準に戻す
  meta.frameStyle = "std";
  applySheet(pg);
  const svgStd = sheetSVG(pg, { print: true });
  out.stdBack = { scale: svgStd.includes("尺度"), mirror: mirrorSVG(k1) !== "" };
  return out;
});

const checks = {
  plainStrip: R.plainStrip.has === true && R.plainStrip.none === true,
  pageNo00: R.pageNo.cover === "00" && R.pageNo.p5 === "04",
  noScale: R.noScale === true,
  noMirror: R.noMirror.svg === true && R.noMirror.boxes === true &&
    R.noMirror.loc === `5 (${R.noMirror.dwg})`,
  dxfOut: R.dxfOut.has === true && R.dxfOut.none === true,
  stdBack: R.stdBack.scale === true && R.stdBack.mirror === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("frame-plain OK");
