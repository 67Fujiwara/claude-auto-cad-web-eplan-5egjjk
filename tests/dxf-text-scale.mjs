/* DXF 取り込みで「文字列だけが拡大される」不具合の再発防止。

   DXF (枠 100×80mm・文字高 3mm = 幅の 3%) を縮小 (fit20 → k=0.25) して
   取り込んだとき、文字も図形と同じ倍率で縮むこと。旧実装は文字高に
   2.5mm の下限を掛けていたため、図形だけ縮んで文字が相対的に巨大化し
   DXF の見た目と別物になっていた。

   ・entsSVG      : dxfEntsToSVG (登録シンボルのボディ生成・プレビュー) が
                    文字高 3×k をそのまま使う (下限で持ち上げない)
   ・pageImport   : 「このページに作図線として配置」で page.texts の size が
                    3×k・noMin=true になる (UI のダイアログを実際に操作)
   ・renderNoMin  : 取り込んだ和文文字の描画 font-size が和文最小呼び
                    (3.5mm) へ持ち上がらない
   ・boundsNoMin  : textBounds も持ち上げない (文字の重なり DRC・選択枠が
                    実寸で効く)
   ・cjkFloorKept : 通常の注記 (noMin なし) の和文は従来どおり 3.5mm に
                    持ち上がる (JIS 最小呼びの機能を壊していない)
   ・symedit      : シンボル編集の「DXF を読み込む」(dxfEntsToShapes) も
                    文字/図形の比を保つ */
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
  const seg = pairs => pairs.map(([c, v]) => c + "\n" + v).join("\n") + "\n";
  // 100×80 の枠 + 高さ 3mm の和文 TEXT (= 枠幅の 3%)
  const dxf = "0\nSECTION\n2\nENTITIES\n" +
    seg([[0, "LINE"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 0]]) +
    seg([[0, "LINE"], [8, "0"], [10, 100], [20, 0], [11, 100], [21, 80]]) +
    seg([[0, "LINE"], [8, "0"], [10, 100], [20, 80], [11, 0], [21, 80]]) +
    seg([[0, "LINE"], [8, "0"], [10, 0], [20, 80], [11, 0], [21, 0]]) +
    seg([[0, "TEXT"], [8, "0"], [10, 10], [20, 5], [40, 3], [1, "電源 100-240V"]]) +
    "0\nENDSEC\n0\nEOF\n";
  const ents = parseDXF(dxf);
  const K = 20 / 80;                                   // fit20 → 0.25

  // entsSVG: dxfEntsToSVG の文字高 = 3×k (下限で持ち上げない)
  {
    const r = dxfEntsToSVG(ents, { scale: K });
    const fs = +(r.body.match(/<text[^>]*font-size="([\d.]+)"/) || [])[1];
    out.entsSVG = { fs, want: svgFontSize(3 * K), w: +r.w.toFixed(2) };
  }

  // pageImport: ダイアログを実際に操作して「作図線として配置」
  {
    const pg = newPage("dxftext", App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
    UI.refresh();
    UI.dxfImportDialog(ents, "test.dxf");
    document.querySelector("#dxScale").value = "fit20";
    document.querySelector("#dxMode").value = "draw";
    document.querySelector("#dxOk").click();
    await new Promise(r => setTimeout(r, 60));
    const t = pg.texts[pg.texts.length - 1];
    out.pageImport = { n: pg.texts.length, size: t && t.size, noMin: t && !!t.noMin, wires: pg.wires.length };

    // renderNoMin: 画面描画の font-size が最小呼び 3.5mm 相当へ上がらない
    const el = Editor.svg.querySelector(`text[data-id="${t.id}"]`);
    out.renderNoMin = { fs: el && +el.getAttribute("font-size"), want: svgFontSizeFor(t.text, t.size, false, { noMin: true }) };

    // boundsNoMin: textBounds も実寸のまま
    const tb = textBounds(t);
    out.boundsNoMin = { h: +tb.h.toFixed(2), size: t.size };

    // cjkFloorKept: 通常の注記 (noMin なし) は従来どおり持ち上がる
    const t2 = { id: "t_norm", x: 100, y: 100, text: "和文注記", size: 2, anchor: "start" };
    pg.texts.push(t2);
    UI.refresh();
    await new Promise(r => setTimeout(r, 60));
    const el2 = Editor.svg.querySelector('text[data-id="t_norm"]');
    out.cjkFloorKept = { fs: el2 && +el2.getAttribute("font-size"), want: svgFontSizeFor("和文注記", 3.5, false), h: +textBounds(t2).h.toFixed(2) };
  }

  // symedit: dxfEntsToShapes も比を保つ
  {
    const shapes = dxfEntsToShapes(ents, { scale: 0.4 });
    const tx = shapes.find(s => s.k === "text");
    const xs = shapes.filter(s => s.k === "line").flatMap(s => s.pts.map(q => q[0]));
    const w = Math.max(...xs) - Math.min(...xs);
    out.symedit = { ratio: +(tx.h / w * 100).toFixed(2) };
  }
  return out;
});

const near = (a, b, tol = 0.02) => typeof a === "number" && Math.abs(a - b) <= tol;
const checks = {
  noPageErrors: errs.length === 0,
  entsSVG: near(R.entsSVG.fs, R.entsSVG.want) && near(R.entsSVG.w, 25),
  pageImport: R.pageImport.n === 1 && near(R.pageImport.size, 0.75) && R.pageImport.noMin && R.pageImport.wires >= 4,
  renderNoMin: near(R.renderNoMin.fs, R.renderNoMin.want) && R.renderNoMin.fs < 3,
  boundsNoMin: near(R.boundsNoMin.h, R.boundsNoMin.size * 1.25, 0.05),
  cjkFloorKept: near(R.cjkFloorKept.fs, R.cjkFloorKept.want) && near(R.cjkFloorKept.h, 3.5 * 1.25, 0.05),
  symedit: near(R.symedit.ratio, 3, 0.05),
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs);
await b.close();
process.exit(fail ? 1 : 0);
