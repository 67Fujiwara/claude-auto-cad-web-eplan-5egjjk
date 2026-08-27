/* コネクタの外形の角R (D-sub などのシェルの丸角)。

   ・dialogField : コネクタ配置ダイアログに「角R (mm)」欄がある
   ・roundMade   : 角R=4 で置くと外形が直線4本 + 四分円弧4個 (r=4) になり、
                   角の rect は無い。すべて同じグループに入る
   ・geometry    : 円弧の中心が外形の四隅から R だけ内側にあり、角度が
                   180-270 / 270-360 / 0-90 / 90-180 の四分円になっている
   ・metaKeep    : connMeta に r が残り、「コネクタ編集」で開き直すと 4 が入る
   ・rebuildKeep : 編集ダイアログで作り直しても丸角のまま
   ・zeroCompat  : 角R=0 は従来どおり rect 1 個 (円弧なし)
   ・bodySaved   : 登録した body に A4,4 の円弧が 4 個入り、DXF プリミティブ
                   にも arc として出る */
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
  const arcs = grp.filter(sh => sh.k === "arc");
  out.roundMade = {
    arcs: arcs.length, rects: grp.filter(sh => sh.k === "rect").length,
    r4: arcs.every(a => a.r === 4), grouped: arcs.every(a => a.grp === gid),
  };
  // 幾何: dir=down (機器は右) → 外形は bx=x0+2, by=y0-4, w=12.8, h=len+8
  const bx = meta.x0 + 2, by = meta.y0 - 4, w = 12.8, hgt = (meta.n - 1) * meta.pitch + 8;
  const want = [
    [bx + 4, by + 4, 180, 270], [bx + w - 4, by + 4, 270, 360],
    [bx + w - 4, by + hgt - 4, 0, 90], [bx + 4, by + hgt - 4, 90, 180],
  ];
  out.geometry = want.every(([cx, cy, a0, a1]) =>
    arcs.some(a => Math.abs(a.x - cx) < 0.01 && Math.abs(a.y - cy) < 0.01 && a.a0 === a0 && a.a1 === a1));
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
  out.rebuildKeep = S.shapes.filter(sh => sh.grp === gid2 && sh.k === "arc").length === 4
    && S.shapes.filter(sh => sh.grp === gid2 && sh.k === "rect").length === 0;

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
  out.zeroCompat = grp.filter(sh => sh.k === "rect").length === 1 && grp.filter(sh => sh.k === "arc").length === 0;

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
  out.bodyArcs = sym ? (sym.body.match(/A4,4 /g) || []).length : -1;
  out.dxfArcs = sym ? dxfSymPrimitives(sym).filter(pr => pr.type === "arc" && Math.abs(pr.r - 4) < 0.01).length : -1;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  dialogField: R.dialogField === true,
  roundMade: R.roundMade.arcs === 4 && R.roundMade.rects === 0 && R.roundMade.r4 && R.roundMade.grouped,
  geometry: R.geometry === true && R.metaR === 4,
  metaKeep: R.metaKeep === "4",
  rebuildKeep: R.rebuildKeep === true,
  zeroCompat: R2.zeroCompat === true,
  bodySaved: R2.bodyArcs === 4 && R2.dxfArcs === 4,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, R2, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("conn-radius OK");
