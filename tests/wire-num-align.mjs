/* 線番ラベルの列ぞろえ (PLC の入出力行のような 20mm ピッチの横線群)。

   ・aligned : 同じ張りの横線 8 本に線番を振ると、ラベルの x 中心が
              1 列にそろう (ガタガタにならない)
   ・dodge   : 列位置に機器を置くと、機器の箱が届く行 (その行と直下) だけ
              逃げ、残りの行は元の列を保つ。逃げた行どうしも列がそろう
   ・overlapFree : そろえた後も、ラベルは機器・他の線に重ならない
   ・branchAlign : 分岐位置の違う 2 本 (2 段ラベル) でも列がそろう —
              後の線が入れない列なら、先の線のほうが動く
   ・manualAt : 配線をダブルクリックした位置に線番が出る (クリックした側)。
               近くの列が 12mm 以内ならそこへ吸着してそろう。
               表示だけの機能 — 移動すると位置も一緒に付いてくる。
               プロパティ「位置を自動に戻す」で解除できる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("列ぞろえ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const ws = [];
  for (let i = 0; i < 8; i++) {
    const w = addWire(pg, [[60, 60 + i * 20], [220, 60 + i * 20]]);
    setWireNumber(pg, w, "Y0" + (18 + i));
    ws.push(w);
  }
  App.labelRev++;
  const centers = () => ws.map(w => Math.round(wireLabelPos(w, pg)[0] * 2) / 2);
  const xs1 = centers();
  out.aligned = { cols: new Set(xs1).size, xs: xs1 };

  // 4 本目の列位置に機器 → その行だけ逃げ、他は列を保つ
  const col = xs1[0];
  addDevice(pg, "lamp", col, 60 + 3 * 20, { tag: "-PL9" });
  App.labelRev++;
  const xs2 = centers();
  // 機器の箱は行 4 と直下の行 5 のラベル位置に届く — この 2 行だけが逃げる
  const others = xs2.filter((_, i) => i !== 3 && i !== 4);
  out.dodge = { othersCols: new Set(others).size, othersCol: others[0] === xs1[0],
    moved: xs2[3] !== xs1[3], escTogether: xs2[3] === xs2[4], xs: xs2 };

  // 重なりなし (検図のラベル系エラーが出ない)
  const drc = runDRC().filter(i => /線番|ラベル|重な/.test(i.msg));
  out.overlapFree = { n: drc.length, msgs: drc.slice(0, 3).map(i => i.msg) };

  return out;
});

/* ── 手決めの線番位置 (ダブルクリック) ── */
const MA = {};
await p.evaluate(() => {
  const pg = curPage();
  pg.devices.length = 0; App.labelRev++;
  UI.setTool("select"); UI.refresh(true); zoomFit();
});
await p.waitForTimeout(250);
const S2 = await p.evaluate(() => {
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], v: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const at2 = (x, y) => ({ x: S2.bb[0] + S2.v[0] + x * S2.v[2], y: S2.bb[1] + S2.v[1] + y * S2.v[2] });
// 1 本目: x=90・線の下側をダブルクリック → その場・下側に出る
let cc = at2(90, 61);   // 線 (y=60) のすぐ下 = 下側指定
await p.mouse.dblclick(cc.x, cc.y);
await p.waitForTimeout(250);
MA.input = await p.evaluate(() => !!document.querySelector("#overlay-root input"));
await p.keyboard.press("Enter");
await p.waitForTimeout(250);
Object.assign(MA, await p.evaluate(() => {
  const pg = curPage(), w = pg.wires[0];
  const pos = wireLabelPos(w, pg);
  return { anchored: Array.isArray(w.numAt), x1: Math.round(pos[0]), below: pos[4] === -1 && pos[1] > 60 };
}));
// 2 本目: 1 本目の列から 8mm ずれた位置でダブルクリック → 列へ吸着
cc = at2(98, 81);       // 2 本目 (y=80) のすぐ下・列から 8mm ずれた位置
await p.mouse.dblclick(cc.x, cc.y);
await p.waitForTimeout(250);
await p.keyboard.press("Enter");
await p.waitForTimeout(250);
Object.assign(MA, await p.evaluate(() => {
  const pg = curPage();
  const w1 = pg.wires[0], w2 = pg.wires[1];
  const p1 = wireLabelPos(w1, pg), p2 = wireLabelPos(w2, pg);
  // 移動で位置が付いてくる
  App.selection.clear(); App.selection.add(w1.id);
  const att = buildMoveAttachment();
  applyMove(att, 20, 0);
  App.labelRev++;
  const p1b = wireLabelPos(w1, pg);
  // プロパティで自動へ戻す
  UI.showProps();
  const btn = document.getElementById("pNumAtAuto");
  if (btn) btn.click();
  const cleared = !pg.wires[0].numAt;
  App.selection.clear();
  return { snap: Math.round(p2[0]) === Math.round(p1[0]),
    movedWith: Math.round(p1b[0]) === Math.round(p1[0]) + 20,
    btn: !!btn, cleared };
}));

/* ── 分岐位置の違う 2 本 + 電線仕様 (2 段ラベル) の列ぞろえ ── */
const BA = await p.evaluate(() => {
  const pg = curPage();
  pg.devices.length = 0; pg.wires.length = 0; App.labelRev++;
  const b1 = addWire(pg, [[60, 100], [240, 100]]);
  const b2 = addWire(pg, [[60, 120], [240, 120]]);
  addWire(pg, [[150, 100], [150, 140]]);
  addWire(pg, [[110, 120], [110, 160]]);
  setWireNumber(pg, b1, "S220"); b1.spec = "KIV 1.25sq Y";
  setWireNumber(pg, b2, "R220"); b2.spec = "KIV 1.25sq Y";
  App.labelRev++;
  const q1 = wireLabelPos(b1, pg), q2 = wireLabelPos(b2, pg);
  const out = { x1: Math.round(q1[0] * 2) / 2, x2: Math.round(q2[0] * 2) / 2,
    same: Math.abs(q1[0] - q2[0]) < 1 };

  /* 交差する導体の上に線番が載らない (導体も障害物に入っている) —
     すき間 1 か所以外を縦線でふさいだ横線で、ラベルがすき間へ入る */
  pg.devices.length = 0; pg.wires.length = 0; App.labelRev++;
  const c1 = addWire(pg, [[60, 100], [140, 100]]);
  [70, 80, 90, 100, 110, 130].forEach(x => addWire(pg, [[x, 80], [x, 120]]));
  setWireNumber(pg, c1, "X999");
  App.labelRev++;
  const q3 = wireLabelPos(c1, pg);
  const bx = wireLabelBoxes(c1, q3).num;
  out.condAvoid = [70, 80, 90, 100, 110, 130].every(x => bx.x > x + 0.2 || bx.x + bx.w < x - 0.2);
  out.condX = Math.round(q3[0] * 2) / 2;

  /* 接点のコイル参照 (/ページ.区画 (図番)) と線番・電線仕様が重ならない —
     参照は接点のそば、線番・仕様は同じ線の上で少しよける (遠くへ逃げない) */
  pg.devices.length = 0; pg.wires.length = 0; App.labelRev++;
  const k9 = addDevice(pg, "coil", 300, 200, { tag: "-SFR_A" });
  const c9 = addDevice(pg, "aux_no", 100, 100, { tag: "-SFR_A", rot: 90 });
  c9.linkTo = k9.id;
  const w9 = addWire(pg, [[110, 100], [148, 100]]);   // 短い線 — よけないと仕様が参照に重なる長さ
  setWireNumber(pg, w9, "INV2S1"); w9.spec = "KIV 1.25sq Y";
  App.labelRev++;
  const xr9 = deviceXrefBox(pg, c9);
  const p9 = wireLabelPos(w9, pg);
  const b9 = wireLabelBoxes(w9, p9);
  const hit9 = (a, b2) => a && b2 && a.x < b2.x + b2.w && a.x + a.w > b2.x && a.y < b2.y + b2.h && a.y + a.h > b2.y;
  out.xrefClear = {
    has: !!(xr9 && xr9.box) && !!b9.spec,
    numHit: hit9(b9.num, xr9 && xr9.box), specHit: hit9(b9.spec, xr9 && xr9.box),
    onWire: b9.num.x + b9.num.w / 2 >= 108 && b9.num.x + b9.num.w / 2 <= 150,   // 中心が自分の線の上に留まる
  };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  aligned: R.aligned.cols === 1,
  dodge: R.dodge.othersCols === 1 && R.dodge.othersCol === true &&
    R.dodge.moved === true && R.dodge.escTogether === true,
  overlapFree: R.overlapFree.n === 0,
  branchAlign: BA.same === true,
  condAvoid: BA.condAvoid === true,
  xrefClear: BA.xrefClear.has === true && BA.xrefClear.numHit === false &&
    BA.xrefClear.specHit === false && BA.xrefClear.onWire === true,
  manualAt: MA.input === true && MA.anchored === true && Math.abs(MA.x1 - 90) <= 1 && MA.below === true &&
    MA.snap === true && MA.movedWith === true && MA.btn === true && MA.cleared === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, MA, BA, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-num-align OK");
