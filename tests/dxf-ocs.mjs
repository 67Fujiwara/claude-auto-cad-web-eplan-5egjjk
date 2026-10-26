/* DXF の読み取りを AutoCAD の見え方に合わせる。

   実物の盤図 DXF で、AutoCAD に無い位置に部品がばらけて出た・見えない線が
   出た (ミラーした部品・非表示の画層などを無視していた)。

   ・mirror  : 押し出し方向 Z=-1 (AutoCAD でミラーした 2D 図形) は X が反転
              した座標系 (OCS)。円・円弧・ポリライン・ブロックを正しい側に置く。
              円弧は角度も反転 (90→180 など)。LINE は WCS なので反転しない
   ・block   : ブロックの基点は倍率・回転を掛けてから引く。回転したブロックの
              円弧・文字の角度も回る。16 段の入れ子でも描く。配列挿入 (列×行)
   ・hidden  : 非表示 (色が負)・フリーズ・印刷しない・Defpoints の画層、
              ペーパー空間 (67=1)、非表示 (60=1)、非表示の属性は読まない。
              フリーズ画層のブロックは中身ごと消え、非表示画層のブロックは
              画層 0 の中身だけ消える
   ・bulge   : ポリラインの膨らみ (角の R) は円弧の点になる。頂点の 70 で
              「閉じ」が消えない
   ・ellipse : 楕円 (ELLIPSE) を折れ線で読む。Z=-1 は逆回り
   ・misc    : MTEXT の向き (11/21) を角度にする。ポリフェイス (3D 面) は読まない
   ・ltype   : 線種 (かくれ線などの破線) を読む。BYLAYER = 画層の線種、BYBLOCK =
              差し込んだブロックの線種、$LTSCALE と図形ごとの尺度 (48) を掛ける。
              すき間から始まるパターンは線から始まるように回す
   ・ltOut   : 盤図ページにすると、破線は印刷 SVG で stroke-dasharray、DXF では
              線種 (LTYPE を表に登録) になる。加工用 DXF は実線のまま。
              実線と破線が端でつながっていても 1 本にまとめない */
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
  const L = [];
  const add = (...kv) => { for (let i = 0; i < kv.length; i += 2) L.push(String(kv[i]), String(kv[i + 1])); };
  // ── TABLES: 画層 ──
  add(0, "SECTION", 2, "HEADER", 9, "$LTSCALE", 40, 2, 0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LTYPE");
  add(0, "LTYPE", 2, "HIDDEN2", 70, 0, 73, 2, 40, 9.525, 49, 6.35, 49, -3.175);
  add(0, "LTYPE", 2, "GAPFIRST", 70, 0, 73, 3, 40, 6, 49, -1, 49, 4, 49, -1);
  add(0, "LTYPE", 2, "CONTINUOUS", 70, 0, 73, 0, 40, 0);
  add(0, "ENDTAB");
  add(0, "TABLE", 2, "LAYER");
  add(0, "LAYER", 2, "HID", 70, 0, 62, 7, 6, "HIDDEN2");
  add(0, "LAYER", 2, "VIS", 70, 0, 62, 7);
  add(0, "LAYER", 2, "OFF", 70, 0, 62, -7);
  add(0, "LAYER", 2, "FRZ", 70, 1, 62, 7);
  add(0, "LAYER", 2, "NOPLOT", 70, 0, 62, 7, 290, 0);
  add(0, "ENDTAB", 0, "ENDSEC");
  // ── BLOCKS ──
  add(0, "SECTION", 2, "BLOCKS");
  add(0, "BLOCK", 2, "B", 10, 5, 20, 5);                         // 基点 (5,5)
  add(0, "LINE", 8, "0", 10, 5, 20, 5, 11, 15, 21, 5);
  add(0, "ENDBLK");
  add(0, "BLOCK", 2, "SC", 10, 1, 20, 0);                        // 基点 (1,0)
  add(0, "LINE", 8, "VIS", 10, 1, 20, 0, 11, 2, 21, 0);
  add(0, "ENDBLK");
  add(0, "BLOCK", 2, "ARCB", 10, 0, 20, 0);
  add(0, "ARC", 8, "VIS", 10, 0, 20, 0, 40, 5, 50, 0, 51, 90);
  add(0, "TEXT", 8, "VIS", 10, 0, 20, 0, 40, 2, 1, "ROT-TXT");
  add(0, "ENDBLK");
  add(0, "BLOCK", 2, "MIX", 10, 0, 20, 0);                       // 画層 0 と VIS の中身
  add(0, "LINE", 8, "0", 10, 0, 20, 900, 11, 1, 21, 900);
  add(0, "LINE", 8, "VIS", 10, 0, 20, 910, 11, 1, 21, 910);
  add(0, "ENDBLK");
  for (let k = 0; k < 6; k++) {                                  // 6 段の入れ子 N0→N1→…→N5
    add(0, "BLOCK", 2, "N" + k, 10, 0, 20, 0);
    if (k < 5) add(0, "INSERT", 8, "VIS", 2, "N" + (k + 1), 10, 1, 20, 0);
    else add(0, "LINE", 8, "VIS", 10, 0, 20, 700, 11, 3, 21, 700);
    add(0, "ENDBLK");
  }
  add(0, "BLOCK", 2, "BB", 10, 0, 20, 0);
  add(0, "LINE", 8, "VIS", 6, "BYBLOCK", 10, 0, 20, 1100, 11, 50, 21, 1100);
  add(0, "ENDBLK");
  add(0, "BLOCK", 2, "ATT", 10, 0, 20, 0);
  add(0, "LINE", 8, "VIS", 10, 0, 20, 800, 11, 1, 21, 800);
  add(0, "ENDBLK");
  add(0, "ENDSEC");
  // ── ENTITIES ──
  add(0, "SECTION", 2, "ENTITIES");
  // mirror
  add(0, "CIRCLE", 8, "VIS", 10, 100, 20, 0, 40, 3, 210, 0, 220, 0, 230, -1);
  add(0, "ARC", 8, "VIS", 10, 50, 20, 0, 40, 10, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1);
  add(0, "LWPOLYLINE", 8, "VIS", 90, 2, 70, 0, 10, 10, 20, 0, 10, 20, 20, 0, 210, 0, 220, 0, 230, -1);
  add(0, "INSERT", 8, "VIS", 2, "B", 10, 100, 20, 50, 210, 0, 220, 0, 230, -1);
  add(0, "LINE", 8, "VIS", 10, 300, 20, 0, 11, 310, 21, 0, 210, 0, 220, 0, 230, -1);
  // block
  add(0, "INSERT", 8, "VIS", 2, "SC", 10, 0, 20, 200, 41, 2, 42, 2);
  add(0, "INSERT", 8, "VIS", 2, "ARCB", 10, 0, 20, 300, 50, 90);
  add(0, "INSERT", 8, "VIS", 2, "N0", 10, 0, 20, 0);
  add(0, "INSERT", 8, "VIS", 2, "SC", 10, 0, 20, 400, 70, 3, 71, 2, 44, 20, 45, 30);
  // hidden
  add(0, "LINE", 8, "OFF", 10, 0, 20, 500, 11, 1, 21, 500);
  add(0, "LINE", 8, "FRZ", 10, 0, 20, 501, 11, 1, 21, 501);
  add(0, "LINE", 8, "NOPLOT", 10, 0, 20, 502, 11, 1, 21, 502);
  add(0, "LINE", 8, "Defpoints", 10, 0, 20, 503, 11, 1, 21, 503);
  add(0, "LINE", 8, "VIS", 67, 1, 10, 0, 20, 504, 11, 1, 21, 504);
  add(0, "LINE", 8, "VIS", 60, 1, 10, 0, 20, 505, 11, 1, 21, 505);
  add(0, "LINE", 8, "VIS", 10, 0, 20, 506, 11, 1, 21, 506);              // 見える線
  add(0, "INSERT", 8, "FRZ", 2, "MIX", 10, 1000, 20, 0);               // 中身ごと消える
  add(0, "INSERT", 8, "OFF", 2, "MIX", 10, 2000, 20, 0);               // 画層 0 の中身だけ消える
  add(0, "INSERT", 8, "VIS", 66, 1, 2, "ATT", 10, 0, 20, 0);
  add(0, "ATTRIB", 8, "VIS", 10, 0, 20, 810, 40, 2, 1, "SHOWN-ATT", 2, "T1", 70, 0);
  add(0, "ATTRIB", 8, "VIS", 10, 0, 20, 820, 40, 2, 1, "HIDDEN-ATT", 2, "T2", 70, 1);
  add(0, "SEQEND");
  // bulge / closed
  add(0, "LWPOLYLINE", 8, "VIS", 90, 2, 70, 0, 10, 0, 20, 600, 42, 1, 10, 10, 20, 600);
  add(0, "POLYLINE", 8, "VIS", 66, 1, 70, 1);
  add(0, "VERTEX", 8, "VIS", 10, 0, 20, 650, 70, 0);
  add(0, "VERTEX", 8, "VIS", 10, 10, 20, 650, 70, 0);
  add(0, "VERTEX", 8, "VIS", 10, 10, 20, 660, 70, 0);
  add(0, "SEQEND");
  // ellipse
  add(0, "ELLIPSE", 8, "VIS", 10, 500, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, Math.PI);
  add(0, "ELLIPSE", 8, "VIS", 10, 600, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, Math.PI, 210, 0, 220, 0, 230, -1);
  // ltype
  add(0, "LINE", 8, "HID", 10, 0, 20, 1000, 11, 100, 21, 1000);                 // BYLAYER → HIDDEN2 ×2
  add(0, "LINE", 8, "VIS", 6, "HIDDEN2", 48, 0.5, 10, 0, 20, 1010, 11, 100, 21, 1010);
  add(0, "LINE", 8, "VIS", 6, "GAPFIRST", 10, 0, 20, 1020, 11, 100, 21, 1020);
  add(0, "LINE", 8, "VIS", 10, 0, 20, 1030, 11, 100, 21, 1030);                 // 実線
  add(0, "LINE", 8, "VIS", 10, 0, 20, 1200, 11, 50, 21, 1200);                   // 実線と破線がつながる
  add(0, "LINE", 8, "HID", 10, 50, 20, 1200, 11, 100, 21, 1200);
  add(0, "INSERT", 8, "VIS", 6, "HIDDEN2", 2, "BB", 10, 0, 20, 0);
  add(0, "INSERT", 8, "VIS", 2, "BB", 10, 200, 20, 0);
  // misc
  add(0, "MTEXT", 8, "VIS", 10, 0, 20, 950, 40, 3, 11, 0, 21, 1, 1, "UP-TXT");
  add(0, "POLYLINE", 8, "VIS", 66, 1, 70, 64);
  add(0, "VERTEX", 8, "VIS", 10, 0, 20, 990, 70, 192);
  add(0, "VERTEX", 8, "VIS", 10, 5, 20, 990, 70, 192);
  add(0, "SEQEND");
  add(0, "ENDSEC", 0, "EOF");
  const E = parseDXF(L.join("\n"));

  const near = (a, b2, t = 0.01) => Math.abs(a - b2) < t;
  const lineAt = (x1, y1, x2, y2) => E.some(e => e.type === "LINE" &&
    ((near(e.x1, x1) && near(e.y1, y1) && near(e.x2, x2) && near(e.y2, y2)) ||
     (near(e.x1, x2) && near(e.y1, y2) && near(e.x2, x1) && near(e.y2, y1))));
  const lineY = y => E.filter(e => e.type === "LINE" && near(e.y1, y) && near(e.y2, y));
  const out = {};
  const circ = E.find(e => e.type === "CIRCLE");
  const arcM = E.find(e => e.type === "ARC" && near(e.r, 10));
  const plM = E.find(e => e.type === "LWPOLYLINE" && e.pts.length === 2 && near(e.pts[0][1], 0));
  out.mirror = { circle: circ && [circ.x1, circ.y1], arc: arcM && [arcM.x1, arcM.a1, arcM.a2],
    pl: plM && plM.pts.map(q => q[0]).join(","), block: lineAt(-100, 50, -110, 50), line: lineAt(300, 0, 310, 0) };
  const arcR = E.find(e => e.type === "ARC" && near(e.r, 5));
  const txtR = E.find(e => e.text === "ROT-TXT");
  out.block = { scaled: lineAt(0, 200, 2, 200), arcRot: arcR && [Math.round(arcR.a1), Math.round(arcR.a2)],
    txtRot: txtR && Math.round(txtR.angle || 0), deep: lineAt(5, 700, 8, 700),
    minsert: lineY(400).length + lineY(430).length, minsertX: lineY(400).map(e => Math.round(Math.min(e.x1, e.x2))).sort((a, c) => a - c).join(",") };
  out.hidden = { gone: [500, 501, 502, 503, 504, 505].map(y => lineY(y).length).join(","), vis: lineY(506).length,
    frz: E.filter(e => e.type === "LINE" && e.x1 >= 1000 && e.x1 < 1500).length,
    off: E.filter(e => e.type === "LINE" && e.x1 >= 2000).map(e => e.y1).join(","),
    att: E.some(e => e.text === "SHOWN-ATT") && !E.some(e => e.text === "HIDDEN-ATT") };
  const bul = E.find(e => e.type === "LWPOLYLINE" && e.pts.some(q => near(q[1], 600)));
  out.bulge = { pts: bul && bul.pts.length, low: bul && bul.pts.some(q => near(q[0], 5, 0.2) && near(q[1], 595, 0.2)) };
  const pc = E.find(e => e.type === "POLYLINE" && e.pts.some(q => near(q[1], 650)));
  out.closed = pc ? (pc.flags & 1) : -1;
  const el1 = E.find(e => e.type === "LWPOLYLINE" && e.pts.some(q => near(q[0], 510)));
  const el2 = E.find(e => e.type === "LWPOLYLINE" && e.pts.some(q => near(q[0], 610)));
  const ys = el => el ? [Math.min(...el.pts.map(q => q[1])), Math.max(...el.pts.map(q => q[1]))].map(v => Math.round(v * 10) / 10) : null;
  out.ellipse = { up: ys(el1), down: ys(el2) };
  const dashAt = (y, x0 = 0) => { const l = E.find(e => e.type === "LINE" && near(e.y1, y) && near(Math.min(e.x1, e.x2), x0));
    return l ? (l.dash ? l.dash.join(",") : "solid") : null; };
  out.ltype = { bylayer: dashAt(1000), scaled: dashAt(1010), gapFirst: dashAt(1020), solid: dashAt(1030),
    byblock: dashAt(1100), byblockSolid: dashAt(1100, 200) };
  // 盤図ページにして出力する
  App.project = newProject("線種"); UI.renumberPages();
  const pg = panelInsertDxfPage(E, "線種.dxf").page;
  UI.renumberPages();
  const svg = exportSheetSVG(pg);
  applySheet(pg);
  const dxf = pageToDXF(pg);
  const mach = panelToMachiningDXF(pg);
  const bb0 = dxfEntsBounds(E), fg = panelDataOf(pg).fig;
  const yJ = 1200 - bb0.y0;
  const joined = fg.pl.map((q, i) => ({ q, g: (fg.plD || [])[i] || 0 }))
    .filter(o2 => o2.q.length >= 4 && o2.q.every((v, k) => k % 2 === 0 || Math.abs(v - yJ) < 0.01));
  out.ltOut = { svgDash: svg.includes('stroke-dasharray="12.7 6.35"') && svg.includes('stroke-dasharray="6.35 3.175"'),
    ltDef: /\n\s*LTYPE\s*\n\s*2\s*\nDASH_12-700_6-350\n/.test(dxf), ltRef: /\n\s*6\s*\nDASH_12-700_6-350\n/.test(dxf),
    machSolid: !/DASH_/.test(mach),
    split: joined.length === 2 && joined[0].g !== joined[1].g };
  const up = E.find(e => e.text === "UP-TXT");
  out.misc = { mtextAng: up && Math.round(up.angle || 0), polyface: !E.some(e => e.pts && e.pts.some(q => near(q[1], 990))) };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  mirror: JSON.stringify(R.mirror.circle) === "[-100,0]" && R.mirror.arc && R.mirror.arc[0] === -50 &&
    Math.round(R.mirror.arc[1]) === 90 && Math.round(R.mirror.arc[2]) === 180 &&
    R.mirror.pl === "-10,-20" && R.mirror.block === true && R.mirror.line === true,
  block: R.block.scaled === true && JSON.stringify(R.block.arcRot) === "[90,180]" && R.block.txtRot === 90 &&
    R.block.deep === true && R.block.minsert === 6 && R.block.minsertX === "0,20,40",
  hidden: R.hidden.gone === "0,0,0,0,0,0" && R.hidden.vis === 1 && R.hidden.frz === 0 &&
    R.hidden.off === "910" && R.hidden.att === true,
  bulge: R.bulge.pts >= 10 && R.bulge.low === true,
  closed: R.closed === 1,
  ellipse: JSON.stringify(R.ellipse.up) === "[0,5]" && JSON.stringify(R.ellipse.down) === "[-5,0]",
  misc: R.misc.mtextAng === 90 && R.misc.polyface === true,
  ltype: R.ltype.bylayer === "12.7,6.35" && R.ltype.scaled === "6.35,3.175" && R.ltype.gapFirst === "8,4" &&
    R.ltype.solid === "solid" && R.ltype.byblock === "12.7,6.35" && R.ltype.byblockSolid === "solid",
  ltOut: R.ltOut.svgDash === true && R.ltOut.ltDef === true && R.ltOut.ltRef === true && R.ltOut.machSolid === true &&
    R.ltOut.split === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("dxf-ocs OK");
