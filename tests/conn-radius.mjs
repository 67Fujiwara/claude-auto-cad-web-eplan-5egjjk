/* コネクタの外形の角R (D-sub などのシェルの丸角)。

   ・dialogField : コネクタ配置ダイアログに「角R (mm)」欄がある
   ・roundMade   : 角R=4 で置くと外形は「角R つきの四角形 1 個」になる
                   (後から選んで R を変えられる形)。グループにも入る
   ・geometry    : 四角形の位置・大きさが従来どおりで、r だけ 4 になっている
   ・metaKeep    : connMeta に r が残り、「コネクタ編集」で開き直すと 4 が入る
   ・rebuildKeep : 編集ダイアログで作り直しても丸角のまま
   ・zeroCompat  : 角R=0 は従来どおり rect 1 個 (円弧なし)
   ・bodySaved   : 登録した body の rect に rx="4" が入り、DXF プリミティブ
                   では直線 4 本 + 円弧 4 個 (r=4) として出る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

await p.evaluate(() => { UI.openSymbolEditor(); SymEdit.tool = "conn"; });
await p.waitForTimeout(150);
{
  const bb = await (await p.$("#seCanvas")).boundingBox();
  await p.mouse.click(bb.x + bb.width * 0.4, bb.y + bb.height * 0.3);
}
await p.waitForTimeout(150);

const R = await p.evaluate(async () => {
  const out = {};
  out.dialogField = !!document.querySelector("#cnR");
  document.querySelector("#cnName").value = "CN3";
  document.querySelector("#cnN").value = "4";
  document.querySelector("#cnR").value = "4";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 120));
  const S = SymEdit;
  const gid = [...new Set(S.shapes.map(sh => sh.grp).filter(Boolean))][0];
  const meta = S.connMeta[gid];
  const grp = S.shapes.filter(sh => sh.grp === gid);
  const rects = grp.filter(sh => sh.k === "rect");
  out.roundMade = {
    rects: rects.length, arcs: grp.filter(sh => sh.k === "arc").length,
    r4: rects.every(a => a.r === 4), grouped: rects.every(a => a.grp === gid),
  };
  // 幾何: dir=down (機器は右) → 外形は bx=x0+2, by=y0-4, w=12.8, h=len+8
  const bx = meta.x0 + 2, by = meta.y0 - 4, w = 12.8, hgt = (meta.n - 1) * meta.pitch + 8;
  const rc = rects[0];
  out.geometry = !!rc && Math.abs(rc.x - bx) < 0.01 && Math.abs(rc.y - by) < 0.01
    && Math.abs(rc.w - w) < 0.01 && Math.abs(rc.h - hgt) < 0.01 && rc.r === 4;
  out.metaR = meta.r;

  // ── コネクタ編集で開き直す → r=4 が入っている → 作り直しても丸角のまま
  S.msel = { shapes: S.shapes.map((sh, i) => sh.grp === gid ? i : -1).filter(i => i >= 0),
             pins: S.pins.map((pn, i) => pn.grp === gid ? i : -1).filter(i => i >= 0) };
  document.querySelector("#seConnEd").click();
  await new Promise(r => setTimeout(r, 120));
  out.metaKeep = document.querySelector("#cnR") && document.querySelector("#cnR").value;
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 120));
  const gid2 = [...new Set(S.shapes.map(sh => sh.grp).filter(Boolean))][0];
  out.rebuildKeep = S.shapes.filter(sh => sh.grp === gid2 && sh.k === "rect" && sh.r === 4).length === 1;

  return out;
});

// ── 角R=0 の従来互換と、登録 → body/DXF ──
const R2 = await p.evaluate(async () => {
  const out = {};
  const S = SymEdit;
  S.shapes.length = 0; S.pins.length = 0; S.connMeta = {}; S.msel = { shapes: [], pins: [] };
  S.tool = "conn";
  S.svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  await new Promise(r => setTimeout(r, 120));
  document.querySelector("#cnN").value = "2";
  document.querySelector("#cnR").value = "0";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 120));
  const gid = [...new Set(S.shapes.map(sh => sh.grp).filter(Boolean))].pop();
  const grp = S.shapes.filter(sh => sh.grp === gid);
  out.zeroCompat = grp.filter(sh => sh.k === "rect").length === 1
    && grp.every(sh => sh.k !== "rect" || sh.r === undefined);

  // ── 丸角コネクタを登録 → body と DXF プリミティブ ──
  S.shapes.length = 0; S.pins.length = 0; S.connMeta = {}; S.msel = { shapes: [], pins: [] };
  S.tool = "conn";
  S.svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  await new Promise(r => setTimeout(r, 120));
  document.querySelector("#cnName").value = "CNR";
  document.querySelector("#cnN").value = "3";
  document.querySelector("#cnR").value = "4";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 120));
  document.querySelector("#seName").value = "角Rコネクタテスト";
  window.confirm = () => true;
  document.querySelector("#seOk").click();
  await new Promise(r => setTimeout(r, 150));
  const sym = DB_SYMBOLS.find(s2 => s2.name === "角Rコネクタテスト");
  out.bodyRx = sym ? /<rect[^>]*rx="4"/.test(sym.body) : false;
  out.dxfArcs = sym ? dxfSymPrimitives(sym).filter(pr => pr.type === "arc" && Math.abs(pr.r - 4) < 0.01).length : -1;
  // 丸角の直線部 (四辺) も 4 本出ること
  out.dxfSides = sym ? dxfSymPrimitives(sym).filter(pr => pr.type === "poly" && pr.pts.length === 2).length : -1;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  dialogField: R.dialogField === true,
  roundMade: R.roundMade.rects === 1 && R.roundMade.arcs === 0 && R.roundMade.r4 && R.roundMade.grouped,
  geometry: R.geometry === true && R.metaR === 4,
  metaKeep: R.metaKeep === "4",
  rebuildKeep: R.rebuildKeep === true,
  zeroCompat: R2.zeroCompat === true,
  bodySaved: R2.bodyRx === true && R2.dxfArcs === 4 && R2.dxfSides >= 4,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, R2, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("conn-radius OK");
