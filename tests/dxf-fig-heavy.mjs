/* 実物の 30MB 級 DXF (折れ線の頂点が数十万) を盤図ページにしても固まらない。

   取り込んだ線・円・円弧は「図 (fig)」として数値の配列だけで持ち、
   ページ上は代表の 1 要素として扱う。頂点の多い図は画面では画像で描く。

   ・simplify : 一直線に並ぶ点 (ずれが許容内) は間引かれる (2 点になる)。
               ジグザグ (許容より大きい) はほぼ全部残る
   ・screen   : 画面の盤図の層には重い図の path を入れない (軽い)。
               印刷 SVG には全部の頂点がベクトルで出る
   ・raster   : 画面には画像 (blob) が出て、実際に線の画素がある。
               小さなパンでは描き直さず、大きく拡大すると細かく描き直す
   ・hit      : 線の上をクリックすると図 (代表) が当たる。図の箱の中でも
               線から離れた所は当たらない (範囲選択などを邪魔しない)
   ・move     : 図を動かすと dx/dy だけ変わり、図のデータはそのまま。
               印刷の座標も画像の位置もずれる
   ・delete   : 図を消すと図のデータも消え、画像も消える。元に戻すで戻る
   ・rotate   : 図を含む選択は回転しない (文字だけ回って図とずれない)
   ・save     : 保存 (直列化) しても図が残る
   ・migrate  : V230 の形 (1 本ずつの line entity) の DXF 盤図は、開いた
               ときに図へまとめ直される (つながる線は 1 本の折れ線に)
   ・away     : ほかのページへ移ると画像は隠れる */
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
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const img = () => document.querySelector("#pnRaster");
  const until = async (fn, ms = 4000) => { const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };

  // ── 頂点の多い DXF: ジグザグ 5 万点 + 一直線 200 点 + 線 1 本 + 文字 ──
  const o = ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", "0", "90", "50000", "70", "0"];
  for (let i = 0; i < 50000; i++) o.push("10", (i * 0.05).toFixed(2), "20", String(100 + (i % 2) * 2));
  o.push("0", "LWPOLYLINE", "8", "0", "90", "200", "70", "0");
  for (let i = 0; i < 200; i++) o.push("10", String(i * 10), "20", (500 + (i % 2) * 0.02).toFixed(2));
  o.push("0", "LINE", "8", "0", "10", "10", "20", "550", "11", "60", "21", "550");
  o.push("0", "TEXT", "8", "0", "10", "1000", "20", "560", "40", "10", "1", "HEAVY-TXT");
  o.push("0", "ENDSEC", "0", "EOF");
  App.project = newProject("重い DXF"); UI.renumberPages();
  const pg0 = App.project.pages.find(isDrawingPage);
  const r = panelInsertDxfPage(parseDXF(o.join("\n")), "重い.dxf");
  UI.renumberPages();
  const pg = r.page;
  App.pageIdx = App.project.pages.indexOf(pg); UI.refresh(); zoomFit();
  await raf();
  const pd = panelDataOf(pg);
  const fig = pd.fig;

  // ── simplify ──
  out.simplify = { straight: fig.pl.some(q => q.length === 4 && q[1] === 400 && Math.abs(q[3] - 400) < 0.05 && q[2] === 1990),
    zig: Math.max(...fig.pl.map(q => q.length / 2)), heavy: panelFigHeavy(pd) };

  // ── screen / print ──
  const svgP = exportSheetSVG(pg);
  applySheet(pg);
  out.screen = { layerLen: Editor.layers.panel.innerHTML.length, text: Editor.layers.panel.innerHTML.includes("HEAVY-TXT"),
    printL: (svgP.match(/L/g) || []).length };

  // ── raster ──
  out.raster = { shown: await until(() => img().style.display !== "none" && /^blob:/.test(img().getAttribute("href") || "")) };
  const px = await new Promise(res => {
    const im = new Image();
    im.onload = () => { const cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
      const ctx = cv.getContext("2d"); ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      res(n); };
    im.onerror = () => res(-1);
    im.src = img().getAttribute("href");
  });
  out.raster.pixels = px;
  const href0 = img().getAttribute("href"), dens0 = Editor.pnRaster && Editor.pnRaster.dens;
  Editor.view.tx += 5; requestRender(); await raf(); await sleep(400);
  out.raster.panKept = img().getAttribute("href") === href0;
  // 中央を 4 倍に拡大 → 細かく描き直す
  const rc = Editor.svg.getBoundingClientRect(), v = Editor.view;
  const cx = rc.width / 2, cy = rc.height / 2;
  v.tx = cx - (cx - v.tx) * 4; v.ty = cy - (cy - v.ty) * 4; v.s *= 4;
  requestRender(); await raf();
  out.raster.zoomRedraw = await until(() => img().getAttribute("href") !== href0);
  out.raster.denser = !!(Editor.pnRaster && Editor.pnRaster.dens > dens0 * 2);
  zoomFit(); await raf(); await sleep(300);

  // ── hit ──
  const fe = pd.entities.find(e => e.t === "fig");
  out.hit = { onLine: panelHitIdx(pg, 35, 450, 2.5 * sheetScale()), empty: panelHitIdx(pg, 1000, 200, 2.5 * sheetScale()),
    figIdx: pd.entities.indexOf(fe) };

  // ── move ──
  const firstM = s2 => { const m = /<path d="M(-?[\d.]+),(-?[\d.]+)L/.exec(s2); return m ? [+m[1], +m[2]] : null; };
  const m0 = firstM(svgP);
  const imgX0 = +img().getAttribute("x");
  commit();
  panelMoveEnts(pg, [out.hit.figIdx], 10, 5);
  requestRender(); await raf();
  const pd2 = panelDataOf(pg);
  const fe2 = pd2.entities.find(e => e.t === "fig");
  const m1 = firstM(exportSheetSVG(pg)); applySheet(pg);
  out.move = { dx: fe2.dx, dy: fe2.dy, sameFig: pd2.fig === fig,
    shift: m0 && m1 ? [+(m1[0] - m0[0]).toFixed(2), +(m1[1] - m0[1]).toFixed(2)] : null };
  out.move.imgMoved = await until(() => Math.abs(+img().getAttribute("x") - (imgX0 + 10)) < 0.5);

  // ── rotate: 図を含む選択は回さない (文字だけ回って図とずれない) ──
  const tIdx = pd2.entities.findIndex(e => e.t === "text");
  const t0 = { ...pd2.entities[tIdx] };
  Editor.panelSel = { pageId: pg.id, idxs: new Set(pd2.entities.map((_, i) => i)) };
  App.selection.clear();
  rotateSelection();
  const tA = panelDataOf(pg).entities[tIdx];
  out.rotate = { same: tA.x === t0.x && tA.y === t0.y && !tA.rot };
  Editor.panelSel = null;

  // ── save ──
  const ser = JSON.parse(serializeProject());
  const spd = ser.panelData[pg.panel.dataKey];
  out.save = { fig: !!(spd && spd.fig && spd.fig.pl.length === fig.pl.length),
    rep: !!(spd && spd.entities.some(e => e.t === "fig" && e.dx === 10)) };

  // ── delete / undo ──
  commit();
  panelDeleteEnts(pg, [pd2.entities.indexOf(fe2)]);
  requestRender(); await raf(); await sleep(100);
  out.del = { fig: !!panelDataOf(pg).fig, rep: panelDataOf(pg).entities.some(e => e.t === "fig"),
    hidden: img().style.display === "none", text: panelDataOf(pg).entities.some(e => e.s === "HEAVY-TXT") };
  undo();
  App.pageIdx = App.project.pages.findIndex(q => q.panel && q.panel.dxf);
  requestRender(); await raf();
  out.del.undo = !!panelDataOf(curPage()).fig;

  // ── away ──
  await until(() => img().style.display !== "none");
  App.pageIdx = App.project.pages.findIndex(isDrawingPage); UI.refresh(); await raf();
  out.away = img().style.display === "none";

  // ── migrate (V230 の形) ──
  App.project = newProject("旧形式"); UI.renumberPages();
  App.project.panelData = { "dxf/old": { entities: [
    { t: "line", x1: 0, y1: 0, x2: 10, y2: 0, layer: "0" }, { t: "line", x1: 10, y1: 0, x2: 10, y2: 10, layer: "0" },
    { t: "line", x1: 10, y1: 10, x2: 0, y2: 10, layer: "0" }, { t: "circle", cx: 5, cy: 5, r: 1, layer: "0" },
    { t: "text", x: 1, y: 1, s: "OLD-TXT", h: 2, layer: "0" },
    { t: "line", x1: 0, y1: 20, x2: 5, y2: 20, add: true } ], layers: {} } };
  App.project.pages.push({ id: "pgOld", no: 0, kind: "panel", name: "旧", devices: [], wires: [], texts: [], zones: [],
    paper: "A3", orient: "landscape", scale: "1:1", panelText: true,
    panel: { jobNo: "", cabId: "", sheetId: "dxf", title: "旧", dataKey: "dxf/old", dxf: "旧.dxf",
      extent: { w: 10, h: 20 }, job: {}, model: "", outer: {}, note: "" } });
  normalizeWireNumbers();     // 開いたときの手当て (panelNormalize を通る)
  const opd = App.project.panelData["dxf/old"];
  out.migrate = { fig: !!opd.fig, pl: opd.fig && opd.fig.pl.map(q => q.length / 2).join(","),
    circles: opd.fig && opd.fig.circles.length,
    ents: opd.entities.map(e => e.t + (e.add ? "+" : "")).join(",") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  simplify: R.simplify.straight === true && R.simplify.zig >= 49990 && R.simplify.heavy === true,
  screen: R.screen.layerLen < 20000 && R.screen.text === true && R.screen.printL >= 50000,
  raster: R.raster.shown === true && R.raster.pixels > 500 && R.raster.panKept === true &&
    R.raster.zoomRedraw === true && R.raster.denser === true,
  hit: R.hit.figIdx === 0 && R.hit.onLine === 0 && R.hit.empty === -1,
  move: R.move.dx === 10 && R.move.dy === 5 && R.move.sameFig === true &&
    !!R.move.shift && R.move.shift[0] === 10 && R.move.shift[1] === -5 && R.move.imgMoved === true,
  rotate: R.rotate.same === true,
  save: R.save.fig === true && R.save.rep === true,
  del: R.del.fig === false && R.del.rep === false && R.del.hidden === true && R.del.text === true && R.del.undo === true,
  away: R.away === true,
  migrate: R.migrate.fig === true && R.migrate.pl === "4" && R.migrate.circles === 1 &&
    R.migrate.ents === "fig,text,line+",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("dxf-fig-heavy OK");
