/* 参照テキスト (図番): 選んだページの図面番号を文字で書く記号。

   ・have    : 記号 page_ref がパレット (その他) に居て、端子は無い。パレットの
              見本は「B-001」の文字 (図面には描かない — 本体は空)
   ・text    : 参照先を選ぶと、その葉の図番 (例 B-002) が置いた位置を中心に出る。
              画面・印刷 SVG・DXF (XREF レイヤ) に同じ文字
   ・follow  : ページを差し込んで図番が繰り下がっても、図番を手で B-015 に
              固定しても、表示が追従する
   ・unset   : 参照先が無いと「?」で、検図がエラー。選べば消える。参照先の
              ページを消すと「?」に戻り、検図が「削除されています」と言う
   ・rotate  : 縦に置く (90°) と文字も 90° 倒れる
   ・props   : プロパティに「参照先」のプルダウンが出て、選ぶと参照先が入る
   ・noGrip  : 文字そのものが記号なので、明示のつかみ枠は出ない (記号ごと動かす)
   ・bom     : 部品表には載らない (購買部品ではない)。プロパティに配線の破断は出ない
   ・size    : プロパティの「文字高 (mm)」(既定 3.5) で文字の大きさを変えられる。
              画面・印刷 SVG・DXF の文字高が変わり、選択枠・当たり判定も文字に合わせて
              伸びる (検図の最小文字高もその値で測る)。標準値に戻すと値を持たない。2.5mm 未満 (JIS の最小) は 2.5 に丸める */
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
  const sym = SYMBOLS_BY_ID.page_ref;
  out.have = { ok: !!sym, pageRef: !!(sym && sym.pageRef), pins: sym ? sym.pins.length : -1, bodyEmpty: sym && sym.body === "",
    thumb: sym ? symThumbSVG(sym).includes("B-001") : false };
  UI.buildPalette();
  out.have.palette = [...document.querySelectorAll("#symTree .sym-name")].some(e => e.textContent === "参照テキスト (図番)");
  if (!sym) return out;

  App.project = newProject("参照テキスト"); UI.renumberPages();
  const pgA = App.project.pages.find(isDrawingPage);
  const pgB = newPage("制御回路", 0);
  App.project.pages.push(pgB); UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(pgA); applySheet(pgA);
  pgA.devices.length = 0; pgA.wires.length = 0;
  const d = addDevice(pgA, "page_ref", 150, 100, {});
  const txt = () => { App.labelRev++; return deviceXrefBox(pgA, d).text; };
  const drcRef = () => runDRC().filter(i => i.target === d.id && i.rule === "参照テキストの参照先なし");
  // ── unset ──
  out.unset = { text: txt(), drc: drcRef().length };
  // ── text ──
  d.props = { toPage: pgB.id };
  const xr = (App.labelRev++, deviceXrefBox(pgA, d));
  App.selection.clear(); UI.refresh(); renderAll();
  const scr = [...document.querySelectorAll("#lyDevices text")].some(t => t.textContent === xr.text);
  const svg = exportSheetSVG(pgA);
  applySheet(pgA);
  const dxf = pageToDXF(pgA);
  out.text = { text: xr.text, want: pageDwgNo(pgB), centered: Math.abs(xr.box.x + xr.box.w / 2 - 150) < 0.01 && Math.abs(xr.box.y + xr.box.h / 2 - 100) < 0.01,
    anchor: xr.anchor, scr, print: svg.includes(">" + xr.text + "<"), dxf: new RegExp("\\n\\s*8\\s*\\nXREF\\n[\\s\\S]{0,200}\\n1\\n" + xr.text + "\\n").test(dxf),
    drcGone: drcRef().length };
  // ── follow ──
  const ins = newPage("追加の回路", 0);
  App.project.pages.splice(App.project.pages.indexOf(pgB), 0, ins);
  UI.renumberPages();
  const t2 = txt(), w2 = pageDwgNo(pgB);
  pgB.dwgNo = "B-015"; pgB.dwgNoManual = true; UI.renumberPages();
  out.follow = { shifted: t2 === w2 && t2 !== out.text.text, manual: txt() };
  // ── rotate ──
  d.rot = 90; App.labelRev++;
  out.rotate = deviceXrefBox(pgA, d).angle;
  d.rot = 0; App.labelRev++;
  // ── props ──
  App.selection.clear(); App.selection.add(d.id); UI.showProps();
  const sel = document.querySelector("#pGoto");
  const lab = sel && sel.closest(".prop-row") && sel.closest(".prop-row").querySelector("label").textContent;
  out.props = { sel: !!sel, label: lab || "", picked: false, noCut: !document.querySelector("#pCutOn") };
  out.bom = !buildBOM().some(r => JSON.stringify(r).includes("page_ref") || JSON.stringify(r).includes("参照テキスト"));
  if (sel) {
    sel.value = ins.id; sel.dispatchEvent(new Event("change"));
    out.props.picked = d.props.toPage === ins.id && txt() === pageDwgNo(ins);
  }
  // ── size ──
  const hIn = document.querySelector("#pRefH");
  out.size = { input: !!hIn, def: hIn ? +hIn.value : null, h0: deviceXrefBox(pgA, d).size, bw0: devBounds(d).w };
  if (hIn) {
    hIn.value = "7"; hIn.dispatchEvent(new Event("change"));
    const x7 = deviceXrefBox(pgA, d);
    App.selection.clear(); UI.refresh(); renderAll();
    const tEl = [...document.querySelectorAll("#lyDevices text")].find(t => t.textContent === x7.text);
    const sv7 = exportSheetSVG(pgA); applySheet(pgA);
    const dx7 = pageToDXF(pgA);
    const m = new RegExp("\\n1\\n" + x7.text + "\\n").exec(dx7);
    const pre = m ? dx7.slice(Math.max(0, m.index - 300), m.index) : "";
    out.size.refH = d.props.refH; out.size.h7 = x7.size; out.size.bw7 = devBounds(d).w;
    out.size.scrFs = tEl ? parseFloat(tEl.getAttribute("font-size")) : null;
    out.size.printFs = (() => { const mm = new RegExp('font-size="([\\d.]+)"[^>]*>' + x7.text + "<").exec(sv7); return mm ? +mm[1] : null; })();
    out.size.dxfH = (() => { const mm = /\n40\n([\d.]+)$/.exec(pre); return mm ? +mm[1] : null; })();
    out.size.fs0 = svgFontSizeFor(x7.text, TEXT_H.normal, true);
    out.size.saved = JSON.parse(JSON.stringify(App.project)).pages.find(q => q.id === pgA.id).devices.find(q => q.id === d.id).props.refH;
    out.size.minH = pageDrawnMinima(pgA).h;
    App.selection.add(d.id); UI.showProps(); renderAll();
    const selR = document.querySelector(`#lyDevices g[data-id="${d.id}"] > rect`);
    out.size.selW = selR ? +selR.getAttribute("width") : null;
    const hIn2 = document.querySelector("#pRefH");
    out.size.shown = hIn2 ? +hIn2.value : null;
    hIn2.value = "1"; hIn2.dispatchEvent(new Event("change"));
    out.size.clamp = d.props.refH;
    UI.showProps();
    const hIn3 = document.querySelector("#pRefH");
    hIn3.value = "3.5"; hIn3.dispatchEvent(new Event("change"));
    out.size.back = "refH" in d.props; out.size.hBack = deviceXrefBox(pgA, d).size; out.size.bwBack = devBounds(d).w;
  }
  // ── noGrip ──
  out.noGrip = devLabelGrips(pgA, d).length;
  // ── 参照先のページを消す ──
  App.project.pages = App.project.pages.filter(pg => pg !== ins);
  UI.renumberPages();
  out.deleted = { text: txt(), drc: drcRef().map(i => i.msg).join("") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  have: R.have.ok && R.have.pageRef && R.have.pins === 0 && R.have.bodyEmpty && R.have.thumb && R.have.palette,
  text: R.text.text === R.text.want && /^B-\d{3}$/.test(R.text.text) && R.text.centered && R.text.anchor === "middle" &&
    R.text.scr && R.text.print && R.text.dxf,
  follow: R.follow.shifted === true && R.follow.manual === "B-015",
  unset: R.unset.text === "?" && R.unset.drc === 1 && R.text.drcGone === 0 &&
    R.deleted.text === "?" && /削除されています/.test(R.deleted.drc),
  rotate: R.rotate === 90,
  props: R.props.sel === true && /^参照先/.test(R.props.label) && R.props.picked === true && R.props.noCut === true,
  bom: R.bom === true,
  noGrip: R.noGrip === 0,
  size: R.size.input && R.size.def === 3.5 && R.size.refH === 7 && R.size.saved === 7 && R.size.shown === 7 &&
    Math.abs(R.size.h7 / R.size.h0 - 2) < 1e-9 && Math.abs(R.size.bw7 / R.size.bw0 - 2) < 1e-9 &&
    R.size.scrFs > R.size.fs0 * 1.9 && R.size.printFs > R.size.fs0 * 1.9 && Math.abs(R.size.dxfH - R.size.h7) < 0.01 &&
    R.size.minH === 7 && R.size.selW === R.size.bw7 + 4 && R.size.clamp === 2.5 && R.size.back === false && R.size.hBack === R.size.h0 && R.size.bwBack === R.size.bw0,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("page-ref OK");
