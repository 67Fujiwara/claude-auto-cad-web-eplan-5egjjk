/* 仕様シートの記入まわり。

   ・ipNone   : 保護等級に「指定無し」がある (8 番) — 選ぶと ◯ が付く
   ・matMemo  : 指定色を書いた後で 1 番 (標準色) を選んでも、標準色の欄に
                指定色が出ない (記入は 2 番の括弧だけに入る)
   ・pwrOpts  : 電源接続方法が 2 択 (端子台 / コネクター接続 3112N 配線長 3M)
   ・pwrPick  : その番号をクリックすると ◯ が移る
   ・pwrMemo  : 御社指定方法の欄を図面の上でクリックすると書き込め、図面に出る
   ・memoCells: 特記事項・指定色・チューブ長の欄もクリックで書ける */
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
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("spec-form OK");
