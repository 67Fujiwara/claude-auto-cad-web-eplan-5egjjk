/* キーエンス KV-8000/7000 (ビルディングブロック形) の入出力ユニット KV-B16XC / KV-B16TD
   (ネジ端子台) の結線図記号。

   ・made     : kv_b16xc_in (入力 16点) / kv_b16td_out (出力 16点) がパレット
               (DB_SYMBOLS) に載り、既定のピン留めにも入る。拡張の順番で割付が
               変わらないので 2/3台目 (_c1/_c2) の記号は無く、expAlts も持たない
   ・pins     : 端子は 0〜15 (公式の接続図の Terminal No.) + コモン C0 の 1 行。
               C1 は C0 と内部で短絡しているので描かない。
               既存の拡張ユニット (000〜 + COM 1 行) は変えない
   ・side     : 入力は現場側が左、出力は現場側が右 (KV Nano と同じ向き)
   ・swap     : 機種入替グループは kv_b_in / kv_b_out (KV Nano とは混ぜない)
   ・onSheet  : 見出し「入力 16点」「出力 16点」(拡張の字は付かない) と
               注記「※信号名 000〜015。C1 は C0 と内部短絡」が紙に載る
               (出力の注記はレール下端の電位リンクに届かない 29 字以内で、下地を
               作っても検図の「記号の重なり」が出ない)。
               入力はコモン +24V も宣言
   ・spec     : 説明に刻印 (0〜15・C0・C1) と信号名 (000〜015・COM0・COM1)・C0/C1 の
               内部短絡と C1 を描かないこと・ネジ端子台・定格 (出力 DC30V 0.3A MOSFET
               シンク 過電流保護)・入力の DC24V/DC5V 切換・シリーズ名を書く
   ・scaffold : 置いて「結線図の下地を作る」で C0 がコモン側レールにつながる。
               入力は P24V 側、出力は N24V 側
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
  const expB = "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,C0";
  const exp3 = Array.from({ length: 16 }, (_, i) => `0${String(i).padStart(2, "0")}`).join(",") + ",COM";
  out.pins = { xc: names(xc) === expB, td: names(td) === expB, old: names(SYMBOLS_BY_ID.kv_nc16exe_in) === exp3 };
  const flip = s => s.thumbBox[0] < 0;
  out.side = { xcLeft: !flip(xc), tdRight: flip(td) };
  out.swap = xc.swapGroup === "kv_b_in" && td.swapGroup === "kv_b_out";
  const noteOf = s => { const m = /※[^<]*/.exec(s.body); return m ? m[0] : ""; };
  out.onSheet = { xc: xc.body.includes(">入力 16点<") && !xc.body.includes("拡張") &&
      noteOf(xc).startsWith("※信号名 000〜015。C1 は C0 と内部短絡") && xc.body.includes("コモンは +24V"),
    td: td.body.includes(">出力 16点<") && !td.body.includes("拡張") && noteOf(td) === "※信号名 000〜015。C1 は C0 と内部短絡",
    tdLen: noteOf(td).length };
  const common = s => /刻印は 0〜15 と C0・C1 \(信号名は 000〜015 と COM0・COM1\)/.test(s.desc) &&
    /C0\/C1 は内部で短絡/.test(s.desc) && /16点\/1コモン/.test(s.desc) && /ネジ端子台/.test(s.desc) &&
    /C0 の 1 行にまとめ、C1 は描かない/.test(s.desc) && /コモンは 1 つ/.test(s.desc) && /C0・C1 は内部で短絡/.test(s.stdNote);
  out.spec = { xc: common(xc) && /DC24V \(5\.3mA\) \/ DC5V/.test(xc.desc) &&
      /KV-8000\/7000/.test(xc.desc) && /入出力ユニット/.test(xc.desc) && !/拡張ユニット/.test(xc.desc) && /スロット位置/.test(xc.desc),
    td: common(td) && /DC30V 0\.3A/.test(td.desc) && /MOSFET シンク/.test(td.desc) && /過電流保護/.test(td.desc) };
  // ── 置いて下地 ──
  const sc = (symId) => {
    App.project = newProject("KV-B"); UI.renumberPages();
    const pg = App.project.pages.find(isDrawingPage);
    App.pageIdx = App.project.pages.indexOf(pg);
    const want = symSheetSpec(SYMBOLS_BY_ID[symId]);
    pg.paper = want.paper; pg.orient = want.orient; pg.scale = want.scale; applySheet(pg);
    pg.devices.length = 0; pg.wires.length = 0;
    const d = addDevice(pg, symId, 200, 40, {});
    const n = buildIoScaffold(pg, d);
    App.labelRev++;
    const nets = computeNets(pg, "closed");
    const pins = symOf(d.sym).pins;
    const c0 = nets.pinNet(d, pins.findIndex(q => q.n === "C0"));
    const rails = pg.devices.filter(d2 => d2 !== d && d2.tag && nets.pinNet(d2, 0) === c0).map(d2 => d2.tag);
    // 注記の帯がレール下端の電位リンクに届いていないこと (検図の「記号の重なり」が出ない)
    const overlap = runDRC().filter(i => i.rule === "記号の重なり").length;
    return { n, rails: rails.join(","), noC1: !pins.some(q => q.n === "C1"), overlap };
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
  onSheet: R.onSheet.xc && R.onSheet.td && R.onSheet.tdLen <= 29,
  spec: R.spec.xc && R.spec.td,
  scaffold: R.scaffold.xc.n > 0 && R.scaffold.td.n > 0 && R.scaffold.xc.noC1 && R.scaffold.td.noC1 &&
    R.scaffold.xc.overlap === 0 && R.scaffold.td.overlap === 0 && /P24V/.test(R.scaffold.xc.rails) && !/N24V/.test(R.scaffold.xc.rails) &&
    /N24V/.test(R.scaffold.td.rails) && !/P24V/.test(R.scaffold.td.rails),
  migrate: R.migrate === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-b-unit OK");
