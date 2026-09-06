/* Panel Studio (制御盤配置) の図面差し込み。

   ・reject   : format / version が違う JSON はエラーにする (黙って読まない)
   ・insert   : 4 シートが仕様ページの直後に 4 ページで入り、既存の順序は
                崩れない。図番は書類側の A 系列 (A-005〜) で振り直される
   ・scale    : 540×740 の中板は A3 横の図枠で 1:5 になる (標準縮尺の最小)
   ・draw     : ページに図形が出る — 円・円弧 (反時計回り)。文字は既定では
                出さず (図が読みにくいため)、「文字も描く」で出る。
                表題欄には job/panel の値 (会社・担当・日付・型式・寸法) が入る
   ・reimport : 同じ案件の JSON をもう一度読んでも 4 ページのまま (置き換え)
   ・zip      : ZIP のまま渡されたら中の *_electracad.json を探して読む
   ・bounds   : 0〜extent の外の座標は数えて知らせる (読み込みは続ける)
   ・dxf      : DXF にも実体が出る (S-T12 / 円 / 円弧は a0→a1 のまま)
   ・textEdit : パネルページでも文字ツールで注記を書ける (Enter で確定)。
                書いた文字は画面・PDF・DXF に出る。文字を選ぶと通常の
                文字プロパティが出て、文字高も変えられる
   ・light    : 重いデータ (entities) はページから分離して持ち、編集の
                たびに再直列化しない — 2 回 commit しても 1MB 超の
                JSON.stringify が走らない。undo しても図は生きている */
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
  const mkSheet = (id, title, w, h, extra = []) => ({
    id, title, extent: { w, h },
    layers: { outline: { color: "#4ac0ff", aci: 4 }, holes: { color: "#ffd24a", aci: 2 } },
    entities: [
      { t: "line", layer: "outline", x1: 0, y1: 0, x2: w, y2: 0 },
      { t: "line", layer: "outline", x1: w, y1: 0, x2: w, y2: h },
      { t: "line", layer: "outline", x1: w, y1: h, x2: 0, y2: h },
      { t: "line", layer: "outline", x1: 0, y1: h, x2: 0, y2: 0 },
      { t: "circle", layer: "holes", cx: 30, cy: 30, r: 3.25 },
      { t: "arc", layer: "holes", cx: w / 2, cy: h / 2, r: 20, a0: 30, a1: 300 },
      { t: "text", layer: "outline", x: 10, y: h - 20, h: 5, s: "S-T12", rot: 0 },
      ...extra,
    ],
    svg: "",
  });
  const FIX = {
    format: "panel-studio/electracad-sheets", version: 1, generator: "panel-studio-test",
    exportedAt: "2026-09-06T00:00:00Z", units: "mm",
    coordinates: "mm, origin bottom-left, +X right, +Y up",
    standardScales: [1, 2, 2.5, 5, 10, 20, 50],
    job: { company: "テスト工業", jobNo: "J123", owner: "藤原", completedAt: "2026-09-01T10:00:00Z", note: "扉裏に配線ダクト" },
    panel: { model: "S-T12", outer: { w: 600, h: 800, d: 250 }, plate: { w: 540, h: 740 } },
    sheets: [
      mkSheet("cabinet_full", "筐体 全体図", 600, 800),
      mkSheet("cabinet_holes", "筐体 穴あけ図", 600, 800),
      mkSheet("plate_full", "中板 全体図", 540, 740,
        // 重い盤 (実案件は数万要素) を模す — 直列化 1MB 超のかたまり
        Array.from({ length: 20000 }, (_, i) => (
          { t: "line", layer: "holes", x1: (i % 500) + 0.125, y1: 10 + (i % 7), x2: (i % 500) + 3.875, y2: 12 + (i % 7) }))),
      mkSheet("plate_holes", "中板 穴あけ図", 540, 740,
        [{ t: "circle", layer: "holes", cx: 900, cy: 30, r: 3 }]),   // はみ出し 1 件
    ],
  };

  App.project = newProject("盤図差し込み"); UI.renumberPages();
  const order0 = App.project.pages.map(q => q.kind);

  // ── 不正な format / version ──
  out.reject = {};
  try { panelInsertPages({ ...FIX, format: "someone-else/sheets" }); out.reject.fmt = "accepted"; }
  catch (e) { out.reject.fmt = /format/.test(e.message); }
  try { panelInsertPages(JSON.parse(JSON.stringify({ ...FIX, version: 2 }))); out.reject.ver = "accepted"; }
  catch (e) { out.reject.ver = /version/.test(e.message); }
  out.reject.untouched = App.project.pages.length === order0.length;

  // ── 差し込み ──
  const r1 = panelInsertPages(JSON.parse(JSON.stringify(FIX)));
  UI.renumberPages();
  const pages = App.project.pages;
  const kinds = pages.map(q => q.kind);
  const firstPanel = kinds.indexOf("panel");
  const lastSpec = kinds.lastIndexOf("spec");
  out.insert = { added: r1.added, badCoords: r1.badCoords,
    afterSpec: firstPanel === lastSpec + 1,
    four: kinds.filter(k => k === "panel").length === 4,
    titles: pages.filter(q => q.kind === "panel").map(q => q.name).join("|"),
    dwg: pages.filter(q => q.kind === "panel").map(q => pageDwgNo(q)).join("|"),
    tailKept: kinds[kinds.length - 1] === order0[order0.length - 1] };

  // ── 縮尺 (中板 540×740 → A3 横で 1:5) ──
  const plate = pages.find(q => q.kind === "panel" && q.panel.sheetId === "plate_full");
  out.scale = { plate: plate.scale, paper: plate.paper + "/" + plate.orient,
    cab: pages.find(q => q.panel && q.panel.sheetId === "cabinet_full").scale };

  // ── 描画と表題欄 ──
  App.pageIdx = pages.indexOf(plate); applySheet(plate);
  // 文字は既定で出ない (kindSVG = 表題欄なしで見る)。extent の破線枠も無い
  const svgOff = kindSVG(plate);
  out.textOff = { noText: !svgOff.includes("S-T12"), noDash: !svgOff.includes("stroke-dasharray") };
  plate.panelText = true;                      // 以降は「文字も描く」で検査
  const svg = exportSheetSVG(plate);
  // 座標系: 左下原点 Y 上向き → 画面では cy=30 の穴は「下」= oy + (extent.h - 30)
  const area2 = panelAreaRect();
  const oy2 = area2.y + (area2.h - plate.panel.extent.h) / 2;
  const cyGot = parseFloat((/<circle[^>]*cy="([\d.]+)" r="3\.25"/.exec(kindSVG(plate)) || [])[1]);
  out.draw = { text: svg.includes("S-T12"), circle: /<circle[^>]*r="3\.25"/.test(svg),
    yFlip: Math.abs(cyGot - (oy2 + plate.panel.extent.h - 30)) < 0.01,
    arcCCW: /A20,20 0 1 0 /.test(svg),
    company: svg.includes("テスト工業"), owner: svg.includes("藤原"),
    date: svg.includes("2026-09-01"), model: svg.includes("S-T12"),
    outer: svg.includes("W600×H800×D250"), note: svg.includes("備考: 扉裏に配線ダクト"),
    scaleCell: svg.includes(">1:5<") };
  // 白黒設定
  plate.panelMono = true;
  const svgM = kindSVG(plate);
  out.draw.mono = !svgM.includes("#4ac0ff");
  delete plate.panelMono;

  // ── DXF (文字も描く ON のまま / OFF で消えることも見る) ──
  delete plate.panelText;
  const dxfOff = pageToDXF(plate); applySheet(plate);
  out.textOff.dxf = !/1\nS-T12\n/.test(dxfOff.split("ENTITIES")[1].split("表題欄")[0] || dxfOff) ||
    !new RegExp("0\\nTEXT\\n8\\nPANEL\\n").test(dxfOff);
  plate.panelText = true;
  const dxf = pageToDXF(plate); applySheet(plate);
  out.dxf = { text: dxf.includes("S-T12"),
    arc: /0\nARC\n8\nPANEL\n62\n2\n[\s\S]{0,120}?50\n30\.000\n51\n300\.000/.test(dxf),
    circle: /0\nCIRCLE\n8\nPANEL\n/.test(dxf) };

  // ── 再読み込み (置き換え) ──
  const n0 = App.project.pages.length;
  const r2 = panelInsertPages(JSON.parse(JSON.stringify(FIX)));
  UI.renumberPages();
  out.reimport = { replaced: r2.replaced, still4: App.project.pages.filter(q => q.kind === "panel").length === 4,
    total: App.project.pages.length === n0 };

  // ── 軽量化: panelData は分離され、commit で再直列化されない ──
  serializeProject();                           // 直列化を温める
  const orig = JSON.stringify; let big = 0;
  JSON.stringify = function (...a2) {
    const r2 = orig.apply(JSON, a2);
    if (typeof r2 === "string" && r2.length > 1e6) big++;
    return r2;
  };
  commit();
  App.project.pages.find(q => q.kind === "panel").name += "!";
  commit();
  JSON.stringify = orig;
  const split = !App.project.pages.some(q => q.panel && q.panel.entities);
  undo(); undo();
  const afterUndo = panelDataOf(App.project.pages.find(q => q.kind === "panel" && q.panel.sheetId === "plate_full"));
  out.light = { big, split, undoAlive: afterUndo.entities.length > 20000 };
  App.redoStack.length = 0;

  // ── ZIP 経由 (store の ZIP を作って読み戻す) ──
  const jsonBytes = new TextEncoder().encode(JSON.stringify(FIX));
  const zip = buildZIP([{ name: "release/J123_electracad.json", data: jsonBytes },
    { name: "release/J123_p1.dxf", data: new TextEncoder().encode("0\nEOF\n") }]);
  const ents2 = await zipEntries(await zip.arrayBuffer());
  const hit = ents2.find(f => /_electracad\.json$/i.test(f.name));
  out.zip = { entries: ents2.length, found: !!hit,
    parses: !!hit && JSON.parse(new TextDecoder().decode(hit.bytes)).format === "panel-studio/electracad-sheets" };
  return out;
});

/* ── パネルページで文字 (注記) を書く — 実マウス + 文字ツール ── */
const TE = { };
await p.evaluate(() => {
  const plate2 = App.project.pages.find(q => q.kind === "panel" && q.panel.sheetId === "plate_full");
  App.pageIdx = App.project.pages.indexOf(plate2); applySheet(plate2);
  UI.refresh(true); zoomFit(); UI.setTool("text");
});
await p.waitForTimeout(300);
const spot = await p.evaluate(() => {
  const bb = Editor.svg.getBoundingClientRect();
  const fr = frameRect();
  return { x: bb.left + Editor.view.tx + (fr.x + 40) * Editor.view.s,
           y: bb.top + Editor.view.ty + (fr.y + 40) * Editor.view.s };
});
await p.mouse.click(spot.x, spot.y);
await p.waitForTimeout(300);
TE.inputShown = await p.evaluate(() => !!document.querySelector('#overlay-root input'));
if (TE.inputShown) {
  await p.keyboard.type("盤内注記A");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(250);
}
Object.assign(TE, await p.evaluate(() => {
  const pg2 = curPage();
  const t = (pg2.texts || []).find(t2 => t2.text === "盤内注記A");
  const svg2 = exportSheetSVG(pg2);
  const dxf2 = pageToDXF(pg2); applySheet(pg2);
  UI.setTool("select");
  // 文字を選ぶと通常の文字プロパティ (文字高の欄) が出て、変更が効く
  let sized = false, propShown = false;
  if (t) {
    App.selection.clear(); App.selection.add(t.id); UI.showProps();
    const el = document.getElementById("pTsz");
    propShown = !!el;
    if (el) {
      el.value = "7";
      el.dispatchEvent(new Event("change", { bubbles: true }));
      sized = t.size === 7;
    }
    App.selection.clear(); UI.showProps();
  }
  return { made: !!t, drawn: svg2.includes("盤内注記A"), dxf: dxf2.includes("盤内注記A"),
    propShown, sized };
}));

const checks = {
  noPageErrors: errs.length === 0,
  reject: R.reject.fmt === true && R.reject.ver === true && R.reject.untouched === true,
  textOff: R.textOff.noText === true && R.textOff.noDash === true && R.textOff.dxf === true,
  insert: R.insert.added === 4 && R.insert.afterSpec === true && R.insert.four === true &&
    R.insert.titles === "筐体 全体図|筐体 穴あけ図|中板 全体図|中板 穴あけ図" &&
    R.insert.dwg === "A-005|A-006|A-007|A-008" && R.insert.tailKept === true,
  scale: R.scale.plate === "1:5" && R.scale.paper === "A3/landscape" && R.scale.cab === "1:5",
  draw: Object.entries(R.draw).every(([, v]) => v === true),
  bounds: R.insert.badCoords === 1,
  reimport: R.reimport.replaced === 4 && R.reimport.still4 === true && R.reimport.total === true,
  zip: R.zip.found === true && R.zip.parses === true,
  light: R.light.big === 0 && R.light.split === true && R.light.undoAlive === true,
  textEdit: TE.inputShown === true && TE.made === true && TE.drawn === true && TE.dxf === true &&
    TE.propShown === true && TE.sized === true,
  dxf: R.dxf.text === true && R.dxf.arc === true && R.dxf.circle === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-import OK");
