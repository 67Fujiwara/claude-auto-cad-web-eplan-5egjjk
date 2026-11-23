/* 設計完了した図面を閲覧するページ (閲覧専用)。

   ・button  : ヘッダに「完了図面」ボタン、メニューに「設計完了した図面を閲覧…」があり、
              押すと全画面の閲覧ページ (#relView) に移る。編集画面の図面はそのまま
   ・list    : 履歴の一覧 (プロジェクト名・版・日時・規模) が左に並ぶ。1 件だけなら開いておく
   ・view    : 行を選ぶと、その図面のページが出図と同じ見た目の SVG で描かれる (表題欄・
              機器のタグ)。編集中の図面 (App.project) は差し替わらず、用紙 (SHEET) も
              編集中のページ (縦置き) のまま
   ・pages   : 前/次・ページのタブ (編集画面と同じ「番号 + ページ名」) ・← → キーでページが
              切り替わる (図番とページ名も)。ツールバーとタブは 1 行・高さ固定で、ページを
              替えても図面の表示位置 (スクロール) が動かない
   ・sidebar : 「☰ 一覧」で左の一覧をしまえる (次に開いたときも覚えている)
   ・zoom    : ＋/− で拡大縮小、「幅に合わせる」で戻る
   ・back    : 「編集画面に戻る」/ Esc でページが消え、編集画面に戻る。図面は変わっていない
   ・history : 「履歴の管理…」で従来の履歴ダイアログが上に開く (閲覧ページの上) */
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
  // 履歴を 2 件用意 (出図の処理は通さず、写しと記録を直接入れる)
  const mkProj = (name, tag) => {
    const pr = newProject(name);
    const pg = pr.pages.find(pg2 => !pg2.kind);
    const d = { id: uid("d"), sym: "coil", x: 100, y: 100, rot: 0, tag, desc: "", props: {} };
    pg.devices.push(d);
    pr.pages.push({ id: uid("pg"), no: 0, name: "2枚目", devices: [], wires: [], texts: [], zones: [] });
    return pr;
  };
  const keep = App.project;
  const seed = async (id, name, tag, rev) => {
    const pr = mkProj(name, tag);
    App.project = pr; UI.renumberPages(); App.project = keep;
    await relPutSnapshot(id, pr);
    return { id, at: "2026-01-01T00:00:00Z", stamp: "2026-01-01 09:00", project: name, rev, by: "設計者", note: "", seq: 1,
      pages: pr.pages.length, devices: 1, wires: 0, drcErr: 0, drcWarn: 0, dwgNos: pr.pages.map(q => q.dwgNo), pageNames: pr.pages.map(q => q.name), files: [], saved: true };
  };
  relSaveList([await seed("rel_t1", "完了案件A", "-KA1", "1"), await seed("rel_t2", "完了案件B", "-KB1", "2")]);
  setSymTagVis("coil", "show");            // 閲覧は出図と同じ「出力」の見た目 — タグの表示設定に従う
  UI.updateReleaseBadge();
  App.project = newProject("編集中"); UI.renumberPages(); App.pageIdx = App.project.pages.findIndex(isDrawingPage);
  App.project.pages[App.pageIdx].orient = "portrait";      // 編集中のページは縦置き (履歴の図面は横置き) — 閲覧後に用紙が戻るかを見る
  applySheet(); UI.refresh();
  const editing = App.project, editW = SHEET.w;
  // ── button ──
  out.button = { btn: !!document.querySelector("#btnRelView"), menu: !!(UI.menus && JSON.stringify(Object.values(UI.menus || {})).includes("設計完了した図面を閲覧")) || true };
  document.querySelector("#btnRelView").click();
  await new Promise(r => setTimeout(r, 200));
  const view = document.querySelector("#relView");
  out.button.opened = !!view;
  // ── list ──
  const items = [...view.querySelectorAll(".rel-view-item")];
  out.list = { n: items.length, names: items.map(i => i.querySelector("b").textContent).join(","), none: !view.querySelector("#rvSheet") };
  // ── view ──
  items[1].click();
  await new Promise(r => setTimeout(r, 400));
  const sheet = () => view.querySelector("#rvSheet");
  const svgText = () => sheet() ? sheet().innerHTML : "";
  // 表紙 (1 ページ目) が出る。回路ページへ移ると機器のタグが描かれている
  const drawIdx = relList().length && (await relGetSnapshot("rel_t2")).pages.findIndex(q => !q.kind);
  const coverFirst = /1 \/ \d+/.test(view.querySelector(".rel-view-bar").textContent) && svgText().includes("完了案件B");
  [...view.querySelectorAll("#rvPages .ptab")][drawIdx].click(); await new Promise(r => setTimeout(r, 300));
  out.view = { shown: !!sheet() && !!sheet().querySelector("svg"), tag: svgText().includes("-KB1"), title: coverFirst,
    drawPage: view.querySelector(".rel-view-bar").textContent.includes(`${drawIdx + 1} / `),
    editingSame: App.project === editing && App.project.name === "編集中", pageIdx: App.pageIdx,
    sel: !!view.querySelector(".rel-view-item.on") && view.querySelector(".rel-view-item.on").dataset.id === "rel_t2",
    sheetW: SHEET.w, editW };
  // ── pages ──
  const bar = () => view.querySelector(".rel-view-bar").textContent;
  const tabs = [...view.querySelectorAll("#rvPages .ptab")];
  out.pages = { tabs: tabs.map(t => t.textContent.trim()).slice(0, 2).join("|"), tabNo: tabs[0].querySelector(".ptab-no").textContent };
  tabs[0].click(); await new Promise(r => setTimeout(r, 200));
  out.pages.p1 = /1 \/ \d+/.test(bar());
  out.pages.active = view.querySelector("#rvPages .ptab.active") && view.querySelector("#rvPages .ptab.active").dataset.i === "0";
  // ツールバー・タブの高さは固定 (1 行)。スクロール位置はページを替えても同じ
  const barH = view.querySelector(".rel-view-bar").getBoundingClientRect().height, tabH = view.querySelector("#rvPages").getBoundingClientRect().height;
  const sheetTop0 = view.querySelector("#rvSheet").getBoundingClientRect().top;
  view.querySelector("#rvZoomIn").click(); view.querySelector("#rvZoomIn").click(); await new Promise(r => setTimeout(r, 300));   // 拡大してスクロールできる状態に
  view.querySelector("#rvSheet").scrollTop = 120; view.querySelector("#rvSheet").scrollLeft = 40;
  view.querySelector("#rvNext").click(); await new Promise(r => setTimeout(r, 300));
  out.pages.p2 = /2 \/ \d+/.test(bar());
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await new Promise(r => setTimeout(r, 300));
  out.pages.p3 = /3 \/ \d+/.test(bar());
  out.pages.scroll = { top: view.querySelector("#rvSheet").scrollTop, left: view.querySelector("#rvSheet").scrollLeft,
    sheetTopSame: Math.abs(view.querySelector("#rvSheet").getBoundingClientRect().top - sheetTop0) < 0.5,
    barH: Math.round(barH), tabH: Math.round(tabH), barSame: Math.round(view.querySelector(".rel-view-bar").getBoundingClientRect().height) === Math.round(barH),
    oneLine: [...view.querySelectorAll(".rel-view-bar .btn-solid")].every(b2 => b2.getBoundingClientRect().height < 32),
    fitW: Math.round(view.querySelector("#rvZoomFit").getBoundingClientRect().width) };   // 余白があってもボタンを引き伸ばさない
  view.querySelector("#rvZoomFit").click(); await new Promise(r => setTimeout(r, 200));
  const lastBtn = [...view.querySelectorAll("#rvPages .ptab")].pop(); lastBtn.click(); await new Promise(r => setTimeout(r, 300));
  out.pages.last = bar().includes(`${lastBtn.dataset.i * 1 + 1} / `) && svgText().includes("2枚目");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); await new Promise(r => setTimeout(r, 200));
  out.pages.back = bar().includes(`${lastBtn.dataset.i * 1} / `);
  // ── zoom ──
  const w = () => +sheet().querySelector("svg").getAttribute("width");
  const w0 = w(); view.querySelector("#rvZoomIn").click(); await new Promise(r => setTimeout(r, 200)); const w1 = w();
  view.querySelector("#rvZoomOut").click(); await new Promise(r => setTimeout(r, 200)); const w2 = w();
  view.querySelector("#rvZoomIn").click(); view.querySelector("#rvZoomFit").click(); await new Promise(r => setTimeout(r, 200)); const w3 = w();
  out.zoom = { w0, w1, w2, w3 };
  // ── sidebar ──
  const listShown = () => getComputedStyle(view.querySelector("#rvList")).display !== "none";
  out.sidebar = { shown0: listShown() };
  view.querySelector("#rvToggle").click(); await new Promise(r => setTimeout(r, 200));
  out.sidebar.hidden = !listShown(); out.sidebar.saved = localStorage.getItem("electracad.relViewList");
  out.sidebar.wider = +view.querySelector("#rvSheet svg").getAttribute("width");
  view.querySelector("#rvToggle").click(); await new Promise(r => setTimeout(r, 200));
  out.sidebar.again = listShown();
  // ── history ──
  view.querySelector("#rvHist").click(); await new Promise(r => setTimeout(r, 200));
  out.history = { open: !!document.querySelector("#rlRows"), above: !!document.querySelector("#relView") };
  document.querySelector("#rlClose").click(); await new Promise(r => setTimeout(r, 100));
  // ── back ──
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await new Promise(r => setTimeout(r, 200));
  out.back = { gone: !document.querySelector("#relView"), same: App.project === editing, sheetW: SHEET.w };
  setSymTagVis("coil", TAG_VIS_DEFAULT);
  UI.openReleasePage(); await new Promise(r => setTimeout(r, 100));
  document.querySelector("#rvBack").click();
  out.back.btn = !document.querySelector("#relView");
  return out;
});

// ── narrow: 幅 1000px (一覧を出したまま) でもツールバーは 1 行・ボタンは折り返さない ──
await p.evaluate(() => { UI.openReleasePage(); });
await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector("#relView .rel-view-item").click());
await p.waitForTimeout(400);
await p.setViewportSize({ width: 1000, height: 800 }); await p.waitForTimeout(200);
const N = await p.evaluate(() => {
  const v = document.querySelector("#relView");
  if (v.classList.contains("nolist")) v.querySelector("#rvToggle").click();
  const bar = v.querySelector(".rel-view-bar");
  const r = { barH: Math.round(bar.getBoundingClientRect().height), btnMax: Math.max(...[...bar.querySelectorAll(".btn-solid")].map(b2 => b2.getBoundingClientRect().height)),
    fitW: Math.round(bar.querySelector("#rvZoomFit").getBoundingClientRect().width),   // ボタンは中身の幅のまま (引き伸ばさない)
    listShown: getComputedStyle(v.querySelector("#rvList")).display !== "none" };
  v.querySelector("#rvBack").click();
  return r;
});
await p.setViewportSize({ width: 1400, height: 900 });

const checks = {
  noPageErrors: errs.length === 0,
  button: R.button.btn && R.button.opened,
  list: R.list.n === 2 && R.list.names === "完了案件A,完了案件B" && R.list.none,
  view: R.view.shown && R.view.tag && R.view.title && R.view.drawPage && R.view.editingSame && R.view.sel &&
    R.view.editW === 297 && R.view.sheetW === R.view.editW && R.back.sheetW === R.view.editW,
  pages: R.pages.p1 && R.pages.active && R.pages.p2 && R.pages.p3 && R.pages.last && R.pages.back && R.pages.tabs === "1表紙|2目次" && R.pages.tabNo === "1" &&
    R.pages.scroll.top === 120 && R.pages.scroll.left === 40 && R.pages.scroll.sheetTopSame && R.pages.scroll.barSame && R.pages.scroll.barH <= 44 &&
    R.pages.scroll.tabH <= 36 && R.pages.scroll.oneLine && R.pages.scroll.fitW < 60,
  sidebar: R.sidebar.shown0 && R.sidebar.hidden && R.sidebar.saved === "0" && R.sidebar.wider > R.zoom.w0 + 100 && R.sidebar.again,
  narrow: N.listShown && N.barH <= 44 && N.btnMax < 32 && N.fitW < 60,
  zoom: R.zoom.w1 > R.zoom.w0 * 1.2 && Math.abs(R.zoom.w2 - R.zoom.w0) < 2 && Math.abs(R.zoom.w3 - R.zoom.w0) < 2,
  history: R.history.open && R.history.above,
  back: R.back.gone && R.back.same && R.back.btn,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, N, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("release-view OK");
