/* 尺度の異なるページ間の貼り付け (コピー元 1:1.25 → 貼り付け先 1:1.5 / 1:5)。

   仕様: 図記号・文字・線の太さは尺度によらず常に 1:1 のまま、
   「配置座標・配線経路・破線枠」だけを尺度比 kf = fDst/fSrc で伸縮し、
   図枠に占める割合 (印刷したときのレイアウト) を保つ。
   端子の張り出しは伸縮しないので、端子につながっていた配線の端点は
   貼り付け後に端子へ吸着し直す。

   ・srcRecorded : コピー時にコピー元ページの尺度がクリップボードに残る
   ・posScaled   : 1:1.25 → 1:1.5 で機器間・文字の相対位置が 1.2 倍になる
   ・zoneScaled  : 破線枠の w/h も 1.2 倍 (図枠に対する割合を保つ)
   ・pinSnap     : 端子につながっていた配線端点が、伸縮後も端子上にある
   ・textKept    : 文字の大きさは変わらない (常に 1:1 の仕様)
   ・bigScaled   : 1:1.25 → 1:5 (kf=4) でも同様に 4 倍 + 端子吸着
   ・sameKept    : 同じ尺度どうしの貼り付けは従来どおり無伸縮 */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const mkPage = (name, scale) => {
    const pg = newPage(name, App.project.pages.length + 1);
    pg.scale = scale;
    App.project.pages.push(pg);
    return pg;
  };
  const go = pg => { App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg); };

  // ── コピー元 1:1.25: 端子が原点からずれている図記号を選ぶ (吸着の検証のため)
  const sym = allSymbols().find(s => (s.pins || []).some(pn => Math.abs(pn.x) + Math.abs(pn.y) > 2) && !s.enclosure);
  out.symId = sym && sym.id;
  const src = mkPage("src", "1:1.25"); go(src);
  const d1 = addDevice(src, sym.id, 100, 100, { tag: "-U1" });
  // 張り出しが最大の端子を使う (伸縮でずれる → 吸着し直しの検証になる)
  const pins = devPins(d1);
  const pi = pins.reduce((m, pn, i) => {
    const o = Math.abs(pn.x - d1.x) + Math.abs(pn.y - d1.y);
    return o > m.o ? { i, o } : m;
  }, { i: 0, o: -1 }).i;
  const pin = pins[pi];
  out.pinOff = { x: pin.x - d1.x, y: pin.y - d1.y };          // 張り出し (≠0 を確認)
  const w1 = addWire(src, [[pin.x, pin.y], [pin.x, pin.y - 20], [pin.x + 30, pin.y - 20]], { raw: true });
  const t1 = { id: uid("t"), x: 150, y: 100, text: "MOTOR", size: 3.5 };
  src.texts.push(t1);
  pageZones(src).push({ id: uid("z"), x: 90, y: 90, w: 60, h: 40, label: "ZN" });
  const z1 = pageZones(src)[0];
  App.selection.clear();
  [d1.id, w1.id, t1.id, z1.id].forEach(id => App.selection.add(id));
  copySelection();
  out.srcRecorded = App.clipboard.scale;

  const measure = pg => {
    const d = pg.devices[pg.devices.length - 1];
    const w = pg.wires[pg.wires.length - 1];
    const t = pg.texts[pg.texts.length - 1];
    const z = pageZones(pg)[pageZones(pg).length - 1];
    const pn = devPins(d)[pi];
    const end = w.pts[0];
    return {
      dTx: t.x - d.x,                                        // 機器→文字の相対距離
      zw: z.w, zh: z.h, tSize: t.size,
      pinGap: Math.hypot(end[0] - pn.x, end[1] - pn.y),      // 配線端点⇔端子
      segLen: Math.abs(w.pts[w.pts.length - 1][0] - w.pts[w.pts.length - 2][0]), // 最終水平区間
    };
  };

  // ── 1:1.5 へ貼り付け (kf = 1.2)
  const dst = mkPage("dst", "1:1.5"); go(dst);
  Editor.lastWorld = { x: 60, y: 60 };
  pasteClipboard();
  out.at15 = measure(dst);

  // ── 1:5 へ貼り付け (kf = 4)
  const big = mkPage("big", "1:5"); go(big);
  Editor.lastWorld = { x: 60, y: 60 };
  pasteClipboard();
  out.at5 = measure(big);

  // ── 同じ尺度 (1:1.25) へ貼り付け → 無伸縮
  const same = mkPage("same", "1:1.25"); go(same);
  Editor.lastWorld = { x: 60, y: 60 };
  pasteClipboard();
  out.same = measure(same);
  return out;
});

const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;
const checks = {
  noPageErrors: errs.length === 0,
  pinOffNonZero: Math.abs(R.pinOff.x) + Math.abs(R.pinOff.y) > 2,   // 前提: 張り出しあり
  srcRecorded: R.srcRecorded === "1:1.25",
  posScaled: near(R.at15.dTx, 50 * 1.2),
  zoneScaled: near(R.at15.zw, 60 * 1.2) && near(R.at15.zh, 40 * 1.2) && near(R.at15.segLen, 30 * 1.2),
  pinSnap: R.at15.pinGap < 0.02,
  textKept: R.at15.tSize === 3.5 && R.at5.tSize === 3.5,
  bigScaled: near(R.at5.dTx, 50 * 4) && near(R.at5.zw, 60 * 4) && R.at5.pinGap < 0.02,
  sameKept: near(R.same.dTx, 50) && near(R.same.zw, 60) && near(R.same.segLen, 30) && R.same.pinGap < 0.02,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, sym: R.symId, at15: R.at15, at5: R.at5, same: R.same, errs }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("paste-scale OK");
