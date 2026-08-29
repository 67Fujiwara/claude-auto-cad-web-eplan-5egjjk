/* 仕様シートの記入まわり。

   ・ipNone   : 保護等級に「指定無し」がある (8 番) — 選ぶと ◯ が付く
   ・matMemo  : 指定色を書いた後で 1 番 (標準色) を選んでも、標準色の欄に
                指定色が出ない (記入は 2 番の括弧だけに入る)
   ・pwrOpts  : 電源接続方法が 2 択 (端子台 / コネクター接続 3112N 配線長 3M)
   ・pwrPick  : その番号をクリックすると ◯ が移る
   ・pwrMemo  : 御社指定方法の欄を図面の上でクリックすると書き込め、図面に出る
   ・memoCells: 特記事項・指定色・チューブ長の欄もクリックで書ける
   ・sheet2   : 仕様は 2 枚目があり、1 枚目と別の様式 (供給電源電圧・
                御社環境温度レンジ・制御盤冷却方法・外部 I/F) で描かれる
   ・newProj  : 新しい図面には仕様が 2 枚入る
   ・multi    : 外部 I/F は複数チェックでき、もう一度押すと外れる
   ・tempFill : 非定常時に温度と理由を書くと「0℃ー45℃ (洗浄 実施の為)」と出る
   ・fieldCell: 定常時の記入欄はクリックして書ける */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const setup = await p.evaluate(async () => {
  App.project = newProject("仕様記入"); UI.renumberPages();
  const i = App.project.pages.findIndex(pg => pg.kind === "spec");
  App.pageIdx = i; applySheet(App.project.pages[i]);
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 250));
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], view: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const S = (x, y) => ({ x: setup.bb[0] + setup.view[0] + x * setup.view[2], y: setup.bb[1] + setup.view[1] + y * setup.view[2] });
/** 仕様シートの枠 (選択肢 or 記入欄) の真ん中を実際にクリックする */
const clickBox = async (find) => {
  const c = await p.evaluate((f) => {
    const o = (Editor.specBoxes || []).find(new Function("o", `return ${f}`));
    return o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null;
  }, find);
  if (!c) return false;
  const s = S(c.x, c.y);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(150);
  return true;
};

const R = {};
R.form = await p.evaluate(() => {
  const ip = SPEC_SHEET[0].blocks.find(x => x.k === "ip");
  const pwr = SPEC_SHEET[0].blocks.find(x => x.kind === "compare");
  const fe = SPEC_SHEET[0].blocks.find(x => x.kind === "pair").groups[0];
  return { ipOpts: ip.opts, pwrOpts: pwr.opts || [], pwrK: pwr.k, feMemoAt: fe.memoAt };
});

// ── 保護等級「指定無し」を選ぶ ──
R.ipNone = { picked: await clickBox('o.k === "ip" && o.i === 7') };
R.ipNone.sel = await p.evaluate(() => curPage().spec.sel.ip);

// ── 指定色を書いてから 1 番 (標準色) を選ぶ ──
await p.evaluate(() => {
  const pg = curPage();
  pg.spec.memo = pg.spec.memo || {};
  pg.spec.memo.mat_fe = "N7 グレー";
  pg.spec.sel.mat_fe = 1;
  UI.refresh();
});
await p.waitForTimeout(150);
await clickBox('o.k === "mat_fe" && o.i === 0');
R.matMemo = await p.evaluate(() => {
  const pg = curPage();
  const svg = kindSVG(pg);
  // 「標準色 (N7 グレー)」のように標準色の欄へ回り込んでいないこと
  return {
    sel: pg.spec.sel.mat_fe,
    memo: pg.spec.memo.mat_fe,
    bad: svg.includes("標準色 (N7 グレー)"),
    good: svg.includes("指定色 (N7 グレー)") && svg.includes("標準色 (5Y7/1)"),
  };
});

// ── 電源接続方法: 2 番 (コネクター接続) を選ぶ ──
R.pwrPick = { picked: await clickBox('o.k === "pwr_std" && o.i === 1') };
R.pwrPick.sel = await p.evaluate(() => curPage().spec.sel.pwr_std);

// ── 御社指定方法の欄をクリックして書き込む ──
await p.evaluate(() => { window.prompt = () => "盤上部より 3φ3W 直入れ"; });
R.pwrMemo = { clicked: await clickBox('o.memo === "pwr"') };
R.pwrMemo.after = await p.evaluate(() => ({
  memo: curPage().spec.memo.pwr,
  drawn: kindSVG(curPage()).includes("盤上部より 3φ3W 直入れ"),
}));

// ── 記入欄が一通りクリックできる ──
R.memoCells = await p.evaluate(() => {
  const keys = (Editor.specBoxes || []).filter(o => o.memo).map(o => o.memo);
  return { keys: [...new Set(keys)].sort() };
});

/* ── 2 枚目の仕様 ── */
R.newProj = await p.evaluate(() => {
  App.project = newProject("仕様2");
  UI.renumberPages();
  return { specs: App.project.pages.filter(pg => pg.kind === "spec").length,
    names: App.project.pages.map(pg => pg.name) };
});
const setup2 = await p.evaluate(async () => {
  const specs = App.project.pages.filter(pg => pg.kind === "spec");
  const sp = specs[1] || specs[0];        // 2 枚目が無くても落ちないようにする
  App.pageIdx = App.project.pages.indexOf(sp);
  applySheet(sp);
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 250));
  const bb = Editor.svg.getBoundingClientRect();
  return { bb: [bb.left, bb.top], view: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
});
const S2 = (x, y) => ({ x: setup2.bb[0] + setup2.view[0] + x * setup2.view[2], y: setup2.bb[1] + setup2.view[1] + y * setup2.view[2] });
const clickBox2 = async (find) => {
  const c = await p.evaluate((f) => {
    const o = (Editor.specBoxes || []).find(new Function("o", `return ${f}`));
    return o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null;
  }, find);
  if (!c) return false;
  const s = S2(c.x, c.y);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(150);
  return true;
};

R.sheet2 = await p.evaluate(() => {
  const pg = curPage();
  const svg = kindSVG(pg);
  const want = ["電源・環境仕様", "供給電源電圧", "AC100V", "AC200V", "御社環境温度レンジ",
    "定常時", "非定常時", "制御盤冷却方法", "ファン", "盤クーラー", "エアーパージ",
    "外部 I/F (複数チェック可)", "上流", "下流", "他装置"];
  return { missing: want.filter(t => !svg.includes(t)),
    // 1 枚目の見出しが出ていないこと (様式が入れ替わっている)
    notSheet1: !svg.includes("制御盤筐体仕様") && !svg.includes("保護等級"),
    sheetNo: SPEC_SHEETS.length };
});

// 外部 I/F を 2 つチェック → 1 つ外す
await clickBox2('o.k === "extif" && o.i === 0');
await clickBox2('o.k === "extif" && o.i === 2');
R.multi = { on: await p.evaluate(() => [...specMultiSel(curPage().spec, "extif")]) };
await clickBox2('o.k === "extif" && o.i === 0');
R.multi.off = await p.evaluate(() => [...specMultiSel(curPage().spec, "extif")]);
R.multi.drawn = await p.evaluate(() => {
  const svg = kindSVG(curPage());
  return (svg.match(/<ellipse /g) || []).length;
});

// 非定常時: 温度と理由を書く (プロンプトは 2 回)
await p.evaluate(() => {
  const answers = ["0℃ ー 45℃", "洗浄"];
  let i = 0;
  window.prompt = () => answers[i++];
});
R.tempFill = { clicked: await clickBox2('o.memo === "temp_ab"') };
R.tempFill.after = await p.evaluate(() => {
  const pg = curPage();
  return { a: pg.spec.memo.temp_ab, b: pg.spec.memo.temp_why,
    drawn: kindSVG(pg).includes("0℃ ー 45℃ (洗浄 実施の為)") };
});

// 定常時の欄
await p.evaluate(() => { window.prompt = () => "5℃ ー 40℃"; });
R.fieldCell = { clicked: await clickBox2('o.memo === "temp_std"') };
R.fieldCell.after = await p.evaluate(() => ({
  memo: curPage().spec.memo.temp_std,
  drawn: kindSVG(curPage()).includes("5℃ ー 40℃"),
}));

const checks = {
  noPageErrors: errs.length === 0,
  ipNone: R.form.ipOpts[7] === "指定無し" && R.ipNone.picked === true && R.ipNone.sel === 7,
  matMemo: R.matMemo.sel === 0 && R.matMemo.bad === false && R.matMemo.good === true && R.form.feMemoAt === 1,
  pwrOpts: R.form.pwrOpts.length === 2 && /端子台/.test(R.form.pwrOpts[0])
    && /アメリカン電機/.test(R.form.pwrOpts[1]) && /3112N/.test(R.form.pwrOpts[1]) && /3M/.test(R.form.pwrOpts[1]),
  pwrPick: R.pwrPick.picked === true && R.pwrPick.sel === 1,
  pwrMemo: R.pwrMemo.clicked === true && R.pwrMemo.after.memo === "盤上部より 3φ3W 直入れ"
    && R.pwrMemo.after.drawn === true,
  memoCells: JSON.stringify(R.memoCells.keys) === JSON.stringify(["env", "mat_fe", "pwr", "tube", "tube_dir"]),
  newProj: R.newProj.specs === 2,
  sheet2: R.sheet2.missing.length === 0 && R.sheet2.notSheet1 === true && R.sheet2.sheetNo === 2,
  multi: JSON.stringify(R.multi.on) === JSON.stringify([0, 2])
    && JSON.stringify(R.multi.off) === JSON.stringify([2]) && R.multi.drawn >= 1,
  tempFill: R.tempFill.clicked === true && R.tempFill.after.a === "0℃ ー 45℃"
    && R.tempFill.after.b === "洗浄" && R.tempFill.after.drawn === true,
  fieldCell: R.fieldCell.clicked === true && R.fieldCell.after.memo === "5℃ ー 40℃"
    && R.fieldCell.after.drawn === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("spec-form OK");
