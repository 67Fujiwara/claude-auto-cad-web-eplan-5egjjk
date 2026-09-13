/* マスターファイルからの図面 (ページ) 呼び出し。

   ・insert  : マスターの選んだページの写しが現在ページの後ろへ入る。
              名前・機器・配線・線番はそのまま
   ・idsNew  : 挿し込んだページ・機器・配線の id は振り直される
              (マスターと同じ id が図面の中に 2 つできない)
   ・linkOk  : コイル連動 (linkTo) は一緒に呼び出したページの中で
              付け替わる。片方だけ呼ぶと外れて検図が知らせる
   ・symKeep : マスターに埋め込まれた自作シンボルも一緒に併合され、
              呼び出したページがそのまま描ける
   ・keepSrc : マスター側の保存データは変わらない
   ・dialog  : 挿入メニューのダイアログから同じ呼び出しができる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

/* ── マスターを作って保存 ── */
const MK = await p.evaluate(async () => {
  App.project = newProject("マスター元"); UI.renumberPages();
  const pg1 = App.project.pages.find(isDrawingPage);
  pg1.name = "標準電源回路";
  pg1.devices.length = 0; pg1.wires.length = 0;
  // 自作シンボル (マスターにだけある)
  const sym = { id: "usr_master_box", db: true, group: "自作", cat: "db", letter: "U",
    name: "マスター試験箱", nameEn: "mbox", desc: "", pins: [{ x: 0, y: 0, n: "1" }],
    sim: "none", bounds: [-10, -2, 20, 14], custom: true, imported: true, nonstd: true,
    body: '<rect x="-8" y="2" width="16" height="10"/>' };
  DB_SYMBOLS.push(sym); SYMBOLS_BY_ID[sym.id] = sym;
  const k1 = addDevice(pg1, "coil", 200, 120, { tag: "-MK1" });
  addDevice(pg1, "usr_master_box", 120, 60, { tag: "-U9" });
  const w1 = addWire(pg1, [[100, 100], [180, 100]]);
  setWireNumber(pg1, w1, "M101");
  // 2 ページ目: 1 ページ目のコイルへ連動する接点
  const pg2 = newPage("標準照明回路", App.project.pages.length + 1);
  App.project.pages.push(pg2);
  const c1 = addDevice(pg2, "aux_no", 120, 100, { tag: "-MK1" });
  c1.linkTo = k1.id;
  addDevice(pg2, "lamp", 180, 100, { tag: "-ML1" });
  UI.renumberPages();
  const id = await UI.wipSave({ asNew: true, name: "標準回路マスター", master: true });
  return { saved: !!id, k1: k1.id, c1: c1.id, pg1Id: pg1.id, masterId: id,
    dev1: pg1.devices.map(d => d.id) };
});

/* ── 新しい図面へ 2 ページとも呼び出す (エンジン直) ── */
const R = await p.evaluate(async ([mk]) => {
  // 自作シンボルを一度消す — マスターの埋め込みから併合できることを見る
  delete SYMBOLS_BY_ID["usr_master_box"];
  const i0 = DB_SYMBOLS.findIndex(s2 => s2.id === "usr_master_box");
  if (i0 >= 0) DB_SYMBOLS.splice(i0, 1);
  App.project = newProject("案件A"); UI.renumberPages();
  const n0 = App.project.pages.length;
  const snap = await relGetSnapshot(mk.masterId);
  const srcIdx = [snap.pages.findIndex(pg => pg.name === "標準電源回路"),
    snap.pages.findIndex(pg => pg.name === "標準照明回路")];
  const clones = insertMasterPages(snap, srcIdx, App.project.pages.length);
  UI.renumberPages();
  const [cp1, cp2] = clones;
  const coil = cp1.devices.find(d => d.sym === "coil");
  const aux = cp2.devices.find(d => /^aux_no/.test(d.sym));
  const box = cp1.devices.find(d => /usr_master_box/.test(d.sym));
  const w = cp1.wires[0];
  const out = {
    added: App.project.pages.length - n0,
    names: clones.map(pg => pg.name).join(" / "),
    wireNum: w && w.num,
    idsNew: coil.id !== mk.k1 && aux.id !== mk.c1 && cp1.id !== mk.pg1Id &&
      !mk.dev1.includes(coil.id),
    linkOk: aux.linkTo === coil.id,
    symKeep: !!box && symOf(box.sym).name === "マスター試験箱",
  };
  // 片方 (接点ページ) だけ呼び出す → linkTo は外れ、検図が知らせる
  const clones2 = insertMasterPages(snap, [snap.pages.findIndex(pg => pg.name === "標準照明回路")],
    App.project.pages.length);
  UI.renumberPages();
  const aux2 = clones2[0].devices.find(d => /^aux_no/.test(d.sym));
  out.linkCut = { gone: !aux2.linkTo,
    told: runDRC().some(i => i.page === clones2[0].no && /リンクされていません/.test(i.msg)) };
  // マスター側は変わっていない
  const snap2 = await relGetSnapshot(mk.masterId);
  out.keepSrc = snap2.pages.some(pg => pg.devices.some(d => d.id === mk.k1)) &&
    snap2.pages.length === snap.pages.length;
  return out;
}, [MK]);

/* ── ダイアログ経由 ── */
const DL = await p.evaluate(async () => {
  App.project = newProject("案件B"); UI.renumberPages();
  const n0 = App.project.pages.length;
  App.pageIdx = n0 - 1;
  UI.openMasterPages();
  await new Promise(r => setTimeout(r, 400));
  const boxes = [...document.querySelectorAll(".mpPg")];
  if (!boxes.length) return { open: false };
  // 「標準電源回路」の行にチェック (マスターには表紙・目次なども入っている)
  const target = boxes.find(c => c.parentElement.textContent.includes("標準電源回路"));
  if (!target) return { open: true, noRow: true };
  target.checked = true;
  document.getElementById("mpGo").click();
  await new Promise(r => setTimeout(r, 300));
  const pg = curPage();
  return { open: true, added: App.project.pages.length - n0,
    name: pg.name, at: App.pageIdx === n0, devs: pg.devices.length };
});

const checks = {
  insert: MK.saved === true && R.added === 2 &&
    R.names === "標準電源回路 / 標準照明回路" && R.wireNum === "M101",
  idsNew: R.idsNew === true,
  linkOk: R.linkOk === true && R.linkCut.gone === true && R.linkCut.told === true,
  symKeep: R.symKeep === true,
  keepSrc: R.keepSrc === true,
  dialog: DL.open === true && DL.added === 1 && DL.name === "標準電源回路" &&
    DL.at === true && DL.devs === 2,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, MK, R, DL, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("master-pages OK");
