/* 仕様シートの記入まわり。

   ・ipNone   : 保護等級に「指定無し」がある (8 番) — 選ぶと ◯ が付く
   ・matMemo  : 指定色を書いた後で 1 番 (標準色) を選んでも、標準色の欄に
                指定色が出ない (記入は 2 番の括弧だけに入る)
   ・pwrOpts  : 電源接続方法が 2 択 (端子台 / コネクター接続 3112N 配線長 3M)
   ・pwrPick  : その番号をクリックすると ◯ が移る
   ・pwrMemo  : 御社指定方法の欄を図面の上でクリックすると書き込め、図面に出る
   ・memoCells: 特記事項・指定色・チューブ長の欄もクリックで書ける
   ・sheet2   : 仕様は 2 枚目があり、1 枚目と別の様式 (供給電源電圧・
                制御盤冷却方法・外部 I/F) で描かれる。温度レンジの欄は無い
   ・newProj  : 新しい図面には仕様が 2 枚入る
   ・multi    : 外部 I/F は複数チェックでき、もう一度押すと外れる
   ・ifDetail : チェックした I/F ごとに詳細の箇条書き欄が出て、クリックで書ける。
                外すとその行も消える
   ・ifGrow   : 1 行書き込むと追記用の空き行が増える — 同じ I/F が複数あっても
                続けて書ける
   ・ifCompact: 途中の行を消すと後ろの行が詰まる (空きの枠が残らない)
   ・matOne   : 材質は鉄・ステンレスのどれか 1 つ — 片方を選ぶと
                もう片方の ◯ が消える。新規図面はステンレス側が未選択
   ・supPhase : AC200V の行に単相/3相の小 2 択。3相を押すと ◯ が付き
                AC200V も選ばれる。AC100V に移すと単相/3相は外れる
   ・supNote  : 供給電源電圧の表の下に備考欄 — クリックで書き込め、図面に出る */
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
  const want = ["電源・環境仕様", "供給電源電圧", "AC100V", "AC200V",
    "制御盤冷却方法", "ファン", "盤クーラー", "エアーパージ",
    "外部 I/F (複数チェック可)", "上流", "下流", "他装置", "詳細 (チェックした I/F ごとに記入)"];
  return { missing: want.filter(t => !svg.includes(t)),
    // 温度レンジの欄は無くした
    noTemp: !svg.includes("御社環境温度レンジ") && !svg.includes("非定常時"),
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

/* 外部 I/F の詳細 (箇条書き)。チェックした項目ぶんだけ行が出る */
R.ifDetail = await p.evaluate(() => {
  const svg = kindSVG(curPage());
  return { rows: (svg.match(/・(上流|下流|他装置):/g) || []).length,
    picked: [...specMultiSel(curPage().spec, "extif")] };
});
await p.evaluate(() => { window.prompt = () => "検査装置と Ethernet 接続"; });
R.ifDetail.clicked = await clickBox2('o.memo === "extif_2"');
R.ifDetail.after = await p.evaluate(() => ({
  memo: curPage().spec.memo.extif_2,
  drawn: kindSVG(curPage()).includes("・他装置: 検査装置と Ethernet 接続"),
}));
/* 1 行書き込んだので、追記用の空き行が増えているはず */
R.ifGrow = await p.evaluate(() => ({
  boxes: (Editor.specBoxes || []).filter(o => o.memo && o.memo.startsWith("extif_2")).map(o => o.memo),
  rows: (kindSVG(curPage()).match(/・他装置:/g) || []).length,
}));
await p.evaluate(() => { window.prompt = () => "PLC リンク (2 台目)"; });
R.ifGrow.clicked = await clickBox2('o.memo === "extif_2_1"');
R.ifGrow.after = await p.evaluate(() => ({
  memo: curPage().spec.memo.extif_2_1,
  rows: (kindSVG(curPage()).match(/・他装置:/g) || []).length,
  drawn: kindSVG(curPage()).includes("・他装置: PLC リンク (2 台目)"),
}));
// 途中の行 (1 行目) を消すと、2 行目が繰り上がる
await p.evaluate(() => { window.prompt = () => ""; });
R.ifCompact = { clicked: await clickBox2('o.memo === "extif_2"') };
R.ifCompact.after = await p.evaluate(() => ({
  first: curPage().spec.memo.extif_2 || null,
  second: curPage().spec.memo.extif_2_1 || null,
  rows: (kindSVG(curPage()).match(/・他装置:/g) || []).length,
}));

// チェックを外すと、その行も消える
await clickBox2('o.k === "extif" && o.i === 2');
R.ifDetail.afterUncheck = await p.evaluate(() => {
  const svg = kindSVG(curPage());
  return { has: svg.includes("・他装置:"), rows: (svg.match(/・(上流|下流|他装置):/g) || []).length };
});

/* ── 材質どれかのみ / AC200V 単相・3相 / 供給電源電圧の備考 ── */
const goSpec = async (i) => {
  await p.evaluate((i2) => {
    const sp = App.project.pages.filter(q => q.kind === "spec")[i2];
    App.pageIdx = App.project.pages.indexOf(sp); applySheet(sp); UI.refresh(true); zoomFit();
  }, i);
  await p.waitForTimeout(250);
  const st = await p.evaluate(() => {
    const bb = Editor.svg.getBoundingClientRect();
    return { bb: [bb.left, bb.top], view: [Editor.view.tx, Editor.view.ty, Editor.view.s] };
  });
  return async (find) => {
    const c = await p.evaluate((f) => {
      const o = (Editor.specBoxes || []).find(new Function("o", `return ${f}`));
      return o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null;
    }, find);
    if (!c) return false;
    await p.mouse.click(st.bb[0] + st.view[0] + c.x * st.view[2], st.bb[1] + st.view[1] + c.y * st.view[2]);
    await p.waitForTimeout(150);
    return true;
  };
};
const clickS1 = await goSpec(0);
R.matOne = { def: await p.evaluate(() => {
  const d = defaultSpec().sel; return { fe: d.mat_fe, sus: d.mat_sus }; }) };
R.matOne.pickSus = await clickS1('o.k === "mat_sus" && o.i === 2');
R.matOne.afterSus = await p.evaluate(() => ({ fe: curPage().spec.sel.mat_fe, sus: curPage().spec.sel.mat_sus }));
R.matOne.pickFe = await clickS1('o.k === "mat_fe" && o.i === 0');
R.matOne.afterFe = await p.evaluate(() => ({ fe: curPage().spec.sel.mat_fe, sus: curPage().spec.sel.mat_sus }));

const clickS2 = await goSpec(1);
R.supPhase = { def: await p.evaluate(() => defaultSpec().sel.sup_v_ph) };
R.supPhase.pick3 = await clickS2('o.k === "sup_v_ph" && o.i === 1');
R.supPhase.after = await p.evaluate(() => ({ v: curPage().spec.sel.sup_v, ph: curPage().spec.sel.sup_v_ph,
  drawn: kindSVG(curPage()).includes("3相") }));
R.supPhase.pick100 = await clickS2('o.k === "sup_v" && o.i === 0');
R.supPhase.off = await p.evaluate(() => ({ v: curPage().spec.sel.sup_v, ph: curPage().spec.sel.sup_v_ph }));

await p.evaluate(() => { window.prompt = () => "主幹 30A・漏電遮断器指定"; });
R.supNote = { clicked: await clickS2('o.memo === "sup_v_note"') };
R.supNote.after = await p.evaluate(() => ({ memo: curPage().spec.memo.sup_v_note,
  drawn: kindSVG(curPage()).includes("主幹 30A・漏電遮断器指定") }));

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
  sheet2: R.sheet2.missing.length === 0 && R.sheet2.notSheet1 === true
    && R.sheet2.noTemp === true && R.sheet2.sheetNo === 2,
  ifDetail: R.ifDetail.rows === 1 && R.ifDetail.clicked === true
    && R.ifDetail.after.memo === "検査装置と Ethernet 接続" && R.ifDetail.after.drawn === true
    && R.ifDetail.afterUncheck.has === false,
  ifGrow: JSON.stringify(R.ifGrow.boxes) === JSON.stringify(["extif_2", "extif_2_1"])
    && R.ifGrow.rows === 2 && R.ifGrow.clicked === true
    && R.ifGrow.after.memo === "PLC リンク (2 台目)" && R.ifGrow.after.rows === 3
    && R.ifGrow.after.drawn === true,
  ifCompact: R.ifCompact.clicked === true && R.ifCompact.after.first === "PLC リンク (2 台目)"
    && R.ifCompact.after.second === null && R.ifCompact.after.rows === 2,
  matOne: R.matOne.def.fe === 0 && R.matOne.def.sus === -1 &&
    R.matOne.pickSus === true && R.matOne.afterSus.fe === -1 && R.matOne.afterSus.sus === 2 &&
    R.matOne.pickFe === true && R.matOne.afterFe.fe === 0 && R.matOne.afterFe.sus === -1,
  supPhase: R.supPhase.def === -1 && R.supPhase.pick3 === true &&
    R.supPhase.after.v === 1 && R.supPhase.after.ph === 1 && R.supPhase.after.drawn === true &&
    R.supPhase.pick100 === true && R.supPhase.off.v === 0 && R.supPhase.off.ph === -1,
  supNote: R.supNote.clicked === true && R.supNote.after.memo === "主幹 30A・漏電遮断器指定" &&
    R.supNote.after.drawn === true,
  multi: JSON.stringify(R.multi.on) === JSON.stringify([0, 2])
    && JSON.stringify(R.multi.off) === JSON.stringify([2]) && R.multi.drawn >= 1,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("spec-form OK");
