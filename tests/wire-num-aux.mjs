/* 作画線・破線と線番 — 「配線に関係ない線」に線番を振らない。

   ・bareNoNum   : どのピンにも触れない実線 (配置図の作画など) に番号が付かない
   ・staleCleared: 過去に付いた自動番号も、回路でなくなれば再採番で消える
   ・dashCondBare: 破線のまま回路として扱う線 (aux=false) でもピンに触れなければ番号なし
   ・auxHeal     : 作図線 (非導通) に残った線番は自動採番のたびに掃除される
   ・placeAssign : 素の線の上に機器を置いた瞬間に線番が付く (機器で区間も破断)
   ・deleteClears: 機器を消して回路でなくなった線から自動線番が外れる */
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
  App.project = newProject("作画線テスト");
  UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);

  // 1) ピンに触れない実線 → 番号なし
  const bare = addWire(pg, [[60, 60], [140, 60]], { raw: true });
  autoNumberWires();
  out.bareNoNum = bare.num == null && bare.numShow !== true;

  // 2) 昔の自動番号が残っていても掃除される (据え置きの対象にしない)
  bare.num = "999"; bare.numShow = true;
  autoNumberWires();
  out.staleCleared = bare.num == null && bare.numShow !== true;

  // 3) 破線のまま回路扱い (aux=false 手動指定) でも、ピンに触れなければ番号なし
  const dashCond = addWire(pg, [[60, 80], [140, 80]], { raw: true, style: "dash" });
  dashCond.aux = false;
  autoNumberWires();
  out.dashCondBare = dashCond.num == null;

  // 4) 作図線 (非導通) に残った線番の掃除
  const aux = addWire(pg, [[60, 100], [140, 100]], { raw: true, style: "dash" });
  aux.num = "888"; aux.numShow = true; aux.fixed = true;
  autoNumberWires();
  out.auxHeal = aux.num == null && aux.numShow !== true && aux.fixed !== true;

  // 5) 素の線の上に機器を置く → その瞬間に採番され、機器の左右で区間が変わる
  const w5 = addWire(pg, [[100, 140], [100, 220]], { raw: true });
  autoNumberWires();
  const noneBefore = w5.num == null;
  Editor.ghost = { symId: "pb_no", x: 100, y: 160, rot: 0 };   // ピン (100,160)/(100,180) が線上
  placeGhost();
  Editor.ghost = null;
  const segs = pg.wires.filter(w => w.pts.every(pt => pt[0] === 100 && pt[1] >= 140 && pt[1] <= 220));
  const dev = pg.devices[pg.devices.length - 1];
  out.placeAssign = {
    noneBefore, segs: segs.length,
    numbered: segs.length === 2 && segs.every(w => w.num != null),
    broken: segs.length === 2 && segs[0].num !== segs[1].num,
  };

  // 6) 機器を消す → 回路でなくなった線から自動線番が外れる
  App.selection.clear(); App.selection.add(dev.id);
  deleteSelection();
  out.deleteClears = !pg.devices.includes(dev) && segs.every(w => w.num == null);
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  bareNoNum: R.bareNoNum === true,
  staleCleared: R.staleCleared === true,
  dashCondBare: R.dashCondBare === true,
  auxHeal: R.auxHeal === true,
  placeAssign: R.placeAssign.noneBefore && R.placeAssign.numbered && R.placeAssign.broken,
  deleteClears: R.deleteClears === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-num-aux OK");
