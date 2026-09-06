/* Panel Studio (制御盤配置) の図面差し込み。

   ・reject   : format / version が違う JSON はエラーにする (黙って読まない)
   ・insert   : 4 シートが仕様ページの直後に 4 ページで入り、既存の順序は
                崩れない。図番も振り直される
   ・scale    : 540×740 の中板は A3 横の図枠で 1:5 になる (標準縮尺の最小)
   ・draw     : ページに図形が出る — 文字 "S-T12"・円・円弧 (反時計回り)。
                表題欄には job/panel の値 (会社・担当・日付・型式・寸法) が入る
   ・reimport : 同じ案件の JSON をもう一度読んでも 4 ページのまま (置き換え)
   ・zip      : ZIP のまま渡されたら中の *_electracad.json を探して読む
   ・bounds   : 0〜extent の外の座標は数えて知らせる (読み込みは続ける)
   ・dxf      : DXF にも実体が出る (S-T12 / 円 / 円弧は a0→a1 のまま) */
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
      mkSheet("plate_full", "中板 全体図", 540, 740),
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

  // ── DXF ──
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

const checks = {
  noPageErrors: errs.length === 0,
  reject: R.reject.fmt === true && R.reject.ver === true && R.reject.untouched === true,
  insert: R.insert.added === 4 && R.insert.afterSpec === true && R.insert.four === true &&
    R.insert.titles === "筐体 全体図|筐体 穴あけ図|中板 全体図|中板 穴あけ図" &&
    R.insert.dwg === "B-001|B-002|B-003|B-004" && R.insert.tailKept === true,
  scale: R.scale.plate === "1:5" && R.scale.paper === "A3/landscape" && R.scale.cab === "1:5",
  draw: Object.entries(R.draw).every(([, v]) => v === true),
  bounds: R.insert.badCoords === 1,
  reimport: R.reimport.replaced === 4 && R.reimport.still4 === true && R.reimport.total === true,
  zip: R.zip.found === true && R.zip.parses === true,
  dxf: R.dxf.text === true && R.dxf.arc === true && R.dxf.circle === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-import OK");
