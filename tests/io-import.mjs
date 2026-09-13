/* I/O リスト → PLC 接続図の自動作図。

   ・parse   : タブ区切り/CSV を読み、見出し行は飛ばす。R500 と 500 は同じ。
              種別またはコメントの語から現場機器の記号が決まる
   ・genIn   : 入力アドレスから「PLC入力接続図」ページ — ユニット枚・下地・
              機能欄コメント・現場機器 (2線式) の行配線までできる
   ・genOut  : 出力アドレスから「PLC出力接続図」ページ (別ページ)
   ・twoCol  : 入力が 2 枚 (in1/in2) なら同じページに 2 列で並ぶ
   ・electric: 置いた現場機器が PLC 端子と同じネットになっている (絵だけでない)
   ・clean   : 生成ページの検図 (尺度注意を除く) が 0 件
   ・sensor3 : 3 線式 (近接) は機器だけ置き、配線は引かない
   ・dialog  : 挿入メニューのダイアログから同じ生成が走る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  // ── parse ──
  const t1 = "アドレス\tコメント\t種別\n000\t上流CAM1トリガー\n001\t上流CAM2トリガー\tリミット\nR500,上流照明,ランプ\n502\t検査開始ボタン\n105\t満杯検知\t近接\n";
  const pr = ioListParse(t1);
  out.parse = {
    n: pr.rows.length, skipped: pr.skipped,
    r500: pr.rows.find(r => r.addr === "R500"),
    kinds: pr.rows.map(r => r.kindSym).join(","),
  };

  // ── 生成 ──
  App.project = newProject("IO取込"); UI.renumberPages();
  const n0 = App.project.pages.length;
  const res = ioListGenerate("KV-N40AT", pr.rows, { tag: "-PLC9" });
  out.gen = {
    pages: res.pages.map(pg => pg.name).join(" / "),
    placed: res.placed, unmatched: res.unmatched, sensors3: res.sensors3,
    added: App.project.pages.length - n0,
  };
  const pgIn = res.pages.find(pg => /入力/.test(pg.name));
  const pgOut = res.pages.find(pg => /出力/.test(pg.name));
  const unitIn1 = pgIn && pgIn.devices.find(d => d.sym === "kv_n40at_in1");
  const unitIn2 = pgIn && pgIn.devices.find(d => d.sym === "kv_n40at_in2");
  const unitOut = pgOut && pgOut.devices.find(d => d.sym === "kv_n40at_out");
  out.units = { in1: !!unitIn1, in2: !!unitIn2, out: !!unitOut,
    twoCol: !!(unitIn1 && unitIn2) && unitIn2.x > unitIn1.x + 100,
    tag: unitIn1 && unitIn1.tag };
  out.fn = {
    c000: unitIn1 && unitIn1.props.fn["000"],
    c500: unitOut && unitOut.props.fn["500"],
  };
  // 種別「リミット」の 001 行: 現場機器が置かれ、端子と同じネット
  App.pageIdx = App.project.pages.indexOf(pgIn); applySheet(pgIn);
  const ls = pgIn.devices.find(d => d.sym === "limit_sw");
  const prox = pgIn.devices.find(d => d.sym === "prox");
  const nets = computeNets(pgIn, "closed");
  const pin001 = unitIn1 && symOf(unitIn1.sym).pins.findIndex(q => q.n === "001");
  out.electric = ls && unitIn1 ? {
    tag: ls.tag, wired: nets.pinNet(ls, 0) === nets.pinNet(unitIn1, pin001) ||
      nets.pinNet(ls, 1) === nets.pinNet(unitIn1, pin001),
  } : { missing: true };
  // 3線式 (近接 110) は置くだけ — その行の配線は 0 本
  out.sensor3 = prox ? {
    placed: true,
    rowWires: pgIn.wires.filter(w => !w.gen && w.pts.every(pt => Math.abs(pt[1] - prox.y) < 0.01)).length,
  } : { placed: false };
  // 出力 500 (ランプ) は配線済み
  const lamp = pgOut && pgOut.devices.find(d => d.sym === "lamp");
  out.outLamp = { placed: !!lamp };
  // 検図 (尺度注意を除く)
  const drc = runDRC().filter(i => i.rule !== "尺度と用紙上の寸法")
    .filter(i => res.pages.some(pg => pg.no === i.page))
    .filter(i => i.sev === "err");
  out.clean = { errs: drc.map(i => i.msg).slice(0, 4) };
  return out;
});

/* ── ダイアログ経由 ── */
const DL = await p.evaluate(async () => {
  App.project = newProject("IOダイアログ"); UI.renumberPages();
  const n0 = App.project.pages.length;
  UI.openIoImport();
  await new Promise(r => setTimeout(r, 150));
  const ta = document.getElementById("ioTxt");
  if (!ta) return { open: false };
  ta.value = "500\tシグナルタワー赤\tランプ\n501\tシグナルタワー黄\tランプ";
  document.getElementById("ioTag").value = "-PLC2";
  document.getElementById("ioGo").click();
  await new Promise(r => setTimeout(r, 300));
  const pg = App.project.pages[App.project.pages.length - 1];
  const unit = pg.devices.find(d => /^kv_/.test(d.sym));
  return { open: true, added: App.project.pages.length - n0, name: pg.name,
    tag: unit && unit.tag, cur: curPage() === pg,
    fn: unit && unit.props.fn && unit.props.fn["500"] };
});

const checks = {
  parse: R.parse.n === 5 && R.parse.skipped === 1 &&
    !!R.parse.r500 && R.parse.r500.kindSym === "lamp" &&
    R.parse.kinds === ",limit_sw,lamp,pb_no,prox",
  genIn: /PLC入力接続図/.test(R.gen.pages) && R.gen.added === 2 &&
    R.gen.placed === 5 && R.gen.unmatched.length === 0,
  genOut: /PLC出力接続図/.test(R.gen.pages) && R.units.out === true,
  twoCol: R.units.in1 === true && R.units.in2 === true && R.units.twoCol === true &&
    R.units.tag === "-PLC9",
  fnSet: R.fn.c000 === "上流CAM1トリガー" && R.fn.c500 === "上流照明",
  electric: R.electric.wired === true && /^-/.test(R.electric.tag || ""),
  sensor3: R.sensor3.placed === true && R.sensor3.rowWires === 0 && R.gen.sensors3 === 1,
  outLamp: R.outLamp.placed === true,
  clean: R.clean.errs.length === 0,
  dialog: DL.open === true && DL.added === 1 && /PLC出力接続図/.test(DL.name) &&
    DL.tag === "-PLC2" && DL.cur === true && DL.fn === "シグナルタワー赤",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, DL, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("io-import OK");
