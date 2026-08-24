/* シンボル作成のカーソル。OS の太い十字カーソルをやめ、SVG 側に
   髪線の十字 + スナップ枠 (実際にクリックが落ちる点) を描く。

   ・osHidden   : #seCanvas は cursor:none (OS カーソルを隠す)
   ・follows    : マウスを動かすと十字線がスナップ済み座標に追従する
                  (中央 → (0,0)、そこから右下 → スナップ (1mm) の格子上)
   ・hairline   : 十字線は vector-effect=non-scaling-stroke の 1px 髪線
   ・pickbox    : スナップ枠が十字の交点に重なる
   ・snapsPin   : 端子ツールでは 5mm グリッドへスナップして追従する
   ・hides      : キャンバスから出ると消える
   ・clickAlive : カーソルを重ねても普通にクリックで作画できる
                  (十字線が当たり判定を奪わない) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

await p.evaluate(() => UI.openSymbolEditor());
await p.waitForTimeout(200);
const bb = await (await p.$("#seCanvas")).boundingBox();
const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;

const readCursor = () => p.evaluate(() => {
  const c = document.querySelector("#seCursor");
  if (!c) return null;
  const cv = c.querySelector(".cv"), ch = c.querySelector(".ch"), cp = c.querySelector(".cp");
  return {
    display: c.style.display,
    x: +cv.getAttribute("x1"), x2: +cv.getAttribute("x2"),
    y: +ch.getAttribute("y1"),
    px: +cp.getAttribute("x") + +cp.getAttribute("width") / 2,
    py: +cp.getAttribute("y") + +cp.getAttribute("height") / 2,
    ve: cv.getAttribute("vector-effect"), w: cv.getAttribute("stroke-width"),
    cursorCss: getComputedStyle(document.querySelector("#seCanvas")).cursor,
  };
});

await p.mouse.move(cx, cy);                    // キャンバス中央 = 作画座標 (0,0)
const atCenter = await readCursor();
// 60mm 角のキャンバス: 高さ px / 60 = 1mm あたりの px。8mm ぶん右下へ
const mm = bb.height / 60;
await p.mouse.move(cx + 8 * mm, cy + 8 * mm);
const at88 = await readCursor();

// 端子ツールは 5mm スナップ (8mm → 10mm へ丸まる)
await p.evaluate(() => { document.querySelector('.se-tool[data-t="pin"]').click(); });
await p.mouse.move(cx + 8 * mm, cy + 8 * mm);
const atPin = await readCursor();
await p.evaluate(() => { document.querySelector('.se-tool[data-t="line"]').click(); });

// キャンバスの外へ → 消える
await p.mouse.move(bb.x - 40, cy);
const outside = await readCursor();

// カーソル表示があっても作画は普通にできる (線を2点 + Enter で確定)。
// 人の操作と同じく押下中にもポインタが動く — 十字線の追従が innerHTML の
// 描き直しでクリックを失わせないことをこの動きで確かめる
const clickAt = async (x, y) => {
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + 1, y);
  await p.mouse.move(x, y);
  await p.mouse.up();
};
await clickAt(cx, cy);                       // 作画前 (draft 無し) = 十字線だけが動く状態
await p.mouse.click(cx + 10 * mm, cy);       // 2点目は draft のプレビュー再描画があるので普通のクリック
await p.keyboard.press("Enter");
const drawn = await p.evaluate(() => {
  const sh = SymEdit.shapes[SymEdit.shapes.length - 1];
  document.querySelector("#seCancel").click();
  return sh ? { k: sh.k, pts: sh.pts } : null;
});

const near = (a, b2, tol = 0.6) => typeof a === "number" && Math.abs(a - b2) <= tol;
const checks = {
  noPageErrors: errs.length === 0,
  osHidden: atCenter && atCenter.cursorCss === "none",
  follows: atCenter && atCenter.display !== "none" && near(atCenter.x, 0) && near(atCenter.y, 0) &&
    at88 && near(at88.x, 8) && near(at88.y, 8) && at88.x === at88.x2 && Number.isInteger(at88.x),
  hairline: atCenter && atCenter.ve === "non-scaling-stroke" && atCenter.w === "1",
  pickbox: at88 && near(at88.px, at88.x, 0.01) && near(at88.py, at88.y, 0.01),
  snapsPin: atPin && atPin.x % 5 === 0 && atPin.y % 5 === 0 && near(atPin.x, 10) && near(atPin.y, 10),
  hides: outside && outside.display === "none",
  clickAlive: drawn && drawn.k === "line" && drawn.pts.length === 2 &&
    near(drawn.pts[0][0], 0) && near(drawn.pts[1][0], 10),
};
console.log(JSON.stringify({ atCenter, at88, atPin, outside, drawn }, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
