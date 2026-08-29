/* c接点 (切替接点) — JIS C 0617-7 07-02-04 / IEC 60617。

   ・symbol     : 補助接点 (c接点) がライブラリ (ロジック機器) にあり、
                  端子は 11 (共通)・12 (b側)・14 (a側) の 3 点
   ・restNC     : 不動作時は共通-b側が閉、動作時は共通-a側が閉 (break-before-make)
   ・noShort    : b側→0V / a側→+24V の常套回路でも短絡と誤検図しない
   ・linkedNum  : コイル連動の 2 個目は 21/22/24 に自動繰り上げ
   ・mirror     : コイル下のミラー表に 11·12·14 が出る (画面・DXF とも)
   ・drawn      : 図面と DXF に記号が出る
   ・dbFixed    : データベースの切替接点も切替として通電計算される
                  (端子の並びは a側 → b側 → 共通)
   ・oneFigure  : 同じ図記号番号 (07-02-04) を別の図形が名乗らない。
                  規格原本との照合が要る旨は stdNote に書いてある
   ・blade      : 可動刃は b側の固定接点バーを 1.5mm 以上越えて交わり、
                  a側の固定接点とは 2mm 以上空く (縮小しても読める)
   ・dbMake     : データベース側の a側 (メーク) にはブレーク要素の横バーが無く、
                  可動刃は b側バーを越えて描かれる
   ・rank8      : 連動接点の十の位は 8 で止まる (9x は規格外)
   ・swapNote   : 端子番号を手入力した切替接点がある図面では、端子の並びが
                  変わった旨を知らせる
   ・upVariant  : 共通が上の c接点 (上のレールから 2 回路へ振り分ける向き) があり、
                  図形は共通が下の c接点をそのまま上下反転したもの
   ・falseErr   : c接点のページに正しく配線した 3線式センサを置いても、
                  電位の誤りとして誤検図しない (両投を同時に閉じた仮の状態で
                  +24V と 0V が同じネットに見えることによる誤爆の回帰)
   ・coIdle     : 片方の投だけ使うのは普通なので未接続の注意を出さない。
                  共通の結び忘れ・両方未接続は今までどおり出す
   ・pinMsg     : 検図の文言は図面に印字された端子番号 (繰り上げ後) で言う
   ・labelBlank : 端子番号を空欄にしてもミラー表は 3 欄のまま (b接点と紛れない) */
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
  const sym = symOf("aux_co");
  out.symbol = {
    found: !!sym, cat: sym && sym.cat, jis: sym && sym.jis, sim: sym && sym.sim,
    linked: !!(sym && sym.linked),
    pins: sym ? sym.pins.map(q => [q.x, q.y, q.n]) : null,
    inPalette: [...document.querySelectorAll("#symTree .sym-name")].some(x => x.textContent === sym.name),
  };

  App.project = newProject("c接点");
  UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  const d = addDevice(pg, "aux_co", 100, 100, {});
  // 不動作 / 動作の閉じ方 (通電計算モード)
  App.sim.states = {}; App.sim.timers = {};
  const pairs = m => JSON.stringify(conductivePairs(d, m));
  out.restNC = { rest: pairs("sim") };
  App.sim.states[d.id] = true;
  out.restNC.act = pairs("sim");
  App.sim.states = {};
  out.restNC.open = pairs("open");     // 機器を跨いで線番・ネットが破断する

  // ── 短絡の誤検図が出ないこと (b側 0V / a側 +24V) ──
  const ps = addDevice(pg, "psu24", 60, 50, {});
  const pins = i => devPins(d)[i];
  const pp = devPins(ps);        // L(50,50) N(70,50) +V(50,80) -V(70,80)
  // +24V → a側(14) は右回りで、0V → b側(12) は真下へ (線が重ならない経路)
  addWire(pg, [[50, 80], [50, 55], [120, 55], [120, 100], [100, 100]], { raw: true });
  addWire(pg, [[70, 80], [70, 100], [90, 100]], { raw: true });
  const lamp = addDevice(pg, "lamp", 100, 160, {});
  const lp = devPins(lamp);
  addWire(pg, [[pins(2).x, pins(2).y], [lp[0].x, lp[0].y]], { raw: true });     // 共通(11) → ランプ
  addWire(pg, [[lp[1].x, lp[1].y], [lp[1].x, 200], [70, 200], [70, 100]], { raw: true });  // ランプ → 0V
  out.wired = { p24: !!pp[2], com: [pins(2).x, pins(2).y], a: [pins(0).x, pins(0).y], b: [pins(1).x, pins(1).y] };
  const drc = runDRC();
  out.noShort = { shorts: drc.filter(i => /短絡/.test(i.msg)).map(i => i.msg) };

  // ── 連動接点の自動繰り上げ ──
  const coil = addDevice(pg, "coil", 200, 100, {});
  const c1 = addDevice(pg, "aux_co", 240, 100, { linkTo: coil.id });
  const c2 = addDevice(pg, "aux_co", 280, 100, { linkTo: coil.id });
  out.linkedNum = {
    first: [0, 1, 2].map(i => effectivePinName(c1, i)),
    second: [0, 1, 2].map(i => effectivePinName(c2, i)),
  };

  // ── ミラー表 (画面・DXF) ──
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.mirror = {
    label: contactPinLabel(c1),
    svg: Editor.layers.devices.innerHTML.includes("11·12·14"),
    // DXF の非 ASCII は \U+xxxx 形式で書き出される
    dxf: pageToDXF(pg).split(/\r?\n/).includes("11\\U+00B712\\U+00B714"),
  };

  // ── 図面・DXF に記号が出る ──
  out.drawn = {
    svg: Editor.layers.devices.innerHTML.includes("M-10,0 V7 H-2.6"),
    dxfLines: (pageToDXF(pg).match(/\nLINE\n/g) || []).length,
  };

  // ── データベースの切替接点 ──
  const dbs = symOf("changeover");
  const dd = addDevice(pg, "changeover", 340, 100, {});
  App.sim.states = {};
  out.dbFixed = {
    sim: dbs.sim, pins: dbs.pins.map(q => q.n),
    rest: JSON.stringify(conductivePairs(dd, "sim")),
  };
  App.sim.states[dd.id] = true;
  out.dbFixed.act = JSON.stringify(conductivePairs(dd, "sim"));
  App.sim.states = {};

  /* ── 07-02-04 (切替接点) を名乗るのは 1 記号だけ ──
     このライブラリでは、同じ番号の記号に要素を足した変形 (熱動素子つきの
     メーク接点など) は同じ番号を名乗る運用。しかし配置そのものが違う図
     (共通が中央の操作スイッチ用) が同じ番号を名乗ると、どちらが規格の姿か
     分からなくなるので、そちらは番号を外して stdNote で断る */
  const claim = allSymbols().filter(s2 => s2.jis === "07-02-04").map(s2 => s2.id);
  const symR = symOf("aux_co_r");
  /* 姿勢違い (上下反転) は同じ図なので同じ番号でよい。線分の集合で確かめる */
  const segs = (sym2, flip) => {
    const d = /d="([^"]+)"/.exec(sym2.body)[1];
    const out2 = []; let x = 0, y = 0;
    d.match(/[MLVH][^MLVH]*/g).forEach(tk => {
      const k = tk[0], v = tk.slice(1).trim().split(/[ ,]+/).map(parseFloat);
      const [x0, y0] = [x, y];
      if (k === "M") { [x, y] = v; return; }
      if (k === "L") [x, y] = v; else if (k === "V") y = v[0]; else x = v[0];
      const f = q => (flip ? 20 - q : q);
      const a = [x0, f(y0)], b2 = [x, f(y)];
      out2.push(JSON.stringify([a, b2].sort()));
    });
    return out2.sort();
  };
  out.oneFigure = {
    claim, stdNote: !!sym.stdNote && /照合/.test(sym.stdNote),
    dbJis: dbs.jis, dbNote: !!dbs.stdNote && /照合/.test(dbs.stdNote),
    mirrored: JSON.stringify(segs(sym, false)) === JSON.stringify(segs(symR, true)),
  };

  // ── 共通が上の c接点 ──
  const du = addDevice(pg, "aux_co_r", 460, 260, {});
  App.sim.states = {};
  out.upVariant = {
    pins: symR.pins.map(q => [q.x, q.y, q.n]),
    rest: JSON.stringify(conductivePairs(du, "sim")),
    inPalette: [...document.querySelectorAll("#symTree .sym-name")].some(x => x.textContent === symR.name),
  };
  App.sim.states[du.id] = true;
  out.upVariant.act = JSON.stringify(conductivePairs(du, "sim"));
  App.sim.states = {};
  pg.devices.splice(pg.devices.indexOf(du), 1);

  // ── 刃とバーの寸法 (縮小しても「バーを横切る刃」と読めるか) ──
  const mBlade = /M0,13 L(-?[\d.]+),(-?[\d.]+)/.exec(sym.body);
  const mBar = /M-10,0 V7 H(-?[\d.]+)/.exec(sym.body);
  const [bx, by] = [parseFloat(mBlade[1]), parseFloat(mBlade[2])];
  const barEnd = parseFloat(mBar[1]);
  const cross = bx * (13 - 7) / (13 - by);          // 刃が y=7 を横切る x
  out.blade = {
    cross: +cross.toFixed(2), barEnd,
    over: +(Math.abs(cross) - Math.abs(barEnd)).toFixed(2),   // 交点から先のバー
    gap: +(0 - barEnd).toFixed(2),                            // バー端と a側固定接点の空き
    tipAbove: +(7 - by).toFixed(2),                           // 刃の先端がバーより上に出る量
  };

  // ── データベース側の作図 ──
  out.dbMake = { aBar: /M7,7 H/.test(dbs.body), blade: /M5,13 L([\d.]+),([\d.]+)/.exec(dbs.body) };
  if (out.dbMake.blade) {
    const ty = parseFloat(out.dbMake.blade[2]);
    out.dbMake.tipAbove = +(7 - ty).toFixed(2);   // b側バー (y=7) を越えているか
  }

  // ── 連動接点は 8 個目まで。9 個目以降も 9x を出さない ──
  const coil2 = addDevice(pg, "coil", 400, 100, {});
  const many = [];
  for (let i = 0; i < 9; i++) many.push(addDevice(pg, "aux_co", 400 + i * 20, 160, { linkTo: coil2.id }));
  out.rank8 = { eighth: effectivePinName(many[7], 2), ninth: effectivePinName(many[8], 2) };

  /* ── 正しく配線した 3線式センサが誤検図されないこと ──
     (両投を同時に閉じた仮の状態では +24V と 0V が同じネットに見えるため、
      投ごとの 2 パスで判定しないと無関係な機器にエラーが出る) */
  const pgS = newPage("センサ", App.project.pages.length + 1);
  App.project.pages.push(pgS); UI.renumberPages();
  App.pageIdx = App.project.pages.indexOf(pgS); applySheet(pgS);
  addDevice(pgS, "psu24", 60, 50, {});
  addDevice(pgS, "aux_co", 100, 100, {});
  addWire(pgS, [[50, 80], [50, 55], [120, 55], [120, 100], [100, 100]], { raw: true });  // +24V → a側
  addWire(pgS, [[70, 80], [70, 100], [90, 100]], { raw: true });                         // 0V → b側
  const lampS = addDevice(pgS, "lamp", 100, 160, {});
  addWire(pgS, [[100, 120], [100, 160]], { raw: true });
  addWire(pgS, [[100, 180], [100, 200], [70, 200], [70, 100]], { raw: true });
  const sensor = addDevice(pgS, "prox", 200, 100, {});     // 正しい配線 (BN→+24V / BU→0V)
  const sp = devPins(sensor);
  addWire(pgS, [[sp[0].x, sp[0].y], [sp[0].x, 55], [120, 55]], { raw: true });
  addWire(pgS, [[sp[2].x, sp[2].y], [sp[2].x, 200], [100, 200]], { raw: true });
  const drc2 = runDRC().filter(i => i.page === pgS.no);
  out.falseErr = {
    errs: drc2.filter(i => i.sev === "err").map(i => i.msg),
    sensor: drc2.filter(i => i.target === sensor.id).map(i => i.sev + ":" + i.msg),
    lamp: drc2.filter(i => i.target === lampS.id).map(i => i.sev + ":" + i.msg),
  };
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);

  /* ── 片方の投だけ使っても未接続の注意を出さない ── */
  const idleCo = addDevice(pg, "aux_co", 520, 100, {});
  const ip = devPins(idleCo);
  addWire(pg, [[ip[2].x, ip[2].y], [ip[2].x, ip[2].y + 20]], { raw: true });      // 共通だけ配線
  addWire(pg, [[ip[0].x, ip[0].y], [ip[0].x, ip[0].y - 20]], { raw: true });      // a側も配線
  const noteOf = id => runDRC().filter(i => i.target === id && /未接続/.test(i.msg)).map(i => i.msg);
  out.coIdle = { used: noteOf(idleCo.id) };
  // 共通を外すと今までどおり知らせる
  pg.wires = pg.wires.filter(w => !(w.pts[0][0] === ip[2].x && w.pts[0][1] === ip[2].y));
  out.coIdle.noCom = noteOf(idleCo.id);

  /* ── 検図の文言は繰り上げ後の端子番号で言う ── */
  out.pinMsg = runDRC().filter(i => i.target === c2.id && /未接続/.test(i.msg)).map(i => i.msg);

  /* ── 端子番号を空欄にしてもミラー表は 3 欄 ── */
  c1.props = c1.props || {}; c1.props.pinNames = { 1: "" };
  out.labelBlank = contactPinLabel(c1);
  delete c1.props.pinNames;

  // ── 端子番号を手入力した切替接点があるときの注意 ──
  dd.props = dd.props || {}; dd.props.pinNames = { 0: "COM2" };
  UI.setMsg("");
  noteSymbolMigration();
  out.swapNote = /端子の並び/.test(document.getElementById("stMsg").textContent || "");
  delete dd.props.pinNames;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  symbol: R.symbol.found && R.symbol.cat === "logic" && R.symbol.jis === "07-02-04"
    && R.symbol.sim === "changeover" && R.symbol.linked && R.symbol.inPalette
    && JSON.stringify(R.symbol.pins) === JSON.stringify([[0, 0, "14"], [-10, 0, "12"], [0, 20, "11"]]),
  restNC: R.restNC.rest === "[[1,2]]" && R.restNC.act === "[[0,2]]" && R.restNC.open === "[]",
  noShort: R.noShort.shorts.length === 0,
  linkedNum: JSON.stringify(R.linkedNum.first) === JSON.stringify(["14", "12", "11"])
    && JSON.stringify(R.linkedNum.second) === JSON.stringify(["24", "22", "21"]),
  mirror: R.mirror.label === "11·12·14" && R.mirror.svg === true && R.mirror.dxf === true,
  drawn: R.drawn.svg === true && R.drawn.dxfLines > 10,
  dbFixed: R.dbFixed.sim === "changeover" && JSON.stringify(R.dbFixed.pins) === JSON.stringify(["NO", "NC", "COM"])
    && R.dbFixed.rest === "[[1,2]]" && R.dbFixed.act === "[[0,2]]",
  oneFigure: JSON.stringify(R.oneFigure.claim) === JSON.stringify(["aux_co", "aux_co_r"])
    && R.oneFigure.stdNote === true && !R.oneFigure.dbJis && R.oneFigure.dbNote === true
    && R.oneFigure.mirrored === true,
  upVariant: JSON.stringify(R.upVariant.pins) === JSON.stringify([[0, 20, "14"], [-10, 20, "12"], [0, 0, "11"]])
    && R.upVariant.rest === "[[1,2]]" && R.upVariant.act === "[[0,2]]" && R.upVariant.inPalette === true,
  falseErr: R.falseErr.errs.length === 0 && R.falseErr.sensor.every(m => !/err/.test(m))
    && R.falseErr.lamp.every(m => !/err/.test(m)),
  coIdle: R.coIdle.used.length === 0 && R.coIdle.noCom.length > 0,
  pinMsg: R.pinMsg.length > 0 && R.pinMsg.every(m => /2[124]/.test(m)) && !R.pinMsg.some(m => /ピン 1[124]/.test(m)),
  labelBlank: R.labelBlank === "11·-·14",
  blade: R.blade.over >= 1.5 && R.blade.gap >= 2 && R.blade.tipAbove >= 1.5,
  dbMake: R.dbMake.aBar === false && R.dbMake.tipAbove >= 1,
  rank8: R.rank8.eighth === "81" && R.rank8.ninth === "81",
  swapNote: R.swapNote === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("changeover OK");
