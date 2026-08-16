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
  const f = contentScale();   // 線種は図面内容と同じ倍率
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
  const key = sym.id + "@" + contentScale();
  if (__dxfPrimCache.has(key)) return __dxfPrimCache.get(key);
  const prims = [];
  const src = scaleSymbolGeom(sym.body, contentScale());
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
    // 破線 (機械的結合・囲い・遮蔽) は導体と区別できるよう DXF でも線種を保つ
    const lt = attr(attrs, "stroke-dasharray") ? "DASHED" : null;
    if (tag === "path") {
      const d = attr(attrs, "d");
      if (d) dxfParsePath(d).forEach(poly => prims.push({ type: "poly", lt, pts: poly.map(p => [p[0] + ox, p[1] + oy]) }));
    } else if (tag === "rect") {
      const x = +attr(attrs, "x"), y = +attr(attrs, "y");
      const w = +attr(attrs, "width"), h = +attr(attrs, "height");
      prims.push({ type: "poly", lt, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(p => [p[0] + ox, p[1] + oy]) });
    } else if (tag === "circle") {
      prims.push({ type: "circle", lt, cx: +attr(attrs, "cx") + ox, cy: +attr(attrs, "cy") + oy, r: +attr(attrs, "r") });
    } else if (tag === "text") {
      // SVG の font-size は em 寸法。DXF の TEXT 高さ (group 40) は大文字高なので換算する
      const fam = (attr(attrs, "font-family") || "sans-serif").toLowerCase();
      const cap = fam.includes("mono") ? TEXT_CAP_MONO : fam.includes("serif") && !fam.includes("sans") ? TEXT_CAP_SERIF : TEXT_CAP;
      pendingText = {
        type: "text",
        x: +attr(attrs, "x") + ox, y: +attr(attrs, "y") + oy,
        size: +((+(attr(attrs, "font-size") || 5) * cap).toFixed(3)),
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
function dxfCircle(cx, cy, r, layer, ltype) {
  const p = [[0, "CIRCLE"], [8, layer]];
  if (ltype) p.push([6, ltype]);
  p.push([10, cx.toFixed(3)], [20, dxfY(cy)], [40, r.toFixed(3)]);
  return dxfEntity(p);
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
  const c = Math.cos(r), s = Math.sin(r), k = contentScale();   // 図記号は常に 1:1
  return (x, y) => [dev.x + (x * k) * c - (y * k) * s, dev.y + (x * k) * s + (y * k) * c];
}

/** 投影法の記号 (画面の projSymbolSVG と同一寸法) */
function dxfProjSymbol(x, y, u, proj) {
  if (proj === "該当なし (回路図)") return "";
  const first = proj === "第一角法";
  const big = 3 * u, smallR = 1.86 * u, cy = y + 3.6 * u;
  // 2つの投影図は 0.5mm 以上離す (円すい台の端面線が同心円を貫通しないように)
  const bx = x + (first ? 14.3 * u : 5.2 * u), sx = x + (first ? 5.2 * u : 14.3 * u);
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
function dxfMirrorTable(coilDev, S) {   // S には contentScale 版を渡す
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return "";
  const org = mirrorOrigin(coilDev);      // 位置は画面・検図と同じ探索結果を使う
  const x = org.x, y0 = org.y0, rowH = S(4.2), MAXROWS = 4;
  let out = dxfPoly([[coilDev.x, coilDev.y + S(20)], [x, y0 - S(1.5)]], "WIRENUM", "DASHED");
  contacts.slice(0, MAXROWS).forEach((c, i) => {
    const cy = y0 + i * rowH;
    const n0 = effectivePinName(c, 0), n1 = effectivePinName(c, 1);
    const csym = symOf(c.sym);
    // ミニ接点グリフ (b接点は横バーつき) — DXF だけ種別が分からなくならないように
    out += dxfPoly([[x, cy + S(1.5)], [x + S(2), cy + S(1.5)], [x + S(4.6), cy + S(-1.3)]], "WIRENUM");
    out += dxfPoly([[x + S(4.6), cy + S(1.5)], [x + S(5.4), cy + S(1.5)]], "WIRENUM");
    if (csym.sim === "contact_nc") out += dxfPoly([[x + S(2), cy + S(-1.3)], [x + S(4.6), cy + S(-1.3)]], "WIRENUM");
    const cols = mirrorCols(contacts);
    if (n0 && n1) out += dxfText(x + S(cols.pin), cy + S(2.3), S(TEXT_H.small), `${n0}\u00b7${n1}`, "WIRENUM");
    out += dxfText(x + S(cols.ref), cy + S(2.3), S(TEXT_H.small), "/" + devLocation(c), "WIRENUM");
  });
  if (contacts.length > MAXROWS) {
    out += dxfText(x, y0 + MAXROWS * rowH + S(2), S(TEXT_H.small), `+${contacts.length - MAXROWS}`, "WIRENUM");
  }
  return out;
}

/** 1ページ → DXF 文字列 */
function pageToDXF(page) {
  applySheet(page);          // ページごとの用紙・尺度
  let ents = "";
  const { w, h, margin: mg, marginLeft: ml, cols, rows } = SHEET;
  const meta = projectMeta();
  const pm = pageSheetMeta(page);   // 用紙・尺度はページ固有設定を優先
  const f = sheetScale();
  const S = v => v * f;                      // 図枠・表題欄用 (用紙実寸 mm → 作図領域 mm)
  const C = v => v * contentScale();         // 図面内容用 (常に 1:1)
  const [pw, ph] = PAPERS[pm.paper] || PAPERS.A3;

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
  tbCell(2, 0, "図面番号", pageDwgNo(page));
  tbCell(3, 0, "改訂", meta.rev || "0");
  tbCell(0, R, "設計 (署名)", meta.designer || "—");
  tbCell(1, R, "検図 (署名)", meta.checker || "—");
  tbCell(2, R, "日付", meta.date || todayStr());
  tbCell(3, R, "尺度", pm.scale || "1:1");
  tbCell(0, R * 2, "企業 (団体) 名", meta.author || "—");
  tbCell(1, R * 2, "用紙 / 投影法", `${pm.paper} / ${meta.proj || "第三角法"}`);
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
    if (z.label) ents += dxfText(z.x + C(2.5), z.y - C(1.8), C(TEXT_H.normal), z.label, "TEXT");
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
      ents += dxfText(mx, my, C(TEXT_H.small), wr.num, "WIRENUM", "middle", horiz ? 0 : 90);
    }
    if (wr.spec && wr.numShow !== false) {   // 線番と同じ代表1本にだけ表示する
      const [mx, my, horiz] = wireLabelPos(wr, page);
      ents += dxfText(horiz ? mx : mx + C(WIRE_SPEC_OFF), horiz ? my + C(4.6) : my, C(TEXT_H.small), wr.spec, "WIRENUM", "middle", horiz ? 0 : 90);
    }
  });
  junctionDots(page).forEach(([x, y]) => { ents += dxfCircle(x, y, C(LINE_W.thick * 1.5), "WIRE"); });

  // ── デバイス ──
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (!sym) return;
    const xf = dxfDevXform(dev);
    dxfSymPrimitives(sym).forEach(pr => {
      const lyr = pr.lt ? "AUXLINE" : "SYMBOL";      // 破線は補助線レイヤへ (導体と分離)
      if (pr.type === "poly") {
        ents += dxfPoly(pr.pts.map(p => xf(p[0], p[1])), lyr, pr.lt);
      } else if (pr.type === "circle") {
        const [cx, cy] = xf(pr.cx, pr.cy);
        ents += dxfCircle(cx, cy, pr.r, lyr, pr.lt);
      } else if (pr.type === "text") {
        // 記号内の文字は回転させない (JIS Z 8313-0: 文字は図面の下辺から読める向き)
        const [tx, ty] = xf(pr.x, pr.y);
        ents += dxfText(tx, ty, pr.size * contentScale(), pr.text, "SYMBOL", pr.anchor || "middle");
      }
    });
    // ピン番号 (画面と同じく回転後の絶対座標に水平で置く)
    sym.pins.forEach((p, pi) => {
      const vis = pinLabelVisible(page, dev, pi);
      if (!vis) return;
      const name = vis.name, abs = vis.abs;
      const rotated = (dev.rot || 0) % 360 !== 0;
      const isTop = !rotated && (p.y <= 0 || (sym.horizontalPins && p.y <= sym.bounds[1] + 2));
      const tx = abs.x + C(1), ty = rotated ? abs.y - C(1.6) : abs.y + (isTop ? C(3.4) : C(-1.6));
      ents += dxfText(tx, ty, C(TEXT_H.small), name, "PIN");
    });
    // タグ / 機能テキスト (配置は画面と同じ deviceLabelBoxes に従う)
    const b = devBounds(dev);
    const lboxes = deviceLabelBoxes(page, dev);
    lboxes.forEach(o => { ents += dxfText(o.x, o.y, o.size, o.text, "TEXT", o.anchor); });
    const xr = deviceXrefBox(page, dev);      // 位置は画面と同じ探索結果を使う
    if (xr) ents += dxfText(xr.x, xr.y, xr.size, xr.text, "WIRENUM");
    // コイル下の接点ミラー (画面と同じ内容・同じ寸法)
    if (sym.mirror) ents += dxfMirrorTable(dev, C);
  });

  // ── フリーテキスト ──
  page.texts.forEach(t => {
    ents += dxfText(t.x, t.y, textHeight(t) * contentScale(), t.text, "TEXT", t.anchor || "middle");
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
    "9", "$MEASUREMENT", "70", "1",
    "9", "$LTSCALE", "40", "1.0",
    "9", "$EXTMIN", "10", "0.0", "20", "0.0", "30", "0.0",
    "9", "$EXTMAX", "10", SHEET.w.toFixed(3), "20", SHEET.h.toFixed(3), "30", "0.0",
    "9", "$LIMMIN", "10", "0.0", "20", "0.0",
    "9", "$LIMMAX", "10", SHEET.w.toFixed(3), "20", SHEET.h.toFixed(3),
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

/* ═══════════════════════════════════════════════════════════════
   DXF 取り込み (R12〜。LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC /
   TEXT / MTEXT / SOLID を読み、図面へ作図するか、シンボルとして登録する)
   ═══════════════════════════════════════════════════════════════ */

/** DXF 文字列 → エンティティ配列 (単位 mm)。
    LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / TEXT / MTEXT / SOLID に対応し、
    BLOCKS と INSERT (挿入点・尺度・回転) も展開する。 */
function parseDXF(text) {
  const src = String(text).replace(/\r\n?/g, "\n").split("\n");
  const pairs = [];
  for (let i = 0; i + 1 < src.length; i++) {
    const code = parseInt(src[i].trim(), 10);
    if (Number.isNaN(code) || src[i].trim() === "") continue;   // 空行・ずれから再同期する
    pairs.push([code, src[i + 1]]);
    i++;
  }
  const unesc = t => String(t).replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "");

  /* 1) BLOCKS を集める */
  const blocks = {};
  let bi = 0, curBlockName = null, blockEnts = null;
  const sections = [];
  pairs.forEach(([c, v], k) => { if (c === 0 && v.trim() === "SECTION") sections.push(k); });
  const readEnts = (from, to, sink) => {
    let cur = null, curType = null, verts = null, inVertex = false, mtext = "";
    const push = () => {
      if (!cur || !curType) return;
      if (curType === "POLYLINE") cur.pts = verts || [];
      if (curType === "MTEXT" && mtext) cur.text = unesc(mtext);
      sink.push({ type: curType, ...cur });
      cur = null; curType = null; verts = null; inVertex = false; mtext = "";
    };
    for (let i = from; i < to; i++) {
      const [c, raw] = pairs[i];
      const v = raw.trim();
      if (c === 0) {
        if (v === "VERTEX" && curType === "POLYLINE") { inVertex = true; cur.__vx = null; cur.__vy = null; continue; }
        if (v === "SEQEND") { inVertex = false; continue; }
        push();
        curType = ["LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "TEXT", "MTEXT", "SOLID", "INSERT"].includes(v) ? v : null;
        cur = curType ? { layer: "0", pts: [] } : null;
        if (curType === "POLYLINE") verts = [];
        continue;
      }
      if (!cur) continue;
      const num = parseFloat(v);
      switch (c) {
        case 8: cur.layer = v; break;
        case 2: if (curType === "INSERT") cur.blockName = v; break;
        case 1: if (curType === "MTEXT") mtext += raw; else cur.text = unesc(raw); break;
        case 3: if (curType === "MTEXT") mtext += raw; break;
        case 10:
          if (curType === "POLYLINE" && inVertex) { cur.__vx = num; }
          else if (curType === "LWPOLYLINE") cur.pts.push([num, null]);
          else cur.x1 = num;                      // POLYLINE ヘッダの 10/20 は常に 0 なので使わない
          break;
        case 20:
          if (curType === "POLYLINE" && inVertex) { cur.__vy = num; if (cur.__vx !== null) verts.push([cur.__vx, num]); }
          else if (curType === "LWPOLYLINE" && cur.pts.length) cur.pts[cur.pts.length - 1][1] = num;
          else cur.y1 = num;
          break;
        case 11: cur.x2 = num; break;
        case 21: cur.y2 = num; break;
        case 40: cur.r = num; cur.size = num; break;
        case 41: if (curType === "INSERT") cur.sx = num; break;
        case 42: if (curType === "INSERT") cur.sy = num; break;
        case 50: if (curType === "INSERT") cur.rot = num; else cur.a1 = num; break;
        case 51: cur.a2 = num; break;
        case 70: cur.flags = num; break;
        case 72: cur.hAlign = num; break;
        case 73: cur.vAlign = num; break;
        default: break;
      }
    }
    push();
  };
  // BLOCKS セクション
  const blkStart = pairs.findIndex(([c, v], k) => c === 2 && v.trim() === "BLOCKS" && pairs[k - 1] && pairs[k - 1][0] === 0);
  if (blkStart >= 0) {
    let i = blkStart + 1;
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c === 0 && v.trim() === "ENDSEC") break;
      if (c === 0 && v.trim() === "BLOCK") {
        let name = "", j = i + 1, bx = 0, by = 0;
        for (; j < pairs.length && !(pairs[j][0] === 0); j++) {
          if (pairs[j][0] === 2) name = pairs[j][1].trim();
          if (pairs[j][0] === 10) bx = parseFloat(pairs[j][1]);
          if (pairs[j][0] === 20) by = parseFloat(pairs[j][1]);
        }
        let end = j;
        while (end < pairs.length && !(pairs[end][0] === 0 && pairs[end][1].trim() === "ENDBLK")) end++;
        const sink = [];
        readEnts(j, end, sink);
        blocks[name] = { base: [bx, by], ents: sink };
        i = end + 1;
        continue;
      }
      i++;
    }
  }
  /* 2) ENTITIES を読む */
  const entStart = pairs.findIndex(([c, v], k) => c === 2 && v.trim() === "ENTITIES" && pairs[k - 1] && pairs[k - 1][0] === 0);
  const raw = [];
  if (entStart >= 0) {
    let end = entStart;
    while (end < pairs.length && !(pairs[end][0] === 0 && ["ENDSEC", "EOF"].includes(pairs[end][1].trim()))) end++;
    readEnts(entStart + 1, end, raw);
  } else {
    readEnts(0, pairs.length, raw);
  }
  /* 3) INSERT を展開 (1段のみ入れ子も展開する) */
  const out = [];
  const place = (ents, ox, oy, sx, sy, rot, depth) => {
    const c = Math.cos(rot * Math.PI / 180), s2 = Math.sin(rot * Math.PI / 180);
    const T = (x, y) => [ox + (x * sx) * c - (y * sy) * s2, oy + (x * sx) * s2 + (y * sy) * c];
    ents.forEach(e => {
      if (e.type === "INSERT") {
        const b = blocks[e.blockName];
        if (!b || depth > 3) { out.push({ ...e, unresolved: !b }); return; }
        const [px, py] = T(e.x1 || 0, e.y1 || 0);
        place(b.ents.map(x => ({ ...x })), px - (b.base[0] || 0), py - (b.base[1] || 0),
          sx * (e.sx || 1), sy * (e.sy || 1), rot + (e.rot || 0), depth + 1);
        return;
      }
      const n = { ...e };
      if (n.x1 !== undefined && n.y1 !== undefined) { const [a, b2] = T(n.x1, n.y1); n.x1 = a; n.y1 = b2; }
      if (n.x2 !== undefined && n.y2 !== undefined) { const [a, b2] = T(n.x2, n.y2); n.x2 = a; n.y2 = b2; }
      if (n.pts && n.pts.length) n.pts = n.pts.map(p => (isFinite(p[0]) && isFinite(p[1])) ? T(p[0], p[1]) : p);
      if (n.r !== undefined) n.r = n.r * Math.abs(sx);
      if (n.size !== undefined) n.size = n.size * Math.abs(sy);
      out.push(n);
    });
  };
  place(raw, 0, 0, 1, 1, 0, 0);
  // 揃え指定つき TEXT は 11/21 (揃え点) が実位置
  out.forEach(e => {
    if ((e.type === "TEXT") && (e.hAlign || e.vAlign) && e.x2 !== undefined) { e.x1 = e.x2; e.y1 = e.y2; }
  });
  return out.filter(e => e.type !== "INSERT" || e.unresolved);
}

/** 取り込んだエンティティ群の外接矩形 (DXF 座標系) */
function dxfEntsBounds(ents) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (isFinite(x) && isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  ents.forEach(e => {
    if (e.type === "INSERT") return;                    // 定義が無いブロックは寸法に含めない
    if (e.type === "LINE") { add(e.x1, e.y1); add(e.x2, e.y2); }
    else if (e.type === "CIRCLE" || e.type === "ARC") { add(e.x1 - e.r, e.y1 - e.r); add(e.x1 + e.r, e.y1 + e.r); }
    else if (e.type === "TEXT" || e.type === "MTEXT") { add(e.x1, e.y1); add(e.x1 + textWidthMM(e.text || "", e.size || 3.5), e.y1 + (e.size || 3.5)); }
    else if (e.type === "SOLID") { [[e.x1, e.y1], [e.x2, e.y2]].forEach(([x, y]) => add(x, y)); }
    else (e.pts || []).forEach(p => add(p[0], p[1]));
  });
  if (!isFinite(x0)) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** エンティティ群 → SVG ボディ (ローカル座標。Y反転・原点合わせ・尺度指定) */
function dxfEntsToSVG(ents, opt = {}) {
  const b = dxfEntsBounds(ents);
  if (!b) return { body: "", w: 0, h: 0 };
  const k = opt.scale || 1;
  const ox = opt.originX !== undefined ? opt.originX : b.x0;
  const oy = opt.originY !== undefined ? opt.originY : b.y1;   // 上端を基準に Y 反転
  const X = x => +(((x - ox) * k).toFixed(3));
  const Y = y => +(((oy - y) * k).toFixed(3));
  let out = "";
  ents.forEach(e => {
    if (e.type === "INSERT") return;                    // 定義が無いブロックは描けない
    if (e.type === "LINE") out += `<path d="M${X(e.x1)},${Y(e.y1)} L${X(e.x2)},${Y(e.y2)}"/>`;
    else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const pts = (e.pts || []).filter(p => isFinite(p[0]) && isFinite(p[1]));
      if (pts.length >= 2) {
        const d = "M" + pts.map(p => `${X(p[0])},${Y(p[1])}`).join(" L") + ((e.flags & 1) ? " Z" : "");
        out += `<path d="${d}"/>`;
      }
    } else if (e.type === "CIRCLE") out += `<circle cx="${X(e.x1)}" cy="${Y(e.y1)}" r="${+(e.r * k).toFixed(3)}"/>`;
    else if (e.type === "ARC") {
      const r = e.r * k, a1 = (e.a1 || 0) * Math.PI / 180, a2 = (e.a2 || 0) * Math.PI / 180;
      const cx = X(e.x1), cy = Y(e.y1);
      const p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
      const p2 = [cx + r * Math.cos(a2), cy - r * Math.sin(a2)];
      let sweepAng = (e.a2 - e.a1 + 360) % 360;
      out += `<path d="M${p1[0].toFixed(3)},${p1[1].toFixed(3)} A${r.toFixed(3)},${r.toFixed(3)} 0 ${sweepAng > 180 ? 1 : 0} 0 ${p2[0].toFixed(3)},${p2[1].toFixed(3)}"/>`;
    } else if (e.type === "SOLID") {
      if (isFinite(e.x1) && isFinite(e.x2)) out += `<path d="M${X(e.x1)},${Y(e.y1)} L${X(e.x2)},${Y(e.y2)}"/>`;
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      const sz = Math.max(2.5, (e.size || 3.5) * k);
      out += `<text x="${X(e.x1)}" y="${Y(e.y1)}" font-size="${svgFontSize(sz)}" fill="currentColor" stroke="none" font-family="sans-serif">${escXML(e.text || "")}</text>`;
    }
  });
  return { body: out, w: b.w * k, h: b.h * k, bounds: b };
}
