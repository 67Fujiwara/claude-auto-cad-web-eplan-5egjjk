/* 図面注記の白抜き文字 (黒地に白)。

   ・propInv  : プロパティに「白抜き文字」チェックがあり、入れると t.inv が立ち
               外すと消える (undo の控えも積まれる)
   ・render   : inv の注記は文字より先に黒帯 (fill=INK) が敷かれ、文字は白。
               通常の注記には帯が無く、文字は INK 色
   ・bounds   : 外接箱 (検図・ラベルよけ) は黒帯の余白ぶん広くなる
   ・dxf      : DXF には画面と同じ塗りの帯 (SOLID 濃灰 ACI250) が文字の
               下に敷かれ、文字は白 (ACI255)。通常の注記には出ない */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("白抜き"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0; pg.texts.length = 0;
  pg.texts.push({ id: "ti1", x: 120, y: 80, text: "注意", size: 5 });
  const t = pg.texts[0];

  // ── プロパティのチェックで on/off ──
  App.selection.clear(); App.selection.add("ti1"); UI.showProps();
  const cb = document.getElementById("pTinv");
  out.propInv = { found: !!cb, checked0: cb && cb.checked };
  const depth0 = App.undoStack.length;
  cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  out.propInv.on = t.inv === true;
  out.propInv.undoPushed = App.undoStack.length === depth0 + 1;
  App.selection.add("ti1"); UI.showProps();
  const cb2 = document.getElementById("pTinv");
  out.propInv.checked1 = cb2 && cb2.checked;
  cb2.checked = false; cb2.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  out.propInv.off = t.inv === undefined;

  // ── 描画: 黒帯 + 白文字 (印刷経路 = PDF と同じ) ──
  const svgPlain = textsSVG(pg, { print: true });
  t.inv = true;
  const svgInv = textsSVG(pg, { print: true });
  const rectRe = /<rect [^>]*fill="#1b2334"[^>]*data-id="ti1"/;
  const rectIdx = svgInv.search(rectRe);
  const textIdx = svgInv.indexOf("<text");
  out.render = {
    band: rectIdx >= 0,
    bandUnderText: rectIdx >= 0 && rectIdx < textIdx,
    whiteText: /<text [^>]*fill="#fff"/.test(svgInv),
    plainNoBand: !rectRe.test(svgPlain),
    plainInk: /<text [^>]*fill="#1b2334"/.test(svgPlain),
  };

  // ── 外接箱が帯ぶん広い ──
  const bi = textBounds(t);
  const bp = textBounds({ ...t, inv: undefined });
  out.bounds = { wider: bi.w > bp.w + 1, taller: bi.h > bp.h + 1,
    shifted: bi.x < bp.x - 0.5 && bi.y < bp.y - 0.5 };

  // ── DXF: 塗りの帯 (SOLID ACI250) + 白文字 (ACI255) ──
  const solids = d => (d.match(/0\nSOLID\n8\nTEXT\n62\n250\n/g) || []).length;
  const dxfInv = pageToDXF(pg); applySheet(pg);
  delete t.inv;
  const dxfPlain = pageToDXF(pg); applySheet(pg);
  const iSolid = dxfInv.indexOf("0\nSOLID\n8\nTEXT");
  const iText = dxfInv.indexOf("1\n" + dxfEscape("注意"));
  out.dxf = { plain: solids(dxfPlain), inv: solids(dxfInv),
    band: solids(dxfInv) === 1 && solids(dxfPlain) === 0,
    under: iSolid >= 0 && iText > iSolid,                   // 帯が文字より先 = 下敷き
    white: /1\n注意\n50\n[\d.-]+\n62\n255\n/.test(dxfInv),
    plainInkText: !/62\n255/.test(dxfPlain) };
  App.selection.clear();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  propInv: R.propInv.found === true && R.propInv.checked0 === false && R.propInv.on === true &&
           R.propInv.undoPushed === true && R.propInv.checked1 === true && R.propInv.off === true,
  render: R.render.band === true && R.render.bandUnderText === true && R.render.whiteText === true &&
          R.render.plainNoBand === true && R.render.plainInk === true,
  bounds: R.bounds.wider === true && R.bounds.taller === true && R.bounds.shifted === true,
  dxf: R.dxf.band === true && R.dxf.under === true && R.dxf.white === true && R.dxf.plainInkText === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("text-invert OK");
