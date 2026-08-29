/* まっすぐ線を引く — 配線ツールの直線が引きやすいこと。

   ・axisLock  : 直前の頂点の行から少しずれてクリックしても、その行に乗って
                 まっすぐな 1 区間になる (段差の L 字ができない)
   ・keepStep  : 目盛 1 つ分より大きくずらしたときは、これまでどおり段差が残る
                 (意図した曲げまで消さない)
   ・shift     : Shift を押している間は、どれだけ外れていても必ずまっすぐ
   ・alignPin  : 端子の行に近いところは端子の行に乗る (向かい先と高さがそろう)
   ・guide     : まっすぐ乗っているときは補助線が出る
   ・pinWins   : 端子の上では端子の座標が優先 (端子から線が外れない) */
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
  App.project = newProject("直線"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  UI.setTool("wire"); UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));

  const bb = Editor.svg.getBoundingClientRect();
  const S = (x, y) => [bb.left + Editor.view.tx + x * Editor.view.s, bb.top + Editor.view.ty + y * Editor.view.s];
  const ev = (t, x, y, o = {}) => {
    const [cx, cy] = S(x, y);
    Editor.svg.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: cx, clientY: cy, ...o }));
  };
  const click = (x, y, o) => { ["mousedown", "mouseup", "click"].forEach(t => ev(t, x, y, o)); };
  const move = (x, y, o) => window.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true, clientX: S(x, y)[0], clientY: S(x, y)[1], ...o }));
  const draw = async (a, b2, o) => {
    click(a[0], a[1], o);
    move(b2[0], b2[1], o); click(b2[0], b2[1], o);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    return pg.wires[pg.wires.length - 1];
  };

  /* 少しだけ下へずれた終点 (3mm)。格子への丸めでは 105 (段差) になる位置だが、
     直前の頂点の行に乗せるのでまっすぐな 1 区間になる */
  let w = await draw([60, 100], [140, 103]);
  out.axisLock = { pts: JSON.stringify(w.pts), straight: w.pts.length === 2 && w.pts[0][1] === w.pts[1][1] };

  // ── 目盛 1 つ分より大きくずらす → 段差 (L 字) は残る ──
  w = await draw([60, 130], [140, 137]);
  out.keepStep = { pts: JSON.stringify(w.pts), stepped: w.pts.length > 2 };

  // ── Shift を押していれば、どれだけ外れてもまっすぐ ──
  w = await draw([60, 160], [140, 173], { shiftKey: true });
  out.shift = { pts: JSON.stringify(w.pts), straight: w.pts.length === 2 && w.pts[0][1] === w.pts[1][1] };

  /* 端子の行に近いところは端子の行に乗る。格子から外れた端子 (M12 など) で
     ないと格子への丸めと区別が付かないので、わざと 2.5mm ずらして置く */
  const dev = addDevice(pg, "lamp", 200, 60, {});
  dev.y = 62.5;
  const pin = devPins(dev)[0];
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  w = await draw([120, pin.y + 1.5], [160, pin.y + 1.5]);
  out.alignPin = { pinY: pin.y, pts: JSON.stringify(w.pts), on: w.pts.every(q => q[1] === pin.y) };

  // ── 補助線 (まっすぐ乗っているときに出る) ──
  click(60, 200);
  move(140, 203);
  await new Promise(r => setTimeout(r, 120));
  out.guide = { lock: Editor.wireDraft.lock, drawn: Editor.layers.overlay.innerHTML.includes("stroke-dasharray=\"1 2\"") };
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // ── 端子の上では端子が優先 (その端子につながる点として返る) ──
  const q = wireDraftPoint(pin.x + 0.6, pin.y + 0.6, false);
  out.pinWins = { x: q.x, y: q.y, hit: !!q.pin,
    isPin: !!q.pin && q.x === pin.x && q.y === pin.y };
  UI.setTool("select");
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  axisLock: R.axisLock.straight === true,
  keepStep: R.keepStep.stepped === true,
  shift: R.shift.straight === true,
  alignPin: R.alignPin.on === true,
  guide: R.guide.lock === "h" && R.guide.drawn === true,
  pinWins: R.pinWins.isPin === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-straight OK");
