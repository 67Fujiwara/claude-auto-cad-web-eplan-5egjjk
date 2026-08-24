/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — シンボル作成 (自作機器の作画と登録)

   1単位 = 1mm。作画した図形を IEC 60617 の作法 (太線 0.5mm / 機械リンクは
   細い破線 / 端子は 5mm グリッド) に沿ってシンボル化し、ライブラリへ登録する。
   図形の一覧は shapes として保存するので、あとから同じ画面で編集できる。
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const SymEdit = {
  shapes: [],          // {k:"line"|"rect"|"circle"|"arc"|"text", ...}
  pins: [],            // {x,y,n}
  funcs: [],           // {kind, pins:[a,b], name} — 1台に複数の機能を持たせる
  tool: "line",
  draft: null,         // 作画中の図形
  sel: -1,             // 選択中の図形 index (-1 = なし / -2以下 = 端子)
  undo: [],
  svg: null,
  editingId: null,     // 既存シンボルを編集中ならその id
  style: "solid",      // solid | dash
  fill: false,         // 図形を黒く塗りつぶす
  lw: LINE_W.thick,    // シンボル全体の線の太さ (mm)
  W: 60, H: 60,        // 作画領域 (mm)
  snap: 1,             // 図形のスナップ (mm)
};

const SYMEDIT_TOOLS = [
  ["line", "線", "折れ線 (クリックで頂点・ダブルクリック/Enter で確定)"],
  ["rect", "長方形", "対角の2点をクリック (ドラッグでも可)"],
  ["circle", "円", "中心 → 半径 をクリック (ドラッグでも可)"],
  ["rectf", "塗り長方形", "黒く塗りつぶした長方形 (対角の2点)"],
  ["half", "半円", "円の縦半分。中心 → 半径 をクリックし、残す側へ動かす"],
  ["arc", "円弧", "中心 → 開始 → 終了 (円・半円と同じくドラッグでも可。回した向きに弧が付く)"],
  ["text", "文字", "クリックした位置に文字を入れる"],
  ["pin", "端子", "配線をつなぐ点。5mm グリッドに乗ります"],
  ["conn", "コネクタ", "多極コネクタ (CN3 など) をまとめて置く。クリックした位置が1番ピン"],
  ["select", "選択", "クリックで選択、空白からドラッグで範囲選択 (まとめて移動/Del)。矢印キーで微調整 0.5mm (Shift=5mm)。青いシンボル枠は角をドラッグでサイズ変更"],
];

/** 画面座標 → 作画座標 (mm)。viewBox は preserveAspectRatio で余白が付くので、
    SVG 自身の変換行列から求める (自前の計算だとカーソルと図形がずれる)。 */
function symEditXY(ev) {
  const svg = SymEdit.svg;
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  }
  // 行列が取れない環境のフォールバック (中央合わせ・等倍維持)
  const r = svg.getBoundingClientRect();
  const s = Math.min(r.width / SymEdit.W, r.height / SymEdit.H) || 1;
  const ox = (r.width - SymEdit.W * s) / 2, oy = (r.height - SymEdit.H * s) / 2;
  return {
    x: (ev.clientX - r.left - ox) / s - SymEdit.W / 2,
    y: (ev.clientY - r.top - oy) / s - SymEdit.H / 2,
  };
}
function symSnap(v, g) { return Math.round(v / g) * g; }

/** 図形1つを SVG 文字列に */
function symShapeSVG(sh, opts = {}) {
  // 破線は図形ごとの寸法 (sh.dash) を優先。無ければ従来の機械リンク寸法 3/0.75
  const dash = sh.style === "dash"
    ? ` stroke-dasharray="${sh.dash || "3 0.75"}" stroke-width="${sh.lw || LINE_W.thin}" stroke-linecap="butt"`
    : (sh.lw ? ` stroke-width="${sh.lw}"` : "");
  const extra = opts.hl ? ` stroke="${SEL}" stroke-width="0.8"` : "";
  if (sh.k === "raw") {
    // 分解できない要素 (曲線など)。translate + rotate で移動・回転はできる
    const tf = (sh.dx || sh.dy || sh.rot)
      ? ` transform="translate(${+(sh.dx || 0).toFixed(2)},${+(sh.dy || 0).toFixed(2)}) rotate(${sh.rot || 0})"` : "";
    return `<g${tf}${opts.hl ? ` stroke="${SEL}"` : ""}>${sh.body}</g>`;
  }
  if (sh.k === "line") {
    const d = sh.pts.map((p, i) => `${i ? "L" : "M"}${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join(" ");
    return `<path d="${d}${sh.closed ? " Z" : ""}"${sh.fill ? ' fill="currentColor" stroke="none"' : ""}${dash}${extra}/>`;
  }
  if (sh.k === "rect") {
    return `<rect x="${+sh.x.toFixed(2)}" y="${+sh.y.toFixed(2)}" width="${+sh.w.toFixed(2)}" height="${+sh.h.toFixed(2)}"${sh.fill ? ' fill="currentColor" stroke="none"' : ""}${dash}${extra}/>`;
  }
  if (sh.k === "circle") {
    return `<circle cx="${+sh.x.toFixed(2)}" cy="${+sh.y.toFixed(2)}" r="${+sh.r.toFixed(2)}"${sh.fill ? ' fill="currentColor" stroke="none"' : ""}${dash}${extra}/>`;
  }
  if (sh.k === "half") {
    // 円の半分 (弦は直線)。dir = 残す側 (right/left/up/down)
    const r = sh.r, cx = sh.x, cy = sh.y;
    const d = sh.dir || "right";
    const p0 = d === "right" || d === "left" ? [cx, cy - r] : [cx - r, cy];
    const p1 = d === "right" || d === "left" ? [cx, cy + r] : [cx + r, cy];
    const sweep = (d === "right" || d === "down") ? 1 : 0;
    const fill = sh.fill ? ' fill="currentColor" stroke="none"' : "";
    return `<path d="M${+p0[0].toFixed(2)},${+p0[1].toFixed(2)} A${+r.toFixed(2)},${+r.toFixed(2)} 0 0 ${sweep} ${+p1[0].toFixed(2)},${+p1[1].toFixed(2)} Z"${fill}${dash}${extra}/>`;
  }
  if (sh.k === "arc") {
    const a0 = sh.a0 * Math.PI / 180, a1 = sh.a1 * Math.PI / 180;
    const x0 = sh.x + sh.r * Math.cos(a0), y0 = sh.y + sh.r * Math.sin(a0);
    const x1 = sh.x + sh.r * Math.cos(a1), y1 = sh.y + sh.r * Math.sin(a1);
    let sweep = ((sh.a1 - sh.a0) % 360 + 360) % 360;
    const large = sweep > 180 ? 1 : 0;
    return `<path d="M${+x0.toFixed(2)},${+y0.toFixed(2)} A${+sh.r.toFixed(2)},${+sh.r.toFixed(2)} 0 ${large} 1 ${+x1.toFixed(2)},${+y1.toFixed(2)}"${dash}${extra}/>`;
  }
  if (sh.k === "text") {
    const fam = sh.mono ? "monospace" : sh.serif ? "serif" : "sans-serif";
    // data-h (文字の呼び高さ) を必ず残す。検図が用紙上の文字高を測るのに使う
    return `<text x="${+sh.x.toFixed(2)}" y="${+sh.y.toFixed(2)}" data-h="${sh.h || TEXT_H.normal}" font-size="${svgFontSizeFor(sh.text, sh.h || TEXT_H.normal, !!sh.mono, { noMin: true, bold: !!sh.bold })}" text-anchor="${sh.anchor || "middle"}" fill="currentColor" stroke="none" font-family="${fam}"${sh.bold ? ' font-weight="bold"' : ""}${sh.italic ? ' font-style="italic"' : ""}>${escXML(sh.text)}</text>`;
  }
  return "";
}

/** 図形一覧 → シンボル body */
function symShapesToBody(shapes) {
  return shapes.map(sh => symShapeSVG(sh)).join("");
}

/** 図形と端子から外接矩形を求める (一様余白 2mm。JIS の他の記号と同じ作法) */
function symShapesBounds(shapes, pins) {
  const NS = "http://www.w3.org/2000/svg";
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const probe = document.createElementNS(NS, "svg");
  probe.setAttribute("width", "10"); probe.setAttribute("height", "10");
  probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
  document.body.appendChild(probe);
  const g = document.createElementNS(NS, "g");
  g.setAttribute("fill", "none"); g.setAttribute("stroke", "#000"); g.setAttribute("stroke-width", "0.5");
  g.innerHTML = symShapesToBody(shapes);
  probe.appendChild(g);
  try {
    const bb = g.getBBox();
    if (bb.width || bb.height) { x0 = bb.x; y0 = bb.y; x1 = bb.x + bb.width; y1 = bb.y + bb.height; }
  } catch (e) { /* 空のときは無視 */ }
  probe.remove();
  (pins || []).forEach(p => {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  });
  if (!isFinite(x0)) return [-5, -5, 10, 10];
  const M = 2, r = v => Math.round(v * 10) / 10;
  return [r(x0 - M), r(y0 - M), r(x1 - x0 + M * 2), r(y1 - y0 + M * 2)];
}

/** DXF のエンティティを作画図形に変換する (原点中央・mm)。
    そのまま編集・削除できるので、取り込んだ後に端子を足してシンボル化できる。 */
function dxfEntsToShapes(ents, opt = {}) {
  const k = opt.scale || 1;
  const b = dxfEntsBounds(ents);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const X = x => +(((x - cx) * k)).toFixed(2);
  const Y = y => +((-(y - cy) * k)).toFixed(2);      // DXF は上向きが +Y
  const out = [];
  ents.forEach(e => {
    if (e.type === "INSERT") return;
    if (e.type === "LINE" || e.type === "SOLID") {
      if (isFinite(e.x1) && isFinite(e.x2)) out.push({ k: "line", pts: [[X(e.x1), Y(e.y1)], [X(e.x2), Y(e.y2)]], style: "solid" });
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const pts = (e.pts || []).filter(p => isFinite(p[0]) && isFinite(p[1])).map(p => [X(p[0]), Y(p[1])]);
      if (pts.length >= 2) { if (e.flags & 1) pts.push(pts[0]); out.push({ k: "line", pts, style: "solid" }); }
    } else if (e.type === "CIRCLE") {
      out.push({ k: "circle", x: X(e.x1), y: Y(e.y1), r: +(e.r * k).toFixed(2), style: "solid" });
    } else if (e.type === "ARC") {
      // DXF の角度は反時計回り・Y上向き。画面座標 (Y下向き) では符号が反転する
      out.push({ k: "arc", x: X(e.x1), y: Y(e.y1), r: +(e.r * k).toFixed(2),
        a0: -(e.a2 || 0), a1: -(e.a1 || 0), style: "solid" });
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      // 文字高さは DXF の値に尺度をかけたまま使う。下限で持ち上げると
      // 縮尺取り込みで図形だけ縮んで文字が相対的に巨大化する
      out.push({ k: "text", x: X(e.x1), y: Y(e.y1), text: e.text || "",
        h: Math.max(0.3, +((e.size || 3.5) * k).toFixed(2)), mono: true });
    }
  });
  // センタリングをやり直す: dxfEntsBounds の文字幅は見積もりなので、
  // 実際に描いた寸法 (getBBox) とずれると図形群が原点から大きく外れ、
  // 作画キャンバスの外に出て「プレビューには出るのに見えない」状態になる
  if (out.length) {
    const bb = symShapesBounds(out, []);
    const dx = -(bb[0] + bb[2] / 2), dy = -(bb[1] + bb[3] / 2);
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      const r1 = v => Math.round(v * 100) / 100;
      out.forEach(sh => {
        if (sh.k === "line") sh.pts = sh.pts.map(q => [r1(q[0] + dx), r1(q[1] + dy)]);
        else { sh.x = r1(sh.x + dx); sh.y = r1(sh.y + dy); }
      });
    }
  }
  return out;
}

/* ── 既存シンボル body (SVG 文字列) → 作画図形への分解 ──
   全シンボルを同じ画面で編集できるようにするための逆変換。
   直線 (M/L/H/V/Z)・真円弧 (A rx=ry)・rect・circle・text は個々の図形へ、
   ベジェ曲線などは要素ごと raw 図形 (移動・回転できる塊) として残す */

/** SVG の端点式円弧 → 中心式 (作画図形の arc)。楕円は対象外 (null) */
function svgArcShape(x1, y1, x2, y2, r, large, sweep, props) {
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-9) return null;
  if (r * r < d2) r = Math.sqrt(d2);                 // SVG 仕様の半径補正 (弦が届く最小へ)
  const f = Math.sqrt(Math.max(0, r * r / d2 - 1)) * (large !== sweep ? 1 : -1);
  const cx = f * dy + (x1 + x2) / 2, cy = -f * dx + (y1 + y2) / 2;
  const aOf = (px, py) => Math.atan2(py - cy, px - cx) * 180 / Math.PI;
  const a1v = aOf(x1, y1), a2v = aOf(x2, y2);
  // 作画図形の arc は a0 → a1 の時計回り (掃引 1) で描く
  const r2 = v => Math.round(v * 100) / 100;
  if (sweep) {
    const span = ((a2v - a1v) % 360 + 360) % 360;
    return { k: "arc", x: r2(cx), y: r2(cy), r: r2(r), a0: r2(a1v), a1: r2(a1v + span), ...props };
  }
  const span = ((a1v - a2v) % 360 + 360) % 360;
  return { k: "arc", x: r2(cx), y: r2(cy), r: r2(r), a0: r2(a2v), a1: r2(a2v + span), ...props };
}

/** path の d → 作画図形の列。対応しないコマンドがあれば null (要素ごと raw に) */
function symPathToShapes(d, ox, oy, st) {
  if (/[^MLHVAZmlhvaz\s,\-.\d]/.test(d)) return null;         // C/S/Q/T (曲線) などは分解しない
  if (st.fill && /[Aa]/.test(d)) return null;                 // 塗り+弧 (きのこ頭など) は形が変わるので分解しない
  const toks = d.match(/[MLHVAZmlhvaz]|-?(?:\d+\.?\d*|\.\d+)/g) || [];
  const out = [];
  const r2 = v => Math.round(v * 100) / 100;
  const props = () => {
    const o = {};
    if (st.style === "dash") { o.style = "dash"; if (st.dash) o.dash = st.dash; }
    if (st.lw) o.lw = st.lw;
    if (st.fill) o.fill = true;
    return o;
  };
  let i = 0, cur = null, x = 0, y = 0, sx = 0, sy = 0, poly = null;
  const num = () => +toks[i++];
  const endPoly = (closed) => {
    if (poly && poly.length >= 2) out.push({ k: "line", pts: poly, ...(closed ? { closed: true } : {}), ...props() });
    poly = null;
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) {
      cur = toks[i++];
      if (cur === "Z" || cur === "z") { endPoly(true); x = sx; y = sy; cur = null; continue; }
      continue;
    }
    if (!cur) return null;
    const rel = cur === cur.toLowerCase(), C = cur.toUpperCase();
    if (C === "M") {
      endPoly(false);
      const nx = num(), ny = num();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny;
      sx = x; sy = y;
      poly = [[r2(x + ox), r2(y + oy)]];
      cur = rel ? "l" : "L";                          // 後続の座標対は線分
      continue;
    }
    if (C === "L") { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; }
    else if (C === "H") { const nx = num(); x = rel ? x + nx : nx; }
    else if (C === "V") { const ny = num(); y = rel ? y + ny : ny; }
    else if (C === "A") {
      const rx = num(), ry = num(); num();
      const large = num() ? 1 : 0, sweep = num() ? 1 : 0;
      const nx = num(), ny = num();
      const ex = rel ? x + nx : nx, ey = rel ? y + ny : ny;
      if (Math.abs(rx - ry) > 0.01) return null;      // 楕円弧は raw のまま
      endPoly(false);
      const arc = svgArcShape(x + ox, y + oy, ex + ox, ey + oy, rx, large, sweep, props());
      if (!arc) { x = ex; y = ey; poly = [[r2(x + ox), r2(y + oy)]]; continue; }  // 長さ0の弧は捨てる
      out.push(arc);
      x = ex; y = ey;
      poly = [[r2(x + ox), r2(y + oy)]];              // 弧の終点から折れ線を続けられる
      continue;
    } else return null;
    if (!poly) poly = [[r2(x + ox), r2(y + oy)]];
    else poly.push([r2(x + ox), r2(y + oy)]);
  }
  endPoly(false);
  return out;
}

/** body (SVG 文字列) → 作画図形の列 */
function symBodyToShapes(body) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><g>${body}</g></svg>`, "image/svg+xml");
  if (doc.querySelector("parsererror")) return [{ k: "raw", body, dx: 0, dy: 0, rot: 0 }];
  const out = [];
  const walk = (el, ox, oy) => {
    for (const ch of el.children) {
      const tag = ch.tagName.toLowerCase();
      const st = {};
      const dashA = ch.getAttribute("stroke-dasharray");
      const lwA = parseFloat(ch.getAttribute("stroke-width"));
      if (dashA) { st.style = "dash"; st.dash = dashA; }
      if (isFinite(lwA)) st.lw = lwA;
      const fillA = ch.getAttribute("fill");
      st.fill = !!fillA && fillA !== "none";
      if (tag === "g") {
        // translate(x,y) の g は中へ潜る。回転・拡大付きの g はまるごと raw
        const tr = ch.getAttribute("transform") || "";
        const tm = /^\s*translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)\s*$/.exec(tr);
        if (!tr || tm) { walk(ch, ox + (tm ? +tm[1] : 0), oy + (tm && tm[2] !== undefined ? +tm[2] : 0)); continue; }
        out.push({ k: "raw", body: ch.outerHTML, dx: ox, dy: oy, rot: 0 });
      } else if (tag === "rect") {
        out.push({ k: "rect", x: +(ch.getAttribute("x") || 0) + ox, y: +(ch.getAttribute("y") || 0) + oy,
          w: +ch.getAttribute("width"), h: +ch.getAttribute("height"),
          ...(st.fill ? { fill: true } : {}), ...(st.style ? { style: "dash", dash: st.dash } : {}), ...(st.lw ? { lw: st.lw } : {}) });
      } else if (tag === "circle") {
        out.push({ k: "circle", x: +(ch.getAttribute("cx") || 0) + ox, y: +(ch.getAttribute("cy") || 0) + oy,
          r: +ch.getAttribute("r"),
          ...(st.fill ? { fill: true } : {}), ...(st.style ? { style: "dash", dash: st.dash } : {}), ...(st.lw ? { lw: st.lw } : {}) });
      } else if (tag === "text") {
        const fam = ch.getAttribute("font-family") || "";
        const mono = fam.includes("mono");
        const serif = !mono && fam.includes("serif") && !fam.includes("sans");
        const italic = (ch.getAttribute("font-style") || "") === "italic";
        const bold = (ch.getAttribute("font-weight") || "") === "bold";
        const hAttr = parseFloat(ch.getAttribute("data-h"));
        const fs = parseFloat(ch.getAttribute("font-size"));
        const h2 = isFinite(hAttr) ? hAttr
          : isFinite(fs) ? +((fs * capRatio((mono ? "mono" : "sans") + (bold ? "+b" : ""))).toFixed(2)) : TEXT_H.normal;
        const anc = ch.getAttribute("text-anchor") || "start";   // SVG の既定は start
        out.push({ k: "text", x: +(ch.getAttribute("x") || 0) + ox, y: +(ch.getAttribute("y") || 0) + oy,
          text: ch.textContent, h: h2, mono,
          ...(bold ? { bold: true } : {}), ...(serif ? { serif: true } : {}), ...(italic ? { italic: true } : {}),
          ...(anc !== "middle" ? { anchor: anc } : {}) });
      } else if (tag === "path") {
        const shapes = symPathToShapes(ch.getAttribute("d") || "", ox, oy, st);
        if (shapes) out.push(...shapes);
        else out.push({ k: "raw", body: ch.outerHTML, dx: ox, dy: oy, rot: 0 });
      } else {
        out.push({ k: "raw", body: ch.outerHTML, dx: ox, dy: oy, rot: 0 });
      }
    }
  };
  walk(doc.documentElement.firstElementChild, 0, 0);
  return out;
}

/** raw 図形のローカル外接箱 (キャッシュ) を dx/dy/rot 込みで返す [x0,y0,x1,y1] */
const _rawBBCache = new WeakMap();
function rawShapeBB(sh) {
  let bb = _rawBBCache.get(sh);
  if (!bb) {
    const NS = "http://www.w3.org/2000/svg";
    const probe = document.createElementNS(NS, "svg");
    probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
    document.body.appendChild(probe);
    const g = document.createElementNS(NS, "g");
    g.innerHTML = sh.body;
    probe.appendChild(g);
    try { const b = g.getBBox(); bb = [b.x, b.y, b.x + b.width, b.y + b.height]; }
    catch (e) { bb = [0, 0, 0, 0]; }
    probe.remove();
    _rawBBCache.set(sh, bb);
  }
  const a = ((sh.rot || 0) % 360) * Math.PI / 180;
  const cs = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(([px, py]) =>
    [px * Math.cos(a) - py * Math.sin(a) + (sh.dx || 0), px * Math.sin(a) + py * Math.cos(a) + (sh.dy || 0)]);
  const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* ══════════════ 画面 ══════════════ */
UI.openSymbolEditor = (symId = null) => {
  if (App.sim.running) { UI.setMsg("シミュレーション中はシンボルを作成できません"); return; }
  const S = SymEdit;
  S.shapes = []; S.pins = []; S.funcs = []; S.undo = []; S.sel = -1; S.draft = null; S.moving = null;
  S.msel = { shapes: [], pins: [] }; S.marquee = null; S.frame = null; S.frameDrag = null;
  S.tool = "line"; S.style = "solid"; S.fill = false; S.editingId = null; S.lw = LINE_W.thick;

  let meta = { name: "", nameEn: "", letter: "E", typ: "", desc: "", group: "自作", sim: "none", mono: false };
  let asCopy = false;
  if (symId && SYMBOLS_BY_ID[symId]) {
    let src = SYMBOLS_BY_ID[symId];
    // 寸法違い (stretch)・機種で自動生成する下地 (unitSheet) は上書き編集できない
    // → 既定寸法の姿を静的な複製として開く (保存すると新しいシンボルになる)
    if (src.stretch || src.stretchOf || src.unitSheet) {
      asCopy = true;
      if (src.stretch) src = symStretchVariant(src, src.stretch.def);
    }
    S.editingId = asCopy ? null : symId;
    meta = {
      name: (src.name || "") + (asCopy ? " (複製)" : ""), nameEn: src.nameEn || "", letter: src.letter || "E",
      typ: src.typ || "", desc: src.desc || "",
      group: src.group || (SYM_CATS[src.cat] ? SYM_CATS[src.cat].name : "自作"),
      sim: src.sim || "none",
    };
    S.pins = (src.pins || []).map(p => ({ x: p.x, y: p.y, n: p.n || "" }));
    S.funcs = Array.isArray(src.funcs) ? deepCopy(src.funcs) : [];
    S.shapes = Array.isArray(src.shapes) ? deepCopy(src.shapes) : [];
    if (src.lw) S.lw = src.lw;
    if (!S.shapes.length && src.body) {
      // 図形一覧を持たないシンボル (規格ライブラリ・DXF取り込み) は
      // body を作画図形へ分解して、個々の線・円・文字として編集できるようにする
      S.shapes = symBodyToShapes(src.body);
    }
    // 保存済みの枠 (bounds) が自動計算と違えば「手で決めた枠」として引き継ぐ
    const auto = symShapesBounds(S.shapes, S.pins);
    const bd0 = src.bounds;
    if (Array.isArray(bd0) && bd0.length === 4 && bd0.some((v, i2) => Math.abs(v - auto[i2]) > 0.05)) {
      S.frame = [...bd0];
    }
  }

  if (S.shapes.length || S.pins.length) {
    const a = symShapesBounds(S.shapes, S.pins);
    const f = S.frame;
    // 手動枠があれば、それも収まる作画範囲にする
    const bd = f
      ? [Math.min(a[0], f[0]), Math.min(a[1], f[1]),
         Math.max(a[0] + a[2], f[0] + f[2]) - Math.min(a[0], f[0]),
         Math.max(a[1] + a[3], f[1] + f[3]) - Math.min(a[1], f[1])]
      : a;
    const need = Math.max(Math.abs(bd[0]), Math.abs(bd[1]), Math.abs(bd[0] + bd[2]), Math.abs(bd[1] + bd[3])) * 2 + 8;
    S.W = S.H = [40, 60, 100, 160, 240, 320].find(v => v >= need) || 320;
  } else { S.W = S.H = 60; }
  const body = h(`<div class="se-wrap">
    <div class="se-left">
      <div class="se-tools" id="seTools"></div>
      <div class="prop-note" id="seHint" style="margin:8px 0 0">折れ線: クリックで頂点、ダブルクリックか Enter で確定</div>
      <div class="prop-sect">選択の操作</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-solid" id="seDup" style="padding:4px 10px;font-size:11.5px" title="選択した図形・端子を +5mm ずらして複製 (Ctrl+D)">複製</button>
        <button class="btn-solid" id="seRot" style="padding:4px 10px;font-size:11.5px" title="選択を 90° 回転。未選択なら全体を回転 (R)">回転 90°</button>
      </div>
      <div class="prop-note" style="margin-top:4px">Ctrl+C コピー / Ctrl+X 切り取り / Ctrl+V 貼り付け / Ctrl+D 複製 / R 回転90°。未選択で回転すると全体が回ります。</div>
      <div class="prop-sect">線種</div>
      <div class="prop-row"><label class="chk"><input type="radio" name="seStyle" value="solid" checked/><span>実線 (導体・図記号)</span></label></div>
      <div class="prop-row"><label class="chk"><input type="radio" name="seStyle" value="dash"/><span>破線 (機械リンク・囲い)</span></label></div>
      <div class="prop-row"><label class="chk"><input type="checkbox" id="seFill"/><span>塗りつぶす (黒)</span></label></div>
      <div class="prop-sect">線の太さ</div>
      <div class="prop-row"><select id="seLw">
        <option value="0.5">0.5 mm 太線 (図記号の標準)</option>
        <option value="0.25">0.25 mm 細線 (取り込み図形・補助)</option>
        <option value="0.35">0.35 mm 中線</option>
      </select></div>
      <div class="prop-sect">作画範囲</div>
      <div class="prop-row"><select id="seSize">
        ${[40, 60, 100, 160, 240, 320].map(v => `<option value="${v}"${v === S.W ? " selected" : ""}>${v} × ${v} mm</option>`).join("")}
      </select></div>
      <div class="prop-sect" id="sePinHead">端子</div>
      <div id="sePins" class="se-pins"></div>
      <div class="prop-note" style="margin-top:6px">端子は 5mm グリッドに乗ります。番号は部品表・接続リストに出ます。</div>
    </div>
    <div class="se-mid">
      <svg id="seCanvas" viewBox="${-S.W / 2} ${-S.H / 2} ${S.W} ${S.H}" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="se-status" id="seStatus">X: 0.0  Y: 0.0</div>
    </div>
    <div class="se-right">
      <div class="prop-sect">機器の情報</div>
      <div class="prop-row"><label>名称</label><input id="seName" value="${escAttr(meta.name)}" placeholder="例: 圧力センサ (自社品)"/></div>
      <div class="prop-row"><label>英名</label><input id="seNameEn" value="${escAttr(meta.nameEn)}" placeholder="Pressure sensor"/></div>
      <div class="prop-row"><label>文字記号</label><input id="seLetter" class="mono" value="${escAttr(meta.letter)}" maxlength="2" placeholder="B"/></div>
      <div class="prop-row"><label>型式</label><input id="seTyp" class="mono" value="${escAttr(meta.typ)}" placeholder="部品表に出る型式"/></div>
      <div class="prop-row"><label>分類</label><input id="seGroup" value="${escAttr(meta.group)}" placeholder="自作"/></div>
      <div class="prop-row"><label>説明</label><input id="seDesc" value="${escAttr(meta.desc)}" placeholder="用途・注意点"/></div>
      <div class="prop-row"><label>回路の働き<br><span class="rp-dim">(機能を追加すると無効)</span></label><select id="seSim">
        ${(() => {
          const opts = [["none", "なし (作図のみ)"], ["passthru", "素通し (端子台・接続)"],
            ["contact_no", "a接点 (メーク)"], ["contact_nc", "b接点 (ブレーク)"],
            ["coil", "コイル (励磁で接点が動く)"], ["load", "負荷 (ランプ・ソレノイド)"],
            ["breaker", "遮断器 (手動開閉)"]];
          // 一覧に無い働き (切替接点・電位リンク等) の記号を編集しても、働きを失わないように残す
          if (meta.sim && !opts.some(o => o[0] === meta.sim)) opts.push([meta.sim, `現状のまま (${meta.sim})`]);
          return opts.map(([v, t]) => `<option value="${v}"${meta.sim === v ? " selected" : ""}>${t}</option>`).join("");
        })()}
      </select></div>
      <div class="prop-sect" id="seFnHead">機能 (複数可)</div>
      <div class="prop-note" style="margin-top:0">
        コイル・a接点などを1台の機器の中に複数持たせられます。<br>
        接点は同じ機器のコイルに連動します (自社製ドライバのような複合機器向け)。
      </div>
      <div id="seFuncs" class="se-funcs"></div>
      <button class="btn-solid" id="seFnAdd" style="margin-top:6px;padding:4px 10px;font-size:11.5px">機能を追加</button>
      <div class="prop-sect">プレビュー (パレット表示)</div>
      <div class="se-preview" id="sePrev"></div>
      <div class="prop-note" id="seBounds">外接矩形: —</div>
      <div class="prop-note">線幅は太線 0.5mm (JIS Z 8312)、文字高は 3.5mm で描かれます。<br>
        端子を2点以上置くと、配線をつないで通電シミュレーションできます。</div>
    </div>
  </div>`);

  const foot = h(`<div style="display:flex;gap:10px;align-items:center;width:100%">
    <button class="btn-solid" id="seDxf">DXF を読み込む…</button>
    <button class="btn-solid" id="seIns">シンボルを挿入…</button>
    <button class="btn-solid" id="seUndo">元に戻す</button>
    <button class="btn-solid" id="seClear">全消去</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="seCancel">キャンセル</button>
    <button class="btn-solid primary" id="seOk">${S.editingId ? "更新して保存" : "ライブラリに登録"}</button>
  </div>`);

  const m = UI.openModal({
    title: S.editingId ? "シンボルの編集" : "シンボルの作成",
    sub: "図形を描いて端子を置くと、自作の機器としてライブラリに登録できます (Esc = 作画のキャンセル)",
    body, foot, wide: true, noEsc: true,
    onclose: () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousemove", onDocMove, true);
    },
  });

  S.svg = body.querySelector("#seCanvas");
  const statusEl = body.querySelector("#seStatus");
  const hintEl = body.querySelector("#seHint");

  // ── ツールボタン ──
  const toolsEl = body.querySelector("#seTools");
  toolsEl.innerHTML = SYMEDIT_TOOLS.map(([id, label]) =>
    `<button class="se-tool${id === S.tool ? " on" : ""}" data-t="${id}">${label}</button>`).join("");
  toolsEl.addEventListener("click", e => {
    const b = e.target.closest(".se-tool");
    if (!b) return;
    S.tool = b.dataset.t; S.draft = null; S.sel = -1; S.moving = null; S.marquee = null; S.frameDrag = null;
    S.msel = { shapes: [], pins: [] };
    toolsEl.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === S.tool));
    const t = SYMEDIT_TOOLS.find(x => x[0] === S.tool);
    hintEl.textContent = t ? t[2] : "";
    draw();
  });
  body.querySelectorAll('input[name="seStyle"]').forEach(r =>
    r.addEventListener("change", e => { S.style = e.target.value; }));
  body.querySelector("#seFill").addEventListener("change", e => { S.fill = e.target.checked; });
  body.querySelector("#seLw").value = String(S.lw);
  body.querySelector("#seLw").addEventListener("change", e => { S.lw = parseFloat(e.target.value) || LINE_W.thick; draw(); });
  body.querySelector("#seSize").addEventListener("change", e => {
    S.W = S.H = +e.target.value;
    S.svg.setAttribute("viewBox", `${-S.W / 2} ${-S.H / 2} ${S.W} ${S.H}`);
    draw();
  });

  // ── 描画 ──
  const push = () => { S.undo.push({ shapes: deepCopy(S.shapes), pins: deepCopy(S.pins), funcs: deepCopy(S.funcs) }); if (S.undo.length > 60) S.undo.shift(); };
  /* カーソル (細い十字線 + スナップ枠)。OS のカーソルは隠してあるので、
     スナップ済みの座標 = 実際にクリックが落ちる点をこれで示す。
     mousemove では属性だけ動かす (innerHTML を触ると click が失われる) */
  const cursorAp = () => Math.max(1.4, S.W * 0.022);   // スナップ枠の一辺 (見かけの大きさを一定に)
  const moveCursor = (x, y) => {
    S.cursorPos = [x, y];
    const c = S.svg.querySelector("#seCursor");
    if (!c) return;
    c.style.display = "";
    const cv = c.querySelector(".cv"), ch = c.querySelector(".ch"), cp = c.querySelector(".cp");
    cv.setAttribute("x1", x); cv.setAttribute("x2", x);
    ch.setAttribute("y1", y); ch.setAttribute("y2", y);
    const ap = cursorAp();
    cp.setAttribute("x", x - ap / 2); cp.setAttribute("y", y - ap / 2);
  };
  const hideCursor = () => {
    S.cursorPos = null;
    const c = S.svg.querySelector("#seCursor");
    if (c) c.style.display = "none";
  };
  const draw = () => {
    const g = 1, G = 5;
    let out = "";
    // グリッド
    let d1 = "", d5 = "";
    for (let x = -S.W / 2; x <= S.W / 2; x += g) { (Math.abs(x % G) < 1e-6 ? (d5 += `M${x},${-S.H / 2} V${S.H / 2} `) : (d1 += `M${x},${-S.H / 2} V${S.H / 2} `)); }
    for (let y = -S.H / 2; y <= S.H / 2; y += g) { (Math.abs(y % G) < 1e-6 ? (d5 += `M${-S.W / 2},${y} H${S.W / 2} `) : (d1 += `M${-S.W / 2},${y} H${S.W / 2} `)); }
    out += `<path d="${d1}" stroke="rgba(120,150,200,.13)" stroke-width="0.08" fill="none"/>`;
    out += `<path d="${d5}" stroke="rgba(120,150,200,.28)" stroke-width="0.12" fill="none"/>`;
    // 原点の十字
    out += `<path d="M-3,0 H3 M0,-3 V3" stroke="rgba(255,120,120,.55)" stroke-width="0.2" fill="none"/>`;
    // シンボル枠 (青)。配置時の外接矩形。選択ツールでは角をドラッグしてサイズを変えられる
    if (S.shapes.length || S.pins.length) {
      const fb = S.frame ?? symShapesBounds(S.shapes, S.pins);
      out += `<rect x="${fb[0]}" y="${fb[1]}" width="${fb[2]}" height="${fb[3]}" fill="none" stroke="#4b9fff" stroke-width="${S.frame ? 0.3 : 0.16}" stroke-dasharray="1.6 1" opacity="${S.frame ? 0.95 : 0.55}"/>`;
      if (S.tool === "select") {
        const hs = 1.3;
        [[fb[0], fb[1]], [fb[0] + fb[2], fb[1]], [fb[0], fb[1] + fb[3]], [fb[0] + fb[2], fb[1] + fb[3]]]
          .forEach(([cx, cy]) => { out += `<rect x="${cx - hs / 2}" y="${cy - hs / 2}" width="${hs}" height="${hs}" fill="#4b9fff" stroke="none"/>`; });
      }
    }
    // 図形
    out += `<g fill="none" stroke="#e6edf7" stroke-width="${S.lw}" stroke-linecap="round" stroke-linejoin="round" color="#e6edf7">`;
    S.shapes.forEach((sh, i) => { out += symShapeSVG(sh, { hl: i === S.sel || S.msel.shapes.includes(i) }); });
    out += `</g>`;
    // 範囲選択の矩形
    if (S.marquee) {
      const q = S.marquee;
      out += `<rect x="${Math.min(q.x0, q.x1)}" y="${Math.min(q.y0, q.y1)}" width="${Math.abs(q.x1 - q.x0)}" height="${Math.abs(q.y1 - q.y0)}" fill="rgba(75,159,255,.08)" stroke="${SEL}" stroke-width="0.25" stroke-dasharray="1 0.8"/>`;
    }
    // 作画中
    if (S.draft) {
      out += `<g fill="none" stroke="${SEL}" stroke-width="0.4" stroke-dasharray="1 0.8">${S.draft.k === "raw" ? "" : symShapeSVG(S.draft)}</g>`;
    }
    // 端子
    S.pins.forEach((p, i) => {
      out += `<circle cx="${p.x}" cy="${p.y}" r="0.9" fill="${S.sel === -2 - i || S.msel.pins.includes(i) ? SEL : "#e5484d"}" stroke="none"/>`;
      if (p.n) out += `<text x="${p.x + 1.6}" y="${p.y - 1.2}" font-size="2.6" fill="#8b96ab" font-family="monospace">${escXML(p.n)}</text>`;
    });
    // カーソル (最前面・当たり判定なし)。線は vector-effect で常に 1px の髪線
    const ap = cursorAp();
    out += `<g id="seCursor" style="display:none" pointer-events="none">
      <line class="cv" x1="0" x2="0" y1="${-S.H / 2}" y2="${S.H / 2}" stroke="rgba(75,159,255,.5)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <line class="ch" y1="0" y2="0" x1="${-S.W / 2}" x2="${S.W / 2}" stroke="rgba(75,159,255,.5)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <rect class="cp" x="${-ap / 2}" y="${-ap / 2}" width="${ap}" height="${ap}" fill="none" stroke="#4b9fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </g>`;
    S.svg.innerHTML = out;
    if (S.cursorPos) moveCursor(S.cursorPos[0], S.cursorPos[1]);   // 再描画で消えた十字線を戻す
    refreshSide();
  };
  const refreshSide = () => {
    const bd = S.frame ?? symShapesBounds(S.shapes, S.pins);
    const bEl = body.querySelector("#seBounds");
    bEl.innerHTML =
      `シンボル枠 (青): X ${bd[0]} / Y ${bd[1]} / 幅 ${bd[2]} / 高さ ${bd[3]} mm` +
      (S.frame
        ? ` <button id="seFrameReset" class="se-pin-del" title="図形から自動計算した枠に戻す">自動に戻す</button>`
        : ` <span class="rp-dim">(自動。選択ツールで角をドラッグして変更)</span>`);
    const fr = bEl.querySelector("#seFrameReset");
    if (fr) fr.addEventListener("click", () => { S.frame = null; draw(); });
    const prevSym = { bounds: bd, lw: S.lw, body: symShapesToBody(S.shapes) };
    body.querySelector("#sePrev").innerHTML = prevSym.body ? symThumbSVG(prevSym, 90) : '<span class="se-empty">図形がありません</span>';
    const ph = body.querySelector("#sePinHead");
    if (ph) ph.textContent = S.pins.length ? `端子 (${S.pins.length} 点)` : "端子 (未設定)";
    const pl = body.querySelector("#sePins");
    pl.innerHTML = S.pins.length ? S.pins.map((p, i) =>
      `<div class="se-pin"><span class="mono">${i + 1}</span>
        <input class="mono" id="sePinN${i}" value="${escAttr(p.n)}" placeholder="端子番号"/>
        <span class="mono se-pin-xy">${p.x},${p.y}</span>
        <button class="se-pin-del" data-i="${i}" title="削除">✕</button></div>`).join("")
      : '<div class="se-empty">「端子」ツールで配置します</div>';
    S.pins.forEach((p, i) => {
      const inp = pl.querySelector(`#sePinN${i}`);
      if (inp) inp.addEventListener("change", e => { p.n = e.target.value.trim(); draw(); });
    });
    pl.querySelectorAll(".se-pin-del").forEach(b => b.addEventListener("click", () => {
      push();
      const i = +b.dataset.i;
      S.pins.splice(i, 1);
      // 端子を消したら、その端子を使う機能の割り当てを詰める
      S.funcs.forEach(f => { f.pins = (f.pins || []).map(v => (v === i ? null : v > i ? v - 1 : v)); });
      S.funcs = S.funcs.filter(f => (f.pins || []).every(v => v != null));
      draw();
    }));
    renderFuncs();
  };
  const FUNC_KINDS = [["coil", "コイル (励磁)"], ["contact_no", "a接点 (メーク)"], ["contact_nc", "b接点 (ブレーク)"],
    ["load", "負荷 (ランプ・ソレノイド)"], ["passthru", "素通し (端子・コネクタ)"], ["breaker", "遮断器 (手動開閉)"]];
  const renderFuncs = () => {
    const el = body.querySelector("#seFuncs");
    if (!el) return;
    const head = body.querySelector("#seFnHead");
    if (head) head.textContent = S.funcs.length ? `機能 (${S.funcs.length} 個)` : "機能 (複数可)";
    const simSel = body.querySelector("#seSim");
    if (simSel) simSel.disabled = S.funcs.length > 0;
    const pinOpts = (selv) => S.pins.map((p, i) =>
      `<option value="${i}"${i === selv ? " selected" : ""}>${i + 1}: ${escAttr(p.n || "")}</option>`).join("");
    el.innerHTML = S.funcs.length ? S.funcs.map((f, i) => `
      <div class="se-func">
        <select id="seFk${i}">${FUNC_KINDS.map(([v, t]) => `<option value="${v}"${f.kind === v ? " selected" : ""}>${t}</option>`).join("")}</select>
        <select id="seFa${i}">${pinOpts((f.pins || [])[0])}</select>
        <select id="seFb${i}">${pinOpts((f.pins || [])[1])}</select>
        <input id="seFn${i}" value="${escAttr(f.name || "")}" placeholder="名称 (例 CN3 EMG)"/>
        <button class="se-pin-del se-fn-del" data-i="${i}" title="削除">✕</button>
      </div>`).join("") : '<div class="se-empty">「機能を追加」で、コイルや接点をまとめられます</div>';
    S.funcs.forEach((f, i) => {
      const k = el.querySelector(`#seFk${i}`), a = el.querySelector(`#seFa${i}`), b2 = el.querySelector(`#seFb${i}`), nm = el.querySelector(`#seFn${i}`);
      if (k) k.addEventListener("change", e => { f.kind = e.target.value; renderFuncs(); });
      if (a) a.addEventListener("change", e => { f.pins[0] = +e.target.value; });
      if (b2) b2.addEventListener("change", e => { f.pins[1] = +e.target.value; });
      if (nm) nm.addEventListener("change", e => { f.name = e.target.value.trim(); });
    });
    el.querySelectorAll(".se-fn-del").forEach(b2 => b2.addEventListener("click", () => {
      push(); S.funcs.splice(+b2.dataset.i, 1); renderFuncs();
    }));
  };

  // ── マウス操作 ──
  const distSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    if (!L2) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  const hitShape = (x, y) => {
    for (let i = S.shapes.length - 1; i >= 0; i--) {
      const sh = S.shapes[i];
      // 線は頂点だけでなく線分の途中もつまめるようにする
      if (sh.k === "line" && (sh.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 2) ||
        sh.pts.some((p, j) => j > 0 && distSeg(x, y, sh.pts[j - 1][0], sh.pts[j - 1][1], p[0], p[1]) < 1.2))) return i;
      if (sh.k === "rect" && x > sh.x - 1 && x < sh.x + sh.w + 1 && y > sh.y - 1 && y < sh.y + sh.h + 1) return i;
      if ((sh.k === "circle" || sh.k === "arc" || sh.k === "half") && Math.abs(Math.hypot(x - sh.x, y - sh.y) - sh.r) < 2) return i;
      if (sh.k === "text" && Math.abs(x - sh.x) < 6 && Math.abs(y - sh.y) < 3) return i;
      if (sh.k === "raw") {
        const b = rawShapeBB(sh);
        if (x > b[0] - 1 && x < b[2] + 1 && y > b[1] - 1 && y < b[3] + 1) return i;
      }
    }
    return -1;
  };
  /** 図形1つの外接矩形 [x0,y0,x1,y1]。範囲選択の当たり判定に使う (raw は対象外) */
  const shapeBBox = (sh) => {
    if (sh.k === "line") {
      const xs = sh.pts.map(q => q[0]), ys = sh.pts.map(q => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    if (sh.k === "rect") return [sh.x, sh.y, sh.x + sh.w, sh.y + sh.h];
    if (sh.k === "circle" || sh.k === "arc" || sh.k === "half") return [sh.x - sh.r, sh.y - sh.r, sh.x + sh.r, sh.y + sh.r];
    if (sh.k === "text") return [sh.x - 5, sh.y - 3, sh.x + 5, sh.y + 1];
    if (sh.k === "raw") return rawShapeBB(sh);
    return null;
  };
  const clearMsel = () => { S.msel = { shapes: [], pins: [] }; };
  S.svg.addEventListener("mousemove", e => {
    const p = symEditXY(e);
    const g = S.tool === "pin" ? GRID : S.snap;
    const x = symSnap(p.x, g), y = symSnap(p.y, g);
    statusEl.textContent = `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`;
    moveCursor(x, y);
    if (S.marquee) {
      if (!(e.buttons & 1)) { S.marquee = null; }
      else { S.marquee.x1 = p.x; S.marquee.y1 = p.y; draw(); return; }
    }
    if (S.frameDrag) {
      if (!(e.buttons & 1)) { S.frameDrag = null; }
      else {
        // シンボル枠の角を引っぱってサイズ変更 (0.5mm スナップ・最小 2mm)
        const o = S.frameDrag.orig, hd = S.frameDrag.handle;
        const rx = symSnap(p.x, 0.5), ry = symSnap(p.y, 0.5);
        let x0 = o[0], y0 = o[1], x1 = o[0] + o[2], y1 = o[1] + o[3];
        if (hd.includes("w")) x0 = Math.min(rx, x1 - 2);
        if (hd.includes("e")) x1 = Math.max(rx, x0 + 2);
        if (hd.includes("n")) y0 = Math.min(ry, y1 - 2);
        if (hd.includes("s")) y1 = Math.max(ry, y0 + 2);
        const r1 = v => Math.round(v * 10) / 10;
        S.frame = [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)];
        draw(); return;
      }
    }
    if (S.moving) {
      if (!(e.buttons & 1)) { S.moving = null; }        // svg 外でボタンを離した後の迷子ドラッグを防ぐ
      else {
        const m = S.moving;
        // 端子が混ざるときは端子のグリッドに合わせる (別々のスナップだと形が崩れる)
        const mg = m.multi ? (m.targets.some(t => t.pi >= 0) ? GRID : S.snap) : (m.pi >= 0 ? GRID : S.snap);
        const dx = symSnap(p.x - m.px, mg), dy = symSnap(p.y - m.py, mg);
        if (dx || dy || m.pushed) {
          if (!m.pushed) { push(); m.pushed = true; }   // 最初に動いた時点で1回だけ undo を積む
          const apply = (t2) => {
            const t = t2.pi >= 0 ? S.pins[t2.pi] : S.shapes[t2.i], o = t2.orig;
            if (!t) return;
            if (o.k === "line") t.pts = o.pts.map(q => [q[0] + dx, q[1] + dy]);
            else if (o.k === "raw") { t.dx = (o.dx || 0) + dx; t.dy = (o.dy || 0) + dy; }
            else { t.x = o.x + dx; t.y = o.y + dy; }    // rect/circle/half/arc/text/端子は x,y 起点
          };
          if (m.multi) m.targets.forEach(apply); else apply(m);
          draw();
        }
        return;
      }
    }
    if (!S.draft) return;
    const d = S.draft;
    if (d.k === "line") { d.pts = [...d.fixed, [x, y]]; }
    else if (d.k === "rect") { d.x = Math.min(d.ax, x); d.y = Math.min(d.ay, y); d.w = Math.abs(x - d.ax); d.h = Math.abs(y - d.ay); }
    else if (d.k === "circle") { d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y)); }
    else if (d.k === "half") {
      d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y));
      const dx = x - d.x, dy = y - d.y;                 // 動かした向きの側を残す
      d.dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "down" : "up");
    }
    else if (d.k === "arc") {
      if (d.step === 1) d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y));
      else {
        // カーソルを回した向き・量に弧を追従させる (円・半円と同じ手応えで短い側から伸びる)
        const a = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI;
        let del = a - (d.prevA != null ? d.prevA : d.baseA);
        del = ((del % 360) + 540) % 360 - 180;          // 最短方向の角度差
        d.acc = Math.max(-359.9, Math.min(359.9, (d.acc || 0) + del));
        d.prevA = a;
        d.a0 = d.baseA + Math.min(0, d.acc);            // 描画・確定は a0→a1 の時計回りに正規化
        d.a1 = d.baseA + Math.max(0, d.acc);
      }
    }
    draw();
  });
  S.svg.addEventListener("mouseleave", hideCursor);
  /* innerHTML の描き直し後は mouseleave が落ちないことがある (ホバー連鎖が
     切れるため)。文書全体の move でキャンバス外を検知して確実に消す */
  const onDocMove = (e) => { if (S.cursorPos && !S.svg.contains(e.target)) hideCursor(); };
  document.addEventListener("mousemove", onDocMove, true);
  // ドラッグ (押しながら動かして離す) でも図形を確定できるようにする。
  // クリック2回で描く従来の操作もそのまま使える。
  S.svg.addEventListener("mousedown", e => {
    // ドラッグ中の再描画で要素が入れ替わると click が発火せず suppressClick が残るため、
    // 新しい押下の時点で必ずリセットする (前の操作の click はこの mousedown より先に来ている)
    S.suppressClick = false;
    S.lastNudgeAt = 0;   // マウス操作で微調整の連打まとめを打ち切る (undo の粒度を守る)
    S.downAt = { x: e.clientX, y: e.clientY };
    if (S.pendingInsert) return;                 // 挿入待ち: click 側で配置する
    if (S.draft) return;
    if (S.tool === "select") {
      const p = symEditXY(e);
      // シンボル枠 (青) の角ハンドル → 枠のサイズ変更
      if (S.shapes.length || S.pins.length) {
        const fb = S.frame ?? symShapesBounds(S.shapes, S.pins);
        const corners = [[fb[0], fb[1], "nw"], [fb[0] + fb[2], fb[1], "ne"], [fb[0], fb[1] + fb[3], "sw"], [fb[0] + fb[2], fb[1] + fb[3], "se"]];
        // 当たり判定は描いている青い四角 (1.3mm) と同じ感覚に絞る。
        // 広くすると、角の近くから始める範囲選択ドラッグが枠リサイズに化ける
        const hc = corners.find(c => Math.abs(c[0] - p.x) < 0.9 && Math.abs(c[1] - p.y) < 0.9);
        if (hc) { S.frameDrag = { handle: hc[2], orig: [...fb] }; return; }
      }
      const pi = S.pins.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < 2);
      const i = pi >= 0 ? -1 : hitShape(p.x, p.y);
      if (pi < 0 && i < 0) {
        // 空白から押した → 範囲選択を始める
        S.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        return;
      }
      // まとめ選択の中をつまんだ → 選択したものを全部一緒に動かす
      const inMsel = (pi >= 0 && S.msel.pins.includes(pi)) || (i >= 0 && S.msel.shapes.includes(i));
      if (inMsel) {
        S.moving = {
          multi: true, px: p.x, py: p.y, pushed: false,
          targets: [
            ...S.msel.shapes.filter(ix => S.shapes[ix]).map(ix => ({ i: ix, pi: -1, orig: deepCopy(S.shapes[ix]) })),
            ...S.msel.pins.map(ix => ({ i: -1, pi: ix, orig: deepCopy(S.pins[ix]) })),
          ],
        };
        return;
      }
      // 単独でつまむ → そのままドラッグで移動 (mousemove 側で追従)
      clearMsel();
      S.sel = pi >= 0 ? -2 - pi : i;
      const t = pi >= 0 ? S.pins[pi] : S.shapes[i];
      S.moving = { pi, i, px: p.x, py: p.y, orig: deepCopy(t), pushed: false };
      draw();
      return;
    }
    if (!["rect", "rectf", "circle", "half", "arc"].includes(S.tool)) return;
    const p = symEditXY(e);
    const x = symSnap(p.x, S.snap), y = symSnap(p.y, S.snap);
    S.draft = (S.tool === "rect" || S.tool === "rectf")
      ? { k: "rect", ax: x, ay: y, x, y, w: 0, h: 0, style: S.style, fill: S.tool === "rectf" || S.fill }
      : S.tool === "half"
        ? { k: "half", x, y, r: 0.5, dir: "right", style: S.style, fill: S.fill }
        : S.tool === "arc"
          ? { k: "arc", x, y, r: 0.5, a0: 0, a1: 90, step: 1, style: S.style }
          : { k: "circle", x, y, r: 0.5, style: S.style, fill: S.fill };
    S.draftFromDown = true;      // この直後の click は1点目なので読み飛ばす
    // ここで再描画すると mousedown と mouseup の対象要素が変わり click が出なくなる。
    // 作画中の図形は次の mousemove で描かれるので、ここでは描き直さない。
  });
  S.svg.addEventListener("mouseup", e => {
    if (S.marquee) {
      // 範囲選択を確定。触れている図形・端子をまとめて選ぶ
      const q = S.marquee; S.marquee = null; S.downAt = null;
      const x0 = Math.min(q.x0, q.x1), x1 = Math.max(q.x0, q.x1);
      const y0 = Math.min(q.y0, q.y1), y1 = Math.max(q.y0, q.y1);
      if (x1 - x0 > 1 || y1 - y0 > 1) {
        const shapes = [], pins = [];
        S.shapes.forEach((sh, i) => {
          const b = shapeBBox(sh);
          if (b && b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0) shapes.push(i);
        });
        S.pins.forEach((pn, i) => {
          if (pn.x >= x0 - 0.5 && pn.x <= x1 + 0.5 && pn.y >= y0 - 0.5 && pn.y <= y1 + 0.5) pins.push(i);
        });
        S.msel = { shapes, pins }; S.sel = -1;
        S.suppressClick = true;
        const n = shapes.length + pins.length;
        UI.setMsg(n ? `${n} 個を選択しました (つまんでドラッグで一緒に移動 / Del で削除)` : "範囲内に図形がありません");
      }
      draw(); return;
    }
    if (S.frameDrag) {
      S.frameDrag = null; S.downAt = null; S.suppressClick = true;
      draw(); return;
    }
    if (S.moving) {
      if (S.moving.pushed) S.suppressClick = true;      // 動かした後の click で選択を奪い直さない
      S.moving = null; S.downAt = null;
      return;
    }
    const d0 = S.downAt; S.downAt = null;
    if (!d0 || !S.draft) return;
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < 4) return;   // ドラッグしていない (クリック操作に任せる)
    S.draftFromDown = false;
    if (S.draft.k === "arc") {
      // ドラッグで中心→半径を決めた場合: 離した点を弧の開始として角度指定へ進む
      const d = S.draft;
      if (d.step === 1) {
        const p = symEditXY(e);
        const x = symSnap(p.x, S.snap), y = symSnap(p.y, S.snap);
        d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y));
        d.baseA = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI;
        d.a0 = d.a1 = d.baseA; d.acc = 0; d.prevA = d.baseA; d.step = 2; draw();
        // suppressClick は立てない: 直後の click は step2 の「角度ゼロは確定しない」ガードが無害化する
      }
      return;
    }
    if (S.draft.k === "line") return;                  // 折れ線は多点なのでクリック操作
    S.suppressClick = true;
    const d = S.draft;
    push();
    if (d.k === "rect") { if (d.w > 0.2 && d.h > 0.2) S.shapes.push({ k: "rect", x: d.x, y: d.y, w: d.w, h: d.h, style: d.style, fill: d.fill }); }
    else if (d.k === "circle") { if (d.r > 0.2) S.shapes.push({ k: "circle", x: d.x, y: d.y, r: d.r, style: d.style, fill: d.fill }); }
    else if (d.k === "half") { if (d.r > 0.2) S.shapes.push({ k: "half", x: d.x, y: d.y, r: d.r, dir: d.dir, style: d.style, fill: d.fill }); }
    S.draft = null; draw();
  });
  S.svg.addEventListener("click", e => {
    if (S.suppressClick) { S.suppressClick = false; return; }
    if (S.draftFromDown) { S.draftFromDown = false; return; }   // 押した時点で1点目を取っている
    const p = symEditXY(e);
    const g = S.tool === "pin" ? GRID : S.snap;
    const x = symSnap(p.x, g), y = symSnap(p.y, g);
    if (S.pendingInsert) {
      // 「シンボルを挿入…」で選んだ記号を、クリックした位置 (5mm グリッド) へ置く
      const ins = S.pendingInsert; S.pendingInsert = null;
      push();
      const bx = symSnap(p.x, GRID), by = symSnap(p.y, GRID);
      const i0 = S.shapes.length, p0 = S.pins.length;
      ins.shapes.forEach(sh => { const c = deepCopy(sh); moveShape(c, bx, by); S.shapes.push(c); });
      ins.pins.forEach(pn => S.pins.push({ x: pn.x + bx, y: pn.y + by, n: pn.n }));
      S.msel = { shapes: S.shapes.map((_, i2) => i2).slice(i0), pins: S.pins.map((_, i2) => i2).slice(p0) };
      S.sel = -1;
      const t0 = SYMEDIT_TOOLS.find(x2 => x2[0] === S.tool);
      hintEl.textContent = t0 ? t0[2] : "";
      fitCanvas(); draw();
      UI.setMsg(`「${ins.name}」を挿入しました (図形 ${ins.shapes.length}・端子 ${ins.pins.length}) — そのままドラッグで動かせます`);
      return;
    }
    if (S.tool === "select") {
      // スナップ前の座標で当たり判定する (mousedown のつまみ判定と一致させる)
      const i = hitShape(p.x, p.y);
      const pi = S.pins.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < 2);
      S.sel = pi >= 0 ? -2 - pi : i;
      clearMsel();  // クリックでの選択は単独に戻す
      draw(); return;
    }
    if (S.tool === "pin") {
      push();
      S.pins.push({ x, y, n: String(S.pins.length + 1) });
      draw(); return;
    }
    if (S.tool === "conn") { openConnDialog(x, y); return; }
    if (S.tool === "text") {
      const t = prompt("記号の中に入れる文字 (例: M, 3~, PLC)", "");
      if (t && t.trim()) { push(); S.shapes.push({ k: "text", x, y, text: t.trim(), h: TEXT_H.normal, mono: false }); }
      draw(); return;
    }
    if (!S.draft) {
      if (S.tool === "line") S.draft = { k: "line", fixed: [[x, y]], pts: [[x, y]], style: S.style };
      else if (S.tool === "rect" || S.tool === "rectf") S.draft = { k: "rect", ax: x, ay: y, x, y, w: 0, h: 0, style: S.style, fill: S.tool === "rectf" || S.fill };
      else if (S.tool === "circle") S.draft = { k: "circle", x, y, r: 0.5, style: S.style, fill: S.fill };
      else if (S.tool === "half") S.draft = { k: "half", x, y, r: 0.5, dir: "right", style: S.style, fill: S.fill };
      else if (S.tool === "arc") S.draft = { k: "arc", x, y, r: 0.5, a0: 0, a1: 90, step: 1, style: S.style };
      draw(); return;
    }
    const d = S.draft;
    if (d.k === "line") { d.fixed.push([x, y]); d.pts = [...d.fixed]; draw(); return; }
    if (d.k === "arc") {
      if (d.step === 1) {
        d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y));
        d.baseA = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI;
        d.a0 = d.a1 = d.baseA; d.acc = 0; d.prevA = d.baseA; d.step = 2; draw(); return;
      }
      if (Math.abs(d.acc || 0) < 1) return;            // 角度が付くまで確定しない (ドラッグ直後の空クリックも無視)
      push(); S.shapes.push({ k: "arc", x: d.x, y: d.y, r: d.r, a0: d.a0, a1: d.a1, style: d.style });
      S.draft = null; draw(); return;
    }
    // rect / circle は2点目で確定
    push();
    if (d.k === "rect") { if (d.w > 0.2 && d.h > 0.2) S.shapes.push({ k: "rect", x: d.x, y: d.y, w: d.w, h: d.h, style: d.style, fill: d.fill }); }
    else if (d.k === "circle") { if (d.r > 0.2) S.shapes.push({ k: "circle", x: d.x, y: d.y, r: d.r, style: d.style, fill: d.fill }); }
    else if (d.k === "half") { if (d.r > 0.2) S.shapes.push({ k: "half", x: d.x, y: d.y, r: d.r, dir: d.dir, style: d.style, fill: d.fill }); }
    S.draft = null; draw();
  });
  S.svg.addEventListener("dblclick", () => { finishLine(); });
  const finishLine = () => {
    const d = S.draft;
    if (!d || d.k !== "line") return;
    if (d.fixed.length >= 2) { push(); S.shapes.push({ k: "line", pts: deepCopy(d.fixed), style: d.style }); }
    S.draft = null; draw();
  };

  // ── 選択の操作 (複製・コピー・回転) と既存シンボルの挿入 ──
  const moveShape = (sh, dx, dy) => {
    const r2 = v => Math.round(v * 100) / 100;
    if (sh.k === "line") sh.pts = sh.pts.map(q => [r2(q[0] + dx), r2(q[1] + dy)]);
    else if (sh.k === "raw") { sh.dx = r2((sh.dx || 0) + dx); sh.dy = r2((sh.dy || 0) + dy); }
    else { sh.x = r2(sh.x + dx); sh.y = r2(sh.y + dy); }
  };
  /** 図形が収まらなければ作画範囲を1段広げる */
  const fitCanvas = () => {
    const bd = symShapesBounds(S.shapes, S.pins);
    const need = Math.max(Math.abs(bd[0]), Math.abs(bd[1]), Math.abs(bd[0] + bd[2]), Math.abs(bd[1] + bd[3])) * 2 + 8;
    const want = [40, 60, 100, 160, 240, 320].find(v => v >= need) || 320;
    if (want > S.W) {
      S.W = S.H = want;
      S.svg.setAttribute("viewBox", `${-S.W / 2} ${-S.H / 2} ${S.W} ${S.H}`);
      const sz = body.querySelector("#seSize");
      if (sz) sz.value = String(want);
    }
  };
  const selIdx = () => {
    if (S.msel.shapes.length || S.msel.pins.length) return { s: [...S.msel.shapes], p: [...S.msel.pins] };
    if (S.sel >= 0) return { s: [S.sel], p: [] };
    if (S.sel <= -2) return { s: [], p: [-2 - S.sel] };
    return { s: [], p: [] };
  };
  const copySel = (silent) => {
    const { s, p } = selIdx();
    if (!s.length && !p.length) { UI.setMsg("コピーするものを選択してください (選択ツールでクリック / 範囲選択)"); return false; }
    S.clip = { shapes: s.map(i => deepCopy(S.shapes[i])).filter(Boolean), pins: p.map(i => deepCopy(S.pins[i])).filter(Boolean), n: 0 };
    if (!silent) UI.setMsg(`${s.length + p.length} 個をコピーしました (Ctrl+V で貼り付け)`);
    return true;
  };
  const pasteClip = () => {
    if (!S.clip || (!S.clip.shapes.length && !S.clip.pins.length)) { UI.setMsg("コピーしたものがありません (Ctrl+C でコピー)"); return; }
    push();
    S.clip.n++;
    const off = 5 * S.clip.n;
    const i0 = S.shapes.length, p0 = S.pins.length;
    S.clip.shapes.forEach(sh => { const c = deepCopy(sh); moveShape(c, off, off); S.shapes.push(c); });
    S.clip.pins.forEach(pn => S.pins.push({ x: pn.x + off, y: pn.y + off, n: pn.n }));
    S.msel = { shapes: S.shapes.map((_, i) => i).slice(i0), pins: S.pins.map((_, i) => i).slice(p0) };
    S.sel = -1;
    fitCanvas(); draw();
    UI.setMsg(`貼り付けました (+${off}mm) — そのままドラッグで動かせます`);
  };
  const dupSel = () => { if (copySel(true)) pasteClip(); };
  /** 選択 (無ければ全体) を 90° 時計回りに回転する。中心は対象の外接箱の
      中心を 5mm グリッドへ丸めた点 — 端子がグリッドから外れないように */
  const rotateSel = () => {
    const has = S.msel.shapes.length || S.msel.pins.length || S.sel !== -1;
    const idx = has ? selIdx() : { s: S.shapes.map((_, i) => i), p: S.pins.map((_, i) => i) };
    if (!idx.s.length && !idx.p.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    idx.s.forEach(i => {
      const b = S.shapes[i] && shapeBBox(S.shapes[i]);
      if (b) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    });
    idx.p.forEach(i => { const p = S.pins[i]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    if (!isFinite(x0)) return;
    const cx = symSnap((x0 + x1) / 2, GRID), cy = symSnap((y0 + y1) / 2, GRID);
    push();
    const R = (px, py) => [cx - (py - cy), cy + (px - cx)];      // 時計回り 90°
    const r2 = v => Math.round(v * 100) / 100;
    idx.s.forEach(i => {
      const sh = S.shapes[i];
      if (!sh) return;
      if (sh.k === "line") sh.pts = sh.pts.map(([px, py]) => R(px, py).map(r2));
      else if (sh.k === "rect") {
        const [nx, ny] = R(sh.x, sh.y + sh.h);
        sh.x = r2(nx); sh.y = r2(ny);
        const w0 = sh.w; sh.w = sh.h; sh.h = w0;
      } else if (sh.k === "arc") {
        const [nx, ny] = R(sh.x, sh.y);
        sh.x = r2(nx); sh.y = r2(ny); sh.a0 = r2(sh.a0 + 90); sh.a1 = r2(sh.a1 + 90);
      } else if (sh.k === "half") {
        const [nx, ny] = R(sh.x, sh.y);
        sh.x = r2(nx); sh.y = r2(ny);
        sh.dir = { right: "down", down: "left", left: "up", up: "right" }[sh.dir || "right"];
      } else if (sh.k === "raw") {
        const [nx, ny] = R(sh.dx || 0, sh.dy || 0);
        sh.dx = r2(nx); sh.dy = r2(ny); sh.rot = ((sh.rot || 0) + 90) % 360;
      } else {  // circle / text (文字は位置だけ回し、向きは水平のまま)
        const [nx, ny] = R(sh.x, sh.y);
        sh.x = r2(nx); sh.y = r2(ny);
      }
    });
    idx.p.forEach(i => { const p = S.pins[i]; const [nx, ny] = R(p.x, p.y); p.x = r2(nx); p.y = r2(ny); });
    fitCanvas(); draw();
    UI.setMsg(has ? "選択を 90° 回転しました" : "全体を 90° 回転しました");
  };
  const deleteSel = () => {
    if (S.msel.shapes.length || S.msel.pins.length) {
      push();
      const rmS = new Set(S.msel.shapes.filter(i => S.shapes[i]));
      S.shapes = S.shapes.filter((_, i) => !rmS.has(i));
      const rmP = new Set(S.msel.pins);
      const remap = new Map(); let k2 = 0;
      S.pins.forEach((_, i) => { if (!rmP.has(i)) remap.set(i, k2++); });
      S.pins = S.pins.filter((_, i) => !rmP.has(i));
      S.funcs.forEach(f => { f.pins = (f.pins || []).map(v => (remap.has(v) ? remap.get(v) : null)); });
      S.funcs = S.funcs.filter(f => (f.pins || []).every(v => v != null));
      clearMsel(); S.sel = -1; draw();
      return true;
    }
    if (S.sel !== -1) {
      push();
      if (S.sel <= -2) S.pins.splice(-2 - S.sel, 1); else S.shapes.splice(S.sel, 1);
      S.sel = -1; draw();
      return true;
    }
    return false;
  };
  body.querySelector("#seDup").addEventListener("click", dupSel);
  body.querySelector("#seRot").addEventListener("click", rotateSel);

  /** 既存シンボルを作画へ挿入する (組み合わせて新しいシンボルを作る) */
  const openInsertDialog = () => {
    let q2 = "";
    const seen = new Set();
    const list0 = [...SYMBOLS, ...DB_SYMBOLS]
      .filter(s => seen.has(s.id) ? false : (seen.add(s.id), true))
      .filter(s => !s.unitSheet && s.id !== S.editingId);   // 結線図の下地と編集中の自分は除く
    const ib = h(`<div>
      <div class="side-search" style="margin:0 0 10px">
        <svg viewBox="0 0 16 16" width="13" height="13"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input id="siSearch" placeholder="名称・図記号番号で検索…"/>
      </div>
      <div id="siGrid" class="wiz-cards" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));max-height:56vh;overflow:auto"></div>
    </div>`);
    const im = UI.openModal({ title: "シンボルの挿入", sub: "既存の図記号を作画へ取り込み、組み合わせて新しいシンボルを作れます", body: ib, wide: true });
    const renderIns = () => {
      const q3 = q2.toLowerCase();
      const list = list0.filter(s => !q3 || s.name.toLowerCase().includes(q3) || (s.nameEn || "").toLowerCase().includes(q3) || (s.jis || "").includes(q3));
      ib.querySelector("#siGrid").innerHTML = list.map(s => `
        <div class="wiz-card" data-ins="${s.id}" style="cursor:pointer">
          <div class="wc-thumb">${symThumbSVG(s, 40)}</div>
          <div class="wc-name">${s.name}</div>
        </div>`).join("") || '<div class="se-empty" style="padding:16px">該当する記号がありません</div>';
      ib.querySelectorAll("[data-ins]").forEach(c => c.addEventListener("click", () => {
        let src = symOf(c.dataset.ins);
        if (src.stretch) src = symStretchVariant(src, src.stretch.def);   // 寸法違いは既定寸法で

        const shapes = Array.isArray(src.shapes) && src.shapes.length ? deepCopy(src.shapes) : symBodyToShapes(src.body || "");
        S.pendingInsert = { shapes, pins: (src.pins || []).map(p => ({ x: p.x, y: p.y, n: p.n || "" })), name: src.name };
        im.close();
        S.tool = "select"; S.draft = null;
        toolsEl.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === "select"));
        hintEl.textContent = `「${src.name}」を挿入します — 置きたい位置をクリック (Esc で中止)`;
        UI.setMsg(`「${src.name}」を挿入します — 置きたい位置をクリックしてください`);
      }));
    };
    ib.querySelector("#siSearch").addEventListener("input", e => { q2 = e.target.value; renderIns(); });
    renderIns();
  };
  foot.querySelector("#seIns").addEventListener("click", openInsertDialog);

  /** 多極コネクタ (CN3 など) を1番ピンの位置から生成する */
  const openConnDialog = (x0, y0) => {
    const cb = h(`<div>
      <div class="prop-note" style="margin-top:0">
        クリックした位置が1番ピンです。端子は 5mm ピッチでグリッドに乗り、
        コネクタの山形と番号も一緒に描かれます。
      </div>
      <div class="prop-grid2">
        <div class="prop-row"><label>コネクタ名</label><input id="cnName" value="CN1" placeholder="CN3 / 電源コネクタ"/></div>
        <div class="prop-row"><label>極数</label><input id="cnN" class="mono" type="number" min="1" max="40" value="8"/></div>
        <div class="prop-row"><label>ピッチ (mm)</label><input id="cnP" class="mono" type="number" min="5" max="20" step="5" value="5"/></div>
        <div class="prop-row"><label>並び</label><select id="cnDir">
          <option value="down">下へ (配線は左・機器は右)</option>
          <option value="down_r">下へ (配線は右・機器は左)</option>
          <option value="right">右へ (配線は下・機器は上)</option>
        </select></div>
        <div class="prop-row"><label>開始番号</label><input id="cnStart" class="mono" value="1"/></div>
        <div class="prop-row"><label>種類</label><select id="cnKind">
          <option value="recept">レセプタクル (機器側)</option>
          <option value="plug">プラグ (ケーブル側)</option>
          <option value="term">端子台</option>
        </select></div>
      </div>
      <div class="prop-row"><label>信号名 (改行区切り・任意)</label></div>
      <textarea id="cnSig" rows="5" placeholder="L1&#10;L2&#10;L1C&#10;L2C&#10;NC&#10;PE" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:12px;padding:6px 8px;outline:none"></textarea>
      <div class="prop-note">信号名を入れると端子番号のかわりに使われます (部品表・接続リストに出ます)。</div>
    </div>`);
    const cf = h(`<div style="display:flex;gap:10px;width:100%">
      <span style="flex:1"></span>
      <button class="btn-solid" id="cnCancel">キャンセル</button>
      <button class="btn-solid primary" id="cnOk">配置</button>
    </div>`);
    const cm = UI.openModal({ title: "コネクタの配置", sub: "多極コネクタ・端子台をまとめて作ります", body: cb, foot: cf });
    cf.querySelector("#cnCancel").addEventListener("click", cm.close);
    cf.querySelector("#cnOk").addEventListener("click", () => {
      const q = sel => cb.querySelector(sel);
      const n = Math.max(1, Math.min(40, parseInt(q("#cnN").value, 10) || 1));
      const pitch = Math.max(5, parseInt(q("#cnP").value, 10) || 5);
      const dir = q("#cnDir").value, kind = q("#cnKind").value;
      const name = q("#cnName").value.trim();
      const startNo = parseInt(q("#cnStart").value, 10);
      const sigs = q("#cnSig").value.split(/\r?\n/).map(v => v.trim());
      cm.close();
      push();
      const vert = dir !== "right";
      // 機器の中身がある向き (配線と反対側)。ライブラリのコネクタ記号と同じ作法で、
      // 山形と端子番号を外形の内側に描く。
      const s2 = dir === "down" ? 1 : -1;          // +1 = 機器は右 / -1 = 機器は左
      const len = (n - 1) * pitch;
      for (let i = 0; i < n; i++) {
        const px = vert ? x0 : x0 + i * pitch;
        const py = vert ? y0 + i * pitch : y0;
        const label = sigs[i] || String((isNaN(startNo) ? 1 : startNo) + i);
        S.pins.push({ x: px, y: py, n: label });
        const num = String((isNaN(startNo) ? 1 : startNo) + i);
        if (vert) {
          S.shapes.push({ k: "line", pts: [[px, py], [px + s2 * 2.6, py]], style: "solid" });   // 引出線
          const a = px + s2 * (kind === "plug" ? 2.6 : 5.2), b2 = px + s2 * (kind === "plug" ? 5.2 : 2.6);
          if (kind === "term") S.shapes.push({ k: "circle", x: px + s2 * 4, y: py, r: 1.1, style: "solid" });
          else S.shapes.push({ k: "line", pts: [[a, py - 2.2], [b2, py], [a, py + 2.2]], style: "solid" });
          S.shapes.push({ k: "text", x: px + s2 * 9.4, y: py + 0.9, text: num, h: TEXT_H.small, mono: true });
        } else {
          S.shapes.push({ k: "line", pts: [[px, py], [px, py - 2.6]], style: "solid" });
          const a = py - (kind === "plug" ? 2.6 : 5.2), b2 = py - (kind === "plug" ? 5.2 : 2.6);
          if (kind === "term") S.shapes.push({ k: "circle", x: px, y: py - 4, r: 1.1, style: "solid" });
          else S.shapes.push({ k: "line", pts: [[px - 2.2, a], [px, b2], [px + 2.2, a]], style: "solid" });
          S.shapes.push({ k: "text", x: px, y: py - 8.6, text: num, h: TEXT_H.small, mono: true });
        }
      }
      // 外形と名称 (山形と番号を囲う)
      if (vert) {
        const bx = s2 > 0 ? x0 + 2 : x0 - 14.8;
        S.shapes.push({ k: "rect", x: bx, y: y0 - 4, w: 12.8, h: len + 8, style: "solid" });
        if (name) S.shapes.push({ k: "text", x: bx + 6.4, y: y0 - 6, text: name, h: TEXT_H.small, mono: true });
      } else {
        S.shapes.push({ k: "rect", x: x0 - 4, y: y0 - 14.8, w: len + 8, h: 12.8, style: "solid" });
        if (name) S.shapes.push({ k: "text", x: x0 + len / 2, y: y0 - 16.8, text: name, h: TEXT_H.small, mono: true });
      }
      draw();
      UI.setMsg(`コネクタ「${name || ""}」を ${n} 極で配置しました`);
    });
  };

  const onKey = (e) => {
    if (!document.body.contains(body)) return;
    // 入力欄で打っているときはショートカットを横取りしない (改行・削除が効かなくなる)
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" ||
      ae.tagName === "SELECT" || ae.isContentEditable);
    if (typing) return;
    if (e.key === "Enter") { finishLine(); e.stopPropagation(); e.preventDefault(); return; }
    // コピー・貼り付け・複製・回転
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { copySel(); e.stopPropagation(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) { if (copySel(true)) { deleteSel(); UI.setMsg("切り取りました (Ctrl+V で貼り付け)"); } e.stopPropagation(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { pasteClip(); e.stopPropagation(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { dupSel(); e.stopPropagation(); e.preventDefault(); return; }
    if (!e.ctrlKey && !e.metaKey && (e.key === "r" || e.key === "R")) { rotateSel(); e.stopPropagation(); e.preventDefault(); return; }
    // 矢印キーで選択中の図形・端子を微調整移動する
    // 図形のみ: 0.5mm (Shift で 5mm)。端子を含むときは 5mm グリッドを保つ
    const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (ARROWS[e.key] && !S.draft && (S.sel !== -1 || S.msel.shapes.length || S.msel.pins.length)) {
      const hasPin = S.sel <= -2 || S.msel.pins.length > 0;
      const step = hasPin ? GRID : (e.shiftKey ? 5 : 0.5);
      const dx = ARROWS[e.key][0] * step, dy = ARROWS[e.key][1] * step;
      const now = Date.now();
      if (!S.lastNudgeAt || now - S.lastNudgeAt > 800) push();  // 連打・長押しは1回の undo にまとめる
      S.lastNudgeAt = now;
      const mv = (t) => {
        if (!t) return;
        if (t.k === "line") t.pts = t.pts.map(q => [q[0] + dx, q[1] + dy]);
        else if (t.k === "raw") { t.dx = (t.dx || 0) + dx; t.dy = (t.dy || 0) + dy; }
        else { t.x += dx; t.y += dy; }             // rect/circle/half/arc/text/端子は x,y 起点
      };
      if (S.msel.shapes.length || S.msel.pins.length) {
        S.msel.shapes.forEach(i => mv(S.shapes[i]));
        S.msel.pins.forEach(i => mv(S.pins[i]));
      } else if (S.sel <= -2) mv(S.pins[-2 - S.sel]);
      else mv(S.shapes[S.sel]);
      draw(); e.stopPropagation(); e.preventDefault(); return;
    }
    if (e.key === "Escape") {
      // Esc は作画中の図形のキャンセルに使う (画面は閉じない)
      e.stopPropagation(); e.preventDefault();
      if (S.pendingInsert) {
        S.pendingInsert = null;
        const t0 = SYMEDIT_TOOLS.find(x2 => x2[0] === S.tool);
        hintEl.textContent = t0 ? t0[2] : "";
        UI.setMsg("挿入を中止しました");
      } else if (S.draft) { S.draft = null; S.draftFromDown = false; S.moving = null; S.marquee = null; draw(); UI.setMsg("作画をキャンセルしました"); }
      else if (S.sel !== -1 || S.msel.shapes.length || S.msel.pins.length) { S.sel = -1; clearMsel(); S.moving = null; S.marquee = null; S.frameDrag = null; draw(); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && deleteSel()) {
      e.stopPropagation(); e.preventDefault();
    }
  };
  document.addEventListener("keydown", onKey, true);

  // ── DXF の取り込み (作画図形として読み込み、そのまま編集できる) ──
  foot.querySelector("#seDxf").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".dxf,.DXF";
    inp.addEventListener("change", () => {
      const file = inp.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        let ents = [];
        try { ents = parseDXF(String(rd.result)); }
        catch (err) { alert("DXF の解析に失敗しました"); return; }
        if (!ents.length) { alert("図形が見つかりませんでした (対応: LINE / POLYLINE / CIRCLE / ARC / TEXT)"); return; }
        openDxfDialog(ents, file.name);
      };
      rd.readAsText(file, "utf-8");
    });
    inp.click();
  });
  /** 取り込みの倍率・線の太さを決めて図形に変換する */
  const openDxfDialog = (ents, fileName) => {
    const bb = dxfEntsBounds(ents);
    const w0 = Math.max(0.01, bb.x1 - bb.x0), h0 = Math.max(0.01, bb.y1 - bb.y0);
    const counts = {};
    ents.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const unresolved = ents.filter(e => e.unresolved).length;
    const db = h(`<div>
      <div class="prop-note" style="margin-top:0">
        <b>${escAttr(fileName)}</b> — 図形 ${ents.length} 個
        (${Object.entries(counts).map(([k2, v]) => `${k2} ${v}`).join(" / ")})<br>
        元の大きさ: ${w0.toFixed(1)} × ${h0.toFixed(1)} (図面単位)
        ${unresolved ? `<br><span style="color:var(--warn)">定義の無いブロック参照が ${unresolved} 個あります (省略します)</span>` : ""}
      </div>
      <div class="prop-grid2">
        <div class="prop-row"><label>倍率</label><select id="dsScale">
          <option value="1">1 : 1 (図面単位 = mm)</option>
          <option value="0.5">1 : 2 に縮小</option>
          <option value="0.25">1 : 4 に縮小</option>
          <option value="2">2 : 1 に拡大</option>
          <option value="fit">作画範囲に合わせる</option>
        </select></div>
        <div class="prop-row"><label>線の太さ</label><select id="dsLw">
          <option value="0.25">0.25 mm 細線 (DXF 取り込みの標準)</option>
          <option value="0.35">0.35 mm 中線</option>
          <option value="0.5">0.5 mm 太線</option>
        </select></div>
      </div>
      <div class="prop-row"><label class="chk"><input type="checkbox" id="dsClear"/><span>いま描いてある図形を消してから読み込む</span></label></div>
      <div class="prop-note">読み込んだ図形はそのまま編集できます。端子を置いて「ライブラリに登録」でシンボルになります。</div>
    </div>`);
    const df = h(`<div style="display:flex;gap:10px;width:100%">
      <span style="flex:1"></span>
      <button class="btn-solid" id="dsCancel">キャンセル</button>
      <button class="btn-solid primary" id="dsOk">読み込む</button>
    </div>`);
    const dm = UI.openModal({ title: "DXF の取り込み", sub: "作画図形として読み込みます", body: db, foot: df });
    df.querySelector("#dsCancel").addEventListener("click", dm.close);
    df.querySelector("#dsOk").addEventListener("click", () => {
      const sv = db.querySelector("#dsScale").value;
      const k = sv === "fit" ? Math.min((S.W - 10) / w0, (S.H - 10) / h0) : parseFloat(sv);
      const lw = parseFloat(db.querySelector("#dsLw").value) || LINE_W.thin;
      const clear = db.querySelector("#dsClear").checked;
      dm.close();
      push();
      if (clear) { S.shapes = []; S.pins = []; S.funcs = []; S.frame = null; S.msel = { shapes: [], pins: [] }; }
      const add = dxfEntsToShapes(ents, { scale: k });
      S.shapes.push(...add);
      S.lw = lw;
      const lwSel = body.querySelector("#seLw");
      if (lwSel) lwSel.value = String(lw);
      fitCanvas();                                     // 収まる作画範囲へ広げる
      S.tool = "select"; S.draft = null;
      toolsEl.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === "select"));
      draw();
      UI.setMsg(`DXF を読み込みました (図形 ${add.length} 個・線の太さ ${lw}mm)`);
    });
  };

  body.querySelector("#seFnAdd").addEventListener("click", () => {
    if (S.pins.length < 2) { alert("先に端子を2点以上置いてください (端子ツール / コネクタツール)"); return; }
    push();
    S.funcs.push({ kind: S.funcs.length ? "contact_no" : "coil", pins: [0, 1], name: "" });
    renderFuncs();
  });

  foot.querySelector("#seUndo").addEventListener("click", () => {
    const st = S.undo.pop();
    if (!st) return;
    S.shapes = st.shapes; S.pins = st.pins; S.funcs = st.funcs || []; S.draft = null; S.sel = -1; S.moving = null; S.marquee = null; S.frameDrag = null;
    S.msel = { shapes: [], pins: [] }; draw();
  });
  foot.querySelector("#seClear").addEventListener("click", () => {
    if (!confirm("作画した図形と端子をすべて消しますか？")) return;
    push(); S.shapes = []; S.pins = []; S.funcs = []; S.draft = null; S.sel = -1; S.frame = null;
    S.msel = { shapes: [], pins: [] }; draw();
  });
  foot.querySelector("#seCancel").addEventListener("click", m.close);

  foot.querySelector("#seOk").addEventListener("click", () => {
    const q = s => body.querySelector(s);
    const name = q("#seName").value.trim();
    if (!name) { alert("名称を入力してください"); q("#seName").focus(); return; }
    if (!S.shapes.length) { alert("図形が1つもありません。左のツールで作画してください"); return; }
    const bodySVG = symShapesToBody(S.shapes);
    const sim = q("#seSim").value;
    if (S.pins.length < 2 && sim !== "none" && !S.funcs.length) {
      if (!confirm("端子が2点未満です。回路の働きを設定しても通電計算はされません。\nこのまま登録しますか？")) return;
    }
    const dupName = [...SYMBOLS, ...DB_SYMBOLS].find(s => s.name === name && s.id !== S.editingId);
    if (dupName && !confirm(`「${name}」という名前のシンボルが既にあります。\nこのまま登録しますか？`)) return;

    const id = S.editingId || ("usr_" + uid("s"));
    const orig = S.editingId ? SYMBOLS_BY_ID[S.editingId] : null;
    const isStd = !!(orig && !orig.custom && !orig.imported) || !!(orig && orig.edited);  // 規格ライブラリの上書き
    const sym = {
      ...(orig || {}),                 // jis / stdNote / enclosure など元の付帯情報を引き継ぐ
      id, db: true,
      group: q("#seGroup").value.trim() || (orig && orig.group) || "自作",
      cat: orig ? (orig.cat || "db") : "db",
      letter: (q("#seLetter").value.trim() || "E").toUpperCase(),
      name, nameEn: q("#seNameEn").value.trim() || name,
      desc: q("#seDesc").value.trim() || "自作シンボル",
      typ: q("#seTyp").value.trim(),
      pins: S.pins.map((p, i) => ({ x: p.x, y: p.y, n: p.n || String(i + 1) })),
      sim: S.funcs.length ? "multi" : sim,
      lw: S.lw,
      funcs: S.funcs.length ? deepCopy(S.funcs) : undefined,
      bounds: S.frame ? [...S.frame] : symShapesBounds(S.shapes, S.pins),
      body: bodySVG,
      shapes: deepCopy(S.shapes),      // 再編集できるように図形一覧も保存する
      imported: true,                  // localStorage へ保存する対象
      custom: orig ? !!orig.custom : true,   // 自作 (シンボル作成で描いたもの)
      nonstd: orig ? !!orig.nonstd : true,   // 規格記号ではないことを明示
      edited: isStd || undefined,      // 規格記号の上書き (「自作シンボルの管理」で元に戻せる)
    };
    if (isStd) {
      // 規格ライブラリの記号を上書き: 元を控えてから全域 (パレット・図面) で置き換える
      symOverrideStd(sym);
    } else {
      const at = DB_SYMBOLS.findIndex(s => s.id === id);
      if (at >= 0) DB_SYMBOLS[at] = sym; else DB_SYMBOLS.push(sym);
      SYMBOLS_BY_ID[id] = sym;
    }
    _symRectCache.delete(id);   // 同一 id で body を再編集した場合に古い箱をラベル障害物に使わない
    saveImportedSymbols();
    syncProjectSymbols();
    if (symCatOf(sym) === "db") dbSetPinned([...new Set([...dbPinnedList(), id])]);
    UI.buildPalette();
    requestRender();
    m.close();
    UI.setMsg(isStd
      ? `シンボル「${name}」を上書きしました (「自作シンボルの管理」からいつでも元の規格図形に戻せます)`
      : `シンボル「${name}」を${S.editingId ? "更新" : "登録"}しました (左のライブラリに表示)`);
  });

  draw();
};

/** 自作シンボルの一覧から編集・削除する */
UI.manageCustomSymbols = () => {
  const list = () => DB_SYMBOLS.filter(s => s.custom || s.imported);
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      自作シンボル・DXF から取り込んだシンボル・規格記号の上書きの一覧です。<br>
      編集するとこのブラウザに保存され、図面にも埋め込まれます。上書きした規格記号は「元に戻す」で復元できます。
    </div>
    <div id="csRows" style="max-height:56vh;overflow:auto"></div>
  </div>`);
  const foot = h(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn-solid primary" id="csNew">新しいシンボルを作る…</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="csClose">閉じる</button>
  </div>`);
  const m = UI.openModal({ title: "自作シンボルの管理", sub: "作成・編集・削除", body, foot, wide: true });
  const render = () => {
    const rows = list();
    body.querySelector("#csRows").innerHTML = rows.length ? rows.map(s => `
      <div class="cs-row" data-id="${s.id}">
        <div class="cs-thumb">${symThumbSVG(s, 44)}</div>
        <div class="cs-info">
          <div class="cs-name">${escXML(s.name)}</div>
          <div class="cs-sub">${escXML(s.desc || "")} — 端子 ${(s.pins || []).length} 点 / ${s.edited ? "規格記号の上書き" : s.custom ? "自作" : "DXF取り込み"}</div>
        </div>
        <button class="btn-solid cs-edit" data-id="${s.id}">編集</button>
        <button class="btn-solid cs-del" data-id="${s.id}">${s.edited ? "元に戻す" : "削除"}</button>
      </div>`).join("") : '<div class="se-empty" style="padding:18px">まだありません</div>';
    body.querySelectorAll(".cs-edit").forEach(b => b.addEventListener("click", () => {
      m.close(); UI.openSymbolEditor(b.dataset.id);
    }));
    body.querySelectorAll(".cs-del").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.id;
      const sym0 = SYMBOLS_BY_ID[id];
      if (sym0 && sym0.edited) {
        // 規格記号の上書き: 削除ではなく元の規格図形へ復元する
        if (!confirm(`「${sym0.name}」を元の規格図形に戻しますか？`)) return;
        symRestoreStd(id);
        _symRectCache.delete(id);
        saveImportedSymbols();
        syncProjectSymbols();
        UI.buildPalette();
        requestRender();
        render();
        UI.setMsg(`「${SYMBOLS_BY_ID[id].name}」を元の規格図形に戻しました`);
        return;
      }
      const used = App.project.pages.some(pg => pg.devices.some(d => d.sym === id));
      if (used) { alert("この図面で使用中のシンボルは削除できません。先に機器を削除してください。"); return; }
      if (!confirm(`シンボル「${SYMBOLS_BY_ID[id].name}」を削除しますか？`)) return;
      const i = DB_SYMBOLS.findIndex(s => s.id === id);
      if (i >= 0) DB_SYMBOLS.splice(i, 1);
      delete SYMBOLS_BY_ID[id];
      dbSetPinned(dbPinnedList().filter(x => x !== id));
      saveImportedSymbols();
      UI.buildPalette();
      render();
    }));
  };
  render();
  foot.querySelector("#csNew").addEventListener("click", () => { m.close(); UI.openSymbolEditor(); });
  foot.querySelector("#csClose").addEventListener("click", m.close);
};
