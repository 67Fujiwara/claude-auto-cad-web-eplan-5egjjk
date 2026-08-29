/* 文字の回転 — 図面注記を縦向き・斜めにも置けること。

   ・rKey      : 文字を選んで R キー → 90° ずつ回る (デバイスと同じ操作)
   ・drawn     : 画面の文字に回転がかかる (基点は動かない)
   ・propAngle : プロパティの「角度」で任意の角度にできる。0 に戻すと属性が消える
   ・hit       : 回した文字も、その文字の上をクリックすれば掴める
   ・block     : デバイスと一緒のブロック回転で、文字の向きも一緒に回る
   ・dxf       : DXF に傾きが出る (画面と同じ向き = 反時計回りで符号反転)
   ・drc       : 回した文字の外接箱は回転後の形で見る (縦書きが横の物と重ならない) */
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
  App.project = newProject("文字回転"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0; pg.texts.length = 0;

  const t = { id: uid("t"), x: 120, y: 100, text: "盤内配線", size: 3.5 };
  pg.texts.push(t);
  App.selection.clear(); App.selection.add(t.id);
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));

  // ── R キーで 90° ずつ ──
  const press = k => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  press("r");
  out.rKey = { a1: textRot(t) };
  press("r"); press("r"); press("r");
  out.rKey.round = textRot(t);       // 4 回で一周して 0 に戻る (属性も消える)
  out.rKey.cleared = t.rot === undefined;
  press("r");
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  out.drawn = {
    rot: textRot(t),
    svg: Editor.layers.texts.innerHTML.includes(`rotate(90 ${t.x} ${t.y})`),
    pos: t.x === 120 && t.y === 100,       // 基点は動かない
  };

  // ── プロパティの角度 ──
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const inp = document.querySelector("#pTrot");
  out.propAngle = { field: !!inp, was: inp && inp.value };
  if (inp) {
    inp.value = "45"; inp.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.propAngle.set = textRot(t);
    const inp2 = document.querySelector("#pTrot");
    inp2.value = "0"; inp2.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.propAngle.zero = t.rot === undefined && textRot(t) === 0;
  }

  // ── 回した文字を掴む ──
  t.rot = 90; App.selection.clear(); UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  const hitAt = (dx, dy) => {
    const h = hitTest(t.x + dx, t.y + dy);
    return !!h && h.type === "text" && h.obj.id === t.id;
  };
  /* 基点の 4mm 下: 回す前は文字が右へ伸びているので外れ、90° 回すと
     文字がそこへ来るので掴める (回転を見ていないと結果が変わらない) */
  t.rot = 0; UI.refresh();
  const before = hitAt(0, 4);
  t.rot = 90; UI.refresh();
  await new Promise(r => setTimeout(r, 100));
  out.hit = { down: hitAt(0, 4), beforeRot: before };

  // ── ブロック回転 (デバイスと一緒) ──
  t.rot = 0;
  const dev = addDevice(pg, "lamp", 140, 100, {});
  App.selection.clear(); App.selection.add(t.id); App.selection.add(dev.id);
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  press("r");
  await new Promise(r => setTimeout(r, 150));
  const t2 = curPage().texts.find(q => q.id === t.id);
  out.block = { rot: textRot(t2), moved: t2.x !== 120 || t2.y !== 100 };

  // ── DXF ──
  t2.rot = 90;
  // 和文は \U+xxxx へ逃がして書き出されるので、その形で探す
  const dxf = pageToDXF(curPage()).split(/\r?\n/);
  const esc = [..."盤内配線"].map(c => "\\U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
  out.dxf = { has: dxf.includes("-90"), text: dxf.includes(esc) };

  // ── 検図の外接箱 ──
  const flat = { id: uid("t"), x: 200, y: 100, text: "ABCDEFGH", size: 3.5 };
  const tall = { id: uid("t"), x: 200, y: 100, text: "ABCDEFGH", size: 3.5, rot: 90 };
  out.drc = {
    flat: [+textBounds(flat).w.toFixed(2), +textBounds(flat).h.toFixed(2)],
    tall: [+textBounds(tall).w.toFixed(2), +textBounds(tall).h.toFixed(2)],
  };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  rKey: R.rKey.a1 === 90 && R.rKey.round === 0 && R.rKey.cleared === true,
  drawn: R.drawn.rot === 90 && R.drawn.svg === true && R.drawn.pos === true,
  propAngle: R.propAngle.field === true && R.propAngle.set === 45 && R.propAngle.zero === true,
  hit: R.hit.down === true && R.hit.beforeRot === false,
  block: R.block.rot === 90 && R.block.moved === true,
  dxf: R.dxf.has === true && R.dxf.text === true,
  // 90° 回すと外接箱の縦横が入れ替わる (横長 → 縦長)
  drc: R.drc.flat[0] > R.drc.flat[1] && R.drc.tall[1] > R.drc.tall[0],
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("text-rotate OK");
