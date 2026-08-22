/* キーエンス KV Nano シリーズ (KV-N14AT / KV-N24AT / KV-N40AT) の入出力結線図。

   要求は「用紙 1 枚 = 記号 1 個」。結線図を用紙ごとに作り直さず、機種の記号を
   差し替えれば端子構成ごと入れ替わる状態にすること。用紙は
     ・16 点まで      … A3 横 1:1 / 1 列
     ・24 点以上      … A3 縦 1:2 / 2 列 (左=入力・右=出力)

   1:2 の用紙は作図領域が実寸の 2 倍になるので、記号も 2 倍で作る。こうすると
   紙の上の見え方 (行ピッチ 15mm・文字 2.5mm・線 0.5mm) が 1:1 の図と揃う。
   端子番号やタグはアプリが描くので、記号の倍率 (textK) に合わせて一緒に
   大きくしないと紙の上で 1.25mm になってしまう — そこも見る。

   判定
   ・3 機種の点数と端子番号が実機どおりであること (入力 R000〜 / 出力 R500〜、
     16 点で次のチャネルへ繰り上がる)
   ・想定の用紙 (A3 横 1:1 / A3 縦 1:2) の図枠に収まり、表題欄に掛からないこと
   ・紙の上の寸法が機種によらず同じであること (行ピッチ 15mm・文字 2.5mm)
   ・端子番号・タグも記号と同じ倍率で描かれること (1:2 で 1.25mm にならない)
   ・尺度の検図が、実際に描かれている文字・線を測って判定すること
     (普通の記号を 1:2 に置いたら今までどおりエラー)
   ・正しく置いた図では検図が 1 件も出ないこと (未使用の入出力点は警告しない)
   ・機種を差し替えても置き直しが要らないこと (原点とピンの並びが同じ規則)
   ・部品表に 1 台として出ること・DXF に端子番号が出ること */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = { model: {}, sheet: {}, print: {} };
  const SPEC = {
    kv_n14at: { model: "KV-N14AT", in: 8, out: 6, paper: "A3", orient: "landscape", scale: "1:1", k: 1 },
    kv_n24at: { model: "KV-N24AT", in: 14, out: 10, paper: "A3", orient: "portrait", scale: "1:2", k: 2 },
    kv_n40at: { model: "KV-N40AT", in: 24, out: 16, paper: "A3", orient: "portrait", scale: "1:2", k: 2 },
  };
  out.spec = SPEC;

  // ① 点数と端子番号 (KV のリレー番号は 16 点で次のチャネルへ繰り上がる)
  Object.entries(SPEC).forEach(([id, sp]) => {
    const sym = symOf(id);
    if (!sym) { out.model[id] = "記号がありません"; return; }
    const ins = sym.pins.filter(x => /^R[0-4]/.test(x.n)).map(x => x.n);
    const outs = sym.pins.filter(x => /^R5/.test(x.n)).map(x => x.n);
    const want = [];
    for (let i = 0; i < sp.in; i++) want.push(`R${Math.floor(i / 16)}${String(i % 16).padStart(2, "0")}`);
    const wantOut = [];
    for (let i = 0; i < sp.out; i++) wantOut.push(`R${5 + Math.floor(i / 16)}${String(i % 16).padStart(2, "0")}`);
    out.model[id] = {
      typ: sym.typ, sheet: sym.sheet, textK: sym.textK,
      inOk: ins.join(",") === want.join(","), outOk: outs.join(",") === wantOut.join(","),
      ins: ins.length, outs: outs.length,
      aux: sym.pins.filter(x => !/^R/.test(x.n)).map(x => x.n).join(","),
      lastIn: ins[ins.length - 1], lastOut: outs[outs.length - 1],
      noDrc: !!sym.noDrc, parts: (sym.parts || []).length,
    };
  });

  // ② 想定の用紙に収まるか / 検図が出ないか
  App.project = newProject("KV Nano 入出力結線図");
  const pages = {};
  Object.entries(SPEC).forEach(([id, sp], i) => {
    const pg = i === 0 ? App.project.pages[0] : (() => {
      const q = newPage(sp.model, App.project.pages.length + 1); App.project.pages.push(q); return q;
    })();
    pg.name = `${sp.model} 入出力結線図`;
    pg.paper = sp.paper; pg.orient = sp.orient; pg.scale = sp.scale;
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    const fr = frameRect();
    // 図枠の左上へ寄せて置く (置き方の目安)
    const d = addDevice(pg, id, fr.x + 20 * sp.k, fr.y + 4 * sp.k, { tag: `-A${i + 1}` });
    pages[id] = { pg, d };
    const bb = devPartBoxes(d), tb = titleBlocksRects();
    const inFrame = bb.every(x => x.x >= fr.x && x.y >= fr.y && x.x + x.w <= fr.x + fr.w && x.y + x.h <= fr.y + fr.h);
    const onBlock = bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y));
    // 紙の上の寸法 (作図領域 mm ÷ 尺度)
    const f = SHEET.f;
    const rows = d && symOf(id).pins.filter(x => /^R/.test(x.n));
    const pitch = (rows[1].y - rows[0].y) / f;
    const m = pageDrawnMinima(pg);
    out.sheet[id] = { inFrame, onBlock, paper: `${SHEET.w}x${SHEET.h}`,
      printed: `${(devBounds(d).w / f).toFixed(0)}x${(devBounds(d).h / f).toFixed(0)}` };
    out.print[id] = { pitch, minText: +(m.h / f).toFixed(3), minLine: +(m.w / f).toFixed(3),
      pinLabel: +(pinLabelPos(pg, d, 0).size / f).toFixed(2) };
  });
  App.labelRev++;
  out.drc = runDRC().map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`);

  // ③ 普通の記号を 1:2 に置いたら、今までどおり尺度の検図が出ること
  const q = newPage("普通の記号", App.project.pages.length + 1);
  q.paper = "A3"; q.orient = "portrait"; q.scale = "1:2";
  App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1; applySheet(q);
  addDevice(q, "coil", 100, 100, { tag: "-K9" });
  App.labelRev++;
  out.plainScale = runDRC().filter(i => i.rule === "尺度と用紙上の寸法" && i.page === q.no).length;
  App.project.pages.pop();

  /* ④ 機種の差し替え。記号を替えるだけで端子構成が入れ替わり、用紙が変わる
     機種でも「この用紙にする」の 1 押しで済むこと (結線図を描き直さない) */
  const t = pages.kv_n14at;
  App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  const before = { pins: devPins(t.d).length, sheet: `${t.pg.paper}/${t.pg.orient}/${t.pg.scale}` };
  t.d.sym = "kv_n24at";                       // ← プロパティで機種を差し替えたのと同じ
  App.labelRev++;
  const warn = runDRC().filter(i => i.target === t.d.id && i.rule === "記号の想定用紙と違う");
  out.swap = { before, warned: warn.length, msg: (warn[0] || {}).msg || "" };
  out.swap.pins = devPins(t.d).length;
  t.d.sym = "kv_n14at"; App.labelRev++;        // 元へ戻してから残りを見る

  // ⑤ 部品表 (1 台として出る) と DXF (端子番号が出る)
  out.bom = buildBOM().filter(r => /KV-N/.test(r.typeRef)).map(r => `${r.typeRef}x${r.tags.length}`).join(" ");
  App.pageIdx = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n40at"));
  const pg40 = App.project.pages[App.pageIdx]; applySheet(pg40);
  const dxf = pageToDXF(pg40);
  out.dxf = { r107: /\n1\nR107\n/.test(dxf), r515: /\n1\nR515\n/.test(dxf), com: /\n1\nCOM-IN\n/.test(dxf),
    // 端子番号の文字高さも記号と同じ倍率 (紙の上で 2.5mm)
    size: (dxf.split("\n0\nTEXT\n").find(s => s.includes("\n1\nR107\n")) || "").match(/\n40\n([\d.]+)/)?.[1] };
  return out;
});
console.log(JSON.stringify(R, null, 1));

/* 用紙の切り替えは、記号を差し替えたあとプロパティの「この用紙にする」1 押しで
   済むこと (結線図そのものは描き直さない) */
const U = await p.evaluate(() => {
  const f = App.project.pages.findIndex(pg => pg.devices.some(d => /^kv_/.test(d.sym)));
  App.pageIdx = f; applySheet(curPage());
  const dev = curPage().devices.find(d => /^kv_/.test(d.sym));
  dev.sym = "kv_n40at";                       // 14 点 → 40 点へ差し替え (用紙が変わる機種)
  App.selection.clear(); App.selection.add(dev.id);
  App.labelRev++; UI.showProps();
  return { before: `${curPage().paper}/${curPage().orient}/${curPage().scale}`,
    hasButton: !!document.querySelector("#pSheetFix") };
});
// ボタンが出ない (= 用紙違いを検出できていない) ときは、そのまま判定へ落とす
const hasFix = await p.waitForSelector("#pSheetFix", { timeout: 4000 }).then(() => true).catch(() => false);
if (hasFix) { await p.click("#pSheetFix"); await p.waitForTimeout(400); }
const U2 = await p.evaluate(() => {
  const pg = curPage();
  const dev = pg.devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  const fr = frameRect(), bb = devPartBoxes(dev), tb = titleBlocksRects();
  return { after: `${pg.paper}/${pg.orient}/${pg.scale}`,
    inFrame: bb.every(x => x.x >= fr.x && x.y >= fr.y && x.x + x.w <= fr.x + fr.w && x.y + x.h <= fr.y + fr.h),
    onBlock: bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y)),
    drc: runDRC().filter(i => i.target === dev.id).map(i => `${i.sev}:${i.rule}`),
    stillOne: pg.devices.filter(d => /^kv_/.test(d.sym)).length,
    // 用紙を合わせたあとは「この用紙です」に変わる
    fixedAway: !document.querySelector("#pSheetFix") };
});
console.log("用紙の切り替え:", JSON.stringify({ ...U, ...U2 }, null, 1));

const ids = ["kv_n14at", "kv_n24at", "kv_n40at"];
const checks = {
  // 機種の仕様どおりか
  models: ids.every(id => R.model[id] && R.model[id].inOk && R.model[id].outOk &&
    R.model[id].ins === R.spec[id].in && R.model[id].outs === R.spec[id].out),
  // 16 点で次のチャネルへ繰り上がる (KV のリレー番号)
  relayCarry: R.model.kv_n40at.lastIn === "R107" && R.model.kv_n40at.lastOut === "R515" &&
    R.model.kv_n24at.lastIn === "R013" && R.model.kv_n14at.lastIn === "R007",
  // 電源・コモン端子が付いていること
  auxTerminals: ids.every(id => /L,N,PE/.test(R.model[id].aux) && /COM-IN/.test(R.model[id].aux) &&
    /COM-OUT/.test(R.model[id].aux)),
  // 想定の用紙 (16 点まで A3 横 1:1 / それ以上は A3 縦 1:2 の 2 列)
  sheetChoice: R.model.kv_n14at.sheet === "A3 横 1:1" && R.model.kv_n14at.textK === 1 &&
    R.model.kv_n24at.sheet === "A3 縦 1:2" && R.model.kv_n24at.textK === 2 &&
    R.model.kv_n40at.sheet === "A3 縦 1:2" && R.model.kv_n40at.textK === 2 &&
    R.model.kv_n24at.parts === 2 && R.model.kv_n40at.parts === 2 && R.model.kv_n14at.parts === 1,
  // 図枠に収まり、表題欄に掛からない
  fitsSheet: ids.every(id => R.sheet[id].inFrame && !R.sheet[id].onBlock),
  // 紙の上の見え方が機種によらず同じ (行ピッチ 15mm・文字 2.5mm・線 0.5mm)
  printedSame: ids.every(id => R.print[id].pitch === 15 && R.print[id].minText >= 2.5 - 0.001 &&
    R.print[id].minLine >= 0.25 - 0.001 && R.print[id].pinLabel === 2.5),
  // 未使用の入出力点は警告しない。正しく置いた図は検図 0 件
  drcClean: R.drc.length === 0 && ids.every(id => R.model[id].noDrc),
  // 尺度の検図は生きている (普通の記号を 1:2 に置けば出る)
  scaleRuleAlive: R.plainScale === 1,
  // 機種を差し替えると端子構成ごと入れ替わり、用紙違いは検図が知らせる
  swapModel: R.swap.pins === 29 && R.swap.warned === 1 && /A3 縦 1:2 用の記号です/.test(R.swap.msg),
  // 用紙の切り替えはプロパティの 1 押しで済み、そのあと図枠に収まる
  sheetFixButton: U.hasButton === true && hasFix === true && U2.after === "A3/portrait/1:2" &&
    U2.inFrame && !U2.onBlock && U2.drc.length === 0 && U2.stillOne === 1 && U2.fixedAway === true,
  // 部品表は 1 台ずつ / DXF に端子番号が出る
  bom: R.bom === "KV-N14ATx1 KV-N24ATx1 KV-N40ATx1",
  dxf: R.dxf.r107 && R.dxf.r515 && R.dxf.com && parseFloat(R.dxf.size) === 5,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
