/* 表題欄から投影法をなくす。回路図は正投影図ではないので「第三角法」の欄も
   JIS Z 8316 の図示記号も要らない。

   ・label  : 3 段目の 2 列目は「用紙」だけ (値は A3 横 など。"/ 第三角法" は付かない)
   ・symbol : 表題欄に投影法の記号 (円すい台 + 同心円) が無い。右下の欄は空にせず、
             ページ欄が右端まで広がる (最後の縦線は 2 段目まで)
   ・dxf    : DXF の表題欄にも「投影法」の文字・記号の円が無く、最後の縦線は 2 段目まで
   ・stale  : 旧図面の meta.proj = "第三角法" が残っていても何も描かない
   ・dialog : 図枠・表題欄の設定に「投影法」の欄が無く、適用すると旧値 meta.proj が消える */
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
  App.project = newProject("表題欄"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage); App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  projectMeta().proj = "第三角法";       // 旧図面に残っている値
  App.labelRev++;
  const svg = exportSheetSVG(pg); applySheet(pg);
  // 表題欄の部分 (data-titleblock から、ページ番号の文字の少し先まで)
  const i0 = svg.indexOf('data-titleblock="1"'), i1 = svg.indexOf("</text>", svg.indexOf("ページ</text>", i0) + 10);
  const tbs = svg.slice(i0, i1 + 300);
  out.label = { paper: tbs.includes(">用紙</text>"), noProj: !/投影法|第三角法|第一角法/.test(svg) };
  const tbr = titleBlockRect();
  out.symbol = { circles: (tbs.match(/<circle/g) || []).length,
    // 最後の縦線 (x = 4 列目の左端) は 2 段目の下端 (r3) まで
    lastV: (() => { const S = v => v * contentScale(); const cx3 = tbr.x + S(TITLE_BLOCK.cols[0] + TITLE_BLOCK.cols[1] + TITLE_BLOCK.cols[2]);
      const r3 = tbr.y + S(TITLE_BLOCK.rowH * 2), r4 = tbr.y + tbr.h;
      const m = new RegExp(`M${+cx3.toFixed(6)}[^M]*?V([\\d.]+)`).exec(tbs) || new RegExp(`M${cx3}[^M]*?V([\\d.]+)`).exec(tbs);
      return m ? { v: +m[1], r3, r4 } : null; })() };
  // dxf
  const dxf = pageToDXF(pg);
  const S = v => v * contentScale();
  const cx3 = tbr.x + S(TITLE_BLOCK.cols[0] + TITLE_BLOCK.cols[1] + TITLE_BLOCK.cols[2]);
  const ents = dxf.split("\n0\n");
  const lines = ents.filter(e => e.startsWith("LINE\n8\nFRAME_THIN"));
  const vAt = lines.filter(e => { const x1 = +(/\n10\n(-?[\d.]+)/.exec(e) || [])[1], x2 = +(/\n11\n(-?[\d.]+)/.exec(e) || [])[1]; return Math.abs(x1 - cx3) < 0.01 && Math.abs(x2 - cx3) < 0.01; })
    .map(e => { const y1 = +(/\n20\n(-?[\d.]+)/.exec(e) || [])[1], y2 = +(/\n21\n(-?[\d.]+)/.exec(e) || [])[1]; return Math.abs(y1 - y2); });
  const circlesInTb = ents.filter(e => e.startsWith("CIRCLE\n8\nFRAME_THIN")).filter(e => { const x = +(/\n10\n(-?[\d.]+)/.exec(e) || [])[1]; return x > tbr.x && x < tbr.x + tbr.w; }).length;
  out.dxf = { noProj: !/投影法|第三角法/.test(dxf), paper: /\n1\n用紙\n/.test(dxf), vLen: vAt, want2: TITLE_BLOCK.rowH * 2 * contentScale(), circlesInTb };
  // dialog
  UI.sheetSetup();
  out.dialog = { noSel: !document.querySelector("#tbProjMethod"), ok: !!document.querySelector("#tbOk") };
  document.querySelector("#tbOk").click();
  out.dialog.cleared = !("proj" in projectMeta());
  out.dialog.closed = !document.querySelector("#tbOk");
  return out;
});

const near = (a, c) => Math.abs(a - c) < 0.01;
const checks = {
  noPageErrors: errs.length === 0,
  label: R.label.paper && R.label.noProj,
  symbol: R.symbol.circles === 0 && !!R.symbol.lastV && near(R.symbol.lastV.v, R.symbol.lastV.r3),
  dxf: R.dxf.noProj && R.dxf.paper && R.dxf.vLen.length === 1 && near(R.dxf.vLen[0], R.dxf.want2) && R.dxf.circlesInTb === 0,
  dialog: R.dialog.noSel && R.dialog.ok && R.dialog.cleared && R.dialog.closed,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("titleblock-noproj OK");
