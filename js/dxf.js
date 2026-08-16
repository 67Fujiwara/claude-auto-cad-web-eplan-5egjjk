/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — DXF エクスポータ (AutoCAD互換, R12 ASCII)
   図面モデル (デバイス/配線/テキスト/図枠) を 1ページ = 1 DXF に変換する。
   - 座標系: mm。DXF は Y 上向きのため Y を反転して出力
   - シンボルは SVG ボディ (path/rect/circle/text) を解析して LINE/POLYLINE/
     CIRCLE/TEXT に変換。円弧 (A コマンド) は折線近似
   - レイヤ: FRAME / WIRE / SYMBOL / TEXT / WIRENUM / PIN
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const DXF_LAYERS = ["FRAME", "FRAME_THIN", "WIRE", "AUXLINE", "SYMBOL", "TEXT", "WIRENUM", "PIN"];
/* R12 は線幅を持たないため、太さの区分はレイヤと色 (ペン) で伝える。
   FRAME=輪郭 0.7 / FRAME_THIN=区分線・仕切り 0.25 / WIRE=0.5 / AUXLINE=0.25 */

/* 線種テーブル (R12)。作図線を AutoCAD 側でも破線・一点鎖線として開くため */
const DXF_LTYPES = [
  { name: "CONTINUOUS", desc: "Solid line", pat: [] },
  { name: "DASHED", desc: "Dashed (JIS Z 8312 type 02)", pat: WIRE_STYLES.dash.dxf },
  { name: "DASHDOT", desc: "Long-dash dot (JIS Z 8312 type 04)", pat: WIRE_STYLES.dashdot.dxf },
  { name: "DIVIDE", desc: "Long-dash double-dot (JIS Z 8312 type 05)", pat: WIRE_STYLES.dashdotdot.dxf },
];
function dxfLtypeTable() {
  const f = sheetScale();   // 線種パターンも用紙上一定にする
  return DXF_LTYPES.map(lt0 => {
    const lt = { ...lt0, pat: lt0.pat.map(v => v * f) };
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
  const key = sym.id + "@" + sheetScale();
  if (__dxfPrimCache.has(key)) return __dxfPrimCache.get(key);
  const prims = [];
  const src = scaleSymbolGeom(sym.body, 1);
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
  __dxfPrimCache.set(key, prims);
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
/* 和文は DXF の Unicode エスケープ (\U+XXXX) で書き出す。R12 でも AutoCAD が
   解釈でき、コードページ設定に依存せず文字化けしない。 */
function dxfEscape(text) {
  let out = "";
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    out += c < 128 ? ch : "\\U+" + c.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}
function dxfText(x, y, size, text, layer, anchor = "start", angle = 0) {
  if (!text) return "";
  // 幅は CJK を全角として見積もる (画面と同じ textWidthMM を使う)
  const w = textWidthMM(String(text), size);
  const rad = angle * Math.PI / 180;
  const off = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
  const ax = x + off * Math.cos(rad);       // 回転後の基線方向へ寄せる
  const ay = y - off * Math.sin(rad);
  return dxfEntity([[0, "TEXT"], [8, layer], [7, "JP"], [10, ax.toFixed(3)], [20, dxfY(ay)],
    [40, size.toFixed(2)], [1, dxfEscape(text)], [50, angle]]);
}

/** デバイス座標変換 (回転 + 平行移動) */
function dxfDevXform(dev) {
  const r = (dev.rot || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), k = sheetScale();   // 図記号は尺度倍
  return (x, y) => [dev.x + (x * k) * c - (y * k) * s, dev.y + (x * k) * s + (y * k) * c];
}

/** 投影法の記号 (画面の projSymbolSVG と同一寸法) */
function dxfProjSymbol(x, y, u, proj) {
  if (proj === "該当なし (回路図)") return "";
  const first = proj === "第一角法";
  const big = 3 * u, smallR = 1.86 * u, cy = y + 3.6 * u;
  const bx = x + (first ? 11 * u : 3.4 * u), sx = x + (first ? 3.4 * u : 11 * u);
  let out = "";
  out += dxfPoly([[bx - big * 1.7, cy - big], [bx + big * 1.7, cy - smallR]], "FRAME_THIN");
  out += dxfPoly([[bx - big * 1.7, cy + big], [bx + big * 1.7, cy + smallR]], "FRAME_THIN");
  out += dxfLine(bx - big * 1.7, cy - big, bx - big * 1.7, cy + big, "FRAME_THIN");
  out += dxfLine(bx + big * 1.7, cy - smallR, bx + big * 1.7, cy + smallR, "FRAME_THIN");
  out += dxfCircle(sx, cy, big, "FRAME_THIN");
  out += dxfCircle(sx, cy, smallR, "FRAME_THIN");
  return out;
}

/** コイル下の接点ミラー表 (画面 mirrorSVG と同じ内容) */
function dxfMirrorTable(coilDev, S) {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return "";
  const csym0 = SYMBOLS_BY_ID[coilDev.sym];
  const wide = csym0.bounds[2] > 20;
  const x = wide ? coilDev.x - S(24) : coilDev.x + S(3);
  const y0 = coilDev.y + S(24), rowH = S(4.2), MAXROWS = 4;
  let out = dxfPoly([[coilDev.x, coilDev.y + S(20)], [x, y0 - S(1.5)]], "WIRENUM", "DASHED");
  contacts.slice(0, MAXROWS).forEach((c, i) => {
    const cy = y0 + i * rowH;
    const n0 = effectivePinName(c, 0), n1 = effectivePinName(c, 1);
    const csym = SYMBOLS_BY_ID[c.sym];
    // ミニ接点グリフ (b接点は横バーつき) — DXF だけ種別が分からなくならないように
    out += dxfPoly([[x, cy + S(1.5)], [x + S(2), cy + S(1.5)], [x + S(4.6), cy + S(-1.3)]], "WIRENUM");
    out += dxfPoly([[x + S(4.6), cy + S(1.5)], [x + S(5.4), cy + S(1.5)]], "WIRENUM");
    if (csym.sim === "contact_nc") out += dxfPoly([[x + S(2), cy + S(-1.3)], [x + S(4.6), cy + S(-1.3)]], "WIRENUM");
    if (n0 && n1) out += dxfText(x + S(8), cy + S(2.3), S(TEXT_H.small), `${n0}\u00b7${n1}`, "WIRENUM");
    out += dxfText(x + S(18), cy + S(2.3), S(TEXT_H.small), "/" + devLocation(c), "WIRENUM");
  });
  if (contacts.length > MAXROWS) {
    out += dxfText(x, y0 + MAXROWS * rowH + S(2), S(TEXT_H.small), `+${contacts.length - MAXROWS}`, "WIRENUM");
  }
  return out;
}

/** 1ページ → DXF 文字列 */
function pageToDXF(page) {
  let ents = "";
  const { w, h, margin: mg, marginLeft: ml, cols, rows } = SHEET;
  const meta = projectMeta();
  const f = sheetScale();
  const S = v => v * f;                      // 用紙実寸 mm → 作図領域 mm
  const [pw, ph] = PAPERS[meta.paper] || PAPERS.A3;

  // ── 輪郭線 (とじ代 20mm) + 中心マーク ──
  ents += dxfPoly([[ml, mg], [w - mg, mg], [w - mg, h - mg], [ml, h - mg], [ml, mg]], "FRAME");
  const cxm = w / 2, cym = h / 2, cm5 = S(5);   // 中心マークは用紙の対称軸上
  ents += dxfLine(cxm, 0, cxm, mg + cm5, "FRAME");
  ents += dxfLine(cxm, h, cxm, h - mg - cm5, "FRAME");
  ents += dxfLine(0, cym, ml + cm5, cym, "FRAME");
  ents += dxfLine(w, cym, w - mg - cm5, cym, "FRAME");
  // ── 格子参照 (列 1 から / 行 A から・I と O を除く) ──
  const cw = (w - ml - mg) / cols, rh = (h - 2 * mg) / rows;
  const fs = S(TEXT_H.normal), zw = S(5);
  for (let i = 0; i < cols; i++) {
    const cx = ml + cw * i + cw / 2;
    ents += dxfText(cx, mg - S(1.4), fs, String(i + 1), "FRAME", "middle");
    ents += dxfText(cx, h - mg + S(4.2), fs, String(i + 1), "FRAME", "middle");
    if (i) { ents += dxfLine(ml + cw * i, mg - zw, ml + cw * i, mg, "FRAME_THIN"); ents += dxfLine(ml + cw * i, h - mg, ml + cw * i, h - mg + zw, "FRAME_THIN"); }
  }
  for (let i = 0; i < rows; i++) {
    const cy = mg + rh * i + rh / 2 + S(1.3);
    const ch = SHEET_ROW_LETTERS[i] || "Z";
    ents += dxfText(ml - S(2.8), cy, fs, ch, "FRAME", "middle");
    ents += dxfText(w - mg + S(2.8), cy, fs, ch, "FRAME", "middle");
    if (i) { ents += dxfLine(ml - zw, mg + rh * i, ml, mg + rh * i, "FRAME_THIN"); ents += dxfLine(w - mg, mg + rh * i, w - mg + zw, mg + rh * i, "FRAME_THIN"); }
  }
  // ── 表題欄 (割付・文字高・縮小規則は画面と同一。engine の TITLE_BLOCK を使う) ──
  const tb = titleBlockRect();
  const tbX = tb.x, tbY = tb.y, tbW = tb.w, tbH = tb.h;
  const cwmm = TITLE_BLOCK.cols;
  const cxmm = [0, cwmm[0], cwmm[0] + cwmm[1], cwmm[0] + cwmm[1] + cwmm[2]];
  ents += dxfPoly([[tbX, tbY], [tbX + tbW, tbY], [tbX + tbW, tbY + tbH], [tbX, tbY + tbH], [tbX, tbY]], "FRAME");
  ents += dxfLine(tbX, tbY + S(TITLE_BLOCK.rowH), tbX + tbW, tbY + S(TITLE_BLOCK.rowH), "FRAME_THIN");
  ents += dxfLine(tbX, tbY + S(TITLE_BLOCK.rowH * 2), tbX + tbW, tbY + S(TITLE_BLOCK.rowH * 2), "FRAME_THIN");
  cxmm.slice(1).forEach(o => ents += dxfLine(tbX + S(o), tbY, tbX + S(o), tbY + tbH, "FRAME_THIN"));
  /* DXF はクリップできないため、欄に収まる文字高へ縮小し、それでも溢れる場合は
     末尾を「…」で切り詰めて隣の欄へはみ出させない (画面と同じ判定を使う) */
  const tbCell = (ci, ry, label, value) => {
    const cx = cxmm[ci], cwv = cwmm[ci] - 3.4;
    const size = fitTextSize(String(value), cwv, TEXT_H.normal);
    const text = truncateToWidth(String(value), cwv, size);
    ents += dxfText(tbX + S(cx) + S(2), tbY + S(ry) + S(3.6), S(TEXT_H.small), label, "FRAME");
    ents += dxfText(tbX + S(cx) + S(2), tbY + S(ry) + S(8.4), S(size), text, "TEXT");
  };
  const R = TITLE_BLOCK.rowH;
  tbCell(0, 0, "図名 (プロジェクト)", App.project.name);
  tbCell(1, 0, "ページ名", page.name);
  tbCell(2, 0, "図面番号", meta.dwgNo || "E-" + String(page.no).padStart(3, "0"));
  tbCell(3, 0, "改訂", meta.rev || "0");
  tbCell(0, R, "設計 (署名)", meta.designer || "—");
  tbCell(1, R, "検図 (署名)", meta.checker || "—");
  tbCell(2, R, "日付", meta.date || todayStr());
  tbCell(3, R, "尺度", meta.scale || "1:1");
  tbCell(0, R * 2, "企業 (団体) 名", meta.author || "—");
  tbCell(1, R * 2, "用紙 / 投影法", `${meta.paper} ${pw}\u00d7${ph} / ${meta.proj || "第三角法"}`);
  ents += dxfText(tbX + S(cxmm[2]) + S(2), tbY + S(R * 2) + S(3.6), S(TEXT_H.small), "ページ", "FRAME");
  ents += dxfText(tbX + S(cxmm[2]) + S(2), tbY + S(R * 2) + S(8.8), S(TEXT_H.large), `${page.no} / ${App.project.pages.length}`, "TEXT");
  ents += dxfProjSymbol(tbX + S(cxmm[3]) + S(2.5), tbY + S(R * 2) + S(2.4), S(1), meta.proj);

  // ── 改訂履歴欄 (画面と同じ寸法。管理図面に必須) ──
  const rev = revisionRect();
  if (rev) {
    const rows = revisionRows();
    const rh = S(REV_TABLE.rowH);
    const cols = [S(REV_TABLE.cols[0]), S(REV_TABLE.cols[1]),
      rev.w - S(REV_TABLE.cols[0]) - S(REV_TABLE.cols[1]) - S(REV_TABLE.cols[3]), S(REV_TABLE.cols[3])];  // 内容欄が残り
    const xs = [rev.x];
    cols.forEach(c => xs.push(xs[xs.length - 1] + c));
    ents += dxfPoly([[rev.x, rev.y], [rev.x + rev.w, rev.y], [rev.x + rev.w, rev.y + rev.h],
      [rev.x, rev.y + rev.h], [rev.x, rev.y]], "FRAME");
    for (let i = 1; i <= rows.length; i++) ents += dxfLine(rev.x, rev.y + rh * i, rev.x + rev.w, rev.y + rh * i, "FRAME_THIN");
    xs.slice(1, -1).forEach(x => ents += dxfLine(x, rev.y, x, rev.y + rev.h, "FRAME_THIN"));
    ["改訂", "日付", "内容", "承認"].forEach((t, i) => {
      ents += dxfText(xs[i] + S(1.6), rev.y + rh - S(1.6), S(TEXT_H.small), t, "FRAME");
    });
    rows.slice().reverse().forEach((r, ri) => {
      const y = rev.y + rh * (ri + 1);
      [r.rev, r.date, r.desc, r.appr].forEach((v, i) => {
        if (!v) return;
        const cwv = cols[i] / f - 3.2;
        const size = fitTextSize(String(v), cwv, TEXT_H.small);
        ents += dxfText(xs[i] + S(1.6), y + rh - S(1.6), S(size), truncateToWidth(String(v), cwv, size), "TEXT");
      });
    });
  }

  // ── 破線枠 (盤外エリア / グループ) ── 作図線なので AUXLINE に破線で出す
  (page.zones || []).forEach(z => {
    ents += dxfPoly([[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h], [z.x, z.y]], "AUXLINE", "DASHED");
    if (z.label) ents += dxfText(z.x + S(2.5), z.y - S(1.8), S(TEXT_H.normal), z.label, "TEXT");
  });

  // ── 配線 + ジャンクション + 線番 + 電線仕様 ──
  page.wires.forEach(wr => {
    // 作図線 (破線・一点鎖線) は AUXLINE レイヤに線種つきで出力する
    const lt = { dash: "DASHED", dashdot: "DASHDOT", dashdotdot: "DIVIDE" }[wr.style] || null;
    if (!isWireConductive(wr)) {
      ents += dxfPoly(wr.pts, "AUXLINE", lt || "DASHED");
      return;
    }
    ents += dxfPoly(wr.pts, "WIRE", lt);
    if (wr.num && wr.numShow !== false) {
      const [mx, my, horiz] = wireLabelPos(wr, page);
      ents += dxfText(horiz ? mx : mx - S(0.6), my, S(TEXT_H.small), wr.num, "WIRENUM", "middle", horiz ? 0 : 90);
    }
    if (wr.spec) {
      const [mx, my, horiz] = wireLabelPos(wr, page);
      ents += dxfText(horiz ? mx : mx + S(3.4), horiz ? my + S(4.6) : my, S(TEXT_H.small), wr.spec, "WIRENUM", "middle", horiz ? 0 : 90);
    }
  });
  junctionDots(page).forEach(([x, y]) => { ents += dxfCircle(x, y, S(LINE_W.thick * 1.5), "WIRE"); });

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
        ents += dxfText(tx, ty, pr.size * sheetScale(), pr.text, "SYMBOL", pr.anchor || "middle");
      }
    });
    // ピン番号 (画面と同じく回転後の絶対座標に水平で置く)
    sym.pins.forEach((p, pi) => {
      const vis = pinLabelVisible(page, dev, pi);
      if (!vis) return;
      const name = vis.name, abs = vis.abs;
      const rotated = (dev.rot || 0) % 360 !== 0;
      const isTop = !rotated && (p.y <= 0 || (sym.horizontalPins && p.y <= sym.bounds[1] + 2));
      const tx = abs.x + S(1), ty = rotated ? abs.y - S(1.6) : abs.y + (isTop ? S(3.4) : S(-1.6));
      ents += dxfText(tx, ty, S(TEXT_H.small), name, "PIN");
    });
    // タグ / 機能テキスト (配置は画面と同じ deviceLabelBoxes に従う)
    const b = devBounds(dev);
    const lboxes = deviceLabelBoxes(page, dev);
    lboxes.forEach(o => { ents += dxfText(o.x, o.y, o.size, o.text, "TEXT", o.anchor); });
    if (dev.linkTo) {
      const fd = findDevice(dev.linkTo);
      if (fd) {
        const right = lboxes.side === "right";
        const lx = right ? b.x + b.w + S(2.2) : b.x + b.w + S(1.6);
        const ly = right ? b.y + b.h / 2 + S((lboxes.length + 1) * 4) : b.y + b.h / 2 + S(1.2);
        ents += dxfText(lx, ly, S(TEXT_H.small), "/" + devLocation(fd.dev), "WIRENUM");
      }
    }
    // コイル下の接点ミラー (画面と同じ内容・同じ寸法)
    if (sym.mirror) ents += dxfMirrorTable(dev, S);
  });

  // ── フリーテキスト ──
  page.texts.forEach(t => {
    ents += dxfText(t.x, t.y, textHeight(t) * f, t.text, "TEXT", t.anchor || "middle");
  });

  // ── DXF 全体 (R12) ──
  /* R12 は線幅を持たないため、太さの区分は色番号 (ペン) で伝える。
     7=太線 0.5mm / 6=中間 / 8=細線 0.25mm / 5=輪郭 0.7mm */
  const LAYER_COLOR = { FRAME: 5, FRAME_THIN: 8, WIRE: 7, AUXLINE: 8, SYMBOL: 7, TEXT: 7, WIRENUM: 6, PIN: 8 };
  const layers = DXF_LAYERS.map(l =>
    dxfEntity([[0, "LAYER"], [2, l], [70, 0], [62, LAYER_COLOR[l] || 7], [6, "CONTINUOUS"]])).join("");
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "4",
    "9", "$DWGCODEPAGE", "3", "ANSI_932",
    "9", "$TEXTSTYLE", "7", "JP",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "STYLE", "70", "1",
    "0", "STYLE", "2", "JP", "70", "0", "40", "0.0", "41", "1.0", "50", "0.0",
    "71", "0", "42", "2.5", "3", "msgothic.ttc", "4", "",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LTYPE", "70", String(DXF_LTYPES.length),
  ].join("\n") + "\n" + dxfLtypeTable() +
    ["0", "ENDTAB", "0", "TABLE", "2", "LAYER", "70", String(DXF_LAYERS.length)].join("\n") + "\n" + layers +
    ["0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"].join("\n") + "\n" +
    ents +
    ["0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}
