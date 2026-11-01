/* 破断記号 (1 本): 波線をまたぐ配線と、多芯ケーブルの囲み・シールドを、
   選んだ側だけ隠す。

   ・have    : 記号 break_mark1 がパレット (その他) に居る。波線は 1 本
   ・hide    : 波線をまたぐ配線は、選んだ側 (既定 = 下) だけ消える。
              波線の長さの外を通る線、隠す側にあっても波線をまたがない線、
              波線の延長線で横切ってから隠す側へ曲がり込む線は消えない
   ・side    : 「隠す側」を上にすると反対側が消える
   ・rotate  : 90° 回した波線は横の線を切り、選択肢は画面の向き (左/右) で出る
   ・cable   : 波線をまたぐ多芯ケーブルの囲み・シールドは、選んだ側を切り抜いて
              描く (印刷 SVG も)。波線をまたがない囲みは切らない
   ・length  : 波線の長さを伸ばすと、届く範囲の線も切る
   ・dxf     : DXF でも配線の隠した側は出ない
   ・props   : プロパティに「隠す側」が出て、選ぶと切り替わる。タグは付かず、
              「配線の破断」の欄は出ない (この記号自体が破断) */
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
  const sym = SYMBOLS_BY_ID.break_mark1;
  UI.buildPalette();
  out.have = { ok: !!(sym && sym.brkSingle), pins: sym ? sym.pins.length : -1,
    oneWave: sym ? (sym.body.match(/M/g) || []).length === 1 : false,
    palette: [...document.querySelectorAll("#symTree .sym-name")].some(e => e.textContent === "破断記号 1本 (配線の省略)") };
  if (!sym) return out;
  App.project = newProject("破断1本"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  // 横の配線 4 本 (y=100〜115) + 心線囲み (x 113〜127) + シールド、縦の波線 (x=122, y=110)
  const ws = [100, 105, 110, 115].map(y => addWire(pg, [[50, y], [200, y]]));
  const far = addWire(pg, [[50, 300], [200, 300]]);          // 波線の長さの外
  const alone = addWire(pg, [[150, 90], [190, 90]]);          // 隠す側にあるが波線をまたがない
  // 波線の延長線 (長さの外 y=140) で横切ってから、隠す側の範囲へ曲がり込む線 — 波線はまたいでいない
  const bent = addWire(pg, [[130, 140], [110, 140], [110, 120]]);
  const cab = addDevice(pg, "cable_core", 120, 100, {});
  const shd = addDevice(pg, "shield", 120, 100, {});
  const cab2 = addDevice(pg, "cable_core", 170, 200, {});      // 離れた囲み (またがない)
  const brk = addDevice(pg, "break_mark1", 122, 110, { rot: 90 });
  brk.x = 122;                                                  // 心線囲みの中を通す (格子に丸めない)
  brk.sym = breakVariant(SYMBOLS_BY_ID.break_mark1, 40).id;     // 長さ 40 (y 90〜130)
  App.labelRev++;
  const vis = w => { const parts = trimPolyByCircles(w.pts, pageWireMasks(pg));
    return parts.map(q => q.map(pt => pt.map(v => Math.round(v * 10) / 10).join(",")).join(">")).join(" | "); };
  // 90° 回した波線: ローカル +y = 画面の左。既定 (下 = +y) は左側を隠す
  out.hide = { w0: vis(ws[0]), far: vis(far), alone: vis(alone), bent: vis(bent) };
  // ── side ──
  brk.props = { brkSide: "above" }; App.labelRev++;
  out.side = { w0: vis(ws[0]), alone: vis(alone) };
  // ── cable ──
  const svg = devicesSVG(pg);
  const clip = id => new RegExp(`clipPath id="brkclip_${id}"`).test(svg);
  const print = exportSheetSVG(pg); applySheet(pg);
  out.cable = { cab: clip(cab.id), shd: clip(shd.id), cab2: clip(cab2.id), print: print.includes(`brkclip_${cab.id}`),
    // 切り抜く矩形が波線の右 (x ≥ 140) にある
    right: (() => { const m = new RegExp(`brkclip_${cab.id}"[^>]*><path d="M-10000,-10000 H20000 V20000 H-10000 Z M([\\d.\\-]+),`).exec(svg);
      return m ? +m[1] : null; })() };
  // ── props ──
  App.selection.clear(); App.selection.add(brk.id); UI.showProps();
  const sel = document.querySelector("#pBrkSide");
  out.props = { sel: !!sel, opts: sel ? [...sel.options].map(o => o.textContent).join("/") : "", flipped: false,
    noTag: !brk.tag, noCut: !document.querySelector("#pCutOn") };
  if (sel) { sel.value = "below"; sel.dispatchEvent(new Event("change")); out.props.flipped = !brk.props.brkSide && vis(ws[0]) === out.hide.w0; }
  // ── length: 長さ 15 (y 102.5〜117.5) にすると y=100 は外れ、y=115 はまだ切る ──
  brk.sym = breakVariant(SYMBOLS_BY_ID.break_mark1, 15).id; App.labelRev++;
  out.length = { w3: vis(ws[3]), w0: vis(ws[0]) };
  brk.sym = breakVariant(SYMBOLS_BY_ID.break_mark1, 40).id; App.labelRev++;
  // ── dxf ── (既定 = 左を隠す。隠す範囲は波線から 0.01mm 先なので、残る線は 121.99 から)
  const dxf = pageToDXF(pg);
  const dy = v => dxfY(v);
  out.dxf = { leftGone: !new RegExp(`\\n10\\n50\\.000\\n20\\n${dy(100)}\\n`).test(dxf),
    rightKept: new RegExp(`\\n10\\n12(1\\.99|2\\.00)0\\n20\\n${dy(100)}\\n11\\n200\\.000\\n21\\n${dy(100)}\\n`).test(dxf) };
  // ── 回転なし: 下を隠す ──
  brk.rot = 0; brk.x = 100; brk.y = 200; App.labelRev++;
  const v1 = addWire(pg, [[100, 180], [100, 240]]);
  out.rot0 = vis(v1);
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  have: R.have.ok && R.have.pins === 0 && R.have.oneWave && R.have.palette,
  hide: R.hide.w0 === "122,100>200,100" && R.hide.far === "50,300>200,300" && R.hide.alone === "150,90>190,90" &&
    R.hide.bent === "130,140>110,140>110,120",
  side: R.side.w0 === "50,100>122,100" && R.side.alone === "150,90>190,90",
  cable: R.cable.cab && R.cable.shd && !R.cable.cab2 && R.cable.print && R.cable.right !== null && R.cable.right >= 121.9,
  rotate: /波線の左を隠す/.test(R.props.opts) && /波線の右を隠す/.test(R.props.opts),
  props: R.props.sel && R.props.flipped && R.props.noTag && R.props.noCut,
  length: R.length.w0 === "50,100>200,100" && R.length.w3 === "122,115>200,115",
  dxf: R.dxf.leftGone && R.dxf.rightKept,
  rot0: R.rot0 === "100,180>100,200",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("break-single OK");
