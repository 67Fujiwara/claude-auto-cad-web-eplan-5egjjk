/* 目次ページの自動増減 (マスターコピー後の追加・修正でもずれない)。

   目次は 1 枚 30 行 (15 行 × 2 列)。以前はページが増えて入りきらないと
   「ほか n 件 — もう 1 枚足すと載ります」と手動運用だったため、
   マスターをコピーして図面を足すと目次からこぼれていた。

   ・autoAdd : 行が 30 を超えると目次 (2) が自動で増え、1 枚目の直後に並ぶ。
              1 枚目に 30 行・2 枚目に残りが載り、こぼれの注記は出ない
   ・master  : マスターとして保存 → コピーして開く → ページを足す、の
              実運用の流れでも目次が増える
   ・shrink  : ページを減らすと自動で足した目次だけ消える。
              手で追加した目次ページは消さない
   ・dwg     : 目次が増えても図番 (A/B 系列) は重複しない */
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
  const tocs = () => App.project.pages.filter(pg => pg.kind === "toc");
  // ── マスター相当の図面を作って保存 → コピーして開く ──
  App.project = newProject("標準回路マスター"); UI.renumberPages();
  window.confirm = () => true;
  window.prompt = () => "コピーで始めた案件";
  const mid = await UI.wipSave({ asNew: true, name: "標準回路マスター", master: true });
  const cid = await UI.wipCopy(mid);
  out.master = { copied: !!cid, toc0: tocs().length };
  // ── 図面を足していく: 行 30 を超えたら目次 (2) が増える ──
  const pg0 = App.project.pages.find(isDrawingPage);
  while (tocRows().length < 30) {
    const pg = JSON.parse(JSON.stringify(pg0));
    pg.id = uid("pg"); pg.name = `回路 ${tocRows().length + 1}`; pg.devices = []; pg.wires = [];
    App.project.pages.push(pg);
    UI.renumberPages();
  }
  out.at30 = { toc: tocs().length, rows: tocRows().length };
  const pgX = JSON.parse(JSON.stringify(pg0));
  pgX.id = uid("pg"); pgX.name = "追い足しの回路"; pgX.devices = []; pgX.wires = [];
  App.project.pages.push(pgX);
  UI.renumberPages();
  const t2 = tocs();
  out.autoAdd = { toc: t2.length, name2: t2[1] && t2[1].name, auto2: !!(t2[1] && t2[1].tocAuto),
    adjacent: App.project.pages.indexOf(t2[1]) === App.project.pages.indexOf(t2[0]) + 1,
    rows: tocRows().length };
  // 描画: 1 枚目に 30 行・2 枚目に残り。こぼれの注記は出ない
  applySheet(t2[0]);
  const s1 = kindSVG(t2[0]);
  applySheet(t2[1]);
  const s2 = kindSVG(t2[1]);
  out.render = { over1: s1.includes("追い足しの回路") || s1.includes("ほか"),
    on2: s2.includes("追い足しの回路"), title2: s2.includes("目次 (2)") };
  // ── 2 枚ちょうど (60 行) でも最後の行が載り、61 行目で 3 枚目 ──
  while (tocRows().length < 59) {
    const pg = JSON.parse(JSON.stringify(pg0));
    pg.id = uid("pg"); pg.name = `回路 ${tocRows().length + 1}`; pg.devices = []; pg.wires = [];
    App.project.pages.push(pg);
    UI.renumberPages();
  }
  const pg60 = JSON.parse(JSON.stringify(pg0));
  pg60.id = uid("pg"); pg60.name = "ちょうど60の回路"; pg60.devices = []; pg60.wires = [];
  App.project.pages.push(pg60);
  UI.renumberPages();
  const t60 = tocs();
  applySheet(t60[t60.length - 1]);
  const sB = kindSVG(t60[t60.length - 1]);
  out.full2 = { toc: t60.length, rows: tocRows().length,
    last: sB.includes("ちょうど60の回路"), note: sB.includes("ほか") };
  const pg61 = JSON.parse(JSON.stringify(pg0));
  pg61.id = uid("pg"); pg61.name = "はみ出し回路"; pg61.devices = []; pg61.wires = [];
  App.project.pages.push(pg61);
  UI.renumberPages();
  out.grow3 = { toc: tocs().length };
  // 図番の重複なし
  const dwg = App.project.pages.map(pg => pageDwgNo(pg));
  out.dwg = { n: dwg.length, uniq: new Set(dwg).size };
  // ── 減らすと自動の目次だけ消える ──
  App.project.pages = App.project.pages.filter(pg => !/^回路 \d+$/.test(pg.name) &&
    !["追い足しの回路", "ちょうど60の回路", "はみ出し回路"].includes(pg.name));
  UI.renumberPages();
  out.shrink = { toc: tocs().length };
  // 手で足した目次は消えない (行が少なくても残る)
  UI.addSpecialPage("toc");
  UI.renumberPages();
  out.manual = { toc: tocs().length, auto: tocs().filter(pg => pg.tocAuto).length };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  master: R.master.copied === true && R.master.toc0 === 1,
  autoAdd: R.at30.toc === 1 && R.autoAdd.toc === 2 && R.autoAdd.rows === 31 &&
    R.autoAdd.name2 === "目次 (2)" && R.autoAdd.auto2 === true && R.autoAdd.adjacent === true,
  render: R.render.over1 === false && R.render.on2 === true && R.render.title2 === true,
  full2: R.full2.toc === 2 && R.full2.rows === 60 && R.full2.last === true &&
    R.full2.note === false,
  grow3: R.grow3.toc === 3,
  dwg: R.dwg.uniq === R.dwg.n,
  shrink: R.shrink.toc === 1,
  manual: R.manual.toc === 2 && R.manual.auto === 0,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("toc-auto OK");
