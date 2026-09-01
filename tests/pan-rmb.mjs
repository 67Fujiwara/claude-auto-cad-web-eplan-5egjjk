/* 右ドラッグでパン — マウスの位置を軸に図面を動かす。

   ・rmbPan    : 右ボタンのドラッグで図面が動く。つまんだ点がマウスに
                 ついてくる (ドラッグの後もカーソルの下は同じ図面座標)
   ・keepDraft : 配線の作図中に右ドラッグでパンしても、作図中の線は消えない
   ・rmbCancel : 動かさず右クリックだけなら、従来どおり作図をキャンセル
   ・noMenu    : 図面の上では既定の右クリックメニューを出さない
   ・leftSame  : 左ドラッグは今までどおり (パンではなく範囲選択になる) */
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
  App.project = newProject("右ドラッグ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  UI.setTool("select"); UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));

  const bb = Editor.svg.getBoundingClientRect();
  const down = (cx, cy, o = {}) => Editor.svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: cx, clientY: cy, ...o }));
  const move = (cx, cy, o = {}) => window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cx, clientY: cy, ...o }));
  const up = (cx, cy, o = {}) => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: cx, clientY: cy, ...o }));

  // ── 右ドラッグ = パン。つまんだ点がマウスについてくる ──
  const cx = bb.left + 420, cy = bb.top + 320;
  const before = screenToWorld(cx, cy);
  const tx0 = Editor.view.tx, ty0 = Editor.view.ty;
  down(cx, cy, { button: 2, buttons: 2 });
  const panDrag = Editor.drag && Editor.drag.type;
  move(cx + 90, cy + 60, { buttons: 2 });
  up(cx + 90, cy + 60, { button: 2 });
  const after = screenToWorld(cx + 90, cy + 60);   // 動かした先のカーソル位置
  out.rmbPan = {
    drag: panDrag, dx: Editor.view.tx - tx0, dy: Editor.view.ty - ty0,
    follow: Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01,
  };

  // ── 既定の右クリックメニューは出ない ──
  out.noMenu = { prevented: !Editor.svg.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: cx, clientY: cy })) };

  // ── 配線の作図中に右ドラッグでパンしても、作図は消えない ──
  UI.setTool("wire");
  down(cx, cy, { button: 0 }); up(cx, cy, { button: 0 });
  out.keepDraft = { started: !!Editor.wireDraft };
  const tx1 = Editor.view.tx;
  down(cx, cy, { button: 2, buttons: 2 });
  move(cx - 70, cy - 40, { buttons: 2 });
  up(cx - 70, cy - 40, { button: 2 });
  out.keepDraft.after = { draft: !!Editor.wireDraft, panned: Editor.view.tx !== tx1 };

  // ── 動かさず右クリックだけ → 従来どおりキャンセル ──
  down(cx, cy, { button: 2, buttons: 2 });
  up(cx, cy, { button: 2 });
  out.rmbCancel = { draft: !!Editor.wireDraft };

  // ── 左ドラッグは今までどおり範囲選択 ──
  UI.setTool("select");
  down(cx, cy, { button: 0, buttons: 1 });
  move(cx + 40, cy + 30, { buttons: 1 });
  out.leftSame = { drag: Editor.drag && Editor.drag.type };
  up(cx + 40, cy + 30, { button: 0 });
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  rmbPan: R.rmbPan.drag === "pan" && R.rmbPan.dx === 90 && R.rmbPan.dy === 60 && R.rmbPan.follow === true,
  keepDraft: R.keepDraft.started === true && R.keepDraft.after.draft === true && R.keepDraft.after.panned === true,
  rmbCancel: R.rmbCancel.draft === false,
  noMenu: R.noMenu.prevented === true,
  leftSame: R.leftSame.drag === "rubber",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("pan-rmb OK");
