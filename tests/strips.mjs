/* 端子台 (EPLAN の端子台定義にならう)。端子台は図面全体で 1 つの定義を持ち、
   回路図の端子記号はプロパティで端子台・端子番号・段へ紐づく。

   ・model   : stripAdd は -X1, -X2 … と名前を付ける。termLink でタグが -X1:3 になり、
              2段の端子台は段を付けて -X1:3.2。名前を変えると紐づいた端子のタグも変わる。
              段数を 1段に戻すと 2 段目の端子は 1 段目へ寄る。削除すると紐づけが外れる
              (タグは残る)。端子の並びは自然順 (9 の次が 10)
   ・rows    : 端子台配列の行に、内部側 (盤内) と外部側 (現場) の線番・接続先が入り、
              同じ端子台の端子どうしの直結はジャンパに出る (接続先の欄からは外す)。
              線番の無い線は線番の欄を空にする (端子表の「(直結)」は出さない)。
              丸のみの端子も行になる
   ・page    : 「端子台配列を追加」は図面集の末尾に入り、端子台ごとの見出し
              (名前・段数・接続方式・型式・点数) と表が描かれる。印刷 SVG・DXF にも出る。
              端子が 36 行を超えると枚数が自動で増え、減れば自動で足した分だけ減る
   ・label   : 端子の明示 (タグ) は tagOff で画面・印刷・DXF から消え (記号の表示設定が
              「表示」でも)、tagH で文字高が変わる (既定 3.5mm)。明示の位置は従来どおり
              ドラッグ (tagAt) で動かせる
   ・props   : 端子を選ぶと「端子台」「端子番号」「段」が出る。端子台を選ぶとタグが自動で
              付いて入力が無効になる。明示の表示チェックと文字高の欄で tagOff/tagH が変わる
   ・dialog  : プロジェクト › 端子台… で一覧が出て、追加・名前/段数/接続方式/型式の変更が
              適用で反映される
   ・bom     : 部品表の端子のまとめ (端子台ごとの点数) と端子表 CSV は今までどおり
   ・sym2    : 2段用の記号「端子 (2段)」(二重丸) がパレットにあり、2段以上の端子台へ紐づけると
              端子の記号が自動で入れ替わる (位置・配線はそのまま)。1段に戻すと元の記号へ戻る。
              2段の記号も部品表では端子台ごとにまとまり、端子表 CSV に載る */
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
  App.project = newProject("端子台"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  // ── model ──
  const x1 = stripAdd({}), x2 = stripAdd({ type: "double", conn: "pushin", part: "PTTB 2,5" });
  const t3 = addDevice(pg, "terminal", 100, 60, {});
  termLink(t3, x1.id, "3", 1);
  const t10 = addDevice(pg, "terminal", 140, 60, {}); termLink(t10, x1.id, "10", 1);
  const t9 = addDevice(pg, "terminal", 180, 60, {}); termLink(t9, x1.id, "9", 1);
  const d2 = addDevice(pg, "terminal", 220, 60, {}); termLink(d2, x2.id, "3", 2);
  out.model = { names: [x1.name, x2.name].join(","), tag: t3.tag, tag2: d2.tag,
    order: stripTerminals(x1).map(t => t.num).join(","), levels: stripLevels(x2), conn: stripConnName(x2) };
  stripRename(x1, "-X5"); out.model.renamed = t3.tag;
  stripRetype(x2, "single"); out.model.retyped = { tag: d2.tag, level: d2.props.level };
  stripRetype(x2, "double"); termLink(d2, x2.id, "3", 2);
  stripRename(x1, "-X1");
  // ── rows: 現場機器 -S1 → 端子 -X1:1 → コイル -K1、端子 1 と 2 を直結 (ジャンパ) ──
  const s1 = addDevice(pg, "pb_no", 60, 120, { tag: "-S1" });      // 端子 (60,120)/(60,140)
  const tA = addDevice(pg, "terminal", 60, 160, {}); termLink(tA, x1.id, "1", 1);   // (60,160)/(60,180)
  const tB = addDevice(pg, "terminal", 100, 160, {}); termLink(tB, x1.id, "2", 1);
  const k1 = addDevice(pg, "coil", 60, 200, { tag: "-K1" });
  addWire(pg, [[60, 140], [60, 160]]); const wA = addWire(pg, [[60, 180], [60, 200]]); wA.num = "201"; wA.fixed = true;
  addWire(pg, [[60, 180], [100, 180]]);                            // 端子 1 と 2 の直結
  const dot = addDevice(pg, "term_dot", 100, 230, {}); termLink(dot, x1.id, "4", 1);
  addWire(pg, [[100, 220], [100, 240]]); addDevice(pg, "coil", 100, 240, { tag: "-K2" });   // 丸端子の先にコイル
  App.labelRev++;
  const rows = stripRows(x1);
  const r1 = rows.find(r => r.num === "1"), r2 = rows.find(r => r.num === "2"), r4 = rows.find(r => r.num === "4");
  out.rows = { n: rows.length, r1: r1 && { int: r1.int.num + "|" + r1.int.others.join(" "), ext: r1.ext.num + "|" + r1.ext.others.join(" "), jumper: r1.jumper },
    r2jumper: r2 && r2.jumper, r4: r4 && r4.int.others.join(" "), order: rows.map(r => r.num).join(",") };
  // ── page ──
  const nBefore = App.project.pages.length;
  UI.addSpecialPage("strips");
  const sp = App.project.pages[App.project.pages.length - 1];
  out.page = { last: sp.kind === "strips" && App.project.pages.length === nBefore + 1, name: sp.name };
  const svg = kindSVG(sp, false);
  out.page.head = /端子台 -X1[^<]*1段 \/ ネジ[^<]*端子 6 点/.test(svg) && /端子台 -X2[^<]*2段 \/ プッシュイン[^<]*型式 PTTB 2,5/.test(svg);
  out.page.rowText = svg.includes(">201<") && svg.includes(">-K1:A1<") && svg.includes(">-S1:14<") && svg.includes(">" + pageDwgNo(pg) + "<") && !svg.includes("object");
  // 相手のいない端子 (-X1:3) の線番の欄は空 ("(直結)" を出さない)
  out.page.blank = !rows.find(r => r.num === "3").int.num && !rows.find(r => r.num === "3").ext.num;
  out.page.jumper = />2</.test(svg) && />1</.test(svg);
  App.pageIdx = App.project.pages.indexOf(sp);
  const prt = exportSheetSVG(sp); applySheet(sp);
  out.page.print = /端子台配列/.test(prt) && /端子台 -X1/.test(prt);
  const dxf = pageToDXF(sp);
  out.page.dxf = /\n1\n端子台配列\n/.test(dxf) && /端子台 -X1/.test(dxf);
  // 36 行超で枚数が増え、減れば戻る
  const many = [];
  for (let i = 20; i < 60; i++) { const t = addDevice(pg, "terminal", 300 + (i % 10) * 10, 60 + Math.floor(i / 10) * 40, {}); termLink(t, x2.id, String(i), 1); many.push(t); }
  UI.renumberPages();
  out.page.grew = App.project.pages.filter(q => q.kind === "strips").length;
  many.forEach(t => pg.devices.splice(pg.devices.indexOf(t), 1));
  UI.renumberPages();
  out.page.shrank = App.project.pages.filter(q => q.kind === "strips").length;
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  // ── label (端子のタグは既定で「出力時非表示」なので、ここでは表示に切り替えて見る) ──
  setSymTagVis("terminal", "show");
  App.labelRev++;
  const box = () => { App.labelRev++; const o = deviceLabelBoxes(pg, t3).find(q => q.isTag); return o ? o.size : null; };
  out.label = { h0: box() };
  t3.tagH = 5; out.label.h5 = box();
  t3.tagOff = true; App.labelRev++;
  const scr = devLabelsSVG(t3, symOf(t3.sym), pg), pr = devLabelsSVG(t3, symOf(t3.sym), pg, { print: true });
  const dx2 = pageToDXF(pg);
  out.label.off = { scr: !scr.includes("-X1:3"), prt: !pr.includes("-X1:3"), dxf: !/\n1\n-X1:3\n/.test(dx2), shown: tagShownFor(t3, false) };
  delete t3.tagOff; delete t3.tagH; App.labelRev++;
  out.label.on = devLabelsSVG(t3, symOf(t3.sym), pg).includes("-X1:3") && devLabelsSVG(t3, symOf(t3.sym), pg, { print: true }).includes("-X1:3") && /\n1\n-X1:3\n/.test(pageToDXF(pg));
  setSymTagVis("terminal", "noprint");
  // ── props ──
  App.selection.clear(); App.selection.add(t9.id); UI.showProps();
  const q = s => document.querySelector(s);
  out.props = { has: !!q("#pStrip") && !!q("#pTerm") && !!q("#pLevel"), tagDisabled: q("#pTag").disabled, stripVal: q("#pStrip").value === x1.id,
    levelDisabled: q("#pLevel").disabled };
  q("#pStrip").value = x2.id; q("#pStrip").dispatchEvent(new Event("change"));
  out.props.moved = { tag: t9.tag, levelEnabled: !q("#pLevel").disabled };
  q("#pLevel").value = "2"; q("#pLevel").dispatchEvent(new Event("change"));
  out.props.level2 = t9.tag;
  q("#pTerm").value = "12"; q("#pTerm").dispatchEvent(new Event("change"));
  out.props.renum = t9.tag;
  UI.showProps();
  q("#pTagShow").checked = false; q("#pTagShow").dispatchEvent(new Event("change"));
  out.props.off = t9.tagOff === true;
  UI.showProps();
  q("#pTagH").value = "5"; q("#pTagH").dispatchEvent(new Event("change"));
  out.props.tagH = t9.tagH;
  UI.showProps();
  q("#pStrip").value = ""; q("#pStrip").dispatchEvent(new Event("change"));
  out.props.unlinked = { strip: !(t9.props && t9.props.strip), tag: t9.tag, enabled: !q("#pTag").disabled };
  termLink(t9, x1.id, "9", 1); delete t9.tagOff; delete t9.tagH;
  // ── dialog ──
  UI.stripSetup();
  const rowsN = document.querySelectorAll("#stRows tr").length;
  q("#stAdd").click();
  const trs = document.querySelectorAll("#stRows tr");
  const last = trs[trs.length - 1];
  last.querySelector(".stName").value = "-X7"; last.querySelector(".stType").value = "triple"; last.querySelector(".stConn").value = "spring";
  trs[0].querySelector(".stName").value = "-X1A"; trs[0].querySelector(".stPart").value = "UK 2.5 N";
  q("#stOk").click();
  const x7 = projectStrips().find(s => s.name === "-X7");
  out.dialog = { rows: rowsN, added: !!x7 && x7.type === "triple" && x7.conn === "spring", renamed: x1.name === "-X1A" && t3.tag === "-X1A:3",
    part: x1.part === "UK 2.5 N", closed: !q("#stRows") };
  stripRename(x1, "-X1");
  // 削除: 紐づいた端子は外れ、タグは残る
  const t7 = addDevice(pg, "terminal", 400, 300, {}); termLink(t7, x7.id, "5", 1);
  stripRemove(x7.id);
  out.dialog.removed = !projectStrips().some(s2 => s2.id === x7.id) && !(t7.props && t7.props.strip) && t7.tag === "-X7:5.1";   // 3段の端子台なので段付き
  // ── sym2 ──
  const s2 = SYMBOLS_BY_ID.terminal2;
  UI.buildPalette();
  out.sym2 = { has: !!s2 && s2.sim === "passthru" && s2.pins.length === 2 && (s2.body.match(/<circle/g) || []).length === 2,
    palette: [...document.querySelectorAll("#symTree .sym-name")].some(e => e.textContent === "端子 (2段)"),
    swapped: d2.sym === "terminal2" && t9.sym === "terminal",            // d2 は 2段の -X2、t9 は 1段の -X1
    pinsSame: JSON.stringify(SYMBOLS_BY_ID.terminal2.pins) === JSON.stringify(SYMBOLS_BY_ID.terminal.pins) };
  const wx = addWire(pg, [[220, 80], [220, 60]]);                           // d2 (220,60) につながる線
  stripRetype(x2, "single");
  out.sym2.back = d2.sym === "terminal" && d2.tag === "-X2:3" && pg.wires.includes(wx);
  stripRetype(x2, "double"); termLink(d2, x2.id, "3", 2);
  out.sym2.again = d2.sym === "terminal2" && d2.tag === "-X2:3.2";
  dot.props.level = 1; termLink(dot, x2.id, "8", 1); out.sym2.dotKept = dot.sym === "term_dot"; termLink(dot, x1.id, "4", 1);
  // 置いたばかりの端子を 2段の端子台へ紐づけた瞬間に入れ替わる / 端子でない機器の記号は触らない
  const tNew = addDevice(pg, "terminal", 400, 400, {}); termLink(tNew, x2.id, "9", 1);
  const notT = addDevice(pg, "coil", 440, 400, { tag: "-K9" }); termLink(notT, x2.id, "9", 2);
  out.sym2.fresh = tNew.sym === "terminal2"; out.sym2.notTerminal = notT.sym === "coil";
  pg.devices.splice(pg.devices.indexOf(notT), 1);
  // ── bom / csv ──
  const bom = buildBOM();
  const rowsB = (bom.rows || bom);
  const term = rowsB.find(r => JSON.stringify(r).includes("-X1"));
  // 2段の端子も端子台ごとに 1 行 (-X2 は d2・tNew の 2 点、-X3 は 1 点)。記号の種類で混ざらない
  const x3 = stripAdd({ type: "double" }); const t3b = addDevice(pg, "terminal", 480, 400, {}); termLink(t3b, x3.id, "1", 1);
  const bom2 = buildBOM(), rowsB2 = bom2.rows || bom2;
  const rX2 = rowsB2.filter(r => r.tags && r.tags.some(t => /^-X2:/.test(t)));
  const rX3 = rowsB2.filter(r => r.tags && r.tags.some(t => /^-X3:/.test(t)));
  out.bom = { term: !!term, term2: rX2.length === 1 && rX2[0].tags.length === 2 && rX2[0].tags.every(t => /^-X2:/.test(t)) &&
      rX3.length === 1 && rX3[0].tags.length === 1 && rX3[0].tags[0] === "-X3:1.1", csv: /-X1:1/.test(terminalCSV()) && !/-X1:4/.test(terminalCSV()) && /-X2:3\.2/.test(terminalCSV()) };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  model: R.model.names === "-X1,-X2" && R.model.tag === "-X1:3" && R.model.tag2 === "-X2:3.2" && R.model.order === "3,9,10" &&
    R.model.levels === 2 && R.model.conn === "プッシュイン" && R.model.renamed === "-X5:3" && R.model.retyped.tag === "-X2:3" && R.model.retyped.level === 1,
  rows: R.rows.n === 6 && R.rows.r1 && R.rows.r1.int === "201|-K1:A1" && R.rows.r1.ext === "|-S1:14" && R.rows.r1.jumper === "2" && R.rows.r2jumper === "1" &&
    R.rows.r4 === "-K2:A1" && R.rows.order === "1,2,3,4,9,10",
  page: R.page.last && R.page.name === "端子台配列" && R.page.head && R.page.rowText && R.page.blank && R.page.print && R.page.dxf && R.page.grew === 2 && R.page.shrank === 1,
  label: Math.abs(R.label.h0 - 3.5) < 0.01 && Math.abs(R.label.h5 - 5) < 0.01 && R.label.off.scr && R.label.off.prt && R.label.off.dxf && !R.label.off.shown && R.label.on,
  props: R.props.has && R.props.tagDisabled && R.props.stripVal && R.props.levelDisabled && R.props.moved.tag === "-X2:9.1" && R.props.moved.levelEnabled &&
    R.props.level2 === "-X2:9.2" && R.props.renum === "-X2:12.2" && R.props.off && R.props.tagH === 5 && R.props.unlinked.strip && R.props.unlinked.tag === "-X2:12.2" && R.props.unlinked.enabled,
  dialog: R.dialog.rows === 2 && R.dialog.added && R.dialog.renamed && R.dialog.part && R.dialog.closed && R.dialog.removed,
  bom: R.bom.term && R.bom.term2 && R.bom.csv,
  sym2: R.sym2.has && R.sym2.palette && R.sym2.swapped && R.sym2.pinsSame && R.sym2.back && R.sym2.again && R.sym2.dotKept && R.sym2.fresh && R.sym2.notTerminal,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("strips OK");
