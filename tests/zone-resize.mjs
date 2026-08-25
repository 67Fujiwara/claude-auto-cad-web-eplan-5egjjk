/* 破線枠 (盤外/グループ) をマウスでつまんで幅と高さを変えられること。

   判定
   ・選択するとつまみ (角 4 + 辺の中央 4) が描かれること
   ・右辺のつまみをドラッグすると幅だけが変わり、5mm 格子に乗ること
   ・角のつまみで幅と高さが同時に変わること
   ・左上のつまみで x/y と幅・高さが両方動く (右下は固定のまま) こと
   ・10mm より小さくできない (裏返らない) こと
   ・Ctrl+Z (元に戻す) で寸法が戻ること
   ・つまみの上でリサイズカーソルになること */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const Z = await p.evaluate(() => {
  App.project = newProject("枠のリサイズ");
  const pg = curPage();
  pg.zones = [{ id: "z1", x: 100, y: 80, w: 60, h: 40, label: "盤外" }];
  App.selection.clear(); App.selection.add("z1");
  UI.refresh();
  // 画面座標 ← 図面座標の変換 (テストからマウスを正確に落とすため)
  const r = Editor.svg.getBoundingClientRect();
  const v = Editor.view;
  return { rect: { left: r.left, top: r.top }, tx: v.tx, ty: v.ty, s: v.s,
    handles: Editor.svg.innerHTML.includes('stroke-width="0.35"') };
});
const scr = (x, y) => [Z.rect.left + Z.tx + x * Z.s, Z.rect.top + Z.ty + y * Z.s];

/** つまみをドラッグする */
async function dragHandle(fromX, fromY, toX, toY) {
  const [sx, sy] = scr(fromX, fromY), [ex, ey] = scr(toX, toY);
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.mouse.move(ex, ey, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(80);
}
const zone = () => p.evaluate(() => { const z = curPage().zones[0]; return { x: z.x, y: z.y, w: z.w, h: z.h }; });

// カーソル: 右辺のつまみの上で ew-resize
const [cx, cy] = scr(160, 100);
await p.mouse.move(cx, cy);
await p.waitForTimeout(80);
const cursor = await p.evaluate(() => Editor.svg.style.cursor);

// ① 右辺 (160,100) を +23mm → 幅 60 → 83 前後 (破線枠は 0.5mm 刻み)
await dragHandle(160, 100, 183, 100);
const afterRight = await zone();
// ② 右下角 (現在の右下) を動かす → 幅と高さが同時に変わる
const c1 = afterRight;
await dragHandle(c1.x + c1.w, c1.y + c1.h, c1.x + c1.w + 10, c1.y + c1.h + 15);
const afterCorner = await zone();
// ③ 左上角 → x/y も動き、右下は固定
const c2 = afterCorner;
const br = { x: c2.x + c2.w, y: c2.y + c2.h };
await dragHandle(c2.x, c2.y, c2.x + 10, c2.y + 10);
const afterTL = await zone();
// ④ 最小 10mm より小さくできない (右辺を左端より左へ)
const c3 = afterTL;
await dragHandle(c3.x + c3.w, c3.y + c3.h / 2, c3.x - 50, c3.y + c3.h / 2);
const afterMin = await zone();
// ⑤ 元に戻す
await p.evaluate(() => { for (let i = 0; i < 4; i++) undo(); });
const afterUndo = await zone();

const checks = {
  handlesDrawn: Z.handles === true,
  cursorResize: cursor === "ew-resize",
  // 幅だけが変わる。刻みは 0.5mm (5mm 格子だと 23mm 引いても 20/25mm に飛ぶ)
  widthOnly: afterRight.w > 60 && Math.abs(afterRight.w * 2 - Math.round(afterRight.w * 2)) < 1e-6 &&
    Math.abs(afterRight.w - 83) <= 1 &&
    afterRight.h === 40 && afterRight.x === 100 && afterRight.y === 80,
  corner: afterCorner.w > afterRight.w && afterCorner.h > afterRight.h,
  // 左上を動かすと x/y が動き、右下は固定されたまま (刻みは 0.5mm)
  topLeft: Math.abs(afterTL.x - (c2.x + 10)) <= 1 && Math.abs(afterTL.y - (c2.y + 10)) <= 1 &&
    Math.abs(afterTL.x + afterTL.w - br.x) < 1e-6 && Math.abs(afterTL.y + afterTL.h - br.y) < 1e-6,
  minSize: afterMin.w === 10,
  undo: afterUndo.w === 60 && afterUndo.h === 40 && afterUndo.x === 100 && afterUndo.y === 80,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("STATE:", JSON.stringify({ cursor, afterRight, afterCorner, afterTL, afterMin, afterUndo }));
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
