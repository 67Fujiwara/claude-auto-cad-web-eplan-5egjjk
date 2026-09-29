/* 複数キャビネットの共存 (Panel Studio 取り込みを ID で分ける)。

   1 つの図面に複数の盤 (制御盤・操作盤など) を並べたい。以前は取り込みが
   同じ案件番号の panel ページを全部置き換えていたため、2 台目を読み込むと
   1 台目が消えていた。

   ・two     : 別 ID (型式) の JSON を続けて取り込むと 4+4=8 ページ共存
              (2 回目の置き換えは 0)。2 台目は 1 台目の後ろに並ぶ
   ・names   : 別の盤が居るときはページ名に [ID] が付いてタブで見分けられる
   ・replace : 同じ ID を取り込み直すと、その盤の 4 ページだけ置き換わり、
              別の盤のページ・データは残る
   ・data    : panelData も盤ごとに持たれ、置き換えで相手のデータを消さない
   ・legacy  : ID を持たない旧ページ (cabId 無し) は 型式 で読み替えて
              同じ盤と判定される (取り込み直しで置き換え)
   ・dwg     : 図番 (A 系列) は 8 ページ通しで重複しない */
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
  App.project = newProject("2台の盤"); UI.renumberPages();
  const mk = (model, tag) => ({
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-800" }, panel: { model, outer: { w: 600, h: 400, d: 250 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 600, h: 400 },
        entities: [{ t: "line", x1: 0, y1: 0, x2: 600, y2: 0 },
          { t: "text", x: 10, y: 10, h: 5, s: tag, layer: "図面-注記" }] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 600, h: 400 },
        entities: [{ t: "circle", cx: 50, cy: 50, r: 2 }] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 500, h: 300 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 500, h: 300 }, entities: [] },
    ],
  });
  const panels = () => App.project.pages.filter(p2 => p2.kind === "panel");

  const r1 = panelInsertPages(mk("BOX-A", "NOTE-A1"));
  const r2 = panelInsertPages(mk("BOX-B", "NOTE-B1"));
  UI.renumberPages();
  out.two = { n: panels().length, rep1: r1.replaced, rep2: r2.replaced, others2: r2.others,
    order: panels().map(p2 => panelCabIdOf(p2.panel)).join(","),
    dataN: Object.keys(App.project.panelData || {}).length };
  out.names = { b: panels().filter(p2 => p2.panel.cabId === "BOX-B").map(p2 => p2.name).join("|"),
    a: panels().filter(p2 => p2.panel.cabId === "BOX-A").map(p2 => p2.name).join("|") };

  // ── 同じ ID (BOX-A) を修正版で取り込み直す ──
  const r3 = panelInsertPages(mk("BOX-A", "NOTE-A2"));
  UI.renumberPages();
  const aFull = panels().find(p2 => p2.panel.cabId === "BOX-A" && p2.panel.sheetId === "cabinet_full");
  const bFull = panels().find(p2 => p2.panel.cabId === "BOX-B" && p2.panel.sheetId === "cabinet_full");
  out.replace = { n: panels().length, rep3: r3.replaced, others3: r3.others,
    aNew: JSON.stringify(panelDataOf(aFull).entities).includes("NOTE-A2"),
    bKept: JSON.stringify(panelDataOf(bFull).entities).includes("NOTE-B1"),
    aNamed: /\[BOX-A\]$/.test(aFull.name) };

  // ── 旧データ (cabId 無し) は型式で読み替え ──
  panels().forEach(p2 => { if (p2.panel.cabId === "BOX-B") delete p2.panel.cabId; });
  const r4 = panelInsertPages(mk("BOX-B", "NOTE-B2"));
  UI.renumberPages();
  out.legacy = { rep4: r4.replaced, n: panels().length };

  // ── 図番の重複なし ──
  const dwg = panels().map(p2 => pageDwgNo(p2));
  out.dwg = { n: dwg.length, uniq: new Set(dwg).size };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  two: R.two.n === 8 && R.two.rep1 === 0 && R.two.rep2 === 0 && R.two.others2 === 1 &&
    R.two.order === "BOX-A,BOX-A,BOX-A,BOX-A,BOX-B,BOX-B,BOX-B,BOX-B" &&
    R.two.dataN === 8,
  names: R.names.b.split("|").every(n => / \[BOX-B\]$/.test(n)) &&
    R.names.a.split("|").every(n => !/\[/.test(n)),   // 先の盤の名前は触らない
  replace: R.replace.n === 8 && R.replace.rep3 === 4 && R.replace.others3 === 1 &&
    R.replace.aNew === true && R.replace.bKept === true && R.replace.aNamed === true,
  legacy: R.legacy.rep4 === 4 && R.legacy.n === 8,
  dwg: R.dwg.n === 8 && R.dwg.uniq === 8,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-multi OK");
