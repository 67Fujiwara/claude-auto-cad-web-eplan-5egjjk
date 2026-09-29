/* 出力時シンプル図枠とパネルページの左下行 / 設計完了の管理番号欄。

   ・jobLine : パネルページ左下の案件行 (案件番号・型式・外形・備考) は、
              標準図枠では枠下端ぎわ、シンプル図枠では下端の帯 (改訂欄
              20mm) の上へ逃がして重ならない。図枠様式を切り替えると
              描画キャッシュも切り替わる
   ・dxfLine : DXF 出力も同じ位置 (標準とシンプルで y が帯の高さぶん違う)
   ・rlCtrl  : 「出力時シンプル図枠」のとき、設計完了ダイアログに管理番号の
              入力欄が出て、入れると meta.ctrlNo に入り帯に表示される。
              標準図枠のときは欄が出ない */
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
  App.project = newProject("シンプル帯とパネル"); UI.renumberPages();
  panelInsertPages({
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-PL", note: "SUB側" }, panel: { model: "SR30-88", outer: { w: 800, h: 600, d: 300 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 800, h: 600 },
        entities: [{ t: "line", x1: 0, y1: 0, x2: 800, y2: 0 }] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 800, h: 600 }, entities: [] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 700, h: 500 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 700, h: 500 }, entities: [] },
    ],
  });
  UI.renumberPages();
  const meta = projectMeta();
  const pg = App.project.pages.find(p2 => p2.kind === "panel");
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  const jobY = svg => {
    const m2 = svg.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>J-PL 制御盤 SR30-88/);
    return m2 ? +m2[1] : null;
  };
  const f = sheetScale();
  const frBottom = frameRect().y + frameRect().h;
  // 標準図枠 (画面)
  const yStd = jobY(panelSVG(pg));
  // シンプル図枠 (出力時)
  meta.outPlain = true;
  const inPlain = await withOutputFrame(() => {
    applySheet(pg);
    return { y: jobY(panelSVG(pg)), bandTop: SHEET.h - SHEET.margin - PLAIN_TB.h * sheetScale(),
      dxf: pageToDXF(pg) };
  });
  applySheet(pg);
  const yStd2 = jobY(panelSVG(pg));   // 戻すと標準位置 (キャッシュも切り替わる)
  out.jobLine = { yStd, yPlain: inPlain.y, bandTop: inPlain.bandTop, frBottom, f,
    back: yStd2 === yStd };
  // DXF: 標準とシンプルで案件行の y (20 グループ) が違う
  const dxfStd = pageToDXF(pg);
  const yOf = d => {
    // TEXT エンティティは 20 (y) が文字列 (1 グループ) より前に出る —
    // 文字列の直前 300 文字から最後の 20 グループを拾う
    const at = d.indexOf("J-PL 制御盤 SR30-88");
    if (at < 0) return null;
    const pre = d.slice(Math.max(0, at - 300), at);
    const ms = [...pre.matchAll(/\n20\n([\d.-]+)\n/g)];
    return ms.length ? +ms[ms.length - 1][1] : null;
  };
  out.dxfLine = { std: yOf(dxfStd), plain: yOf(inPlain.dxf) };

  // ── 設計完了ダイアログの管理番号欄 ──
  window.confirm = () => true;
  UI.finishDesign();
  await new Promise(r => setTimeout(r, 250));
  const fld = document.getElementById("rlCtrl");
  out.rlCtrl = { has: !!fld };
  if (fld) {
    fld.value = "A014272-ELE";
    UI.runRelease = async () => {};        // 実際の出図はここでは走らせない
    document.getElementById("rlOk").click();
    await new Promise(r => setTimeout(r, 200));
    out.rlCtrl.saved = meta.ctrlNo === "A014272-ELE";
    meta.frameStyle = "plain";
    const band = plainTitleLayout(pg);
    delete meta.frameStyle;
    out.rlCtrl.inBand = band.texts.some(t => t.t === "A014272-ELE" && t.bold);
  }
  // 標準図枠では欄が出ない (開き直しても #rlCtrl が増えない)
  const n1 = document.querySelectorAll("#rlCtrl").length;
  meta.outPlain = false;
  UI.finishDesign();
  await new Promise(r => setTimeout(r, 250));
  out.rlCtrl.noneStd = document.querySelectorAll("#rlCtrl").length === n1;
  const cancels = document.querySelectorAll("#rlCancel");
  cancels[cancels.length - 1].click();
  meta.outPlain = true;
  return out;
});

const near = (a, b2, tol = 0.01) => a !== null && Math.abs(a - b2) < tol;
const checks = {
  noPageErrors: errs.length === 0,
  /* 標準 = 枠下端 - 2mm×f / シンプル = 帯 (20mm×f) のさらに上。
     シンプルの行は帯の上端より上に乗る */
  jobLine: near(R.jobLine.yStd, R.jobLine.frBottom - 2 * R.jobLine.f) &&
    near(R.jobLine.yPlain, R.jobLine.frBottom - 22 * R.jobLine.f) &&
    R.jobLine.yPlain < R.jobLine.bandTop && R.jobLine.back === true,
  dxfLine: R.dxfLine.std !== null && R.dxfLine.plain !== null &&
    Math.abs(R.dxfLine.plain - R.dxfLine.std - 20 * R.jobLine.f) < 0.01,
  rlCtrl: R.rlCtrl.has === true && R.rlCtrl.saved === true && R.rlCtrl.inBand === true &&
    R.rlCtrl.noneStd === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("plain-panel-line OK");
