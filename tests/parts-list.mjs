/* 機器リスト (制御盤に使う機器の一覧ページ)。

   ・parse  : Excel 貼り付け (タブ区切り) を読み替える — 見出し行を飛ばし、
             先頭の № は捨てて振り直す。個数の空欄は 1。カンマ区切りも可
   ・pages  : 80 件 → 機器リストのページが 3 枚 (30/30/20) でき、名前と
             A 系列の図番が付き、書類ページ (仕様など) の後ろに並ぶ
   ・render : 見本の体裁 — 見出し (№/部品名/型式/メーカー/個数)・薄緑の行・
             件数表示。ページごとに受け持ちの行だけが出る
   ・outPdf : 印刷用 SVG と DXF にも同じ内容が出る
   ・round  : ダイアログを開き直すと今の内容がタブ区切りで入っている
             (直して取り込み直せる・Excel へ貼り戻せる)
   ・shrink : 少ない行で取り込み直すと余ったページが消える
   ・toc    : 目次に機器リストのページが載る */
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
  App.project = newProject("機器リスト確認"); UI.renumberPages();
  // ── parse 単体 ──
  const t1 = "№\t部品名\t型式\tメーカー\t個数\n1\t漏電遮断器\tNV32-SVF 2P 15A 30mA\t三菱電機\t1\n2\tサーキットプロテクタ\tCP30-BA 2P 1-M 5A A\t三菱電機\t3\n3\tDINレール\tIAL-1A\t\nマークシート,BNM7,,2";
  const pr = partsParse(t1);
  out.parse = { n: pr.length, r0: pr[0], qty3: pr[2].qty, comma: pr[3] };

  // ── 80 件をダイアログから取り込む ──
  const lines = ["№\t部品名\t型式\tメーカー\t個数",
    "1\t漏電遮断器\tNV32-SVF 2P 15A 30mA\t三菱電機\t1",
    "2\tサーキットプロテクタ\tCP30-BA 2P 1-M 5A A\t三菱電機\t3"];
  for (let i = 3; i <= 80; i++) lines.push(`${i}\t機器${i}\tMODEL-${i}\tメーカー${i}\t2`);
  UI.openPartsList();
  await new Promise(r => setTimeout(r, 150));
  const ta = document.getElementById("plTxt");
  if (!ta) return { open: false };
  ta.value = lines.join("\n");
  document.getElementById("plGo").click();
  await new Promise(r => setTimeout(r, 250));
  const parts = App.project.pages.filter(pg => pg.kind === "parts");
  out.pages = { n: parts.length, names: parts.map(pg => pg.name).join(" / "),
    dwg: parts.map(pg => pageDwgNo(pg)).join(","),
    cur: curPage() === parts[0],
    beforeDrawing: App.project.pages.indexOf(parts[2]) < App.project.pages.findIndex(isDrawingPage) };

  // ── 描画 (1 枚目と 3 枚目) ──
  applySheet(parts[0]);
  const s1 = kindSVG(parts[0]);
  applySheet(parts[2]);
  const s3 = kindSVG(parts[2]);
  out.render = {
    heads: ["機器リスト", "部品名", "型式", "メーカー", "個数"].every(t => s1.includes(t)),
    total: s1.includes("全 80 件 (この頁 1〜30)"),
    row1: s1.includes("漏電遮断器") && s1.includes("NV32-SVF 2P 15A 30mA"),
    fills1: (s1.match(/#eaf4e4/g) || []).length,
    p3total: s3.includes("全 80 件 (この頁 61〜80)"),
    fills3: (s3.match(/#eaf4e4/g) || []).length,
    p3rows: s3.includes("機器80") && !s3.includes("漏電遮断器"),
  };
  // ── 印刷 SVG / DXF ──
  const prn = exportSheetSVG(parts[0]);
  applySheet(parts[0]);
  const dxf = pageToDXF(parts[0]);
  out.outPdf = { svg: prn.includes("漏電遮断器"), dxf: dxf.includes("漏電遮断器") };
  // ── 目次 ──
  out.toc = tocRows().filter(r => /機器リスト/.test(r.name)).length;
  return out;
});

/* ── 開き直すと今の内容が入っている ── */
const RT = await p.evaluate(async () => {
  UI.openPartsList();
  await new Promise(r => setTimeout(r, 150));
  const tas = document.querySelectorAll("#plTxt");
  const ta = tas[tas.length - 1];
  const v = ta ? ta.value : "";
  const head = v.split("\n")[0];
  // 10 件だけにして取り込み直す → ページが 1 枚に減る
  ta.value = v.split("\n").slice(0, 11).join("\n");
  const gos = document.querySelectorAll("#plGo");
  gos[gos.length - 1].click();
  await new Promise(r => setTimeout(r, 250));
  const parts = App.project.pages.filter(pg => pg.kind === "parts");
  return { head, hasModel: v.includes("NV32-SVF 2P 15A 30mA"), lines: v.split("\n").length,
    shrink: parts.length, rows: partsRows().length };
});

const checks = {
  noPageErrors: errs.length === 0,
  parse: R.parse.n === 4 && R.parse.r0.name === "漏電遮断器" &&
    R.parse.r0.model === "NV32-SVF 2P 15A 30mA" && R.parse.r0.maker === "三菱電機" &&
    R.parse.qty3 === "1" && R.parse.comma.name === "マークシート" && R.parse.comma.qty === "2",
  pages: R.pages.n === 3 && R.pages.names === "機器リスト / 機器リスト (2) / 機器リスト (3)" &&
    R.pages.dwg.split(",").every(d => /^A/.test(d)) && R.pages.cur === true &&
    R.pages.beforeDrawing === true,
  render: R.render.heads === true && R.render.total === true && R.render.row1 === true &&
    R.render.fills1 === 30 && R.render.p3total === true && R.render.fills3 === 20 &&
    R.render.p3rows === true,
  outPdf: R.outPdf.svg === true && R.outPdf.dxf === true,
  toc: R.toc === 3,
  round: RT.head === "№\t部品名\t型式\tメーカー\t個数" && RT.hasModel === true &&
    RT.lines === 81,
  shrink: RT.shrink === 1 && RT.rows === 10,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, RT, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("parts-list OK");
