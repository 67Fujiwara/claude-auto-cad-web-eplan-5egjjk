/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — DXF エクスポータ (AutoCAD互換, R12 ASCII)
   図面モデル (デバイス/配線/テキスト/図枠) を 1ページ = 1 DXF に変換する。
   - 座標系: mm。DXF は Y 上向きのため Y を反転して出力
   - シンボルは SVG ボディ (path/rect/circle/text) を解析して LINE/POLYLINE/
     CIRCLE/TEXT に変換。円弧 (A コマンド) は折線近似
   - レイヤ: FRAME / WIRE / SYMBOL / TEXT / WIRENUM / PIN
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const DXF_LAYERS = ["FRAME", "WIRE", "AUXLINE", "SYMBOL", "TEXT", "WIRENUM", "PIN"];

/* 線種テーブル (R12)。作図線を AutoCAD 側でも破線・一点鎖線として開くため */
const DXF_LTYPES = [
  { name: "CONTINUOUS", desc: "Solid line", pat: [] },
  { name: "DASHED", desc: "Dashed __ __ __ __", pat: [6.35, -3.175] },
  { name: "DASHDOT", desc: "Dash dot __ . __ . __", pat: [12.7, -6.35, 0, -6.35] },
];
function dxfLtypeTable() {
  return DXF_LTYPES.map(lt => {
    const total = lt.pat.reduce((s, v) => s + Math.abs(v), 0);
    const pairs = [[0, "LTYPE"], [2, lt.name], [70, 0], [3, lt.desc], [72, 65], [73, lt.pat.length], [40, total.toFixed(3)]];
    lt.pat.forEach(v => pairs.push([49, v.toFixed(3)]));
    return dxfEntity(pairs);
  }).join("");
}

/* ── SVGボディ → プリミティブ (シンボルごとにキャッシュ) ── */
const __dxfPrimCache = new Map();

function dxfParseNumbers(str) {
  return (str.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
}

/** SVG path d 属性 → 折線群 [[x,y],...] の配列 */
function dxfParsePath(d) {
  const polys = [];
  let cur = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const tokens = d.match(/[MmLlHhVvAaZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flush = () => { if (cur.length > 1) polys.push(cur); cur = []; };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case "M": flush(); x = num(); y = num(); sx = x; sy = y; cur = [[x, y]]; break;
      case "m": flush(); x += num(); y += num(); sx = x; sy = y; cur = [[x, y]]; break;
      case "L": x = num(); y = num(); cur.push([x, y]); break;
      case "l": x += num(); y += num(); cur.push([x, y]); break;
      case "H": x = num(); cur.push([x, y]); break;
      case "h": x += num(); cur.push([x, y]); break;
      case "V": y = num(); cur.push([x, y]); break;
      case "v": y += num(); cur.push([x, y]); break;
      case "A": case "a": {
        const rx = num(), ry = num(); num(); const laf = num(), sf = num();
        let ex = num(), ey = num();
        if (cmd === "a") { ex += x; ey += y; }
        // 端点パラメータ → 中心パラメータ (回転なし前提) → 12分割折線
        const pts = dxfArcToPoints(x, y, ex, ey, rx, ry, laf, sf);
        pts.forEach(p => cur.push(p));
        x = ex; y = ey;
        break;
      }
      case "Z": case "z": cur.push([sx, sy]); x = sx; y = sy; break;
      default: break; // 想定外トークンは無視
    }
  }
  flush();
  return polys;
}

/** SVG楕円弧の折線近似 (x軸回転なし) */
function dxfArcToPoints(x1, y1, x2, y2, rx, ry, laf, sf) {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  let l = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (l > 1) { const s = Math.sqrt(l); rx *= s; ry *= s; }
  const sign = laf === sf ? -1 : 1;
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx) / (rx * rx * dy * dy + ry * ry * dx * dx));
  const coef = sign * Math.sqrt(sq);
  const cxp = coef * (rx * dy) / ry, cyp = coef * -(ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  // 開始角/掃引角
  const t1 = ang(1, 0, (x1 - cx) / rx, (y1 - cy) / ry);
  let dt = ang((x1 - cx) / rx, (y1 - cy) / ry, (x2 - cx) / rx, (y2 - cy) / ry);
  if (!sf && dt > 0) dt -= 2 * Math.PI;
  if (sf && dt < 0) dt += 2 * Math.PI;
  const N = 12, pts = [];
  for (let k = 1; k <= N; k++) {
    const t = t1 + dt * (k / N);
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

/** シンボルボディ → プリミティブ配列 (ローカル座標) */
function dxfSymPrimitives(sym) {
  if (__dxfPrimCache.has(sym.id)) return __dxfPrimCache.get(sym.id);
  const prims = [];
  const src = sym.body;
  // <g transform="translate(a,b)"> の入れ子を追跡
  const stack = [{ tx: 0, ty: 0 }];
  const tagRe = /<(\/?)(g|path|rect|circle|text)\b([^>]*?)(\/?)>|<\/text>/g;
  const attr = (s, name) => {
    const m = new RegExp(name + '="([^"]*)"').exec(s);
    return m ? m[1] : null;
  };
  const translateOf = (s) => {
    const t = attr(s, "transform");
    if (!t) return { tx: 0, ty: 0, skip: false };
    const m = /translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)?\s*\)/.exec(t);
    const hasRotate = /rotate\(/.test(t);
    return { tx: m ? +m[1] : 0, ty: m && m[2] !== undefined ? +m[2] : 0, skip: hasRotate };
  };
  let m;
  let pendingText = null;
  let lastIndex = 0;
  while ((m = tagRe.exec(src))) {
    const [full, close, tag, attrs] = m;
    if (pendingText && full === "</text>") {
      pendingText.text = src.slice(lastIndex, m.index).replace(/<[^>]*>/g, "").trim();
      prims.push(pendingText);
      pendingText = null;
      continue;
    }
    const top = stack[stack.length - 1];
    if (tag === "g") {
      if (close) { if (stack.length > 1) stack.pop(); }
      else {
        const t = translateOf(attrs || "");
        stack.push({ tx: top.tx + t.tx, ty: top.ty + t.ty });
      }
      continue;
    }
    if (close) continue;
    const t = translateOf(attrs || "");
    if (t.skip) continue; // rotate付き要素は省略 (現行ライブラリでは未使用)
    const ox = top.tx + t.tx, oy = top.ty + t.ty;
    if (tag === "path") {
      const d = attr(attrs, "d");
      if (d) dxfParsePath(d).forEach(poly => prims.push({ type: "poly", pts: poly.map(p => [p[0] + ox, p[1] + oy]) }));
    } else if (tag === "rect") {
      const x = +attr(attrs, "x"), y = +attr(attrs, "y");
      const w = +attr(attrs, "width"), h = +attr(attrs, "height");
      prims.push({ type: "poly", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(p => [p[0] + ox, p[1] + oy]) });
    } else if (tag === "circle") {
      prims.push({ type: "circle", cx: +attr(attrs, "cx") + ox, cy: +attr(attrs, "cy") + oy, r: +attr(attrs, "r") });
    } else if (tag === "text") {
      pendingText = {
        type: "text",
        x: +attr(attrs, "x") + ox, y: +attr(attrs, "y") + oy,
        size: +(attr(attrs, "font-size") || 3.5),
        anchor: attr(attrs, "text-anchor") || "start",
      };
      lastIndex = tagRe.lastIndex;
    }
  }
  __dxfPrimCache.set(sym.id, prims);
  return prims;
}

/* ── DXF エンティティ生成 ── */
function dxfEntity(pairs) {
  return pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";
}
function dxfY(y) { return (SHEET.h - y).toFixed(3); }
function dxfLine(x1, y1, x2, y2, layer, ltype) {
  const pairs = [[0, "LINE"], [8, layer]];
  if (ltype && ltype !== "CONTINUOUS") pairs.push([6, ltype]);
  pairs.push([10, x1.toFixed(3)], [20, dxfY(y1)], [11, x2.toFixed(3)], [21, dxfY(y2)]);
  return dxfEntity(pairs);
}
function dxfPoly(pts, layer, ltype) {
  let out = "";
  for (let i = 0; i < pts.length - 1; i++) out += dxfLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], layer, ltype);
  return out;
}
function dxfCircle(cx, cy, r, layer) {
  return dxfEntity([[0, "CIRCLE"], [8, layer], [10, cx.toFixed(3)], [20, dxfY(cy)], [40, r.toFixed(3)]]);
}
function dxfText(x, y, size, text, layer, anchor = "start", angle = 0) {
  if (!text) return "";
  let ax = x;
  const w = String(text).length * size * 0.62;
  if (anchor === "middle") ax = x - w / 2;
  if (anchor === "end") ax = x - w;
  return dxfEntity([[0, "TEXT"], [8, layer], [10, ax.toFixed(3)], [20, dxfY(y)], [40, size.toFixed(2)], [1, String(text)], [50, angle]]);
}

/** デバイス座標変換 (回転 + 平行移動) */
function dxfDevXform(dev) {
  const r = (dev.rot || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return (x, y) => [dev.x + x * c - y * s, dev.y + x * s + y * c];
}

/** 1ページ → DXF 文字列 */
function pageToDXF(page) {
  let ents = "";
  const { w, h, margin: mg, cols, rows } = SHEET;

  // ── 図枠 ──
  ents += dxfPoly([[mg, mg], [w - mg, mg], [w - mg, h - mg], [mg, h - mg], [mg, mg]], "FRAME");
  ents += dxfPoly([[mg - 5, mg - 5], [w - mg + 5, mg - 5], [w - mg + 5, h - mg + 5], [mg - 5, h - mg + 5], [mg - 5, mg - 5]], "FRAME");
  const cw = (w - 2 * mg) / cols, rh = (h - 2 * mg) / rows;
  for (let i = 0; i < cols; i++) {
    const cx = mg + cw * i + cw / 2;
    ents += dxfText(cx, mg - 1.2, 3.4, String(i), "FRAME", "middle");
    ents += dxfText(cx, h - mg + 4, 3.4, String(i), "FRAME", "middle");
    if (i) { ents += dxfLine(mg + cw * i, mg - 5, mg + cw * i, mg, "FRAME"); ents += dxfLine(mg + cw * i, h - mg, mg + cw * i, h - mg + 5, "FRAME"); }
  }
  for (let i = 0; i < rows; i++) {
    const cy = mg + rh * i + rh / 2 + 1.2;
    const ch = String.fromCharCode(65 + i);
    ents += dxfText(mg - 2.6, cy, 3.4, ch, "FRAME", "middle");
    ents += dxfText(w - mg + 2.6, cy, 3.4, ch, "FRAME", "middle");
    if (i) { ents += dxfLine(mg - 5, mg + rh * i, mg, mg + rh * i, "FRAME"); ents += dxfLine(w - mg, mg + rh * i, w - mg + 5, mg + rh * i, "FRAME"); }
  }
  // ── 表題欄 ──
  const tbW = 150, tbH = 30, tbX = w - mg - tbW, tbY = h - mg - tbH;
  ents += dxfPoly([[tbX, tbY], [tbX + tbW, tbY], [tbX + tbW, tbY + tbH], [tbX, tbY + tbH], [tbX, tbY]], "FRAME");
  ents += dxfLine(tbX, tbY + 10, tbX + tbW, tbY + 10, "FRAME");
  ents += dxfLine(tbX, tbY + 20, tbX + tbW, tbY + 20, "FRAME");
  [52, 104, 126].forEach(o => ents += dxfLine(tbX + o, tbY, tbX + o, tbY + tbH, "FRAME"));
  ents += dxfText(tbX + 2, tbY + 8.2, 3.6, App.project.name, "TEXT");
  ents += dxfText(tbX + 54, tbY + 8.2, 3.6, page.name, "TEXT");
  ents += dxfText(tbX + 106, tbY + 8.2, 3.2, "E-" + String(page.no).padStart(3, "0"), "TEXT");
  ents += dxfText(tbX + 106, tbY + 28.6, 4.2, `${page.no} / ${App.project.pages.length}`, "TEXT");
  ents += dxfText(tbX + 2, tbY + 28, 3, "ElectraCAD Studio", "TEXT");

  // ── 破線枠 (盤外エリア / グループ) ──
  (page.zones || []).forEach(z => {
    ents += dxfPoly([[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h], [z.x, z.y]], "FRAME");
    if (z.label) ents += dxfText(z.x + 2.5, z.y - 1.8, 3.6, z.label, "TEXT");
  });

  // ── 配線 + ジャンクション + 線番 + 電線仕様 ──
  page.wires.forEach(wr => {
    // 作図線 (破線・一点鎖線) は AUXLINE レイヤに線種つきで出力する
    if (!isWireConductive(wr)) {
      ents += dxfPoly(wr.pts, "AUXLINE", wr.style === "dashdot" ? "DASHDOT" : "DASHED");
      return;
    }
    ents += dxfPoly(wr.pts, "WIRE");
    if (wr.num && wr.numShow !== false) {
      const [mx, my, horiz] = wireLabelPos(wr);
      ents += dxfText(horiz ? mx : mx - 0.6, my, 3, wr.num, "WIRENUM", "middle", horiz ? 0 : 90);
    }
    if (wr.spec) {
      const [mx, my, horiz] = wireLabelPos(wr);
      ents += dxfText(horiz ? mx : mx + 3.4, horiz ? my + 4.6 : my, 2.7, wr.spec, "WIRENUM", "middle", horiz ? 0 : 90);
    }
  });
  junctionDots(page).forEach(([x, y]) => { ents += dxfCircle(x, y, 1.05, "WIRE"); });

  // ── デバイス ──
  page.devices.forEach(dev => {
    const sym = SYMBOLS_BY_ID[dev.sym];
    if (!sym) return;
    const xf = dxfDevXform(dev);
    dxfSymPrimitives(sym).forEach(pr => {
      if (pr.type === "poly") {
        ents += dxfPoly(pr.pts.map(p => xf(p[0], p[1])), "SYMBOL");
      } else if (pr.type === "circle") {
        const [cx, cy] = xf(pr.cx, pr.cy);
        ents += dxfCircle(cx, cy, pr.r, "SYMBOL");
      } else if (pr.type === "text") {
        const [tx, ty] = xf(pr.x, pr.y);
        ents += dxfText(tx, ty, pr.size, pr.text, "SYMBOL", pr.anchor || "middle");
      }
    });
    // ピン番号
    sym.pins.forEach((p, pi) => {
      if (!p.n || dev.sym === "terminal") return;
      const name = effectivePinName(dev, pi);
      if (!name) return;
      const [px, py] = xf(p.x + 1, p.y + (p.y <= 0 ? 3.4 : -1.6));
      ents += dxfText(px, py, 2.5, name, "PIN");
    });
    // タグ / 機能テキスト / クロスリファレンス
    const b = devBounds(dev);
    const tag = displayTag(dev);
    const horizontal = (dev.rot || 0) % 180 !== 0;
    if (horizontal) {
      if (tag) ents += dxfText(b.x + b.w - 2.5, b.y - 2, 3.6, tag, "TEXT");
      if (dev.desc) ents += dxfText(b.x + b.w / 2, b.y + b.h + 4, 2.8, dev.desc, "TEXT", "middle");
    } else {
      if (tag) ents += dxfText(b.x - 2.2, b.y + b.h / 2 - 0.6, 3.6, tag, "TEXT", "end");
      if (dev.desc) ents += dxfText(b.x - 2.2, b.y + b.h / 2 + (tag ? 3.4 : 0.8), 2.8, dev.desc, "TEXT", "end");
    }
    if (dev.linkTo) {
      const f = findDevice(dev.linkTo);
      if (f) ents += dxfText(b.x + b.w + 1.6, b.y + b.h / 2 + 1.2, 3, "/" + devLocation(f.dev), "WIRENUM");
    }
  });

  // ── フリーテキスト ──
  page.texts.forEach(t => {
    ents += dxfText(t.x, t.y, t.size || 4, t.text, "TEXT", t.anchor || "middle");
  });

  // ── DXF 全体 (R12) ──
  const layers = DXF_LAYERS.map(l => dxfEntity([[0, "LAYER"], [2, l], [70, 0], [62, 7], [6, "CONTINUOUS"]])).join("");
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", String(DXF_LTYPES.length),
  ].join("\n") + "\n" + dxfLtypeTable() +
    ["0", "ENDTAB", "0", "TABLE", "2", "LAYER", "70", String(DXF_LAYERS.length)].join("\n") + "\n" + layers +
    ["0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"].join("\n") + "\n" +
    ents +
    ["0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}
