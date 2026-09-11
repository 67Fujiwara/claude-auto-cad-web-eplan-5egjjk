/* 接点ミラー表 (接点がどこにあるかの相互参照) の左下配置。

   ・refFmt  : 位置参照が「ページNo.行英字列数字 (図面番号)」(例 5.D3 (B-001))
              — 区画に加え、PDF で紙を探すための図面番号を併記する
   ・corner  : 表は図面の左下 (図枠内側) から、コイルの並び順で横に並ぶ。
              下ぞろえで、右下の表題欄 (案件名など) の上端より上に出ない
   ・header  : 表の見出しにコイルタグが出る (表がコイルから離れたため)。
              画面 SVG・DXF・当たり判定の箱の 3 つとも
   ・noLead  : コイルから表への破線の引き出し線は描かない (左下へ集約
              したので、ページを横切る長い破線になってしまう)
   ・svgDxf  : 参照文字列が画面 SVG と DXF の両方に出る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("ミラー左下"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const k1 = addDevice(pg, "coil", 120, 100, { tag: "-KA1" });
  const k2 = addDevice(pg, "coil", 200, 100, { tag: "-KA2" });
  const c1 = addDevice(pg, "aux_no", 120, 160, { tag: "-KA1" });
  const c2 = addDevice(pg, "aux_nc", 200, 160, { tag: "-KA1" });
  const c3 = addDevice(pg, "aux_no", 260, 60, { tag: "-KA2" });
  c1.linkTo = k1.id; c2.linkTo = k1.id; c3.linkTo = k2.id;
  out.ids = { k1: k1.id };

  /* A3 (420×297, とじ代 20, 横 8 区画 = 48.75mm) で手計算した区画:
     (120,160) → 列 floor((120-20)/48.75)+1 = 3、行 floor((160-10)/46.17) = 3 = D
     (260, 60) → 列 5、行 1 = B。ページ番号はこの図面ページの no */
  out.refFmt = { c1: devLocation(c1), c3: devLocation(c3), no: pg.no, dwg: pageDwgNo(pg) };

  const o1 = mirrorOrigin(k1), o2 = mirrorOrigin(k2);
  const s1 = mirrorTableSize(k1), s2 = mirrorTableSize(k2);
  const tb = titleBlockRect();
  const bottom = SHEET.h - SHEET.margin - 1.5;
  out.corner = {
    left: Math.abs(o1.x - (SHEET.marginLeft + 3)) < 0.1,
    sideBySide: o2.x > o1.x + s1.w,
    bottom1: Math.abs((o1.y0 + 2 * 4.2) - bottom) < 0.1,
    bottom2: Math.abs((o2.y0 + 1 * 4.2) - bottom) < 0.1,
    belowTitleTop: (o1.y0 - 2 - 4.6) >= tb.y - 0.01 && (o2.y0 - 2 - 4.6) >= tb.y - 0.01,
  };

  const box1 = mirrorLabelBoxes(k1)[0];
  const m1 = mirrorSVG(k1);
  out.header = {
    boxTop: box1 && Math.abs(box1.y - (o1.y0 - 2 - 4.6)) < 0.1 && box1.h === 4.6,
    svg: m1.includes(">-KA1<") && m1.includes('font-weight="bold"'),
  };
  out.noLead = !m1.includes("stroke-dasharray");
  const dxf = pageToDXF(pg);
  out.svgDxf = {
    svgRef: m1.includes("/" + out.refFmt.c1),
    dxfRef: dxf.includes("/" + out.refFmt.c1),
    dxfTag: dxf.split(/\r?\n/).includes("-KA1"),
  };
  return out;
});

const checks = {
  /* 区画 + そのページの図面番号 (PDF では図番で紙を探すため併記) */
  refFmt: R.refFmt.c1 === `${R.refFmt.no}.D3 (${R.refFmt.dwg})` &&
    R.refFmt.c3 === `${R.refFmt.no}.B5 (${R.refFmt.dwg})` && R.refFmt.dwg.length > 0,
  corner: R.corner.left === true && R.corner.sideBySide === true &&
    R.corner.bottom1 === true && R.corner.bottom2 === true && R.corner.belowTitleTop === true,
  header: R.header.boxTop === true && R.header.svg === true,
  noLead: R.noLead === true,
  svgDxf: R.svgDxf.svgRef === true && R.svgDxf.dxfRef === true && R.svgDxf.dxfTag === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("mirror-corner OK");
