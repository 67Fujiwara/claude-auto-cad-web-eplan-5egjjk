/* 入出力結線図 (PLC) のつかみ範囲 — 用紙の大半を覆う外接矩形ではなく、
   実際に線のある帯 (端子の列の箱・機能欄の下線) だけで拾うこと。

   ・hitEmpty : 記号の真ん中の何もない区画をクリックしても PLC は選ばれない
                (中に描いた配線・機器を編集できる)
   ・hitBand  : 端子の列の箱・機能欄の下線の上では PLC が選べる
   ・rubber   : 交差選択も同じ — 空の区画をまたぐだけでは PLC を巻き込まず、
                端子の帯に触れれば選ばれる */
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
  App.project = newProject("PLCつかみ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const d = addDevice(pg, "kv_n40at_out1", 100, 40);   // 出力: 箱が左・機能欄が右端
  UI.setTool("select"); UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));

  const bands = devInkBoxes(d);
  const box = bands[0], fn = bands[1];                // 端子の列の箱 / 機能欄の帯
  const midX = box.x + box.w + 40;                    // 箱と機能欄の間の空き区画
  const midY = box.y + box.h / 2;
  const at = (x, y) => { const h2 = hitTest(x, y); return h2 ? `${h2.type}:${h2.obj.id === d.id ? "plc" : "other"}` : "none"; };
  out.bounds = devBounds(d);
  out.hitEmpty = { mid: at(midX, midY), inBounds: midX > out.bounds.x && midX < out.bounds.x + out.bounds.w };
  out.hitBand = { box: at(box.x + box.w / 2, midY), fn: at(fn.x + fn.w / 2, fn.y + fn.h / 2) };

  // ── 交差選択 (右→左ドラッグ) ──
  const bb = Editor.svg.getBoundingClientRect();
  const S = (x, y) => [bb.left + Editor.view.tx + x * Editor.view.s, bb.top + Editor.view.ty + y * Editor.view.s];
  const drag = (x0, y0, x1, y1) => {
    const [ax, ay] = S(x0, y0), [cx, cy] = S(x1, y1);
    Editor.svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: ax, clientY: ay, button: 0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cx, clientY: cy, buttons: 1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
  };
  App.selection.clear();
  drag(midX + 30, midY + 30, midX - 30, midY - 30);   // 空の区画だけをまたぐ交差選択
  out.rubber = { empty: App.selection.has(d.id) };
  App.selection.clear();
  drag(box.x + box.w + 5, midY + 20, box.x + box.w / 2, midY - 20);  // 端子の帯に触れる
  out.rubber.band = App.selection.has(d.id);
  App.selection.clear();
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  hitEmpty: R.hitEmpty.mid === "none" && R.hitEmpty.inBounds === true,
  hitBand: R.hitBand.box === "device:plc" && R.hitBand.fn === "device:plc",
  rubber: R.rubber.empty === false && R.rubber.band === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("kv-hit OK");
