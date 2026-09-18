/* 相互参照の区分 (格子参照) は「相手のページの図枠」で数える。

   以前は今表示中の図枠 (グローバル SHEET) で数えていたため、用紙・尺度の
   違うページを指す参照が別の区分にずれた (例: 1:1.5 の葉のコイル D2 を
   F3 と書く)。表示中ページの尺度を変えるだけでも参照文字が動いた。

   ・xref   : 連動接点の相互参照 — コイルの葉が 1:1.5 でも、コイルの
             位置をその葉の図枠で数えた区分 (D2) を書く。見ている側の
             葉の尺度を 1:2 に変えても変わらない
   ・mirror : コイル側の接点ミラー表も、接点の葉 (1:1) の図枠で数える
   ・goto   : 行き先 (継続先) の旗の「図番/区分」も相手の葉の図枠で数え、
             こちらの葉の尺度に影響されない
   ・self   : 同じ葉の中の区分 (検図 loc など従来動作) は変わらない */
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
  App.project = newProject("相互参照の区分");
  const pgA = App.project.pages.find(isDrawingPage);     // コイルの葉 (1:1.5)
  const pgB = { ...JSON.parse(JSON.stringify(pgA)), id: "pgXrefB", name: "接点の葉" };
  pgB.devices = []; pgB.wires = [];
  App.project.pages.push(pgB);
  UI.renumberPages();
  pgA.scale = "1:1.5"; pgA.paper = "A3"; pgA.orient = "landscape";
  pgB.scale = null;
  pgA.devices.length = 0; pgA.wires.length = 0;
  // コイルは A3 横 1:1.5 の (155,260) = 区分 D2 (1:1 で数えると F3 になる位置)
  const coil = addDevice(pgA, "coil", 155, 260, { tag: "-CR1" });
  const cont = addDevice(pgB, "aux_no", 70, 65, { tag: "-CR1" });
  cont.linkTo = coil.id;

  // ── xref: 接点の葉 (1:1) から見たコイルの区分 ──
  App.pageIdx = App.project.pages.indexOf(pgB); applySheet(pgB);
  const loc11 = devLocation(coil);
  const svgB = exportSheetSVG(pgB);
  pgB.scale = "1:2"; applySheet(pgB);
  const loc12 = devLocation(coil);
  pgB.scale = null; applySheet(pgB);
  out.xref = { loc11, loc12, drawn: svgB.includes("/" + loc11) };

  // ── mirror: コイルの葉 (1:1.5) のミラー表から見た接点の区分 ──
  applySheet(pgA);
  const locCont = devLocation(cont);
  const svgA = exportSheetSVG(pgA);
  out.mirror = { locCont, drawn: svgA.includes("/" + locCont) };

  // ── goto: 行き先の旗の区分も相手の葉 (1:1.5) の図枠で ──
  const gB = addDevice(pgB, "goto_ref", 100, 100, {});
  gB.props = { toPage: pgA.id };
  const lB = addDevice(pgB, "link", 120, 100, { tag: "-GO1" });
  addWire(pgB, [[100, 100], [120, 100]]);
  const gA = addDevice(pgA, "goto_ref", 200, 50, {});
  gA.props = { toPage: pgB.id };
  const lA = addDevice(pgA, "link", 220, 50, { tag: "-GO1" });
  addWire(pgA, [[200, 50], [220, 50]]);
  App.labelRev++;
  applySheet(pgB);
  const goB1 = gotoRefText(gB);          // 相手 = pgA (1:1.5) の (200,50) → 3A
  pgB.scale = "1:2"; applySheet(pgB);
  App.labelRev++;
  const goB2 = gotoRefText(gB);
  pgB.scale = null; applySheet(pgB);
  out.goto = { goB1, goB2 };

  // ── self: 同じ葉の中の区分は従来どおり (適用中の図枠で) ──
  applySheet(pgA);
  out.self = { colA: sheetCol(155), rowA: sheetRow(260) };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  /* コイル (155,260)@A3横1:1.5 = D2。1:1 の図枠で数えた F3 ではない。
     見ている葉の尺度 1:2 でも変わらない */
  xref: /\.D2 /.test(R.xref.loc11) && R.xref.loc11 === R.xref.loc12 &&
    R.xref.drawn === true,
  /* 接点 (70,65)@A3横1:1 = B2。コイルの葉 (1:1.5) から数えた A1 ではない */
  mirror: /\.B2 /.test(R.mirror.locCont) && R.mirror.drawn === true,
  /* 旗の相手 (200,50)@1:1.5 = 3A。見ている葉の尺度に影響されない */
  goto: /\/3A$/.test(R.goto.goB1) && R.goto.goB1 === R.goto.goB2,
  self: R.self.colA === 2 && R.self.rowA === "D",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("xref-zone OK");
