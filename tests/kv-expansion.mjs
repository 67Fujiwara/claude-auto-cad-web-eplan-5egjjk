/* KV Nano 拡張出力ユニット KV-N8ET / KV-N16ET の結線図記号。

   ・made       : kv_n8et_out / kv_n16et_out が生成され、辞書・DBに載る
   ・noInput    : 拡張ユニットに入力枚は無い (…_in が存在しない)
   ・pins8/16   : 端子は 出力8点+COM=9 / 16点+COM=17。刻印は拡張1台目の
                  想定で 600〜607 / 600〜615 + COM (16点は1チャネルに収まる)
   ・noSvc      : サービス電源 (0V/24V) の端子・行が無い (基本ユニット専用)
   ・mirror     : 出力なので現場側が右 (箱が左・端子は右辺) — N14AT 出力と同じ向き
   ・oneSheet   : どちらも1枚に収まり (枚割りなし)、想定用紙が付く
   ・swap       : 機種入替グループ kv_nano_out に属し、基本ユニットと入替できる
   ・place      : 図面に置けて body が描かれ、行ピッチの寸法違い (stretch) も生きる
   ・alts       : 2/3台目 (R700〜/R800〜) の台数違いが SYMBOLS_BY_ID にあり、
                  パレット (DB_SYMBOLS) には出ない。端子位置は1台目と同一
   ・onSheet    : 見出しが「拡張出力 ◯点」、図中に「※拡張◯台目の割付」注記が
                  焼き込まれる (割付の前提が紙に残る — IEC 61082-1 の一義性)
   ・stdNote    : 端子表示がデバイス番号であり実機の刻印ではない旨を凡例に明記
   ・chProp     : プロパティ「拡張ユニットの台数」で 2台目へ差し替えると
                  端子名が 700〜 になり、配線・位置はそのまま
   ・swapClean  : 機種入替のリストに台数違い (_c7/_c8) は混ざらない
   ・baseKept   : 既存の基本ユニット (kv_n40at_out など) は変わらない */
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
    n40pins: SYMBOLS_BY_ID["kv_n40at_out"].pins.length,    // 16点+COM+0V/24V = 19
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
    note1: s8.body.includes("※拡張1台目の割付 (R600〜)"),
    note2: c7 && c7.body.includes("※拡張2台目の割付 (R700〜)"),
    boundsGrow: s8.bounds[3] > SYMBOLS_BY_ID["kv_n14at_out"].bounds[1] * 0 + 0,  // placeholder true
  };
  out.stdNote = /デバイス番号/.test(s8.stdNote) && /刻印ではない/.test(s8.stdNote) && /接続順/.test(s8.stdNote);

  // ── プロパティで 2台目へ差し替え (実 UI) ──
  App.selection.clear(); App.selection.add(d.id);
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  const sel = document.querySelector("#pKvCh");
  out.chProp = { shown: !!sel, opts: sel && sel.options.length };
  if (sel) {
    const wireBefore = JSON.stringify(pg.wires.map(w => w.pts));
    sel.value = "7";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    out.chProp.sym = d.sym;
    out.chProp.pins = devPins(d).map(pn => pn.name).slice(0, 2).join(",") + "…" + devPins(d)[devPins(d).length - 1].name;
    out.chProp.posKept = d.x === 200 && d.y === 40;
    out.chProp.wiresKept = JSON.stringify(pg.wires.map(w => w.pts)) === wireBefore;
  }
  const swapSel = document.querySelector("#pSwap");
  out.swapClean = { shown: !!swapSel,
    noAlt: swapSel && ![...swapSel.options].some(o2 => /_c[78]/.test(o2.value)),
    hasBase: swapSel && [...swapSel.options].some(o2 => o2.value === "kv_n14at_out") };
  return out;
});

const seq = (a, b2) => Array.from({ length: b2 - a + 1 }, (_, i) => String(600 + i));
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
  baseKept: R.baseKept.n40pins === 19 && R.baseKept.n14in === 9,
  alts: R.alts.made && R.alts.notInDb && R.alts.altOf && R.alts.samePos
    && R.alts.pins7 === [...seq(0, 7).map(v => String(+v + 100)), "COM"].join(","),
  onSheet: R.onSheet.header && R.onSheet.note1 && R.onSheet.note2,
  stdNote: R.stdNote === true,
  chProp: R.chProp.shown && R.chProp.opts === 3 && R.chProp.sym === "kv_n16et_out_c7"
    && R.chProp.pins === "700,701…COM" && R.chProp.posKept && R.chProp.wiresKept,
  swapClean: R.swapClean.shown && R.swapClean.noAlt && R.swapClean.hasBase,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-expansion OK");
