/* キーエンス KV Nano シリーズ (KV-N14AT / KV-N24AT / KV-N40AT) の入出力結線図。

   要求は「用紙 1 枚 = 記号 1 個」。結線図を用紙ごとに作り直さず、機種の記号を
   差し替えれば端子構成ごと入れ替わる状態にすること。

   端子は 2 列 — 左が入力列、右が出力列 (信号は左から右へ)。用紙は入出力の
   合計点数で決める: 16 点まで A3 横、24 点以上 A3 縦。尺度はどちらも 1:1。
   このアプリは図記号を尺度に関わらず実寸で描くので、1:2 にすると線番・注記・
   現場機器の記号が紙の上で半分 (1.25mm) になり JIS Z 8313 の最小 2.5mm を割る。
   40 点でも A3 縦 1:1 に収まるので縮小しない。

   判定
   ・3 機種の点数と端子番号が実機どおりであること (入力 R000〜 / 出力 R500〜、
     16 点で次のチャネルへ繰り上がる)
   ・入力は左・出力は右に出ること (信号の流れ)
   ・想定の用紙 (A3 横 1:1 / A3 縦 1:1) の図枠に収まり、表題欄に掛からないこと。
     現場機器を並べる余地が左右に残ること
   ・紙の上の寸法が機種によらず同じであること (行ピッチ 15mm・文字 2.5mm・線 0.5mm)
   ・未使用の入出力点は警告しないが、電源 (L/N)・コモン・保護接地の結び忘れは
     必ず警告すること (ピン単位の除外)。PE には接地の図記号が付くこと
   ・実際に結線した図 (現場機器 + 線番 + 電源・コモン結線) で検図が 0 件になること
   ・尺度の検図が、実際に描かれている文字・線を測って判定すること
     (普通の記号・破線枠・data-h の無い文字を 1:2 に置いたらエラー)
   ・プロパティのプルダウンで機種を差し替えられ、用紙が変わる機種でも
     「この用紙にする」1 押しで用紙が合い、つないだ配線が外れないこと
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
    kv_n14at: { model: "KV-N14AT", in: 8, out: 6, paper: "A3", orient: "landscape" },
    kv_n24at: { model: "KV-N24AT", in: 14, out: 10, paper: "A3", orient: "portrait" },
    // 40 点は 24 行 × 15mm で A3 縦の表題欄まで届くので A2 縦へ (縮小はしない)
    kv_n40at: { model: "KV-N40AT", in: 24, out: 16, paper: "A2", orient: "portrait" },
  };
  out.spec = SPEC;

  // ① 点数と端子番号 (KV のリレー番号は 16 点で次のチャネルへ繰り上がる)
  Object.entries(SPEC).forEach(([id, sp]) => {
    const sym = symOf(id);
    if (!sym) { out.model[id] = "記号がありません"; return; }
    const ins = sym.pins.filter(x => /^R[0-4]/.test(x.n)), outs = sym.pins.filter(x => /^R5/.test(x.n));
    const want = [], wantOut = [];
    for (let i = 0; i < sp.in; i++) want.push(`R${Math.floor(i / 16)}${String(i % 16).padStart(2, "0")}`);
    for (let i = 0; i < sp.out; i++) wantOut.push(`R${5 + Math.floor(i / 16)}${String(i % 16).padStart(2, "0")}`);
    const aux = sym.pins.filter(x => !/^R/.test(x.n));
    out.model[id] = {
      typ: sym.typ, sheet: symSheetSpec(sym), swapGroup: sym.swapGroup,
      inOk: ins.map(x => x.n).join(",") === want.join(","),
      outOk: outs.map(x => x.n).join(",") === wantOut.join(","),
      ins: ins.length, outs: outs.length,
      lastIn: ins[ins.length - 1].n, lastOut: outs[outs.length - 1].n,
      // 入力は左端 (x=0)・出力は右端。信号は左から右へ流れる
      // 入力は左端、出力は右端 (箱をはさんで反対側に出ていること)
      inLeft: ins.every(x => x.x === 0),
      outRight: outs.every(x => x.x >= 40) && outs.every(x => x.x === outs[0].x),
      aux: aux.map(x => x.n).join(","),
      // 入出力点だけ未接続の検図から外す (電源・コモン・PE は外さない)
      ioSkipped: ins.concat(outs).every(x => x.noDrc === true) && aux.every(x => !x.noDrc),
      // 保護接地の図記号 (JIS C 0617-2 02-15-03) が付いているか
      peEarth: /M[\d.-]+,[\d.-]+ V/.test(sym.body) && aux.some(x => x.n === "PE"),
      textK: symTextK(sym), ink: (sym.inkBoxes || []).length,
    };
  });

  // ② 想定の用紙に収まるか / 現場機器を並べる余地があるか
  App.project = newProject("KV Nano 入出力結線図");
  const pages = {};
  Object.entries(SPEC).forEach(([id, sp], i) => {
    const sym = symOf(id), want = symSheetSpec(sym);
    const pg = i === 0 ? App.project.pages[0] : (() => {
      const q = newPage(sp.model, App.project.pages.length + 1); App.project.pages.push(q); return q;
    })();
    pg.name = `${sp.model} 入出力結線図`;
    pg.paper = want.paper; pg.orient = want.orient; pg.scale = want.scale;
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    const fr = frameRect(), tb = titleBlocksRects();
    // 表題欄を避けて左寄りに置く (24 点以上は列が長いので右へ寄せられない)
    const d = addDevice(pg, id, fr.x + 70, fr.y + 5, { tag: `-A${i + 1}` });
    pages[id] = { pg, d, sym };
    const bb = devPartBoxes(d), bd = devBounds(d);
    out.sheet[id] = {
      inFrame: bd.x >= fr.x && bd.y >= fr.y && bd.x + bd.w <= fr.x + fr.w && bd.y + bd.h <= fr.y + fr.h,
      onBlock: bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y)),
      // 現場機器を並べる余地 (左=入力機器 / 右=負荷)
      leftRoom: Math.round(bd.x - fr.x), rightRoom: Math.round(fr.x + fr.w - (bd.x + bd.w)),
      size: `${Math.round(bd.w)}x${Math.round(bd.h)}`,
    };
    const rows = sym.pins.filter(x => /^R0/.test(x.n));
    const m = pageDrawnMinima(pg);
    out.print[id] = { pitch: rows[1].y - rows[0].y, minText: +m.h.toFixed(3), minLine: +m.w.toFixed(3),
      pinLabel: +pinLabelPos(pg, d, 0).size.toFixed(2) };
  });
  App.labelRev++;

  // ③ 置いただけの状態: 入出力点は黙るが、電源・コモン・PE は知らせる
  const un = runDRC().filter(i => /未接続/.test(i.msg));
  out.unconnected = { total: un.length,
    names: [...new Set(un.map(i => (/ピン (\S+)/.exec(i.msg) || [])[1]))].sort().join(","),
    // 同じ名前の端子 (COM が入力側と出力側に 1 つずつ) を区分で見分けられること
    comRows: un.filter(i => /ピン COM \(/.test(i.msg)).length };

  /* ④ 実際に結線した図で検図が 0 件になること。
     入力に近接センサ、出力に電磁弁、電源・コモン・PE を電位リンクと接地へ */
  const t = pages.kv_n14at;
  App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  const pinOf = (n) => { const i = t.sym.pins.findIndex(q => q.n === n); return { i, ...devPins(t.d)[i] }; };
  const link = (n, tag, dx) => {
    const p0 = pinOf(n);
    addWire(t.pg, [[p0.x, p0.y], [p0.x + dx, p0.y]]);
    return addDevice(t.pg, tag === "PE" ? "prot_earth" : "link", p0.x + dx, p0.y, tag === "PE" ? {} : { tag });
  };
  link("L", "L1", -25); link("N", "N1", 25); link("PE", "PE", 25);
  link("COM", "P24V", -25);                       // 入力コモン (左列)
  const comOut = t.sym.pins.map((q, i) => ({ q, i })).filter(x => x.q.n === "COM").pop();
  const co = devPins(t.d)[comOut.i];
  addWire(t.pg, [[co.x, co.y], [co.x + 25, co.y]]);
  addDevice(t.pg, "link", co.x + 25, co.y, { tag: "0V" });
  // 入力 R000 に近接センサ / 出力 R500 に電磁弁
  const r000 = pinOf("R000"), r500 = pinOf("R500");
  const fr0 = frameRect();
  const sens = addDevice(t.pg, "prox", fr0.x + 25, r000.y - 10, { tag: "-B1" });
  const sp = devPins(sens);
  const sig = sp.find(q => q.name === "BK") || sp[sp.length - 1];
  const w1 = addWire(t.pg, [[sig.x, sig.y], [r000.x, r000.y]]);
  if (w1) w1.num = "101";
  // センサの電源線 (茶=+24V / 青=0V) も描いて結線図を完成させる
  sp.filter(q => q !== sig).forEach(q => {
    addWire(t.pg, [[q.x, q.y], [q.x, q.y + 20]]);
    addDevice(t.pg, "link", q.x, q.y + 20, { tag: q.name === "BN" ? "P24V" : "0V" });
  });
  const val = addDevice(t.pg, "sol_valve", r500.x + 50, r500.y, { tag: "-Y1" });
  const vp = devPins(val);
  const w2 = addWire(t.pg, [[r500.x, r500.y], [vp[0].x, vp[0].y]]);
  if (w2) w2.num = "201";
  // 負荷の帰り線 (シンク出力なので +24V へ戻す)
  addWire(t.pg, [[vp[1].x, vp[1].y], [vp[1].x, vp[1].y + 15]]);
  addDevice(t.pg, "link", vp[1].x, vp[1].y + 15, { tag: "P24V" });
  App.labelRev++;
  out.wired = runDRC().filter(i => i.page === t.pg.no).map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`);

  // ⑤ 尺度の検図: 記号の大きさを見ずに決め打ちしていないか / 取りこぼしが無いか
  const mk12 = (name, fn) => {
    const q = newPage(name, App.project.pages.length + 1);
    q.paper = "A3"; q.orient = "portrait"; q.scale = "1:2";
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1; applySheet(q);
    fn(q); App.labelRev++;
    const n = runDRC().filter(i => i.rule === "尺度と用紙上の寸法" && i.page === q.no).length;
    App.project.pages.pop();
    return n;
  };
  out.scale = { plain: mk12("普通の記号", q => addDevice(q, "coil", 100, 100, { tag: "-K9" })) };
  /* 破線枠・作図線の細線 (0.25mm) と、data-h を持たない文字も測っているか。
     測っていないと、縮小尺度でこれらが JIS の下限を割っても検図が黙る */
  {
    const q = newPage("細線の測り方", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1; applySheet(q);
    addDevice(q, "kv_n14at", 60, 20, { tag: "-A9" });
    const base = pageDrawnMinima(q);
    q.zones = [{ id: uid("z"), x: 60, y: 60, w: 100, h: 60, label: "盤内" }];
    const withZone = pageDrawnMinima(q);
    addWire(q, [[200, 60], [260, 60]]).style = "dashed";
    const withAux = pageDrawnMinima(q);
    out.thin = { base: +base.w.toFixed(3), zone: +withZone.w.toFixed(3), aux: +withAux.w.toFixed(3) };
    // data-h を持たない文字 (取り込み図面など) は font-size から見積もる
    const fake = { id: "kv_fake", pins: [], bounds: [0, 0, 10, 10],
      body: `<text x="0" y="0" font-size="1.2">x</text>`, cat: "misc", name: "f" };
    out.noDataH = +symDrawnMinima(fake).h.toFixed(3);
    App.project.pages.pop();
  }
  App.pageIdx = 0; applySheet(curPage());

  // ⑥ 部品表 (1 台として出る) と DXF (端子番号が出る)
  out.bom = buildBOM().filter(r => /KV-N/.test(r.typeRef)).map(r => `${r.typeRef}x${r.tags.length}`).join(" ");
  App.pageIdx = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n40at"));
  applySheet(curPage());
  const dxf = pageToDXF(curPage());
  out.dxf = { r107: /\n1\nR107\n/.test(dxf), r515: /\n1\nR515\n/.test(dxf), pe: /\n1\nPE\n/.test(dxf),
    size: (dxf.split("\n0\nTEXT\n").find(s2 => s2.includes("\n1\nR107\n")) || "").match(/\n40\n([\d.]+)/)?.[1] };
  return out;
});
console.log(JSON.stringify(R, null, 1));

/* 機種の差し替えと用紙合わせ。プロパティのプルダウンで機種を替え、
   「この用紙にする」を 1 押しすれば用紙が合い、結線は外れない */
const U = await p.evaluate(() => {
  const f = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n14at"));
  App.pageIdx = f; applySheet(curPage());
  const dev = curPage().devices.find(d => d.sym === "kv_n14at");
  App.selection.clear(); App.selection.add(dev.id);
  UI.showProps();
  return { hasSwap: !!document.querySelector("#pSwap"), tag: dev.tag,
    wires: curPage().wires.length };
});
const hasSwap = await p.waitForSelector("#pSwap", { timeout: 4000 }).then(() => true).catch(() => false);
if (hasSwap) {
  await p.selectOption("#pSwap", "kv_n40at");   // 14 点 → 40 点 (用紙が変わる機種)
  await p.waitForTimeout(300);
}
Object.assign(U, await p.evaluate(() => {
  const dev = curPage().devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  return { swapped: symOf(dev.sym).typ, pins: dev && symOf(dev.sym).pins.length,
    keptTag: dev.tag === "-A1",
    sheetErr: runDRC().filter(i => i.rule === "記号の想定用紙と違う" && i.target === dev.id).length };
}));
const hasFix = await p.waitForSelector("#pSheetFix", { timeout: 4000 }).then(() => true).catch(() => false);
U.hasButton = hasFix;
if (hasFix) { await p.click("#pSheetFix"); await p.waitForTimeout(400); }
const U2 = await p.evaluate(() => {
  const pg = curPage();
  const dev = pg.devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  const fr = frameRect(), bb = devPartBoxes(dev), tb = titleBlocksRects(), bd = devBounds(dev);
  // つないである配線が端子から外れていないか (電源・コモン・現場機器)
  /* 入出力点の座標は機種によらず同じ規則なので、現場機器の結線は残る。
     電源・コモンは行数で位置が動くため外れるが、ピン単位の検図が知らせる */
  const pins = devPins(dev);
  const at = (n) => { const q = pins.find(x => x.name === n); return q && pg.wires.some(w =>
    [w.pts[0], w.pts[w.pts.length - 1]].some(e => Math.abs(q.x - e[0]) < 0.01 && Math.abs(q.y - e[1]) < 0.01)); };
  const un = runDRC().filter(i => i.target === dev.id && /未接続/.test(i.msg)).map(i => (/ピン (\S+)/.exec(i.msg) || [])[1]);
  return { after: `${pg.paper}/${pg.orient}/${pg.scale}`,
    inFrame: bd.x >= fr.x && bd.y >= fr.y && bd.x + bd.w <= fr.x + fr.w && bd.y + bd.h <= fr.y + fr.h,
    onBlock: bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y)),
    ioKept: at("R000") === true && at("R500") === true,
    auxTold: [...new Set(un)].sort().join(","),
    fixedAway: !document.querySelector("#pSheetFix") };
});
console.log("機種の差し替え:", JSON.stringify({ ...U, ...U2 }, null, 1));

/* 用紙を変えると図枠の原点も動く。ページの図形ぜんぶが図枠に追従すること
   (記号だけ動かすと、描いてある配線や注記だけが図枠に対してずれる)。
   置き直しでは、つないである配線の端点も一緒に動くこと */
const V = await p.evaluate(() => {
  const pg = curPage();
  const dev = pg.devices.find(d => /^kv_/.test(d.sym));
  // 用紙をいったん A1 縦 (余白 20mm) にして、図枠の原点をずらしておく
  pg.paper = "A1"; pg.orient = "portrait"; pg.scale = "1:1"; applySheet(pg);
  const fr0 = frameRect();
  const other = pg.devices.find(d => d.tag === "-B1");
  const rel0 = { x: other.x - fr0.x, y: other.y - fr0.y };
  App.selection.clear(); App.selection.add(dev.id); App.labelRev++; UI.showProps();
  return { before: `${pg.paper}/${pg.orient}`, frame0: `${fr0.x},${fr0.y}`, rel0 };
});
await p.waitForSelector("#pSheetFix");
await p.click("#pSheetFix");
await p.waitForTimeout(400);
const V2 = await p.evaluate(() => {
  const pg = curPage();
  const fr = frameRect();
  const other = pg.devices.find(d => d.tag === "-B1");
  return { after: `${pg.paper}/${pg.orient}`, frame: `${fr.x},${fr.y}`,
    rel: { x: other.x - fr.x, y: other.y - fr.y } };
});
// 置き直しでは配線の端点も一緒に動く (単体で確かめる)
const W = await p.evaluate(() => {
  const pg = curPage();
  const d = pg.devices.find(d2 => /^kv_/.test(d2.sym));
  const p0 = devPins(d)[0];
  const w = pg.wires.find(x => [x.pts[0], x.pts[x.pts.length - 1]]
    .some(e => Math.abs(e[0] - p0.x) < 0.01 && Math.abs(e[1] - p0.y) < 0.01));
  moveDeviceWithWires(pg, d, 15, 10);
  const q0 = devPins(d)[0];
  const still = w && [w.pts[0], w.pts[w.pts.length - 1]]
    .some(e => Math.abs(e[0] - q0.x) < 0.01 && Math.abs(e[1] - q0.y) < 0.01);
  moveDeviceWithWires(pg, d, -15, -10);
  return { hadWire: !!w, followed: !!still };
});
console.log("用紙追従:", JSON.stringify({ ...V, ...V2, ...W }, null, 1));

const ids = ["kv_n14at", "kv_n24at", "kv_n40at"];
const checks = {
  // 機種の仕様どおりか
  models: ids.every(id => R.model[id] && R.model[id].inOk && R.model[id].outOk &&
    R.model[id].ins === R.spec[id].in && R.model[id].outs === R.spec[id].out),
  // 16 点で次のチャネルへ繰り上がる (KV のリレー番号)
  relayCarry: R.model.kv_n40at.lastIn === "R107" && R.model.kv_n40at.lastOut === "R515" &&
    R.model.kv_n24at.lastIn === "R013" && R.model.kv_n14at.lastIn === "R007",
  // 入力は左・出力は右 (信号の流れ)。電源とコモンも付いている
  twoColumns: ids.every(id => R.model[id].inLeft && R.model[id].outRight &&
    R.model[id].aux === "COM,COM,L,N,PE"),
  // 用紙は 16 点まで A3 横 1:1 / 24 点以上 A3 縦 1:1 (縮小しない)
  sheetChoice: ids.every(id => R.model[id].sheet.paper === R.spec[id].paper &&
    R.model[id].sheet.scale === "1:1" && R.model[id].sheet.orient === R.spec[id].orient) &&
    ids.every(id => R.model[id].textK === 1),
  // 図枠に収まり表題欄を避け、左右に現場機器を並べる余地が残る
  fitsSheet: ids.every(id => R.sheet[id].inFrame && !R.sheet[id].onBlock &&
    R.sheet[id].leftRoom >= 60 && R.sheet[id].rightRoom >= 60),
  // 紙の上の見え方が機種によらず同じ (尺度 1:1 なので作図領域 = 紙)
  printedSame: ids.every(id => R.print[id].pitch === 15 && R.print[id].minText >= 2.5 - 0.001 &&
    R.print[id].minLine >= 0.5 - 0.001 && R.print[id].pinLabel === 2.5),
  // 未使用の入出力点は黙るが、電源・コモン・保護接地の結び忘れは知らせる
  pinLevelDrc: ids.every(id => R.model[id].ioSkipped) &&
    R.unconnected.names === "COM,L,N,PE" && R.unconnected.total === 15 && R.unconnected.comRows === 6,
  // PE には接地の図記号が付く
  peEarth: ids.every(id => R.model[id].peEarth),
  // 実際に結線した図では検図が 1 件も出ない (線番を振っても注記を入れても)
  wiredClean: R.wired.length === 0,
  // 尺度の検図は生きている (普通の記号・破線枠は 1:2 でエラー)
  scaleRuleAlive: R.scale.plain === 1 &&
    // 破線枠・作図線の細線も測っている (0.5 → 0.25)
    R.thin.base === 0.5 && R.thin.zone === 0.25 && R.thin.aux === 0.25 &&
    // data-h の無い文字も font-size から見積もる (測れないものを無視しない)
    R.noDataH > 0 && R.noDataH < 1,
  // 部品表は 1 台ずつ / DXF に端子番号と PE が出る
  bom: R.bom === "KV-N14ATx1 KV-N24ATx1 KV-N40ATx1",
  dxf: R.dxf.r107 && R.dxf.r515 && R.dxf.pe && parseFloat(R.dxf.size) === 2.5,
  // 機種を差し替えると端子構成ごと入れ替わり、用紙違いは検図が知らせる
  swapModel: hasSwap === true && U.hasSwap === true && U.swapped === "KV-N40AT" &&
    U.pins === 45 && U.keptTag === true && U.sheetErr === 1,
  // 用紙は 1 押しで合い、つないだ配線は外れない
  sheetFixButton: U.hasButton === true && U2.after === "A2/portrait/1:1" &&
    U2.inFrame && !U2.onBlock && U2.fixedAway === true &&
    // 入出力の結線は残り、位置の動く電源・コモンは検図が知らせる
    U2.ioKept === true && U2.auxTold === "COM,L,N,PE",
  // 用紙が変わってもページの図形は図枠に追従する (記号だけ動かさない)
  sheetShift: V2.after === "A2/portrait" && V.frame0 !== V2.frame &&
    Math.abs(V2.rel.x - V.rel0.x) < 0.01 && Math.abs(V2.rel.y - V.rel0.y) < 0.01,
  // 機器を動かすと、つないである配線の端点も一緒に動く
  wiresFollow: W.hadWire === true && W.followed === true,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
