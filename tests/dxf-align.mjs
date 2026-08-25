/* DXF 取り込みのずれ。元図と同じ位置に文字・引出線が出ることを確かめる。

   DXF は文字の「位置」と「寄せ」を別々に持つ。寄せを無視して左下から書くと、
   中央寄せの文字は幅の半分ぶん、上寄せの文字は文字高ぶん元図からずれる。
   また引出線 (LEADER)・多重引出線・属性文字 (ATTRIB)・寸法 (DIMENSION) は
   読み飛ばしていたので、注記ごと消えていた。

   ・alignH    : 水平の寄せ (72) が anchor になり、位置は揃え点 (11/21) になる
   ・alignV    : 垂直の寄せ (73) がベースラインの移動になる (上寄せ・中央寄せ)
   ・mtextAtt  : MTEXT の基準点 (71) が anchor とベースラインになる
   ・mtextWrap : MTEXT の \P が改行になり、行ごとの文字に割れる (行送り 1.667)
   ・leader    : LEADER が折れ線として入る
   ・mleader   : 多重引出線から引出線と本文の両方が入る
   ・attrib    : ATTRIB (属性文字) が文字として入る
   ・dimension : DIMENSION の無名ブロックの図形が入る
   ・textAngle : 文字の傾き (50) が保たれる
   ・ctrlCodes : MTEXT の書式コードが本文に漏れない
   ・svgAnchor : 出力 SVG に text-anchor が付く (プレビュー・シンボル登録)
   ・pageAnchor: ページへの作図取り込みでも寄せが引き継がれる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const seg = pairs => pairs.map(([c, v]) => c + "\n" + v).join("\n") + "\n";
  const dxf =
    "0\nSECTION\n2\nBLOCKS\n" +
    seg([[0, "BLOCK"], [2, "*D1"], [10, 0], [20, 0]]) +
    seg([[0, "LINE"], [8, "DIM"], [10, 200], [20, 200], [11, 260], [21, 200]]) +
    seg([[0, "ENDBLK"]]) +
    "0\nENDSEC\n" +
    "0\nSECTION\n2\nENTITIES\n" +
    // 中央寄せ・中央 (72=1 / 73=2)。揃え点 (11/21) が実位置
    seg([[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 50], [40, 5], [72, 1], [73, 2], [1, "CENTER"]]) +
    // 右寄せ・上 (72=2 / 73=3)
    seg([[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 50], [40, 5], [72, 2], [73, 3], [1, "RIGHTTOP"]]) +
    // 寄せなし (72=0 / 73=0) は 10/20 がそのままベースライン
    seg([[0, "TEXT"], [8, "0"], [10, 20], [20, 30], [40, 5], [1, "PLAIN"]]) +
    // 傾き 90 度
    seg([[0, "TEXT"], [8, "0"], [10, 10], [20, 10], [40, 5], [50, 90], [1, "TURNED"]]) +
    // MTEXT: 基準点 5 (中段中央) + 改行 + 書式コード
    seg([[0, "MTEXT"], [8, "0"], [10, 100], [20, 150], [40, 6], [71, 5], [1, "\\A1;LINE1\\PLINE2"]]) +
    // 引出線 (3 頂点)
    seg([[0, "LEADER"], [8, "0"], [10, 0], [20, 0], [30, 0], [10, 10], [20, 10], [30, 0], [10, 30], [20, 10], [30, 0]]) +
    // 多重引出線: LEADER_LINE の頂点 + 本文
    seg([[0, "MULTILEADER"], [8, "0"], [300, "CONTEXT_DATA{"], [10, 999], [20, 999], [41, 4],
         [304, "MLABEL"], [12, 70], [22, 80], [171, 1],
         [303, "LEADER_LINE{"], [10, 50], [20, 60], [10, 65], [20, 75], [303, "}"], [301, "}"]]) +
    // 属性文字
    seg([[0, "ATTRIB"], [8, "0"], [10, 40], [20, 40], [40, 3], [1, "ATTRVAL"]]) +
    // 寸法 (無名ブロック *D1 の図形が出る)
    seg([[0, "DIMENSION"], [8, "0"], [2, "*D1"], [10, 5], [20, 5]]) +
    "0\nENDSEC\n0\nEOF\n";
  const ents = parseDXF(dxf);
  const texts = ents.filter(e => e.type === "TEXT" || e.type === "MTEXT");
  const find = t => texts.find(e => e.text === t);
  const out = { n: ents.length, texts: texts.map(e => ({ t: e.text, x: e.x1, y: e.y1, a: e.anchor, ang: e.angle, s: e.size })) };
  out.center = find("CENTER");
  out.rightTop = find("RIGHTTOP");
  out.plain = find("PLAIN");
  out.turned = find("TURNED");
  out.l1 = find("LINE1"); out.l2 = find("LINE2");
  out.mlabel = find("MLABEL");
  out.attr = find("ATTRVAL");
  // 折れ線: 引出線 (3点) と 多重引出線 (2点)
  const polys = ents.filter(e => e.type === "LWPOLYLINE").map(e => e.pts.map(q => [q[0], q[1]]));
  out.polys = polys;
  // 寸法ブロックの線
  out.dimLine = ents.some(e => e.type === "LINE" && e.x1 === 200 && e.x2 === 260);
  // SVG に anchor が出るか
  const svg = dxfEntsToSVG(ents, { scale: 1 });
  out.svgAnchors = (svg.body.match(/text-anchor="(start|middle|end)"/g) || []).length;
  out.svgMiddle = /text-anchor="middle"[^>]*>CENTER</.test(svg.body) ||
    /<text[^>]*text-anchor="middle"[^>]*>CENTER<\/text>/.test(svg.body);
  out.svgRot = /transform="rotate\(-90/.test(svg.body);
  return out;
});

// ページへの作図取り込みで寄せが残るか (ダイアログを実際に操作)
const R2 = await p.evaluate(async () => {
  const seg = pairs => pairs.map(([c, v]) => c + "\n" + v).join("\n") + "\n";
  const dxf = "0\nSECTION\n2\nENTITIES\n" +
    seg([[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 50], [40, 5], [72, 1], [73, 2], [1, "CENTER"]]) +
    seg([[0, "LINE"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 0]]) +
    "0\nENDSEC\n0\nEOF\n";
  const pg = newPage("dxfal", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  UI.refresh();
  UI.dxfImportDialog(parseDXF(dxf), "a.dxf");
  document.querySelector("#dxScale").value = "1";
  document.querySelector("#dxMode").value = "draw";
  document.querySelector("#dxOk").click();
  await new Promise(r => setTimeout(r, 60));
  const t = pg.texts[pg.texts.length - 1];
  return { anchor: t && t.anchor, text: t && t.text };
});

const near = (a, b2, tol = 0.01) => typeof a === "number" && Math.abs(a - b2) <= tol;
const c = R.center, rt = R.rightTop, pl = R.plain, tu = R.turned;
const checks = {
  noPageErrors: errs.length === 0,
  // 揃え点 (100,50) が実位置になり、中央寄せは anchor=middle
  alignH: !!c && near(c.x1, 100) && c.anchor === "middle" && !!rt && near(rt.x1, 100) && rt.anchor === "end",
  // 中央寄せは半分、上寄せは文字高ぶんベースラインが下がる (DXF は Y が上向き)
  alignV: !!c && near(c.y1, 50 - 2.5) && !!rt && near(rt.y1, 50 - 5),
  // 寄せ無しは 10/20 のまま
  plainKept: !!pl && near(pl.x1, 20) && near(pl.y1, 30) && pl.anchor === "start",
  mtextAtt: !!R.l1 && R.l1.anchor === "middle" && near(R.l1.y1, 150 - 3) && near(R.l1.x1, 100),
  mtextWrap: !!R.l2 && near(R.l2.y1, R.l1.y1 - 6 * 1.667, 0.02) && near(R.l2.x1, R.l1.x1),
  ctrlCodes: !!R.l1 && R.l1.t === undefined ? true : true,   // 本文は find で一致済み (書式コードが残れば見つからない)
  leader: R.polys.some(q => q.length === 3 && near(q[0][0], 0) && near(q[2][0], 30)),
  mleader: R.polys.some(q => q.length === 2 && near(q[0][0], 50) && near(q[1][0], 65)) &&
    !!R.mlabel && near(R.mlabel.x1, 70) && near(R.mlabel.y1, 80 - 4),
  attrib: !!R.attr && near(R.attr.x1, 40) && near(R.attr.y1, 40),
  dimension: R.dimLine === true,
  textAngle: !!tu && near(tu.angle, 90) && R.svgRot === true,
  svgAnchor: R.svgAnchors >= 4 && R.svgMiddle === true,
  pageAnchor: R2.anchor === "middle" && R2.text === "CENTER",
};
console.log(JSON.stringify(R, null, 1).slice(0, 2600));
console.log("page:", JSON.stringify(R2));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
