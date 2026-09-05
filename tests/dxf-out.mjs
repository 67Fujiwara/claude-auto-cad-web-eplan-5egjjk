/* DXF 出力の 3 件 (実案件で見つかった取りこぼし)。

   ・tagStretch : タグの表示設定「出力にも出す」は、パレットの基本形に
                  対して置いた寸法違い (cable_core@35 など) にも効く —
                  DXF にタグが出る。既定 (出力に出さない) では出ない
   ・jpSjis     : 和文は Shift-JIS (CP932) の実バイトで出る ($DWGCODEPAGE
                  ANSI_932 と一致)。\U+ エスケープにしない。ASCII 部は無傷
   ・zonePos    : 破線枠のコメントは、つまんで動かした位置 (lx/ly) と
                  文字高 (labelSize) が DXF にもそのまま出る
   ・jpRead     : 取り込みの文字コード自動判別 — CP932 の DXF (自分の
                  出力も日本語 CAD も) と UTF-8 の DXF の両方で和文が読める */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("DXF出力"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;

  // ── タグ設定の寸法違い継承 ──
  const dv = addDevice(pg, "cable_core@35", 120, 80, { tag: "-VTCF0.5sq 4c" });
  App.labelRev++;
  const before = symTagVis(symOf("cable_core@35"));
  const d0 = pageToDXF(pg);
  setSymTagVis("cable_core", "show");          // パレットの基本形に対して設定
  App.labelRev++;
  const d1 = pageToDXF(pg);
  out.tagStretch = { defVis: before, defOut: d0.includes("-VTCF0.5sq 4c"),
    vis: symTagVis(symOf("cable_core@35")), shown: d1.includes("-VTCF0.5sq 4c") };
  setSymTagVis("cable_core", "noprint");       // 片付け (localStorage を汚さない)

  // ── 和文の CP932 実バイト ──
  pg.texts.push({ id: "tj", x: 150, y: 120, text: "上流装置", size: 5 });
  const d2 = pageToDXF(pg);
  const bytes = dxfBytes(d2);
  const hex = [...bytes].map(v => v.toString(16).padStart(2, "0")).join("");
  out.jpSjis = { raw: d2.includes("上流装置"), noEsc: !/\\U\+4E0A/i.test(d2),
    sjis: hex.includes("8fe397ac91959275"),    // 上流装置 の CP932
    ascii: String.fromCharCode(...bytes.slice(0, 9)) === "0\nSECTION" };

  // ── 破線枠コメントの位置・文字高 ──
  pg.zones = pg.zones || [];
  pg.zones.push({ id: "z1", x: 100, y: 150, w: 60, h: 40, label: "中継BOX", lx: -9, ly: -7, labelSize: 30 });
  const lp = zoneLabelPos(pg.zones[0]);
  const d3 = pageToDXF(pg);
  const re = /0\nTEXT\n8\n\w+\n7\nJP\n10\n([\d.-]+)\n20\n([\d.-]+)\n40\n([\d.]+)\n1\n([^\n]*)/g;
  let m, got = null;
  while ((m = re.exec(d3))) if (m[4] === dxfEscape("中継BOX")) got = { x: +m[1], y: +m[2], h: +m[3] };
  out.zonePos = { got, want: { x: +lp.x.toFixed(3), y: +(SHEET.h - lp.y).toFixed(3), h: lp.size } };
  out.zonePos.match = !!got && Math.abs(got.x - lp.x) < 0.01 &&
    Math.abs(got.y - (SHEET.h - lp.y)) < 0.01 && Math.abs(got.h - lp.size) < 0.01;

  // ── 取り込みの文字コード自動判別 ──
  const sjisBuf = dxfBytes(d2).buffer;
  const utf8Buf = new TextEncoder().encode(d2).buffer;
  out.jpRead = { sjis: decodeDxfText(sjisBuf).includes("上流装置"),
    utf8: decodeDxfText(utf8Buf).includes("上流装置") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  tagStretch: R.tagStretch.defVis === "noprint" && R.tagStretch.defOut === false &&
    R.tagStretch.vis === "show" && R.tagStretch.shown === true,
  jpSjis: R.jpSjis.raw === true && R.jpSjis.noEsc === true && R.jpSjis.sjis === true && R.jpSjis.ascii === true,
  zonePos: R.zonePos.match === true,
  jpRead: R.jpRead.sjis === true && R.jpRead.utf8 === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("dxf-out OK");
