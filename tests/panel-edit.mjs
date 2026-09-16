/* パネル図 (Panel Studio 取り込みのキャビネット・中板) の編集。

   ・clusters : 図形は「外接箱が触れている要素のまとまり」に束なる —
               筐体枠 / 機器 (線 5 本) / 穴 (円) / 文字 が別々の 4 まとまり
   ・hit      : 紙の座標から機器のまとまりを拾える (空振りは null)
   ・nudge    : 矢印キーで選択図形が 5mm 動く (Shift で 0.5mm)。
               画面の上向き = パネル座標の +Y
   ・undoSafe : 動かす → 戻す → また動かす → 2 回戻す で元の座標に戻る
               (undo の控えと実体を共有しても壊れない = 写しに書いている)
   ・drag     : マウスのクリックで機器のまとまりが選ばれ、ドラッグで動く
               (1mm 刻み)
   ・del      : Delete キーで選択図形が消える
   ・holeProps: 穴 (円) を 1 つ選ぶとプロパティに中心 X/Y と径が出て、
               書き換えると図が動く
   ・svgSync  : 編集後の panelSVG は新しい座標で描かれる (キャッシュが
               編集で無効になる)
   ・cusPdf   : 顧客提出用 PDF からは「加工穴のみ」のページが外れる
               (板金加工用の指示 — 見せる意味がない)。社内保存用は全ページ
   ・dxfClean : パネルページの DXF は専用変換だけ — SVG 経由の二重出力
               (同じ線が PANEL と FRAME_THIN に 2 回、円が TEXT にもう 1 回)
               が無い。線種テーブルは CONTINUOUS (0 番・実線) だけ */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

/* ── 取り込みと まとまり・ヒット ── */
const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("パネル編集"); UI.renumberPages();
  const data = {
    format: "panel-studio/electracad-sheets", version: 1,
    job: { jobNo: "J-TEST" }, panel: { model: "TEST-BOX", outer: { w: 600, h: 400, d: 250 } },
    sheets: [
      { id: "cabinet_full", title: "キャビネット(機器つき)", extent: { w: 600, h: 400 },
        layers: { dev: { color: "#c33" } }, entities: [
          { t: "line", x1: 0, y1: 0, x2: 600, y2: 0 }, { t: "line", x1: 600, y1: 0, x2: 600, y2: 400 },
          { t: "line", x1: 600, y1: 400, x2: 0, y2: 400 }, { t: "line", x1: 0, y1: 400, x2: 0, y2: 0 },
          { t: "line", x1: 100, y1: 200, x2: 150, y2: 200, layer: "dev" },
          { t: "line", x1: 150, y1: 200, x2: 150, y2: 230, layer: "dev" },
          { t: "line", x1: 150, y1: 230, x2: 100, y2: 230, layer: "dev" },
          { t: "line", x1: 100, y1: 230, x2: 100, y2: 200, layer: "dev" },
          { t: "line", x1: 100, y1: 215, x2: 150, y2: 215, layer: "dev" },
          { t: "circle", cx: 300, cy: 100, r: 3.5 },
          { t: "text", x: 300, y: 300, h: 5, s: "MCCB" },
        ] },
      { id: "cabinet_holes", title: "キャビネット(加工穴のみ)", extent: { w: 600, h: 400 },
        entities: [{ t: "circle", cx: 50, cy: 50, r: 2 }] },
      { id: "plate_full", title: "中板(機器つき)", extent: { w: 500, h: 300 }, entities: [] },
      { id: "plate_holes", title: "中板(加工穴のみ)", extent: { w: 500, h: 300 }, entities: [] },
    ],
  };
  const res = panelInsertPages(data);
  UI.renumberPages();
  const pg = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "cabinet_full");
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  zoomFit(); requestRender();
  out.import = { added: res.added, has: !!pg, scale: pg.scale };

  const clus = panelClusters(pg);
  const devClu = clus.find(c => c.idxs.length === 5);
  out.clusters = { n: clus.length, dev: devClu ? devClu.idxs.length : 0,
    hole: clus.some(c => c.idxs.length === 1 && panelDataOf(pg).entities[c.idxs[0]].t === "circle"),
    text: clus.some(c => c.idxs.length === 1 && panelDataOf(pg).entities[c.idxs[0]].t === "text") };

  const { ox, oy } = panelOrigin(pg);
  const hitDev = panelClusterAt(pg, ox + 125, oy + (400 - 200));   // 機器の下辺の上
  const hitNone = panelClusterAt(pg, ox + 450, oy + (400 - 300)); // 何もない所
  out.hit = { dev: hitDev ? hitDev.idxs.length : 0, none: hitNone === null };
  // 顧客提出用 PDF: 加工穴のみのページは外れる (社内保存用は全ページ)
  out.cusPdf = {
    int: releasePages("internal").filter(p2 => p2.kind === "panel").length,
    cus: releasePages("customer").filter(p2 => p2.kind === "panel").map(p2 => p2.panel.sheetId).join(","),
  };
  out.devIdxs = devClu ? devClu.idxs : [];
  out.pgId = pg.id;
  return out;
});

/* ── 矢印キーで移動 + undo の安全性 ── */
const K = await p.evaluate(([mk]) => {
  const pg = curPage();
  Editor.panelSel = { pageId: mk.pgId, idxs: new Set(mk.devIdxs) };
  const ent = () => panelDataOf(pg).entities[mk.devIdxs[0]];   // 下辺 (x1=100, y1=200)
  const key = (k, shift) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: !!shift, bubbles: true }));
  const undoN0 = App.undoStack.length;
  key("ArrowRight");                       // +5mm 右
  const afterRight = { x1: ent().x1, y1: ent().y1 };
  key("ArrowUp", true);                    // Shift = 0.5mm、画面の上 = パネル +Y
  const afterUp = { x1: ent().x1, y1: ent().y1 };
  // undo 2 回で元へ。さらに 動かす → 戻す を重ねても座標が化けない (COW)
  undo(); const u1 = { x1: ent().x1, y1: ent().y1 };
  undo(); const u2 = { x1: ent().x1, y1: ent().y1 };
  Editor.panelSel = { pageId: mk.pgId, idxs: new Set(mk.devIdxs) };
  key("ArrowRight"); key("ArrowRight");
  const again = ent().x1;
  undo(); undo();
  const back = { x1: ent().x1, y1: ent().y1 };
  /* きわどい並び: 動かす → 戻す → 動かす → 戻す。控えから復元した実体へ
     直接書くと、2 回目の「戻す」が書き換え後の実体を使い回して化ける */
  Editor.panelSel = { pageId: mk.pgId, idxs: new Set(mk.devIdxs) };
  key("ArrowRight"); undo();
  key("ArrowRight"); undo();
  const tight = { x1: ent().x1, y1: ent().y1 };
  return { undoPushed: App.undoStack.length > undoN0 - 1, afterRight, afterUp, u1, u2, again, back, tight };
}, [R]);

/* ── マウスで 選択 → ドラッグ移動 (1mm 刻み) ── */
const toClient = await p.evaluate(([mk]) => {
  const pg = curPage();
  Editor.panelSel = null; App.selection.clear(); UI.showProps(); requestRender();
  const { ox, oy } = panelOrigin(pg);
  const a = screenToWorld(0, 0), bx = screenToWorld(100, 0), by = screenToWorld(0, 100);
  const kx = 100 / (bx.x - a.x), ky = 100 / (by.y - a.y);
  const W2C = (wx, wy) => ({ x: (wx - a.x) * kx, y: (wy - a.y) * ky });
  return { start: W2C(ox + 125, oy + (400 - 200)),      // 機器の下辺
    end: W2C(ox + 125 + 30, oy + (400 - 200)),          // 右へ 30mm
    kx };
}, [R]);
await p.mouse.click(toClient.start.x, toClient.start.y);
await p.waitForTimeout(150);
const selAfterClick = await p.evaluate(() => (panelSelIdxs() ? panelSelIdxs().size : 0));
await p.mouse.move(toClient.start.x, toClient.start.y);
await p.mouse.down();
await p.mouse.move(toClient.end.x, toClient.end.y, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(150);
const DR = await p.evaluate(([mk]) => {
  const pg = curPage();
  const e = panelDataOf(pg).entities[mk.devIdxs[0]];
  return { click: null, x1: e.x1, y1: e.y1, selKept: !!panelSelIdxs() };
}, [R]);

/* ── Delete キーで削除 ── */
const DEL = await p.evaluate(([mk]) => {
  const pg = curPage();
  const n0 = panelDataOf(pg).entities.length;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  const n1 = panelDataOf(pg).entities.length;
  const undone = (undo(), panelDataOf(curPage()).entities.length);   // 消し過ぎ防止に戻しておく
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return { n0, n1, sel: Editor.panelSel, undone };
}, [R]);

/* ── 穴 (円) のプロパティ編集 + SVG への反映 ── */
const HP = await p.evaluate(async () => {
  const pg = curPage();
  const pd = panelDataOf(pg);
  const ci = pd.entities.findIndex(e => e.t === "circle");
  Editor.panelSel = { pageId: pg.id, idxs: new Set([ci]) };
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const cx = document.getElementById("pPnCx"), dia = document.getElementById("pPnDia");
  if (!cx || !dia) return { fields: false };
  cx.value = "310";
  cx.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const dia2 = document.getElementById("pPnDia");
  dia2.value = "8";
  dia2.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const e = panelDataOf(pg).entities.find(e2 => e2.t === "circle");
  const { ox, oy } = panelOrigin(pg);
  applySheet(pg);
  const svg = panelSVG(pg);
  return { fields: true, cx: e.cx, r: e.r,
    svgNew: svg.includes(`cx="${ox + 310}"`), svgOld: svg.includes(`cx="${ox + 300}"`) };
});

/* ── DXF: 二重出力なし・線種は初期 (CONTINUOUS) だけ ── */
const DX = await p.evaluate(() => {
  const parse = dxf => {
    const ls = dxf.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i < ls.length - 1; i += 2) pairs.push([ls[i], ls[i + 1]]);
    const lt = [];
    pairs.forEach((pr, i) => {
      if (pr[0] === "0" && pr[1] === "LTYPE") {
        for (let j = i + 1; j < Math.min(i + 12, pairs.length); j++)
          if (pairs[j][0] === "2") { lt.push(pairs[j][1]); break; }
      }
    });
    const ei = pairs.findIndex(pr => pr[0] === "2" && pr[1] === "ENTITIES");
    const cnt = {};
    let cur = null;
    pairs.slice(ei).forEach(pr => {
      if (pr[0] === "0") cur = pr[1];
      else if (pr[0] === "8") { const k = cur + "/" + pr[1]; cnt[k] = (cnt[k] || 0) + 1; }
    });
    return { lt, cnt };
  };
  const cab = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "cabinet_full");
  const plate = App.project.pages.find(p2 => p2.kind === "panel" && p2.panel.sheetId === "plate_full");
  applySheet(cab); const a = parse(pageToDXF(cab));
  applySheet(plate); const b2 = parse(pageToDXF(plate));   // 中身 0 件 → 図枠だけの基準
  return { lt: a.lt.join(","),
    panelLines: a.cnt["LINE/PANEL"] || 0,
    circPanel: a.cnt["CIRCLE/PANEL"] || 0,
    circText: a.cnt["CIRCLE/TEXT"] || 0,
    frameThin: a.cnt["LINE/FRAME_THIN"] || 0,
    frameThin0: b2.cnt["LINE/FRAME_THIN"] || 0 };
});

const checks = {
  noPageErrors: errs.length === 0,
  import: R.import.added === 4 && R.import.has === true,
  clusters: R.clusters.n === 4 && R.clusters.dev === 5 &&
    R.clusters.hole === true && R.clusters.text === true,
  hit: R.hit.dev === 5 && R.hit.none === true,
  cusPdf: R.cusPdf.int === 4 && R.cusPdf.cus === "cabinet_full,plate_full",
  /* 線 9 本は PANEL だけ・円は PANEL だけ (TEXT への複製なし)。
     FRAME_THIN は中身 0 件のページ (図枠だけ) と同数 = 中身が漏れていない。
     線種テーブルは CONTINUOUS のみ */
  dxfClean: DX.lt === "CONTINUOUS" && DX.panelLines === 9 && DX.circPanel === 1 &&
    DX.circText === 0 && DX.frameThin === DX.frameThin0,
  /* 右 5mm → x1 105。Shift+↑ は画面の上向き = パネル座標 +0.5 */
  nudge: K.afterRight.x1 === 105 && K.afterRight.y1 === 200 &&
    K.afterUp.x1 === 105 && K.afterUp.y1 === 200.5,
  undoSafe: K.u1.x1 === 105 && K.u1.y1 === 200 && K.u2.x1 === 100 && K.u2.y1 === 200 &&
    K.again === 110 && K.back.x1 === 100 && K.back.y1 === 200 &&
    K.tight.x1 === 100 && K.tight.y1 === 200,
  /* クライアント座標は px 丸めで ±1mm ずれ得る — 1mm 刻みで約 30mm 動いたこと */
  drag: selAfterClick === 5 && Number.isInteger(DR.x1) && Math.abs(DR.x1 - 130) <= 1 &&
    Math.abs(DR.y1 - 200) <= 1 && DR.selKept === true,
  del: DEL.n1 === DEL.n0 - 5 && DEL.sel === null && DEL.undone === DEL.n0,
  holeProps: HP.fields === true && HP.cx === 310 && HP.r === 4,
  svgSync: HP.svgNew === true && HP.svgOld === false,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, K, DR, DEL, HP, selAfterClick, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("panel-edit OK");
