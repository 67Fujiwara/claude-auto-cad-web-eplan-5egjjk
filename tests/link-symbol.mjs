/* 電位リンク (黒丸) と行き先 (黒い矢じり) の形。

   ・dot     : 電位リンクは引出線の先に黒丸 (塗りつぶし)。旧の白抜き三角は無い
   ・beside  : 縦に置いた電位リンクの電位名 (タグ) は黒丸の右に、字の高さの中央を
              黒丸に合わせて置く
   ・blocked : 右に導体があって置けなければ左へ (やはり黒丸の高さ)
   ・rotated : 横に置いた電位リンクでも電位名が出て、導体と重ならない
   ・hit     : 黒丸をクリックすると電位リンクが選べる
   ・thumb   : パレットの見本は、電位リンクが黒丸 + 電位名、行き先が矢じり + 図番の文字 */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  const sym = SYMBOLS_BY_ID.link;
  out.dot = { circle: /<circle cx="0" cy="4" r="1\.1" fill="currentColor"/.test(sym.body), noTri: !/Z/.test(sym.body) };
  App.project = newProject("電位リンク"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const tagBox = d => { App.labelRev++; const o = deviceLabelBoxes(pg, d).find(q => q.isTag); return o ? o.box : null; };
  // ── beside ──
  addWire(pg, [[100, 60], [100, 80]]);
  const lk = addDevice(pg, "link", 100, 80, { tag: "+24V" });
  const bx = tagBox(lk), dotY = 84;
  out.beside = bx && { left: +bx.x.toFixed(2), cy: +(bx.y + bx.h / 2).toFixed(2), dotY };
  // ── blocked: 右に縦の導体 ──
  const w2 = addWire(pg, [[103, 70], [103, 100]]);
  const bx2 = tagBox(lk);
  out.blocked = bx2 && { right: +(bx2.x + bx2.w).toFixed(2), cy: +(bx2.y + bx2.h / 2).toFixed(2) };
  pg.wires.splice(pg.wires.indexOf(w2), 1);
  // ── rotated ──
  addWire(pg, [[160, 120], [180, 120]]);
  const lk2 = addDevice(pg, "link", 180, 120, { tag: "0V", rot: 270 });
  lk2.rot = 270;
  const bx3 = tagBox(lk2);
  out.rotated = bx3 && { clearOfWire: bx3.y + bx3.h < 120 - 0.3 || bx3.y > 120 + 0.3 || bx3.x > 180 };
  // ── hit ──
  const h = hitTest(100, 84);
  out.hit = !!h && h.type === "device" && h.obj === lk;
  // ── thumb ──
  const tg = symThumbSVG(SYMBOLS_BY_ID.goto_ref), tl = symThumbSVG(sym);
  out.thumb = { goto: tg.includes("B-001") && /fill="currentColor"/.test(tg), link: /<circle[^>]*fill="currentColor"/.test(tl) && tl.includes("+24V") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  dot: R.dot.circle && R.dot.noTri,
  beside: !!R.beside && R.beside.left > 101.1 && R.beside.left < 104 && Math.abs(R.beside.cy - R.beside.dotY) < 0.6,
  blocked: !!R.blocked && R.blocked.right < 98.9 && Math.abs(R.blocked.cy - 84) < 0.6,
  rotated: !!R.rotated && R.rotated.clearOfWire,
  hit: R.hit === true,
  thumb: R.thumb.goto && R.thumb.link,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("link-symbol OK");
