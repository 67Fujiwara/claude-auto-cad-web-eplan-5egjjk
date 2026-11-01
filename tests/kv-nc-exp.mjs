/* キーエンス KV 拡張ユニット (ヨーロピアン端子台) KV-NC16EXE / KV-NC16ETE の結線図記号。

   ・made     : kv_nc16exe_in (入力 16点) / kv_nc16ete_out (出力 16点) がパレット
               (DB_SYMBOLS) に載り、既定のピン留めにも入る。2/3台目 (_c7/_c8) は
               SYMBOLS_BY_ID にだけ居てパレットには出ない
   ・pins     : 端子は 600〜615 + COM (拡張1台目の割付)。2台目は 700〜715
   ・side     : 入力は現場側が左 (基本ユニットの入力と同じ向き)、出力は現場側が右
               (KV-N16ET と同じ向き)
   ・swap     : 入力は kv_nano_in、出力は kv_nano_out の機種入替グループ
   ・onSheet  : 見出し「拡張入力 16点」「拡張出力 16点」と割付の注記が紙に載る。
               入力はコモン +24V (NPN 機器向け) も紙で宣言する
   ・spec     : 説明に COM 16 端子 (内部で短絡)・ヨーロピアン端子台・定格 (出力
               DC30V 0.2A)・入力の DC24V/DC5V 切換を書く
   ・scaffold : 置いて「結線図の下地を作る」でレールとコモンの結線が引ける。
               入力の COM は P24V 側、出力の COM は N24V 側へつながる
   ・chProp   : 「拡張ユニットの台数」の差し替え先 (2台目) が用意されている
   ・migrate  : 旧版 (ピン留め ver9) の利用者にも 2 機種が追い足される
   ・oldSame  : 既存の KV-N8ET / KV-N16ET の記号は変わらない (説明は KV Nano のまま) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  const ex = SYMBOLS_BY_ID.kv_nc16exe_in, et = SYMBOLS_BY_ID.kv_nc16ete_out;
  out.made = { ex: !!ex, et: !!et, db: DB_SYMBOLS.includes(ex) && DB_SYMBOLS.includes(et),
    pinned: DB_DEFAULT_PINNED.includes("kv_nc16exe_in") && DB_DEFAULT_PINNED.includes("kv_nc16ete_out"),
    alts: !!SYMBOLS_BY_ID.kv_nc16exe_in_c7 && !!SYMBOLS_BY_ID.kv_nc16ete_out_c8 &&
      !DB_SYMBOLS.includes(SYMBOLS_BY_ID.kv_nc16exe_in_c7) && !DB_SYMBOLS.includes(SYMBOLS_BY_ID.kv_nc16ete_out_c8) };
  if (!ex || !et) return out;
  const names = s => s.pins.map(q => q.n).join(",");
  const exp16 = ch => Array.from({ length: 16 }, (_, i) => `${ch}${String(i).padStart(2, "0")}`).join(",") + ",COM";
  out.pins = { ex: names(ex) === exp16(6), et: names(et) === exp16(6),
    ex2: names(SYMBOLS_BY_ID.kv_nc16exe_in_c7) === exp16(7) };
  const flip = s => s.thumbBox[0] < 0;
  out.side = { exLeft: !flip(ex) && flip(ex) === flip(SYMBOLS_BY_ID.kv_n14at_in),
    etRight: flip(et) && flip(et) === flip(SYMBOLS_BY_ID.kv_n16et_out) };
  out.swap = ex.swapGroup === "kv_nano_in" && et.swapGroup === "kv_nano_out";
  out.onSheet = { ex: ex.body.includes("拡張入力 16点") && ex.body.includes("※拡張1台目の割付 (R600〜)") &&
      ex.body.includes("コモンは +24V"), et: et.body.includes("拡張出力 16点") && et.body.includes("※拡張1台目の割付 (R600〜)") };
  out.spec = { ex: /COM は 16 端子あり内部で短絡/.test(ex.desc) && /ヨーロピアン端子台/.test(ex.desc) && /DC24V\/DC5V/.test(ex.desc),
    et: /COM は 16 端子あり内部で短絡/.test(et.desc) && /DC30V 0\.2A/.test(et.desc) && /ヨーロピアン端子台/.test(et.desc) };
  out.chProp = ex.expAlts && ex.expAlts[7] === "kv_nc16exe_in_c7" && et.expAlts && et.expAlts[8] === "kv_nc16ete_out_c8";
  // ── 置いて下地 ──
  const sc = (symId) => {
    App.project = newProject("拡張"); UI.renumberPages();
    const pg = App.project.pages.find(isDrawingPage);
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    pg.devices.length = 0; pg.wires.length = 0;
    const d = addDevice(pg, symId, 200, 40, {});
    const n = buildIoScaffold(pg, d);
    App.labelRev++;
    const nets = computeNets(pg, "closed");
    const ci = symOf(d.sym).pins.findIndex(q => q.n === "COM");
    const comNet = nets.pinNet(d, ci);
    const rails = pg.devices.filter(d2 => d2 !== d && d2.tag && nets.pinNet(d2, 0) === comNet).map(d2 => d2.tag);
    return { n, rails: rails.join(",") };
  };
  out.scaffold = { ex: sc("kv_nc16exe_in"), et: sc("kv_nc16ete_out") };
  // ── 旧版のピン留めからの追い足し ──
  localStorage.setItem("electracad.dbPinned", JSON.stringify(["cable_core"]));
  localStorage.setItem("electracad.dbPinnedVer", "9");
  const merged = dbPinnedList();
  out.migrate = merged.includes("kv_nc16exe_in") && merged.includes("kv_nc16ete_out") && merged.includes("cable_core");
  out.oldSame = /KV Nano 拡張ユニット KV-N16ET/.test(SYMBOLS_BY_ID.kv_n16et_out.desc) &&
    names(SYMBOLS_BY_ID.kv_n16et_out) === exp16(6);
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  made: R.made.ex && R.made.et && R.made.db && R.made.pinned && R.made.alts,
  pins: R.pins.ex && R.pins.et && R.pins.ex2,
  side: R.side.exLeft && R.side.etRight,
  swap: R.swap === true,
  onSheet: R.onSheet.ex && R.onSheet.et,
  spec: R.spec.ex && R.spec.et,
  scaffold: R.scaffold.ex.n > 0 && R.scaffold.et.n > 0 && /P24V/.test(R.scaffold.ex.rails) && !/N24V/.test(R.scaffold.ex.rails) &&
    /N24V/.test(R.scaffold.et.rails) && !/P24V/.test(R.scaffold.et.rails),
  chProp: R.chProp === true,
  migrate: R.migrate === true,
  oldSame: R.oldSame === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-nc-exp OK");
