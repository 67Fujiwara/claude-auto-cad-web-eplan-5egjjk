/* 端子どうしの吸着と 0.5mm 微調整 — 端子の張り出しが 5mm の倍数でない記号
   (M12 コネクタなど) を、配線や相手の端子と真横に合わせられるようにする。

   ・offGridSym : 端子の張り出しが 5mm の倍数でない記号が実在する (前提)
   ・cantAlign  : 5mm 格子だけでは、その端子を配線の高さに合わせられない
                  (格子移動の結果が必ずずれる) — 修正前の症状
   ・snapDrag   : 実マウスで機器をドラッグすると、あと 2.4mm 以内の相手に
                  端子の高さが吸着してぴったり揃う
   ・altOff     : Alt を押しながらのドラッグは従来どおり格子のまま (吸着しない)
   ・fineNudge  : Shift+矢印で 0.5mm 刻みに動く (矢印だけなら 5mm のまま)
   ・wiresKeep  : 吸着で動いても、端子につながっている配線は追従する
   ・propStep   : プロパティの X/Y が 0.5mm 刻みで入力できる
   ・propFresh  : ドラッグで吸着した後、プロパティの X/Y 欄が動いた値になる */
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
  /* 自作記号は端子を図形の先端へ吸着できるので、張り出しが 5mm の倍数で
     ない端子を持てる (M12 コネクタなど実際の症例)。その姿を作る */
  const sym = {
    id: "test_m12", db: true, group: "自作", cat: "db", letter: "X", custom: true, nonstd: true,
    name: "M12 コネクタ (試験用)", nameEn: "M12", desc: "端子が 5mm 格子から外れた自作記号",
    pins: [{ x: 0, y: 2.5, n: "1" }], bounds: [-6, -4, 18, 12], sim: "none",
    body: `<rect x="-2" y="-2" width="12" height="9"/><path d="M0,2.5 H-6"/>`,
  };
  DB_SYMBOLS.push(sym); SYMBOLS_BY_ID[sym.id] = sym;
  out.offGridSym = { id: sym.id, offs: sym.pins.map(pn => pn.y) };
  const pg = newPage("al", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  // 相手: 水平配線 (端点 y = 100)
  const wr = addWire(pg, [[40, 100], [70, 100]], { raw: true });
  const d = addDevice(pg, sym.id, 120, 100, {});
  const pinOff = devPins(d).map(pn => pn.y - d.y).find(v => Math.abs(v % 5) > 0.05);
  out.pinOff = pinOff;
  // 5mm 格子だけでは合わせられないこと (どの格子位置でも端子 y ≠ 100)
  out.cantAlign = ![...Array(9)].some((_, i) => {
    const y = 80 + i * 5;                       // 格子上の候補
    return Math.abs((y + pinOff) - 100) < 0.01;
  });
  out.dev = { id: d.id, x: d.x, y: d.y };
  out.view = 1;
  return out;
});

const scr = async (x, y) => {
  const r = await p.evaluate(() => {
    const bb = Editor.svg.getBoundingClientRect();
    return { left: bb.left, top: bb.top, tx: Editor.view.tx, ty: Editor.view.ty, s: Editor.view.s };
  });
  return { x: r.left + r.tx + x * r.s, y: r.top + r.ty + y * r.s };
};

// ── 機器を配線の端点あたりへドラッグ (端子が y=100 の 2.4mm 以内に来る位置へ) ──
const target = await p.evaluate(([id, pinOff]) => {
  const d = curPage().devices.find(x => x.id === id);
  // 端子が y=100 から 1.5mm ほどずれる位置を狙う (吸着の範囲内)
  return { fromX: d.x, fromY: d.y, wantY: 100 - pinOff + 1.5 };
}, [R.dev.id, R.pinOff]);
{
  const from = await scr(target.fromX, target.fromY);
  const to = await scr(80, target.wantY);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 6 });
  await p.mouse.up();
}
await p.waitForTimeout(150);
R.snapDrag = await p.evaluate(([id]) => {
  const d = curPage().devices.find(x => x.id === id);
  const ys = devPins(d).map(pn => pn.y);
  return { devY: d.y, pinYs: ys, aligned: ys.some(y => Math.abs(y - 100) < 0.01) };
}, [R.dev.id]);
/* 吸着直後にプロパティ欄が動いた値になっているか。
   ドラッグの mousedown で機器が選ばれてプロパティが開くので、ここでは
   自分で showProps() を呼ばずに欄の値だけを読む (アプリ側の更新を見る) */
R.propFresh = await p.evaluate(([id]) => {
  const d = curPage().devices.find(x => x.id === id);
  const el = document.querySelector("#pY");
  return { field: el && el.value, devY: String(d.y) };
}, [R.dev.id]);

// ── Alt ドラッグは吸着しない ──
R.altOff = await p.evaluate(async ([id, pinOff]) => {
  const d = curPage().devices.find(x => x.id === id);
  d.x = 120; d.y = 100 - pinOff + 1.5 - (100 - pinOff + 1.5) % 5;   // 格子位置へ戻す
  d.y = Math.round(d.y / 5) * 5;
  App.selection.clear(); App.selection.add(id);
  UI.refresh();
  await new Promise(r => setTimeout(r, 100));
  return { y0: d.y };
}, [R.dev.id, R.pinOff]);
{
  const d0 = await p.evaluate(([id]) => { const d = curPage().devices.find(x => x.id === id); return { x: d.x, y: d.y }; }, [R.dev.id]);
  const from = await scr(d0.x, d0.y);
  const to = await scr(80, target.wantY);
  await p.keyboard.down("Alt");
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.up("Alt");
}
await p.waitForTimeout(150);
R.altOff.after = await p.evaluate(([id]) => {
  const d = curPage().devices.find(x => x.id === id);
  return { y: d.y, onGrid: Math.abs(d.y % 5) < 0.001, pinAligned: devPins(d).some(pn => Math.abs(pn.y - 100) < 0.01) };
}, [R.dev.id]);

// ── Shift+矢印で 0.5mm ──
R.fineNudge = await p.evaluate(async ([id]) => {
  const d = curPage().devices.find(x => x.id === id);
  App.selection.clear(); App.selection.add(id);
  const y0 = d.y;
  const key = (shift) => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: shift, bubbles: true }));
  key(true);
  const afterFine = curPage().devices.find(x => x.id === id).y;
  key(false);
  const afterGrid = curPage().devices.find(x => x.id === id).y;
  return { y0, fine: afterFine - y0, grid: afterGrid - afterFine };
}, [R.dev.id]);

// ── 吸着で動いても配線は追従する ──
R.wiresKeep = await p.evaluate(async ([id]) => {
  const pg = curPage();
  const d = pg.devices.find(x => x.id === id);
  const pin = devPins(d)[0];
  const w2 = addWire(pg, [[pin.x, pin.y], [pin.x + 30, pin.y]], { raw: true });
  App.selection.clear(); App.selection.add(id);
  const attach = buildMoveAttachment();
  applyMove(attach, 0, 5);
  const pin2 = devPins(pg.devices.find(x => x.id === id))[0];
  const e0 = pg.wires.find(w => w.id === w2.id).pts[0];
  return { follows: Math.abs(e0[0] - pin2.x) < 0.01 && Math.abs(e0[1] - pin2.y) < 0.01 };
}, [R.dev.id]);

R.propStep = await p.evaluate(async ([id]) => {
  App.selection.clear(); App.selection.add(id);
  UI.refresh(); UI.showProps();
  await new Promise(r => setTimeout(r, 120));
  const el = document.querySelector("#pX");
  if (!el) return { step: null };
  el.value = "77.5";
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  return { step: el.step, x: curPage().devices.find(x => x.id === id).x };
}, [R.dev.id]);

const checks = {
  noPageErrors: errs.length === 0,
  offGridSym: !!R.offGridSym && Math.abs(R.pinOff % 5) > 0.05,
  cantAlign: R.cantAlign === true,
  snapDrag: R.snapDrag.aligned === true,
  altOff: R.altOff.after.onGrid === true && R.altOff.after.pinAligned === false,
  fineNudge: Math.abs(R.fineNudge.fine - 0.5) < 0.001 && Math.abs(R.fineNudge.grid - 5) < 0.001,
  wiresKeep: R.wiresKeep.follows === true,
  propStep: R.propStep.step === "0.5" && R.propStep.x === 77.5,
  propFresh: R.propFresh.field === R.propFresh.devY && R.propFresh.field === "97.5",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("align-snap OK");
