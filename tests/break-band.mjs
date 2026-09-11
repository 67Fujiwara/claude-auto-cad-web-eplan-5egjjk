/* 破断記号 (波線 2 本 + 間の省略帯)。

   ・trim  : 帯を横切る配線は 2 本に切れ、切れ目 = 2 本の間隔になる
   ・dims  : 長さ×間隔の寸法違い (break_mark@LxG)。波線 2 本・外形・帯が
            寸法に追従し、保存 → 読み込みでも id から復元できる
   ・rot   : 90° 回すと帯も回る — 横切る横線は切れ、帯の外の縦線は切れない
   ・hide  : 帯に丸ごと入った機器は 画面 SVG・当たり判定・DXF のどれにも
            出ない。帯の外の機器は出る
   ・propUi: プロパティに「波線の長さ」「2 本の間隔」が出て、変更すると
            寸法違いの記号へ差し替わる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("破断帯"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const w1 = addWire(pg, [[100, 60], [100, 160]]);
  const brk = addDevice(pg, "break_mark", 100, 100, {});
  App.labelRev++;
  const parts1 = trimPolyByCircles(w1.pts, pageWireMasks(pg));
  out.trim = { n: parts1.length,
    gap: parts1.length === 2 ? Math.round((parts1[1][0][1] - parts1[0][1][1]) * 10) / 10 : 0 };

  // 寸法違い + 保存/読み込み相当 (id からの復元)
  const v = breakVariant(SYMBOLS_BY_ID.break_mark, 40, 30);
  brk.sym = v.id; App.labelRev++;
  const parts2 = trimPolyByCircles(w1.pts, pageWireMasks(pg));
  out.dims = { id: v.id, gap: parts2.length === 2 ? Math.round((parts2[1][0][1] - parts2[0][1][1]) * 10) / 10 : 0,
    bounds: v.bounds.join(","), waves: (v.body.match(/M/g) || []).length,
    resolved: (() => { delete SYMBOLS_BY_ID[v.id]; const s2 = symOf("break_mark@40x30"); return s2 && s2.brkGap === 30; })() };

  // 回転: 帯が回る
  brk.rot = 90; App.labelRev++;
  const wH = addWire(pg, [[60, 110], [160, 110]]);
  const wV = addWire(pg, [[150, 60], [150, 160]]);
  out.rot = { h: trimPolyByCircles(wH.pts, pageWireMasks(pg)).length,
    v: trimPolyByCircles(wV.pts, pageWireMasks(pg)).length };
  brk.rot = 0;

  // 隠し: 帯 (40×30 = x80..120, y100..130) に丸ごと入ったコイルは出ない
  const dIn = addDevice(pg, "coil", 100, 103, { tag: "-KIN" });
  const dOut = addDevice(pg, "coil", 160, 103, { tag: "-KOUT" });
  dIn.desc = "省略中身"; dOut.desc = "表示中身";   // DXF 判定用 (機能テキストは常に出力される)
  App.labelRev++;
  const svg = devicesSVG(pg, { print: true });
  const hid = breakHiddenSet(pg);
  const hitIn = hitTest(100, 113), hitOut = hitTest(160, 113);
  const dxf = pageToDXF(pg);
  out.hide = {
    set: hid.has(dIn.id) && !hid.has(dOut.id) && !hid.has(brk.id),
    svg: !svg.includes(`data-id="${dIn.id}"`) && svg.includes(`data-id="${dOut.id}"`),
    hit: !(hitIn && hitIn.type === "device" && hitIn.obj.id === dIn.id) &&
      !!(hitOut && hitOut.obj && hitOut.obj.id === dOut.id),
    dxf: !dxf.includes("省略中身") && dxf.includes("表示中身"),
  };
  return out;
});

/* ── プロパティ UI ── */
const PU = await p.evaluate(async () => {
  const pg = curPage();
  const brk = pg.devices.find(d => /^break_mark/.test(d.sym));
  App.selection.clear(); App.selection.add(brk.id);
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const len = document.getElementById("pBrkLen"), gap = document.getElementById("pBrkGap");
  if (!len || !gap) return { fields: false };
  gap.value = "50";
  gap.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  return { fields: true, sym: brk.sym };
});

const checks = {
  trim: R.trim.n === 2 && R.trim.gap === 15,
  dims: R.dims.id === "break_mark@40x30" && R.dims.gap === 30 &&
    R.dims.bounds === "-20,-3,40,36" && R.dims.waves === 2 && R.dims.resolved === true,
  rot: R.rot.h === 2 && R.rot.v === 1,
  hide: R.hide.set === true && R.hide.svg === true && R.hide.hit === true && R.hide.dxf === true,
  propUi: PU.fields === true && PU.sym === "break_mark@40x50",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, PU, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("break-band OK");
