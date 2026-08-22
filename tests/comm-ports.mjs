/* コントローラの通信ポート (EtherNet/IP・USB-A/B/C・HDMI) が、パレットで一目で
   見分けられること、そして図面には規格外の絵を持ち込んでいないことを確かめる。

   受け口を正面から見た識別図は **パレット (thumbGlyph) だけ** に置く。図面の
   記号本体に入れないのは、
   ・IEC 60617 の図記号は抽象記号で、実物の外観図を混ぜると「どこまでが規格記号か」
     が読めなくなる (IEC 61082-1 は規格外記号に図面上の説明を要求するが、
     本ツールに凡例欄が無い)
   ・記号を回すと絵も回る。90°/270° では水平を保つラベルと重なり、180° では
     「上下逆さまの受け口」という実在しない絵になる
   ・DXF はレイヤ (色) で線幅を伝えるが、レイヤは記号単位で決まるため、細線
     0.25mm が太線と同じペンで出る
   ・1:2 では紙上 0.125mm となり JIS Z 8312 の最細線 0.13mm を下回る
   から。図面側の識別はラベル (RJ45 など) と機能テキスト (EtherNet/IP・デバイス
   ごとに編集できる) が担う。

   判定
   ・識別図が互いに違う形であること — 外形の指紋と縦横比の **両方** に下限
   ・識別図の全ての path が細線 0.25mm であること (2 本目以降も見る)
   ・図面の記号本体と DXF に識別図が出ていないこと
   ・パレットの見出しが全記号で同じ倍率であること
   ・極数と端子名が実機の仕様どおりであること
   ・RJ45 を置くと機能テキストに EtherNet/IP が入ること */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
const EXPECT = {
  conn_rj45: ["TD+", "TD-", "RD+", "NC1", "NC2", "RD-", "NC3", "NC4"],
  conn_usb_a: ["VBUS", "D-", "D+", "GND"],
  conn_usb_b: ["VBUS", "D-", "D+", "GND"],
  conn_usb_c: ["VBUS", "GND", "CC1", "CC2", "D+", "D-", "SHELL"],
  conn_hdmi: ["D2+", "D2S", "D2-", "D1+", "D1S", "D1-", "D0+", "D0S", "D0-", "CK+",
              "CKS", "CK-", "CEC", "RSV", "SCL", "SDA", "GND", "+5V", "HPD"],
};
const R = await p.evaluate((EXPECT) => {
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px"; document.body.appendChild(probe);
  const IDS = Object.keys(EXPECT);
  const out = { ports: {}, thick: [], sameShape: [], inBody: [], pins: [], thumb: [], fn: "" };
  /** 識別図の全 path をつないで外形を測る (最初の 1 本だけ見ると中身は無検査になる) */
  const shapeOf = (id) => {
    const sym = symOf(id);
    if (!sym.thumbGlyph) return null;
    const paths = [...sym.thumbGlyph.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)];
    if (!paths.length) return null;
    if (paths.some(m => !/stroke-width="0\.25"/.test(m[2]))) out.thick.push(id);
    const el = document.createElementNS(NS, "path");
    el.setAttribute("d", paths.map(m => m[1]).join(" ")); probe.appendChild(el);
    const L = el.getTotalLength(), pts = [];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < 720; i++) {
      const q = el.getPointAtLength(L * i / 720);
      pts.push([q.x, q.y]);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    el.remove();
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sc = Math.max(x1 - x0, y1 - y0) / 2;
    const fp = [];
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12;
      let best = 0;
      pts.forEach(q => {
        const ang = Math.atan2(q[1] - cy, q[0] - cx);
        if (Math.abs(((ang - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.14) {
          best = Math.max(best, Math.hypot(q[0] - cx, q[1] - cy));
        }
      });
      fp.push(+(best / sc).toFixed(3));
    }
    return { w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2), len: +L.toFixed(2), paths: paths.length, fp };
  };
  IDS.forEach(id => { out.ports[id] = shapeOf(id); });
  // 形が互いに十分違うか。指紋は x・y を同じ倍率で正規化しているので、
  // 縦横比の違いもそのまま指紋に出る (別条件にすると、or では「形が同じで幅だけ
  // 違う」を見逃し、and では「形は違うが縦横比がたまたま同じ」を落とす)
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
    const a = out.ports[IDS[i]], b2 = out.ports[IDS[j]];
    if (!a || !b2) continue;
    const d = Math.max(...a.fp.map((v, k) => Math.abs(v - b2.fp[k])));
    if (d < 0.15) out.sameShape.push(`${IDS[i]}↔${IDS[j]} 形の差 ${d.toFixed(3)}`);
  }
  // 図面の記号本体に識別図が入っていないこと・見出しの倍率が揃っていること
  const boxes = new Set();
  IDS.forEach(id => {
    const sym = symOf(id);
    const g = /<path d="([^"]*)"[^>]*stroke-width="0\.25"/.exec(sym.body);
    if (g) out.inBody.push(id);
    boxes.add((sym.thumbBox || []).join(","));
    if (JSON.stringify((sym.pins || []).map(q => q.n)) !== JSON.stringify(EXPECT[id])) {
      out.pins.push(`${id}: ${(sym.pins || []).map(q => q.n).join(",")}`);
    }
  });
  out.thumb = [...boxes];
  // 図面に置く: 機能テキストの既定値と、DXF に識別図が出ていないこと
  const pg = newPage("ports", 1); App.project.pages = [pg]; App.pageIdx = 0;
  let x = 60;
  IDS.forEach((id, k) => {
    const d = addDevice(pg, id, x, 60, { tag: `-X${k + 1}` });
    if (id === "conn_rj45") out.fn = d.desc;
    devPins(d).forEach(q => addWire(pg, [[q.x - 15, q.y], [q.x, q.y]]));
    x += devBounds(d).w + 26;
  });
  const txt = pageToDXF(pg);
  out.dxfArcs = (txt.match(/\nARC\n/g) || []).length;      // 識別図が出れば USB-C の長円で ARC が出る
  out.drc = runDRC().filter(i => i.page === pg.no && !/端点|未接続/.test(i.msg)).map(i => i.msg);
  probe.remove(); return out;
}, EXPECT);
console.log(JSON.stringify({ ...R, ports: Object.fromEntries(Object.entries(R.ports).map(([k, v]) => [k, v && { w: v.w, h: v.h, len: v.len, paths: v.paths }])) }, null, 1));
const checks = {
  allHaveGlyph: Object.values(R.ports).every(v => v && v.len > 8 && v.paths >= 1),
  thinLine: R.thick.length === 0,                 // 全 path が細線
  distinct: R.sameShape.length === 0,             // 形も縦横比も違う
  notInBody: R.inBody.length === 0,               // 図面の記号本体には入れない
  notInDXF: R.dxfArcs === 0,                      // DXF にも出ない
  sameThumbScale: R.thumb.length === 1,           // 見出しの倍率が全記号で同じ
  pinNames: R.pins.length === 0,                  // 端子名が実機どおり
  fnDefault: R.fn === "EtherNet/IP",              // RJ45 を置くと機能テキストに入る
  drcClean: R.drc.length === 0,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
