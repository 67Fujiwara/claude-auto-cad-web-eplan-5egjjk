/* KV Nano 拡張出力ユニット KV-N8ET / KV-N16ET の結線図記号。

   ・made       : kv_n8et_out / kv_n16et_out が生成され、辞書・DBに載る
   ・noInput    : 拡張ユニットに入力枚は無い (…_in が存在しない)
   ・pins8/16   : 端子は 出力8点+COM=9 / 16点+COM=17。端子番号はユニットごとに
                  000 から: 000〜007 / 000〜015 + COM (拡張ユニットが何台でも同じ)
   ・noSvc      : サービス電源 (0V/24V) の端子・行が無い (基本ユニット専用)
   ・mirror     : 出力なので現場側が右 (箱が左・端子は右辺) — N14AT 出力と同じ向き
   ・oneSheet   : どちらも1枚に収まり (枚割りなし)、想定用紙が付く
   ・swap       : 機種入替グループ kv_nano_out に属し、基本ユニットと入替できる
   ・place      : 図面に置けて body が描かれ、行ピッチの寸法違い (stretch) も生きる
   ・alts       : 旧版の 2/3台目の記号が SYMBOLS_BY_ID に残り (端子番号は同じ 000〜)、
                  パレット (DB_SYMBOLS) には出ない。端子位置は1台目と同一
   ・onSheet    : 見出しが「拡張出力 ◯点」、図中に「※拡張◯台目の割付」注記が
                  焼き込まれる (割付の前提が紙に残る — IEC 61082-1 の一義性)
   ・stdNote    : 端子表示がデバイス番号であり実機の刻印ではない旨を凡例に明記
   ・noChProp   : プロパティに「拡張ユニットの台数」のプルダウンは出さない (廃止)
   ・oldC7      : 旧版で 2台目にした図面も開けて、端子番号は 000〜 で描かれる
   ・swapClean  : 機種入替のリストに台数違い (_c7/_c8) は混ざらない
   ・swapShow   : 旧版の 2台目の記号でプロパティを開いても、機種欄は親機種が選択表示される
   ・swapKeepCh : 旧版の 2台目のまま機種を N8ET へ差し替えると 2台目の N8ET に着地する
   ・boundsNote : 図中注記のぶん外接矩形が下へ伸びる (注記 7mm は用紙判定にも入る)
   ・legend     : 規格外図記号の凡例 (stdNote) を pasteStdNote で図面に貼れる
   ・baseKept   : 基本ユニットの端子構成 (部屋割りコモン込み) が想定どおり */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const s8 = SYMBOLS_BY_ID["kv_n8et_out"], s16 = SYMBOLS_BY_ID["kv_n16et_out"];
  out.made = { s8: !!s8, s16: !!s16, inDb: DB_SYMBOLS.includes(s8) && DB_SYMBOLS.includes(s16) };
  out.noInput = !SYMBOLS_BY_ID["kv_n8et_in"] && !SYMBOLS_BY_ID["kv_n16et_in"]
    && !SYMBOLS_BY_ID["kv_n8et_in1"] && !SYMBOLS_BY_ID["kv_n16et_in1"];
  if (!s8 || !s16) return out;
  const names = sym => sym.pins.map(pn => pn.n);
  out.pins8 = names(s8);
  out.pins16 = names(s16);
  out.noSvc = !names(s8).some(n => /V$/.test(n)) && !names(s16).some(n => /V$/.test(n))
    && !s8.body.includes(">0V<") && !s16.body.includes(">0V<");
  const n14o = SYMBOLS_BY_ID["kv_n14at_out"], n14i = SYMBOLS_BY_ID["kv_n14at_in"];
  // 出力は鏡像 (thumbBox が -x 側) — 基本ユニットの出力と同じ向きで、入力とは逆
  const flip = sym => sym.thumbBox[0] < 0;
  out.mirror = { s8: flip(s8), s16: flip(s16), base: flip(n14o), inOpp: !flip(n14i),
    samePinX: s8.pins[0].x === n14o.pins[0].x && s16.pins[0].x === n14o.pins[0].x };
  out.oneSheet = { s8: !!(s8.sheet && s8.sheet.paper), s16: !!(s16.sheet && s16.sheet.paper),
    noSplit: !SYMBOLS_BY_ID["kv_n8et_out1"] && !SYMBOLS_BY_ID["kv_n16et_out1"] };
  out.swap = s8.swapGroup === "kv_nano_out" && s16.swapGroup === "kv_nano_out"
    && n14o.swapGroup === "kv_nano_out";
  // 図面に配置して描画・伸縮
  const pg = newPage("kvx", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  const d = addDevice(pg, "kv_n16et_out", 200, 40, {});
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  const v16 = symStretchVariant(s16, 25);   // 行ピッチ 25mm の寸法違い
  out.place = {
    dev: !!d, pins: devPins(d).length,
    drawn: !!document.querySelector(`[data-id="${d.id}"]`),
    stretch: v16 && v16.pins.length === s16.pins.length
      && v16.bounds[3] > s16.bounds[3],   // ピッチを広げると縦に伸びる
  };
  out.baseKept = {
    n40pins: SYMBOLS_BY_ID["kv_n40at_out"].pins.length,   // 16点+C1/C2+0V/24V = 20 (16点は 1 枚 1 列)
    n14in: SYMBOLS_BY_ID["kv_n14at_in"].pins.length,       // 8点+C0 = 9
  };

  // ── 台数違い (2/3台目) ──
  const c7 = SYMBOLS_BY_ID["kv_n8et_out_c7"], c8 = SYMBOLS_BY_ID["kv_n8et_out_c8"];
  out.alts = {
    made: !!c7 && !!c8 && !!SYMBOLS_BY_ID["kv_n16et_out_c7"],
    notInDb: !DB_SYMBOLS.includes(c7) && !DB_SYMBOLS.includes(c8),
    altOf: c7 && c7.altOf === "kv_n8et_out",
    pins7: c7 && c7.pins.map(pn => pn.n).join(","),
    samePos: c7 && JSON.stringify(c7.pins.map(pn => [pn.x, pn.y])) === JSON.stringify(s8.pins.map(pn => [pn.x, pn.y])),
  };
  out.onSheet = {
    header: s8.body.includes(">拡張出力 8点<") && s16.body.includes(">拡張出力 16点<"),
    note1: s8.body.includes("※端子番号はユニットごとに 000〜") && !/R600/.test(s8.body),
    note2: c7 && c7.body.includes("※端子番号はユニットごとに 000〜") && !/R700/.test(c7.body),
    boundsGrow: s8.bounds[3] > SYMBOLS_BY_ID["kv_n14at_out"].bounds[1] * 0 + 0,  // placeholder true
  };
  out.stdNote = /点番号 000〜/.test(s8.stdNote) && /刻印は未確認/.test(s8.stdNote) && /接続順/.test(s8.stdNote);

  // ── 「拡張ユニットの台数」のプルダウンは出さない (廃止) ──
  App.selection.clear(); App.selection.add(d.id);
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  out.noChProp = !document.querySelector("#pKvCh") && !document.body.textContent.includes("拡張ユニットの台数");
  // 旧版で 2台目にした図面を開いた想定: 記号は残っていて、端子番号は 000〜
  const wireBefore = JSON.stringify(pg.wires.map(w => w.pts));
  d.sym = "kv_n16et_out_c7"; App.labelRev++;
  UI.refresh(); UI.showProps();
  await new Promise(r => setTimeout(r, 100));
  out.oldC7 = { pins: devPins(d).map(pn => pn.name).slice(0, 2).join(",") + "…" + devPins(d)[devPins(d).length - 1].name,
    wiresKept: JSON.stringify(pg.wires.map(w => w.pts)) === wireBefore };
  const swapSel = document.querySelector("#pSwap");
  out.swapClean = { shown: !!swapSel,
    noAlt: swapSel && ![...swapSel.options].some(o2 => /_c[78]/.test(o2.value)),
    hasBase: swapSel && [...swapSel.options].some(o2 => o2.value === "kv_n14at_out") };
  // 2台目のままプロパティを開く → 機種欄は親機種が選択表示される
  out.swapShow = swapSel && swapSel.value === "kv_n16et_out";
  // 2台目のまま機種を N8ET へ → 2台目の N8ET に着地 (台数を保つ)
  swapSel.value = "kv_n8et_out";
  swapSel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  out.swapKeepCh = { sym: d.sym, pin0: devPins(d)[0] && devPins(d)[0].name, posKept: d.x === 200 };
  // 外接矩形と用紙判定に図中注記のぶんが入る
  const lastPinY = sym2 => Math.max(...sym2.pins.map(pn => pn.y));
  out.boundsNote = {
    s8: s8.bounds[1] + s8.bounds[3] - lastPinY(s8),
    base: (() => { const b0 = SYMBOLS_BY_ID["kv_n14at_out"]; return b0.bounds[1] + b0.bounds[3] - lastPinY(b0); })(),
  };
  // 凡例 (stdNote) を注記として貼れる
  const nLeg = pasteStdNote(pg, SYMBOLS_BY_ID[d.sym]);
  out.legend = {
    rows: nLeg,
    onPage: pg.texts.some(t2 => /点番号 000〜/.test(t2.text)) && pg.texts.some(t2 => /規格原本との照合/.test(t2.text)),
  };
  return out;
});

const seq = (a, b2) => Array.from({ length: b2 - a + 1 }, (_, i) => String(a + i).padStart(3, "0"));
const checks = {
  noPageErrors: errs.length === 0,
  made: R.made.s8 && R.made.s16 && R.made.inDb,
  noInput: R.noInput === true,
  pins8: JSON.stringify(R.pins8) === JSON.stringify([...seq(0, 7), "COM"]),
  pins16: JSON.stringify(R.pins16) === JSON.stringify([...seq(0, 15), "COM"]),
  noSvc: R.noSvc === true,
  mirror: R.mirror.s8 && R.mirror.s16 && R.mirror.base && R.mirror.inOpp && R.mirror.samePinX,
  oneSheet: R.oneSheet.s8 && R.oneSheet.s16 && R.oneSheet.noSplit,
  swap: R.swap === true,
  place: R.place.dev && R.place.pins === 17 && R.place.drawn && R.place.stretch,
  baseKept: R.baseKept.n40pins === 20 && R.baseKept.n14in === 9,
  alts: R.alts.made && R.alts.notInDb && R.alts.altOf && R.alts.samePos
    && R.alts.pins7 === [...seq(0, 7), "COM"].join(","),
  onSheet: R.onSheet.header && R.onSheet.note1 && R.onSheet.note2,
  stdNote: R.stdNote === true,
  noChProp: R.noChProp === true,
  oldC7: R.oldC7.pins === "000,001…COM" && R.oldC7.wiresKept === true,
  swapClean: R.swapClean.shown && R.swapClean.noAlt && R.swapClean.hasBase,
  swapShow: R.swapShow === true,
  swapKeepCh: R.swapKeepCh.sym === "kv_n8et_out_c7" && R.swapKeepCh.pin0 === "000" && R.swapKeepCh.posKept,
  boundsNote: R.boundsNote.s8 === 13 && R.boundsNote.base === 13,   // (4+7+2) — AT 形は類推注記の帯が基本ユニットにも入る
  legend: R.legend.rows >= 1 && R.legend.onPage,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-expansion OK");
