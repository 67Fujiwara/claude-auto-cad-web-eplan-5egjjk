/* 出力時シンプル図枠 — 標準は JIS、切り替えると出力のときだけシンプル。

   ・screenJis : meta.outPlain を入れても画面の図枠は JIS のまま
                (尺度欄・接点ミラー表がある)
   ・outWrap   : withOutputFrame の間だけシンプル図枠 (管理番号の帯・尺度欄
                なし) になり、終わると必ず JIS に戻る。切り替えていない
                図面では中も JIS のまま
   ・dxfOut    : メニューの DXF出力が全ページシンプル図枠で出る。
                切り替えなしなら JIS のまま (帯は出ない)
   ・pdfOut    : PDF出力 (全ページ1ファイル) もシンプル図枠で描かれ、
                出力後は画面様式 (JIS) に戻る
   ・ui        : 図枠・表題欄の設定の「様式」で切り替えられ、保存されるのは
                meta.outPlain — 画面まで切り替える旧 frameStyle は書かない
   ・migrate   : 旧形式 (meta.frameStyle="plain") の保存データを開くと
                「出力時シンプル」に読み替え、画面は JIS になる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("出力様式"); UI.renumberPages();
  const meta = projectMeta();
  meta.author = "サンプル電機株式会社"; meta.ctrlNo = "A000000ELE";
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const k1 = addDevice(pg, "coil", 120, 100, { tag: "-KA1" });
  const c1 = addDevice(pg, "aux_no", 160, 100, { tag: "-KA1" });
  c1.linkTo = k1.id;

  // ── screenJis: 切り替えても画面は JIS ──
  meta.outPlain = true;
  applySheet(pg);
  const svgScreen = sheetSVG(pg, { print: true });
  out.screenJis = { scale: svgScreen.includes("尺度"), mirror: mirrorSVG(k1) !== "",
    style: frameStyle() };

  // ── outWrap: 包んでいる間だけシンプル、終わると戻る ──
  const inWrap = await withOutputFrame(() => {
    applySheet(pg);
    const s = sheetSVG(pg, { print: true });
    return { style: frameStyle(), ctrl: s.includes("管理番号"), scale: s.includes("尺度") };
  });
  const after = frameStyle();
  applySheet(pg);
  meta.outPlain = false;
  const inWrapOff = await withOutputFrame(() => frameStyle());
  meta.outPlain = true;
  out.outWrap = { in: inWrap, after, off: inWrapOff };

  // ── dxfOut: メニューの DXF出力 (保存だけ横取り) ──
  const got = [];
  const keepDl = window.downloadFile;
  window.downloadFile = (name, data) => got.push({ name,    // DXF は Shift_JIS で保存される
    text: typeof data === "string" ? data : new TextDecoder("shift_jis").decode(data) });
  await UI.exportDXF();
  await new Promise(r => setTimeout(r, App.project.pages.length * 400 + 300));
  out.dxfPlain = { n: got.length,
    ctrl: got.length > 0 && got.every(f => f.text.includes("管理番号")),
    scale: got.some(f => f.text.includes("尺度")) };
  got.length = 0;
  meta.outPlain = false;
  await UI.exportDXF();
  await new Promise(r => setTimeout(r, App.project.pages.length * 400 + 300));
  out.dxfStd = { n: got.length, ctrl: got.some(f => f.text.includes("管理番号")) };
  window.downloadFile = keepDl;
  meta.outPlain = true;

  // ── pdfOut: PDF出力も出力様式 (buildPDF を横取りして様式を記録) ──
  const keepBuild = window.buildPDF;
  const styles = [];
  window.buildPDF = async () => { styles.push(frameStyle()); return new Blob(["%PDF-x"], { type: "application/pdf" }); };
  await UI.exportPDF();
  window.buildPDF = keepBuild;
  out.pdfOut = { styles: styles.join(","), after: frameStyle() };
  return out;
});

/* ── ui: 図枠・表題欄の設定で切り替え ── */
const DU = await p.evaluate(async () => {
  projectMeta().outPlain = false;
  UI.sheetSetup();
  await new Promise(r => setTimeout(r, 200));
  const sel = document.getElementById("tbFrameStyle");
  if (!sel) return { open: false };
  const labels = [...sel.options].map(o => o.textContent).join(" / ");
  sel.value = "plain";
  document.getElementById("tbOk").click();
  await new Promise(r => setTimeout(r, 250));
  const m = projectMeta();
  return { open: true, labels, outPlain: m.outPlain === true,
    noFs: m.frameStyle === undefined, style: frameStyle() };
});

/* ── migrate: 旧形式の保存データを読み出しの共通処理で開く ── */
const MG = await p.evaluate(() => {
  const p2 = newProject("旧形式の図面");
  p2.meta = { ...(p2.meta || {}), frameStyle: "plain" };
  wipShowProject(p2);           // 作業中/履歴/ファイル読み込みと同じ経路
  return { out: projectMeta().outPlain === true,
    fs: App.project.meta.frameStyle, style: frameStyle() };
});

const checks = {
  screenJis: R.screenJis.scale === true && R.screenJis.mirror === true &&
    R.screenJis.style === "std",
  outWrap: R.outWrap.in.style === "plain" && R.outWrap.in.ctrl === true &&
    R.outWrap.in.scale === false && R.outWrap.after === "std" && R.outWrap.off === "std",
  dxfOut: R.dxfPlain.n >= 2 && R.dxfPlain.ctrl === true && R.dxfPlain.scale === false &&
    R.dxfStd.n === R.dxfPlain.n && R.dxfStd.ctrl === false,
  pdfOut: R.pdfOut.styles === "plain" && R.pdfOut.after === "std",
  ui: DU.open === true && /出力時/.test(DU.labels) && DU.outPlain === true &&
    DU.noFs === true && DU.style === "std",
  migrate: MG.out === true && MG.fs === undefined && MG.style === "std",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, DU, MG, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("frame-outplain OK");
