/* コントローラの通信ポート (EtherNet/IP)。USB-A/B/C・HDMI は指示により削除し、
   残った RJ45 が LAN の口と一目で分かることを確かめる。

   記号は「受け口の識別図 + ラベル」の見出しと、JIS C 0617-3 03-03-05
   「プラグおよびソケット」1極の組み合わせ。LAN・USB・HDMI は既製ケーブル 1 品目
   なので、心線を 8 本・19 本と展開せず「機器 ─ ポート ─ ケーブル」の 1 本の
   接続として描く。端子の割付は desc に文字で残す。

   見出しは実物の外観図なので向きに意味があり、機器を回しても正立させないと
   「上下逆さまの受け口」という実在しない絵になる。そこで data-upright グループに
   して、位置だけ機器と一緒に回し姿勢は変えない (画面・DXF とも)。

   判定
   ・USB-A/B/C・HDMI が削除されていること
   ・RJ45 の識別図が LAN らしいこと — モジュラジャック特有の 2 段のラッチ溝
     (すぼまりの段が 2 つ = 高さの段が 3 つ) と接点 8 本
   ・接続が関係ない図として扱うこと — シミュレーションで導通せず、
     置いただけ (未配線) でも未接続の警告が出ない
   ・識別図の全ての path が細線 0.25mm であること (電気的な意味を持つ図記号は
     0.5mm。JIS Z 8312 の線幅列で区別する)
   ・回転 0/90/180/270 のどれでも見出しが正立し、外接矩形の内側に収まること
   ・DXF でも同じ — 識別図は細線レイヤ (SYMBOL_THIN) に出て、4 方向で同一形状
   ・パレットの見出しが図面と同じ図形で、全記号で同じ倍率であること
   ・極数と端子名が実機の仕様どおりであること
   ・RJ45 を置くと機能テキストに EtherNet/IP が入ること (同じ RJ45 に PROFINET
     なども載るので、規格名は記号でなくデバイス側に持たせる) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
/* 1極なので接点は 1 つ = 端子は 2 つ (機器側・ケーブル側)。
   実機の端子割付は desc に文字で残っていること (図面に何本も線を引くための
   ものではないが、情報を捨てはしない) */
const EXPECT = {
  conn_rj45: /端子 1=TD\+ 2=TD- 3=RD\+ 6=RD-/,
};
const R = await p.evaluate((EXPECT) => {
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.style.cssText = "position:absolute;left:-9999px"; document.body.appendChild(probe);
  const IDS = Object.keys(EXPECT);
  const out = { ports: {}, thick: [], sameShape: [], noBlock: [], pins: [], thumb: [],
    notUpright: [], outOfBounds: [], dxfRot: [], dxfThin: [], fn: "", drc: [] };
  /** 記号本体の見出し (data-upright) を取り出す */
  const blockOf = (id) => {
    const sym = symOf(id);
    const i = sym.body.indexOf('<g data-upright="1"');
    if (i < 0) return null;
    let depth = 0, j = i;
    for (const m of sym.body.slice(i).matchAll(/<g\b|<\/g>/g)) {
      depth += m[0] === "</g>" ? -1 : 1;
      if (depth === 0) { j = i + m.index + m[0].length; break; }
    }
    const src = sym.body.slice(i, j);
    const o = /transform="translate\(([-\d.]+),([-\d.]+)\)"/.exec(src);
    return { src, cx: +o[1], cy: +o[2] };
  };
  /** 識別図の全 path をつないで外形の指紋を取る (最初の 1 本だけ見ると中身は無検査) */
  const shapeOf = (id) => {
    const blk = blockOf(id);
    if (!blk) { out.noBlock.push(id); return null; }
    const paths = [...blk.src.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)];
    if (!paths.length) { out.noBlock.push(id); return null; }
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
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
    const a = out.ports[IDS[i]], b2 = out.ports[IDS[j]];
    if (!a || !b2) continue;
    const d = Math.max(...a.fp.map((v, k) => Math.abs(v - b2.fp[k])));
    if (d < 0.15) out.sameShape.push(`${IDS[i]}↔${IDS[j]} 形の差 ${d.toFixed(3)}`);
  }
  // 見出しの枠が全記号で同じ (パレットの倍率が揃う) / 端子名が実機どおり
  const boxes = new Set();
  IDS.forEach(id => {
    const sym = symOf(id);
    boxes.add((sym.thumbBox || []).slice(2).join(","));   // 倍率は枠の大きさで決まる
    // 1極 = 端子 2 つ (機器側・ケーブル側)。極ごとに線を引く形ではない
    if ((sym.pins || []).length !== 2) out.pins.push(`${id}: 端子 ${(sym.pins || []).length} 個`);
    if (!new RegExp(EXPECT[id]).test(sym.desc || "")) out.pins.push(`${id}: 端子割付が desc に無い`);
    // プラグ (塗り潰し) とソケット (半円) が揃っているか = 03-03-05 の形
    if (!/fill="currentColor"/.test(sym.body)) out.pins.push(`${id}: プラグ (塗り潰し) が無い`);
    if (!/A3\.5,3\.5/.test(sym.body)) out.pins.push(`${id}: ソケット (半円) が無い`);
  });
  out.thumb = [...boxes];
  /* 画面: 4 方向で見出しが正立し、外接矩形の内側に収まるか。
     symBodySVG の出力をそのまま DOM に載せ、実際に描かれる位置で測る */
  const pg = newPage("ports", 1); App.project.pages = [pg]; App.pageIdx = 0;
  const upRef = {};
  IDS.forEach(id => {
    const blk = blockOf(id);
    [0, 90, 180, 270].forEach(rot => {
      const d = addDevice(pg, id, 200, 150, { tag: "-X", rot });
      // 見出しは正立なので、中心から ±7mm の正方形に収まるはず
      const c = pinAbs(d, { x: blk.cx, y: blk.cy });
      const bd = devBounds(d);
      if (!(c.x - 7 >= bd.x - 0.01 && c.y - 7 >= bd.y - 0.01 &&
            c.x + 7 <= bd.x + bd.w + 0.01 && c.y + 7 <= bd.y + bd.h + 0.01)) {
        out.outOfBounds.push(`${id} rot${rot}`);
      }
      // 実際に描かれる姿勢: 回転を掛けた body を DOM に載せ、識別図の点列を
      // 画面座標 (CTM 込み) で取る。幅を比べるだけでは 180° 回転を見逃すので、
      // 見出しの原点を合わせて rot=0 の点列と重ね、ずれの最大値を見る
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "-200 -200 400 400");
      svg.innerHTML = `<g transform="rotate(${rot})">${symBodySVG(symOf(id), { rot })}</g>`;
      probe.appendChild(svg);
      const grp = svg.querySelector('g[data-upright="1"]');
      const om = grp.getCTM();
      const org = new DOMPoint(0, 0).matrixTransform(om);
      const pts2 = [];
      grp.querySelectorAll("path").forEach(el2 => {
        const M = el2.getCTM(), L = el2.getTotalLength();
        for (let k = 0; k <= 40; k++) {
          const q = el2.getPointAtLength(L * k / 40).matrixTransform(M);
          pts2.push([q.x - org.x, q.y - org.y]);
        }
      });
      svg.remove();
      if (rot === 0) upRef[id] = pts2;
      else {
        const ref2 = upRef[id] || [];
        let worst = 0;
        pts2.forEach((q, k) => { const r2 = ref2[k]; if (r2) worst = Math.max(worst, Math.hypot(q[0] - r2[0], q[1] - r2[1])); });
        if (worst > 0.05) out.notUpright.push(`${id} rot${rot} ずれ ${worst.toFixed(2)}mm`);
      }
      pg.devices.pop();
    });
  });
  /* DXF: 識別図が細線レイヤに出て、4 方向で同一形状か */
  const shapes = {};
  [0, 90, 180, 270].forEach(rot => {
    const pg2 = newPage("d", 1); App.project.pages = [pg2]; App.pageIdx = 0;
    addDevice(pg2, "conn_rj45", 200, 150, { tag: "-X1", rot });
    const t = pageToDXF(pg2);
    const th = [...t.matchAll(/0\nLINE\n8\nSYMBOL_THIN\n(?:6\n[^\n]+\n)?10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n11\n(-?[\d.]+)\n21\n(-?[\d.]+)/g)]
      .map(m => [+m[1], +m[2], +m[3], +m[4]]);
    if (!th.length) { out.dxfThin.push(`rot${rot}: 細線レイヤに出ていない`); return; }
    const xs = th.flatMap(l => [l[0], l[2]]), ys = th.flatMap(l => [l[1], l[3]]);
    const bot = Math.min(...ys);
    const latch = th.filter(l => Math.abs(l[1] - bot) < 0.01 && Math.abs(l[3] - bot) < 0.01)
      .map(l => +Math.abs(l[2] - l[0]).toFixed(1));
    shapes[rot] = `${th.length}本 ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}x${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} 最下辺 ${latch.join(",")}`;
  });
  out.dxfShapes = shapes;
  if (new Set(Object.values(shapes)).size !== 1) out.dxfRot.push(JSON.stringify(shapes));
  // 指示による削除: USB-A/B/C・HDMI はもう無い
  out.removed = ["conn_usb_a", "conn_usb_b", "conn_usb_c", "conn_hdmi"]
    .every(id => !!(symOf(id) || {}).missing);
  /* LAN らしさ: 2 段のラッチ溝 (すぼまりの高さの段が 3 つ) + 接点 8 本 */
  {
    const blk = blockOf("conn_rj45");
    const outline = (/<path d="(M-6,-4[^"]*)"/.exec(blk.src) || [])[1] || "";
    const levels = new Set([...outline.matchAll(/V(-?[\d.]+)/g)].map(m => +m[1]).filter(v => v > 0));
    out.lan = { pins8: (blk.src.match(/M-?[\d.]+,-4 V-1/g) || []).length,
      latchLevels: levels.size };
  }
  /* 接続が関係ない図: シミュレーションで導通しない・未配線でも警告が出ない */
  const pg3 = newPage("x", 1); App.project.pages = [pg3]; App.pageIdx = 0;
  const d = addDevice(pg3, "conn_rj45", 60, 80, { tag: "-X1" });
  out.fn = d.desc;
  out.sim = { pairs: ["closed", "open", "split", "sim"].map(m => conductivePairs(d, m).length),
    noDrcSym: !!symOf("conn_rj45").noDrc };
  out.drc = runDRC().filter(i => i.page === pg3.no).map(i => i.msg);
  probe.remove(); return out;
}, Object.fromEntries(Object.entries(EXPECT).map(([k, v]) => [k, v.source])));
console.log(JSON.stringify({ ...R, ports: Object.fromEntries(Object.entries(R.ports).map(([k, v]) => [k, v && { w: v.w, h: v.h, len: v.len, paths: v.paths }])) }, null, 1));
const checks = {
  hasBlock: R.noBlock.length === 0,               // 記号本体に見出しがある
  thinLine: R.thick.length === 0,                 // 識別図の全 path が細線
  removed: R.removed === true,                    // USB-A/B/C・HDMI は削除済み
  lanGlyph: (R.lan || {}).pins8 === 8 && R.lan.latchLevels >= 3,   // 2 段ラッチ + 接点 8 本
  simOff: (R.sim || {}).pairs && R.sim.pairs.every(v => v === 0) && R.sim.noDrcSym === true,
  upright: R.notUpright.length === 0,             // 4 方向で正立
  inBounds: R.outOfBounds.length === 0,           // 外接矩形の内側
  dxfThin: R.dxfThin.length === 0,                // DXF でも細線レイヤ
  dxfUpright: R.dxfRot.length === 0,              // DXF でも 4 方向で同一形状
  sameThumbScale: R.thumb.length === 1,           // パレットの倍率が全記号で同じ
  pole1: R.pins.length === 0,        // 1極 (端子 2 つ) + 端子割付は文字で残す
  fnDefault: R.fn === "EtherNet/IP",
  drcClean: R.drc.length === 0,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
