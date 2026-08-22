/* コントローラの通信ポート (EtherNet/IP・USB・HDMI) が、図面でもパレットでも
   一目で見分けられることを確かめる。

   ・識別図 (受け口を正面から見た形) が各ポートで違う形であること
   ・識別図は細線 0.25mm で描かれ、電気的な図記号 (接続器) と紛れないこと
   ・パレットの見出し (thumbBox) が識別図とラベルを映していること
   ・DXF にも識別図が出ること (画面と同じ形)
   ・極数・端子名が実機の仕様どおりで、検図が図記号由来の指摘を出さないこと */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
const R = await p.evaluate(() => {
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px"; document.body.appendChild(probe);
  const IDS = ["conn_rj45", "conn_usb_a", "conn_usb_b", "conn_usb_c", "conn_hdmi"];
  const out = { ports: {}, thin: [], sameShape: [], dxf: {}, drc: [] };
  // 識別図を取り出して、外形の形 (縦横比・面積・頂点数) を測る
  const shapeOf = (id) => {
    const sym = symOf(id);
    const g = /<g transform="translate\(([-\d.]+),([-\d.]+)\)">([\s\S]*?)<\/g>/.exec(sym.body);
    if (!g) return null;
    const first = /<path d="([^"]*)"([^>]*)\/>/.exec(g[3]);
    const el = document.createElementNS(NS, "path"); el.setAttribute("d", first[1]); probe.appendChild(el);
    const L = el.getTotalLength();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const pts = [];
    for (let i = 0; i < 360; i++) {
      const q = el.getPointAtLength(L * i / 360);
      pts.push([q.x, q.y]);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    el.remove();
    // 外形を 24 方向の半径で表す (形の指紋)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sc = Math.max(x1 - x0, y1 - y0) / 2;
    const fp = [];
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12;
      let best = 0;
      pts.forEach(q => {
        const d = Math.hypot(q[0] - cx, q[1] - cy);
        const ang = Math.atan2(q[1] - cy, q[0] - cx);
        if (Math.abs(((ang - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.14) best = Math.max(best, d);
      });
      fp.push(+(best / sc).toFixed(3));
    }
    return { w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2), len: +L.toFixed(2), fp,
      thin: /stroke-width="0\.25"/.test(first[2]) };
  };
  IDS.forEach(id => { const s = shapeOf(id); out.ports[id] = s; if (s && !s.thin) out.thin.push(id); });
  // 形が互いに十分違うか (指紋の差)
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
    const a = out.ports[IDS[i]], b2 = out.ports[IDS[j]];
    if (!a || !b2) continue;
    const d = Math.max(...a.fp.map((v, k) => Math.abs(v - b2.fp[k])));
    const ar = Math.abs(a.w / a.h - b2.w / b2.h);
    if (d < 0.12 && ar < 0.35) out.sameShape.push(`${IDS[i]}↔${IDS[j]} 形の差 ${d.toFixed(3)} 縦横比の差 ${ar.toFixed(2)}`);
  }
  // パレットの見出しが識別図を映しているか
  out.thumb = IDS.map(id => {
    const s = symOf(id);
    if (!s.thumbBox) return `${id}: thumbBox なし`;
    const [, ty, , th] = s.thumbBox;
    const g = /<g transform="translate\(([-\d.]+),([-\d.]+)\)">/.exec(s.body);
    const gy = +g[2];
    return (gy > ty && gy < ty + th) ? "" : `${id}: 識別図が見出しの外`;
  }).filter(Boolean);
  // 図面に置いて DXF を出す
  const pg = newPage("ports", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  let x = 60;
  IDS.forEach((id, k) => {
    const d = addDevice(pg, id, x, 60, { tag: `-X${k + 1}` });
    devPins(d).forEach(q => addWire(pg, [[q.x - 15, q.y], [q.x, q.y]]));
    x += devBounds(d).w + 26;
  });
  const txt = pageToDXF(pg);
  out.dxf.lines = (txt.match(/\nLINE\n/g) || []).length;
  out.dxf.arcs = (txt.match(/\nARC\n/g) || []).length;
  out.dxf.hasEth = /\\U\+0045\\U\+0074\\U\+0068|EtherNet/.test(txt);
  // 図記号そのものに由来する指摘が無いこと (試験図の端点・未接続は除く)
  out.drc = runDRC().filter(i => i.page === pg.no && !/端点|未接続/.test(i.msg)).map(i => i.msg);
  out.pins = IDS.map(id => `${id}:${symOf(id).pins.length}`);
  probe.remove(); return out;
});
console.log(JSON.stringify({ ...R, ports: Object.fromEntries(Object.entries(R.ports).map(([k, v]) => [k, v && { w: v.w, h: v.h, len: v.len, thin: v.thin }])) }, null, 1));
const checks = {
  allHaveGlyph: Object.values(R.ports).every(v => v && v.len > 8),
  thinLine: R.thin.length === 0,                       // 識別図は細線
  distinct: R.sameShape.length === 0,                  // 互いに違う形
  thumb: R.thumb.length === 0,                         // パレットで識別図が見える
  dxfGlyph: R.dxf.lines > 120 && R.dxf.arcs >= 2,      // DXF にも出る (USB-C の長円で ARC)
  dxfLabel: R.dxf.hasEth === true,
  pins: R.pins.join(",") === "conn_rj45:8,conn_usb_a:4,conn_usb_b:4,conn_usb_c:7,conn_hdmi:19",
  drcClean: R.drc.length === 0,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
