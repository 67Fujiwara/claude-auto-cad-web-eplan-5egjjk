/* キーエンス KV-8000/7000 (ビルディングブロック形) の入出力ユニット KV-B16XC / KV-B16TD
   (ネジ端子台) の結線図記号。

   ・made     : kv_b16xc_in (入力 16点) / kv_b16td_out (出力 16点) がパレット
               (DB_SYMBOLS) に載り、既定のピン留めにも入る。拡張の順番で割付が
               変わらないので 2/3台目 (_c1/_c2) の記号は無く、expAlts も持たない
   ・pins     : 端子は 00〜15 (2 桁) + COM。既存の拡張ユニット (000〜) は変えない
   ・side     : 入力は現場側が左、出力は現場側が右 (KV Nano と同じ向き)
   ・swap     : 機種入替グループは kv_b_in / kv_b_out (KV Nano とは混ぜない)
   ・onSheet  : 見出し「入力 16点」「出力 16点」(拡張の字は付かない) と
               注記「※端子番号は 00〜15」が紙に載る。入力はコモン +24V も宣言
   ・spec     : 説明に COM 2 端子 (内部で共通)・ネジ端子台・定格 (出力 DC30V 0.3A
               MOSFET シンク 過電流保護)・入力の DC24V/DC5V 切換・シリーズ名を書く
   ・scaffold : 置いて「結線図の下地を作る」でレールとコモンの結線が引ける。
               入力の COM は P24V 側、出力の COM は N24V 側へつながる
   ・migrate  : 旧版 (ピン留め ver10) の利用者にも 2 機種が追い足される */
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
  const xc = SYMBOLS_BY_ID.kv_b16xc_in, td = SYMBOLS_BY_ID.kv_b16td_out;
  out.made = { xc: !!xc, td: !!td, db: DB_SYMBOLS.includes(xc) && DB_SYMBOLS.includes(td),
    pinned: DB_DEFAULT_PINNED.includes("kv_b16xc_in") && DB_DEFAULT_PINNED.includes("kv_b16td_out"),
    noAlts: !SYMBOLS_BY_ID.kv_b16xc_in_c1 && !SYMBOLS_BY_ID.kv_b16td_out_c1 && !SYMBOLS_BY_ID.kv_b16xc_in_c0 &&
      !(xc && xc.expAlts) && !(td && td.expAlts) };
  if (!xc || !td) return out;
  const names = s => s.pins.map(q => q.n).join(",");
  const exp2 = Array.from({ length: 16 }, (_, i) => String(i).padStart(2, "0")).join(",") + ",COM";
  const exp3 = Array.from({ length: 16 }, (_, i) => `0${String(i).padStart(2, "0")}`).join(",") + ",COM";
  out.pins = { xc: names(xc) === exp2, td: names(td) === exp2, old: names(SYMBOLS_BY_ID.kv_nc16exe_in) === exp3 };
  const flip = s => s.thumbBox[0] < 0;
  out.side = { xcLeft: !flip(xc), tdRight: flip(td) };
  out.swap = xc.swapGroup === "kv_b_in" && td.swapGroup === "kv_b_out";
  out.onSheet = { xc: xc.body.includes(">入力 16点<") && !xc.body.includes("拡張") && xc.body.includes("※端子番号は 00〜15") &&
      xc.body.includes("コモンは +24V"),
    td: td.body.includes(">出力 16点<") && !td.body.includes("拡張") && td.body.includes("※端子番号は 00〜15") };
  out.spec = { xc: /COM は 2 端子あり内部で共通/.test(xc.desc) && /ネジ端子台/.test(xc.desc) && /DC24V \(5\.3mA\) \/ DC5V/.test(xc.desc) &&
      /KV-8000\/7000/.test(xc.desc) && /入出力ユニット/.test(xc.desc) && !/拡張ユニット/.test(xc.desc) &&
      /端子番号は 00〜15 \(2 桁\)/.test(xc.desc) && /スロット位置/.test(xc.desc),
    td: /COM は 2 端子あり内部で共通/.test(td.desc) && /DC30V 0\.3A/.test(td.desc) && /MOSFET シンク/.test(td.desc) && /過電流保護/.test(td.desc) &&
      /ネジ端子台/.test(td.desc) };
  // ── 置いて下地 ──
  const sc = (symId) => {
    App.project = newProject("KV-B"); UI.renumberPages();
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
  out.scaffold = { xc: sc("kv_b16xc_in"), td: sc("kv_b16td_out") };
  // ── 旧版のピン留めからの追い足し ──
  localStorage.setItem("electracad.dbPinned", JSON.stringify(["cable_core"]));
  localStorage.setItem("electracad.dbPinnedVer", "10");
  const merged = dbPinnedList();
  out.migrate = merged.includes("kv_b16xc_in") && merged.includes("kv_b16td_out") && merged.includes("cable_core");
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  made: R.made.xc && R.made.td && R.made.db && R.made.pinned && R.made.noAlts,
  pins: R.pins.xc && R.pins.td && R.pins.old,
  side: R.side.xcLeft && R.side.tdRight,
  swap: R.swap === true,
  onSheet: R.onSheet.xc && R.onSheet.td,
  spec: R.spec.xc && R.spec.td,
  scaffold: R.scaffold.xc.n > 0 && R.scaffold.td.n > 0 && /P24V/.test(R.scaffold.xc.rails) && !/N24V/.test(R.scaffold.xc.rails) &&
    /N24V/.test(R.scaffold.td.rails) && !/P24V/.test(R.scaffold.td.rails),
  migrate: R.migrate === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-b-unit OK");
