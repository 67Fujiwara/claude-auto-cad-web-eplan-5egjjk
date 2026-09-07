/* 線番ラベルの列ぞろえ (PLC の入出力行のような 20mm ピッチの横線群)。

   ・aligned : 同じ張りの横線 8 本に線番を振ると、ラベルの x 中心が
              1 列にそろう (ガタガタにならない)
   ・dodge   : 列位置に機器を置くと、機器の箱が届く行 (その行と直下) だけ
              逃げ、残りの行は元の列を保つ。逃げた行どうしも列がそろう
   ・overlapFree : そろえた後も、ラベルは機器・他の線に重ならない */
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

const checks = {
  noPageErrors: errs.length === 0,
  aligned: R.aligned.cols === 1,
  dodge: R.dodge.othersCols === 1 && R.dodge.othersCol === true &&
    R.dodge.moved === true && R.dodge.escTogether === true,
  overlapFree: R.overlapFree.n === 0,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-num-align OK");
