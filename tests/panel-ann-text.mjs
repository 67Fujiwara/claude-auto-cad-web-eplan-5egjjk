/* パネル図 (Panel Studio 取り込み) の文字の出し分け。

   以前は文字 (text entity) を既定で全部隠していたため、風船番号と
   部品リストの中身が「丸と罫線だけ」になって消えていた。

   ・annShow : 風船番号・リスト・図面注記の文字は既定で描く
   ・typeHide: 機器の型式 (レイヤ名に「型式」) の文字だけ既定で隠す
   ・optType : 「機器の型式も描く」(panelText) を入れると型式も出る
              (トグルで描画キャッシュも切り替わる)
   ・note    : 書き足した注記 (note) は常に出る
   ・dxf     : DXF 出力も同じ出し分け (既定 = 風船・リストあり / 型式なし、
              panelText で型式も) */
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
  App.project = newProject("風船とリスト"); UI.renumberPages();
  const data = {
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-ANN" }, panel: { model: "ANN-BOX", outer: { w: 600, h: 400, d: 250 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 600, h: 400 },
        layers: { "機器": { color: "#295cb3" }, "機器-型式": { color: "#295cb3" },
          "風船番号": { color: "#1a8a3c" }, "部品リスト": { color: "#000000" },
          "図面-注記": { color: "#000000" } },
        entities: [
          { t: "line", x1: 0, y1: 0, x2: 600, y2: 0 }, { t: "line", x1: 0, y1: 0, x2: 0, y2: 400 },
          { t: "circle", cx: 100, cy: 300, r: 8, layer: "風船番号" },
          { t: "text", x: 97, y: 297, h: 6, s: "47", layer: "風船番号" },
          { t: "text", x: 400, y: 380, h: 5, s: "NFB NV32-SVF", layer: "部品リスト" },
          { t: "text", x: 100, y: 280, h: 8, s: "MODEL-XYZ", layer: "機器-型式" },
          { t: "text", x: 300, y: 50, h: 10, s: "上面 800x300", layer: "図面-注記" },
          // 同じ行の右隣にかぶる長い品名 → 右隣の手前 (58.5mm) まで詰める
          { t: "text", x: 100, y: 100, h: 5, s: "ホース用コネクタ(ホース内径25 取り付けネジ G1)", layer: "部品リスト" },
          { t: "text", x: 160, y: 100, h: 5, s: "三桂製作所", layer: "部品リスト" },
          // 収まる文字は詰めない
          { t: "text", x: 300, y: 100, h: 5, s: "OK", layer: "部品リスト" },
          { t: "text", x: 340, y: 100, h: 5, s: "1", layer: "部品リスト" },
          // 右隣が「隠れている型式」だけなら詰めの理由にしない
          { t: "text", x: 100, y: 60, h: 5, s: "長い長い長い長い長い長い長い長い", layer: "部品リスト" },
          { t: "text", x: 130, y: 60, h: 5, s: "HIDDEN-TYPE", layer: "機器-型式" },
        ] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 600, h: 400 },
        entities: [{ t: "circle", cx: 50, cy: 50, r: 2 }] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 500, h: 300 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 500, h: 300 }, entities: [] },
    ],
  };
  panelInsertPages(data);
  UI.renumberPages();
  const pg = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "cabinet_full");
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);

  const s0 = panelSVG(pg);
  out.annShow = { balloon: s0.includes(">47<"), list: s0.includes("NFB NV32-SVF"),
    note: s0.includes("上面 800x300") };
  out.typeHide = !s0.includes("MODEL-XYZ");

  pg.panelText = true;
  const s1 = panelSVG(pg);
  out.optType = s1.includes("MODEL-XYZ") && s1.includes(">47<");
  delete pg.panelText;
  out.optOff = !panelSVG(pg).includes("MODEL-XYZ");   // 戻すと消える (キャッシュ切替)

  // ── 重なり防止: はみ出す文字は右隣の手前まで詰める ──
  const s2 = panelSVG(pg);
  const attrOf = (svg, s) => {
    const m = svg.match(new RegExp(`<text([^>]*)>${s.replace(/[()]/g, "\\$&")}<`));
    return m ? m[1] : null;
  };
  out.fit = {
    long: /textLength="58\.50"/.test(attrOf(s2, "ホース用コネクタ(ホース内径25 取り付けネジ G1)") || ""),
    short: !/textLength/.test(attrOf(s2, "OK") || "x"),
    noNeighbor: !/textLength/.test(attrOf(s2, "三桂製作所") || "x"),
    hiddenFree: !/textLength/.test(attrOf(s2, "長い長い長い長い長い長い長い長い") || "x"),
  };
  pg.panelText = true;   // 型式も描くと、型式が右隣になった文字は詰まる
  out.fit.hiddenOn = /textLength="28\.50"/.test(attrOf(panelSVG(pg), "長い長い長い長い長い長い長い長い") || "");
  delete pg.panelText;
  // DXF は幅係数 (41 < 1) で同じ詰め方 — 既定では 1 本、型式も描くと 2 本
  out.fitDxf = {
    off: (pageToDXF(pg).match(/\n41\n0\.\d+/g) || []).length,
  };
  pg.panelText = true;
  out.fitDxf.on = (pageToDXF(pg).match(/\n41\n0\.\d+/g) || []).length;
  delete pg.panelText;

  // 書き足した注記は常に出る
  panelAddEnts(pg, [{ t: "text", x: 500, y: 100, h: 5, s: "現合で穴あけ", note: true, add: true }]);
  out.note = panelSVG(pg).includes("現合で穴あけ");

  // DXF も同じ出し分け
  const d0 = pageToDXF(pg);
  out.dxf = { balloon: /(^|\n)47\r?\n/.test(d0), list: d0.includes("NFB NV32-SVF"),
    type: !d0.includes("MODEL-XYZ"), note: d0.includes("現合で穴あけ") };
  pg.panelText = true;
  out.dxfType = pageToDXF(pg).includes("MODEL-XYZ");
  delete pg.panelText;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  annShow: R.annShow.balloon === true && R.annShow.list === true && R.annShow.note === true,
  typeHide: R.typeHide === true,
  optType: R.optType === true && R.optOff === true,
  note: R.note === true,
  dxf: R.dxf.balloon === true && R.dxf.list === true && R.dxf.type === true &&
    R.dxf.note === true && R.dxfType === true,
  fit: R.fit.long === true && R.fit.short === true && R.fit.noNeighbor === true &&
    R.fit.hiddenFree === true && R.fit.hiddenOn === true,
  fitDxf: R.fitDxf.off === 1 && R.fitDxf.on === 2,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-ann-text OK");
