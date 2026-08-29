/* 配線の破断 — シンボルに重なった配線を「破断線から下」だけ隠す。
   外接矩形 (青枠) でなく指定した線の位置で切るので、波線の描線に合わせられる。

   ・breakMark  : 標準の「破断記号」を配線に被せると、波線 (y=0) から下の
                  配線が隠れ、上はそのまま残る
   ・propCut    : どの機器でもプロパティ「配線の破断」を入れると、指定 y から
                  下に重なった配線が隠れる (幅は記号の外接矩形ぶん)
   ・lineNotBox : 切れる位置は青枠の上端ではなく指定した破断線の y
   ・sideKept   : 記号の幅の外を通る配線は隠れない
   ・rotFollow  : 記号を 90° 回すと「下」も記号と一緒に回る (ローカル判定)
   ・netKept    : 隠すのは描画だけ — 回路のつながり・検図は変わらない
   ・dxfSame    : DXF 出力も同じ位置で切れる
   ・moveBack   : 記号を動かす/破断をやめると線は元どおり描かれる */
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
  const mk = () => {
    const pg = newPage("wb" + App.project.pages.length, App.project.pages.length + 1);
    App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1; applySheet(pg);
    return pg;
  };
  const dOf = (pg, w) => {
    UI.refresh();
    return null;
  };
  const pathOf = (id) => {
    const el = document.querySelector(`path.wire[data-id="${id}"]`);
    return el ? el.getAttribute("d") : "";
  };

  // ── 標準の破断記号 ──
  const a = mk();
  const w1 = addWire(a, [[100, 40], [100, 160]], { raw: true });
  addDevice(a, "break_mark", 100, 100, {});
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.breakMark = {
    d: pathOf(w1.id),
    upKept: pathOf(w1.id).includes("M100,40"),
    cutAtLine: pathOf(w1.id).includes("L100,100") && !pathOf(w1.id).includes("160"),
  };

  // ── プロパティの破断 (任意の機器: コイルで試す) ──
  const c = mk();
  const w2 = addWire(c, [[100, 40], [100, 200]], { raw: true });
  const w3 = addWire(c, [[130, 40], [130, 200]], { raw: true });   // 記号の幅の外
  const dv = addDevice(c, "coil", 100, 100, {});
  dv.props.cutY = 5;                       // コイル記号のローカル y=5 (中央) から下
  App.labelRev++;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.propCut = {
    d: pathOf(w2.id),
    upKept: pathOf(w2.id).includes("M100,40"),
    cutAt105: pathOf(w2.id).includes("L100,105") && !pathOf(w2.id).includes("L100,200"),
    sideKept: pathOf(w3.id) === "M130,40 L130,200",
  };
  // 青枠の上端 (bounds y=-2 → 98) で切れていないこと
  out.lineNotBox = !out.propCut.d.includes("L100,98");

  // ── 回転追従 (90° 回すと「下」= 図面の右になる) ──
  dv.rot = 90;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const wH = addWire(c, [[40, 100], [200, 100]], { raw: true });   // 記号を横切る水平線
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const dh = pathOf(wH.id);
  // ローカル +y は回転で -x (図面の左) へ向く → 左側が隠れる
  out.rotFollow = { d: dh, cut: dh !== `M40,100 L200,100` };
  dv.rot = 0;

  // ── つながり・検図は「破断の有無」で変わらない (描画だけの機能) ──
  const nets = computeNets(c, "closed");
  const drcNow = runDRC().filter(i => i.page === c.no).map(i => i.msg).sort();
  const savedCut = dv.props.cutY;
  delete dv.props.cutY;
  const drcOff = runDRC().filter(i => i.page === c.no).map(i => i.msg).sort();
  dv.props.cutY = savedCut;
  out.netKept = {
    same: nets.wireNet.get(w2.id) != null,
    drcSame: JSON.stringify(drcNow) === JSON.stringify(drcOff),
  };

  // ── DXF も同じ位置で切れる ──
  const dxf = pageToDXF(c);
  out.dxfSame = dxf.includes("105.000") && !dxf.split("\n").some((ln, i, arr) =>
    ln === "200.000" && arr[i - 2] === " 21");   // ざっくり: 下端 200 の縦線が出ない

  // ── 破断をやめると戻る ──
  delete dv.props.cutY;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.moveBack = pathOf(w2.id) === "M100,40 L100,200";
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  breakMark: R.breakMark.upKept && R.breakMark.cutAtLine,
  propCut: R.propCut.upKept && R.propCut.cutAt105,
  lineNotBox: R.lineNotBox === true,
  sideKept: R.propCut.sideKept === true,
  rotFollow: R.rotFollow.cut === true,
  netKept: R.netKept.same && R.netKept.drcSame,
  dxfSame: R.dxfSame === true,
  moveBack: R.moveBack === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-break OK");
