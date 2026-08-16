/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — コアエンジン
   データモデル / ネットリスト解析 / 通電シミュレーション / DRC / 部品表
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const GRID = 5;              // スナップグリッド 5mm
/* 作図領域。margin = 輪郭線の幅 c (JIS Z 8311)、marginLeft = とじ代側 (20mm) */
const SHEET = { w: 420, h: 297, margin: 10, marginLeft: 20, cols: 10, rows: 6, f: 1, paper: "A3", scale: "1:1" };

/* 線の太さ (JIS Z 8312 の太さ系列。細線:太線 = 1:2) — 用紙上の mm */
const LINE_W = { thick: 0.5, thin: 0.25, extra: 0.7 };
/* 文字高さ (JIS Z 8313-1 の標準列) — 用紙上の mm */
const TEXT_H = { small: 2.5, normal: 3.5, large: 5 };
/* 格子参照の行記号。JIS Z 8311 により I と O は使用しない */
const SHEET_ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
/* 格子参照の区分数 [列, 行] (JIS Z 8311 表2) */
const SHEET_DIVISIONS = { A0: [24, 16], A1: [16, 12], A2: [12, 8], A3: [8, 6], A4: [6, 4] };

/* 用紙 (横置き実寸 mm) と尺度。図面の作図領域は 用紙 × 尺度分母/分子 になる。
   例: A3 (420×297) を 1:2 で描くと作図領域は 840×594 となり、実物の
   2倍の範囲を1枚に収められる (印刷時は用紙サイズに縮小される)。 */
const PAPERS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
};
/* NS = 非尺度 (制御回路図の標準)。尺度は JIS Z 8314 の推奨尺度列 */
const SCALES = ["NS", "2:1", "1:1", "1:2", "1:5", "1:10", "1:20", "1:50", "1:100"];
function scaleFactor(scale) {
  if (scale === "NS") return 1;
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(scale || "1:1"));
  if (!m) return 1;
  const num = parseFloat(m[1]), den = parseFloat(m[2]);
  if (!(num > 0) || !(den > 0)) return 1;
  return den / num;
}
function projectMeta() {
  if (!App.project.meta) App.project.meta = {};
  const m = App.project.meta;
  if (!m.paper) m.paper = "A3";
  if (!m.scale) m.scale = "1:1";
  return m;
}
/** ページに適用される用紙・尺度 (ページ固有の設定があればそれを優先) */
function pageSheetMeta(page) {
  const m = projectMeta();
  const pg = page || (App.project.pages && App.project.pages[App.pageIdx]) || {};
  return { paper: pg.paper || m.paper, scale: pg.scale || m.scale };
}
/** meta (用紙・尺度) から作図領域 SHEET を再計算する (JIS Z 8311)。
    輪郭線の幅 c は A0・A1 = 20mm / A2〜A4 = 10mm、とじ代側 (左) は 20mm。
    格子参照の区分数は偶数とし、1区分が 25〜75mm に収まるようにする。 */
function applySheet(page) {
  const m = pageSheetMeta(page);
  const [pw, ph] = PAPERS[m.paper] || PAPERS.A3;
  const f = scaleFactor(m.scale);
  const c = (m.paper === "A0" || m.paper === "A1") ? 20 : 10;
  SHEET.paper = m.paper; SHEET.scale = m.scale; SHEET.f = f;
  SHEET.w = pw * f;
  SHEET.h = ph * f;
  SHEET.margin = c * f;
  SHEET.marginLeft = Math.max(20, c) * f;      // とじ代 20mm
  const div = SHEET_DIVISIONS[m.paper];
  if (div) { SHEET.cols = div[0]; SHEET.rows = div[1]; }
  else {                                       // 表にない用紙は 25〜75mm の偶数個に分ける
    const evenDiv = (len, target) => {
      let n = 2 * Math.max(1, Math.round(len / target / 2));
      while (n > 2 && len / n < 25) n -= 2;
      while (len / n > 75) n += 2;
      return n;
    };
    SHEET.cols = evenDiv(pw - c - Math.max(20, c), 50);
    SHEET.rows = evenDiv(ph - c * 2, 50);
  }
  return SHEET;
}
/** すべての図形座標を k 倍する (尺度変更で図面の見た目を保つため) */
function scaleProjectGeometry(k) {
  if (!(k > 0) || k === 1) return;
  const r = v => Math.round(v * k * 100) / 100;
  App.project.pages.forEach(pg => {
    pg.devices.forEach(d => { d.x = r(d.x); d.y = r(d.y); });
    pg.wires.forEach(w => { w.pts = w.pts.map(p => [r(p[0]), r(p[1])]); });
    pg.texts.forEach(t => { t.x = r(t.x); t.y = r(t.y); });
    pageZones(pg).forEach(z => { z.x = r(z.x); z.y = r(z.y); z.w = r(z.w); z.h = r(z.h); });
  });
}

/** いま張られている図枠の尺度倍率 (図枠・表題欄のみに掛ける) */
function sheetScale() { return SHEET.f || 1; }
/** 図記号・文字・線幅の倍率。ユーザー指定によりシンボルは常に 1:1 */
function contentScale() { return 1; }

/* 表題欄の割付 (用紙上 mm)。画面・DXF で必ず同じものを使う */
const TITLE_BLOCK = { w: 160, h: 30, rowH: 10, cols: [52, 44, 34, 30] };
const REV_TABLE = { rowH: 6, maxRows: 4, w: 120, cols: [16, 26, 0, 22] }; // cols[2]=残り

/** 表題欄の矩形 (作図領域座標)。図枠描画・DXF・DRC で共有する */
function titleBlockRect() {
  const f = sheetScale();
  const w = TITLE_BLOCK.w * f, h = TITLE_BLOCK.h * f;
  return { x: SHEET.w - SHEET.margin - w, y: SHEET.h - SHEET.margin - h, w, h };
}
/** 改訂履歴欄の矩形 (無ければ null)。
    表題欄の左隣 (同じ下段の帯) に置き、回路の作図領域を侵さないようにする。
    左に余地が無い小さな用紙では従来どおり表題欄の直上に積む。 */
function revisionRect() {
  const revs = revisionRows();
  if (!revs.length) return null;
  const f = sheetScale(), tb = titleBlockRect();
  const h = REV_TABLE.rowH * f * (revs.length + 1);
  const space = tb.x - SHEET.marginLeft;
  const w = Math.min(REV_TABLE.w * f, space);
  if (w >= 60 * f) return { x: tb.x - w, y: tb.y + tb.h - h, w, h, side: true };
  return { x: tb.x, y: tb.y - h, w: tb.w, h, side: false };
}
/** 表題欄と改訂履歴欄の矩形 (検図・試算で共有) */
function titleBlocksRects() {
  const out = [Object.assign(titleBlockRect(), { kind: "title" })];
  const rev = revisionRect();
  if (rev) out.push(Object.assign(rev, { kind: "rev" }));
  return out;
}
/** 線番ラベルの位置。最長区間の中点を基本とし、機器の図記号に重なる場合は
    同じ区間内で空いている位置へずらす (画面・DXF・検図で共有)。 */
function wireLabelPos(w, page) {
  const f = contentScale();
  const segs = [];
  for (let i = 0; i < w.pts.length - 1; i++) {
    const a = w.pts[i], b = w.pts[i + 1];
    segs.push({ a, b, len: Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) });
  }
  segs.sort((x, y) => y.len - x.len);
  const devs = page ? page.devices : [];
  const notes = page ? page.texts : [];
  // 障害物: 機器の図記号・注記・デバイスタグ/機能テキスト (線番が図記号に被らないように)
  const obst = [];
  devs.forEach(d => {
    obst.push(insetRect(devBounds(d), 1.5 * f));
    if (page) deviceLabelBoxes(page, d).forEach(o => obst.push(o.box));
  });
  (notes || []).forEach(t => obst.push(textBounds(t)));
  // 実際に印字される位置 → その文字の外接矩形 (検図・DXF と同じ式にそろえる)
  const posOf = (pt, horiz) => [pt[0] + (horiz ? 0 : -1.8 * f), pt[1] - 1.4 * f, horiz];
  const boxOf = (mx, my, horiz) => {
    const h = TEXT_H.small * f, wd = textWidthMM(String(w.num || ""), h);
    return horiz ? { x: mx - wd / 2, y: my - h, w: wd, h }
                 : { x: mx - h, y: my - wd / 2, w: h, h: wd };
  };
  let best = null;
  const consider = (pt, horiz) => {
    const res = posOf(pt, horiz);
    const bx = boxOf(res[0], res[1], horiz);
    let sc = 0;
    for (const r of obst) sc += overlapArea(bx, r);
    if (sc === 0) return res;
    if (!best || sc < best.sc) best = { sc, res };
    return null;
  };
  // 長い区間から順に、機器・注記・デバイスタグに当たらない位置を探す
  for (const sg of segs) {
    const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
    const at = t => [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
      const pt = at(t);
      const ok = consider(pt, horiz);
      if (ok) return ok;
    }
  }
  // どの区間にも空きが無い場合は、配線から法線方向へ離して逃がす
  const sg = segs[0] || { a: w.pts[0], b: w.pts[w.pts.length - 1] };
  const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
  const pt = [(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2];
  for (const off of [1.8, 4.5, 7, 9.5, -4.5, -7, -9.5]) {
    const cand = horiz ? [pt[0], pt[1] - (off - 1.8) * f] : [pt[0] - (off - 1.8) * f, pt[1]];
    const ok = consider(cand, horiz);
    if (ok) return ok;
  }
  // 全滅時は重なり面積が最小の候補 (無条件フォールバックはしない)
  return best ? best.res : posOf(pt, horiz);
}

/** ピン番号を表示するか (隣接配線の線番と同名なら二重表示を避ける)。
    画面・DXF で同じ判定を使う。 */
function pinLabelVisible(page, dev, pinIdx) {
  const sym = symOf(dev.sym);
  const p = sym.pins[pinIdx];
  if (!p || !p.n || dev.sym === "terminal") return null;
  const name = effectivePinName(dev, pinIdx);
  if (!name) return null;
  const abs = pinAbs(dev, p);
  const dup = page.wires.some(wr => wr.num === name &&
    wr.pts.some(pt => Math.abs(pt[0] - abs.x) < .01 && Math.abs(pt[1] - abs.y) < .01));
  return dup ? null : { name, abs, pin: p };
}

/** 機器ラベル (タグ・機能テキスト) の配置。左に置くと隣の機器へ被る場合は
    右側へ寄せる。画面描画と検図で同じ結果を使うためエンジンに置く。 */
/* デバイスタグ・機能テキストの配置
   ─ 他機器・端子番号・配線・確定済みの他ラベルを障害物として、
     機器の左→右→上→下の順に「干渉しなくなるまで機器側へ寄せて」置く。
     どこにも空きがない場合は重なり面積が最小の候補を採る (無条件フォールバック禁止)。
   ─ 配置はページ内で左→上の順に貪欲決定し、確定したラベルを順次障害物へ積む。 */
const _labelCache = new WeakMap();   // page → { rev, map }

/** ラベル配置以外の固定障害物 (機器の図記号・端子番号・配線・注記) を集める */
function labelObstacles(page) {
  const f = contentScale();
  const out = [];
  page.devices.forEach(d2 => {
    out.push({ owner: d2.id, ...insetRect(devBounds(d2), 1.2 * f) });
    const s2 = symOf(d2.sym);
    (s2.pins || []).forEach((p, pi) => {
      const vis = pinLabelVisible(page, d2, pi);
      if (!vis) return;
      const h = TEXT_H.small * f, w2 = textWidthMM(vis.name, h);
      const rotated = (d2.rot || 0) % 360 !== 0;
      const isTop = !rotated && (p.y <= 0 || (s2.horizontalPins && p.y <= s2.bounds[1] + 2));
      const ty = rotated ? vis.abs.y - 1.6 * f : vis.abs.y + (isTop ? 3.4 : -1.6) * f;
      out.push({ owner: d2.id, x: vis.abs.x + 1 * f, y: ty - h, w: w2, h });
    });
  });
  // 配線 (実線=導体のみ)。作図線はラベルを避ける対象にしない
  const wt = 0.6 * f;
  condWires(page).forEach(w => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x1, y1] = w.pts[i], [x2, y2] = w.pts[i + 1];
      out.push({
        owner: null,
        x: Math.min(x1, x2) - wt, y: Math.min(y1, y2) - wt,
        w: Math.abs(x2 - x1) + wt * 2, h: Math.abs(y2 - y1) + wt * 2,
      });
    }
  });
  (page.texts || []).forEach(t => {
    const h = (t.size || TEXT_H.normal) * f;
    out.push({ owner: null, x: t.x, y: t.y - h, w: textWidthMM(t.text || "", h), h });
  });
  return out;
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.05 && h > 0.05 ? w * h : 0;
}

/** 1機器ぶんのラベル配置を決める。obstacles は {x,y,w,h,owner} の配列 */
function placeDeviceLabels(page, dev, obstacles) {
  const sym = symOf(dev.sym);
  const f = contentScale();
  const b = devBounds(dev);
  const tag = displayTag(dev), desc = dev.desc;
  const horizontal = (dev.rot || 0) % 180 !== 0;
  const H = TEXT_H.normal * f;
  const mk = (text, x, y, anchor, isTag) => {
    const o = { text, x, y, w: textWidthMM(text, H), h: H, anchor, size: H, isTag: !!isTag };
    o.box = labelBox(o);
    return o;
  };
  const wrap = (arr, side) => { arr.side = side; return arr; };
  if (!tag && !desc) return wrap([], "left");

  // 候補の生成 ─ side ごとに機器へ寄せる段階を持つ
  const sideCand = (side, d) => {
    const out = [];
    if (side === "left" || side === "right") {
      const x = side === "left" ? b.x - d * f : b.x + b.w + d * f;
      const anchor = side === "left" ? "end" : "start";
      if (tag) out.push(mk(tag, x, b.y + b.h / 2 - 0.8 * f, anchor, true));
      if (desc) out.push(mk(desc, x, b.y + b.h / 2 + (tag ? 4 : 1) * f, anchor));
    } else if (side === "top") {
      const cx = b.x + b.w / 2, y = b.y - d * f;
      if (desc) out.push(mk(desc, cx, y - (tag ? 4 * f : 0), "middle"));
      if (tag) out.push(mk(tag, cx, y, "middle", true));
    } else {   // bottom
      const cx = b.x + b.w / 2, y = b.y + b.h + d * f;
      if (tag) out.push(mk(tag, cx, y, "middle", true));
      if (desc) out.push(mk(desc, cx, y + (tag ? 4 * f : 0), "middle"));
    }
    return wrap(out, side);
  };
  // 探索順: 横向き機器は上下優先、縦向き機器は左右優先。
  // ミラー表を持つコイルは右側を接点ミラーのために空けておき、最後に回す。
  const order = horizontal
    ? [["top", [2.0, 3.4, 5.4]], ["bottom", [4.4, 6.4, 8.4]], ["left", [2.2, 1.4, 0.8]], ["right", [2.2, 1.4, 0.8]]]
    : sym.mirror
      ? [["left", [2.2, 1.4, 0.8, 0.3]], ["top", [1.6, 5.0, 8.4]], ["bottom", [4.4, 7.8, 11.2]], ["right", [2.2, 1.4]]]
      : [["left", [2.2, 1.4, 0.8, 0.3]], ["right", [2.2, 1.4, 0.8, 0.3]], ["top", [1.6, 5.0, 8.4]], ["bottom", [4.4, 7.8, 11.2]]];

  const relevant = obstacles.filter(o => o.owner !== dev.id);
  let best = null;
  for (const [side, gaps] of order) {
    for (const d of gaps) {
      const cand = sideCand(side, d);
      let score = 0;
      for (const o of cand) for (const r of relevant) score += overlapArea(o.box, r);
      if (score === 0) return cand;
      if (!best || score < best.score) best = { cand, score };
    }
  }
  return best ? best.cand : sideCand("left", 2.2);   // 全滅時は重なり最小の候補
}

/** ページ内の全ラベルを左→上の順に貪欲配置し、確定ぶんを障害物へ積む */
function computePageLabels(page) {
  const base = labelObstacles(page);
  const placed = [];
  const map = new Map();
  const order = [...page.devices].sort((a, b) =>
    (a.x - b.x) || (a.y - b.y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  order.forEach(dev => {
    const boxes = placeDeviceLabels(page, dev, base.concat(placed));
    map.set(dev.id, boxes);
    boxes.forEach(o => placed.push({ owner: dev.id, ...o.box }));
  });
  return map;
}

function deviceLabelBoxes(page, dev) {
  const c = _labelCache.get(page);
  if (c && c.rev === App.labelRev) {
    const hit = c.map.get(dev.id);
    if (hit) return hit;
  }
  const map = computePageLabels(page);
  _labelCache.set(page, { rev: App.labelRev, map });
  return map.get(dev.id) || placeDeviceLabels(page, dev, labelObstacles(page));
}
function labelBox(o) {
  const x = o.anchor === "middle" ? o.x - o.w / 2 : o.anchor === "end" ? o.x - o.w : o.x;
  return { x, y: o.y - o.h, w: o.w, h: o.h };
}
/** 矩形を内側へ縮める (当たり判定の余白ぶんを外して実描画に近づける) */
function insetRect(r, d) {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - d * 2), h: Math.max(0, r.h - d * 2) };
}

/** 面積比 ratio 以上で重なっているか */
function rectsOverlap(a, b, ratio = 0) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return false;
  return !ratio || (ox * oy) > a.w * a.h * ratio;
}

/** 注記テキストの概算 bbox */
function textBounds(t) {
  const h = (t.size || TEXT_H.normal) * contentScale();
  const w = textWidthMM(t.text || "", h);
  const anchor = t.anchor || "middle";
  const x = anchor === "middle" ? t.x - w / 2 : anchor === "end" ? t.x - w : t.x;
  return { x, y: t.y - h, w, h: h * 1.25 };
}

/** 表示する改訂行 (新しい方から最大 maxRows 行) */
function revisionRows() {
  const revs = (projectMeta().revs || []).filter(r => r && (r.rev || r.date || r.desc || r.appr));
  return revs.slice(-REV_TABLE.maxRows);
}

/** 文字列の概算幅 (mm)。CJK は全角として数える */
function textWidthMM(s, size, bold = false) {
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
      (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) ||
      (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) ||
      (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x20000 && c <= 0x3FFFD);
    n += wide ? 1 : 0.58;
  }
  return n * size * (bold ? 1.05 : 1);
}
/** 欄幅に収まる文字高を求める (最小 2.5mm。それ以下は呼び出し側で切る) */
function fitTextSize(value, cellW, startSize, bold = false) {
  let size = startSize;
  while (size > TEXT_H.small && textWidthMM(value, size, bold) > cellW) size -= 0.25;
  return size;
}
/** 欄に収まらない文字列を末尾「…」で切り詰める (クリップできない DXF 用) */
function truncateToWidth(value, cellW, size, bold = false) {
  const s = String(value);
  if (textWidthMM(s, size, bold) <= cellW) return s;
  let out = s;
  while (out.length > 1 && textWidthMM(out + "…", size, bold) > cellW) out = out.slice(0, -1);
  return out + "…";
}
/** 線分 a-b が矩形 r と交差する (端点が内側の場合を含む) か。直交配線前提の簡易判定 */
function segCrossesRect(a, b, r) {
  const inside = p => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x0 <= r.x + r.w && x1 >= r.x && y0 <= r.y + r.h && y1 >= r.y;
}

/** 輪郭線の内側 (作図してよい範囲) */
function frameRect() {
  return { x: SHEET.marginLeft, y: SHEET.margin, w: SHEET.w - SHEET.marginLeft - SHEET.margin, h: SHEET.h - SHEET.margin * 2 };
}

const App = {
  project: null,
  pageIdx: 0,
  selection: new Set(),      // device/wire/text の id
  tool: "select",
  undoStack: [],
  redoStack: [],
  sim: { running: false, states: {}, energized: null, timers: {} },
  clipboard: null,
  labelRev: 0,               // ラベル配置キャッシュの世代 (commit / refresh で更新)
};

/* ══════════════ ユーティリティ ══════════════ */
let __uid = 1;
function uid(prefix = "e") { return prefix + (Date.now() % 1e7).toString(36) + (__uid++).toString(36); }
function snap(v) { return Math.round(v / GRID) * GRID; }
function ptKey(x, y) { return Math.round(x * 10) + "," + Math.round(y * 10); }
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

/* ══════════════ プロジェクト / ページ ══════════════ */
function newProject(name = "無題プロジェクト") {
  return {
    name,
    symbols: [],        // この図面が使う取り込みシンボルの定義 (自己完結させる)
    meta: {
      paper: "A3", scale: "1:1", dwgNo: "", rev: "0",
      designer: "", checker: "", date: todayStr(), author: "ElectraCAD Studio",
    },
    pages: [newPage("メイン回路", 1)],
  };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function newPage(name, no) {
  return { id: uid("p"), no, name, devices: [], wires: [], texts: [], zones: [] };
}
/** プロジェクトに同梱されたシンボル定義を辞書へ取り込む (読込・undo 後に呼ぶ) */
function mergeProjectSymbols() {
  const list = App.project && App.project.symbols;
  if (!Array.isArray(list)) return;
  list.forEach(sym => {
    if (!sym || !sym.id) return;
    SYMBOLS_BY_ID[sym.id] = sym;
    if (typeof DB_SYMBOLS !== "undefined" && !DB_SYMBOLS.some(x => x.id === sym.id)) DB_SYMBOLS.push(sym);
  });
}
/** 図面で実際に使われている取り込みシンボルをプロジェクトへ保存する */
function syncProjectSymbols() {
  if (!App.project) return;
  const used = new Set();
  App.project.pages.forEach(pg => pg.devices.forEach(d => used.add(d.sym)));
  const keep = [];
  used.forEach(id => {
    const sym = SYMBOLS_BY_ID[id];
    if (sym && sym.imported) keep.push(sym);
  });
  App.project.symbols = keep;
}

/** 旧データ互換: zones が無いページに追加 */
function pageZones(page) {
  if (!page.zones) page.zones = [];
  return page.zones;
}
function curPage() { return App.project.pages[App.pageIdx]; }

/* ══════════════ デバイス ══════════════ */
/* 定義が見つからないシンボル (取り込みシンボルを含む図面を別環境で開いた等) の
   代替。落とさずに「?」枠で描き、検図でエラーとして知らせる。 */
const MISSING_SYM = {
  id: "__missing", cat: "misc", letter: "", name: "未登録シンボル", nameEn: "Missing symbol",
  desc: "この図面が使うシンボル定義が見つかりません", pins: [{ x: 0, y: 0, n: "1" }, { x: 0, y: 20, n: "2" }],
  sim: "passthru", bounds: [-8, -2, 16, 24], missing: true,
  body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-7" y="4" width="14" height="12" stroke-dasharray="3 0.75" stroke-width="0.25"/>` +
    `<text x="0" y="12.6" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">?</text>`,
};
function symOf(symId) { return SYMBOLS_BY_ID[symId] || MISSING_SYM; }

/* 図記号・文字・線の太さは尺度によらず常に 1:1 で描く (シンボルの大きさは
   変えない)。尺度を変えると図枠 (用紙) だけが広くなり、1枚に収められる
   回路が増える。 */
function pinAbs(dev, pin) {
  const r = (dev.rot || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: dev.x + pin.x * c - pin.y * s, y: dev.y + pin.x * s + pin.y * c };
}
function devPins(dev) {
  const sym = symOf(dev.sym);
  return sym.pins.map((p, i) => ({ ...pinAbs(dev, p), name: p.n, idx: i }));
}
function devBounds(dev) {
  const sym = symOf(dev.sym);
  const [bx, by, bw, bh] = sym.bounds;
  const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]
    .map(([x, y]) => pinAbs(dev, { x, y }));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 全ページから letter の次の連番タグを生成 (-S1, -K3 …) */
function nextTag(letter) {
  let max = 0;
  const re = new RegExp("^-" + letter + "(\\d+)$");
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    const m = re.exec(d.tag || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }));
  return "-" + letter + (max + 1);
}

function addDevice(page, symId, x, y, opts = {}) {
  const sym = symOf(symId);
  const dev = {
    id: uid("d"), sym: symId, x: snap(x), y: snap(y), rot: opts.rot || 0,
    tag: opts.tag !== undefined ? opts.tag : (sym.letter ? nextTag(sym.letter) : ""),
    desc: opts.desc || "", typeRef: opts.typeRef !== undefined ? opts.typeRef : (sym.typ || ""), linkTo: opts.linkTo || null,
    props: opts.props || {},
  };
  page.devices.push(dev);
  return dev;
}

function findDevice(id) {
  for (const pg of App.project.pages) {
    const d = pg.devices.find(d => d.id === id);
    if (d) return { dev: d, page: pg };
  }
  return null;
}

/** デバイスの表示タグ (リンクされた補助接点は親コイルのタグを表示) */
function displayTag(dev) {
  if (dev.linkTo) {
    const f = findDevice(dev.linkTo);
    if (f) return f.dev.tag;
  }
  return dev.tag;
}

/** 格子参照の列番号 (クロスリファレンス "ページ.列"。JIS Z 8311: 左上を起点に 1 から) */
function sheetCol(x) {
  const inner = SHEET.w - SHEET.marginLeft - SHEET.margin;
  return Math.max(1, Math.min(SHEET.cols, Math.floor((x - SHEET.marginLeft) / (inner / SHEET.cols)) + 1));
}
/** 格子参照の行記号 (I・O を除く) */
function sheetRow(y) {
  const inner = SHEET.h - SHEET.margin * 2;
  const i = Math.max(0, Math.min(SHEET.rows - 1, Math.floor((y - SHEET.margin) / (inner / SHEET.rows))));
  return SHEET_ROW_LETTERS[i] || "Z";
}
/** このページに印字される図番 (表題欄・DXF・印刷で共通) */
function pageDwgNo(page) {
  return page.dwgNo || projectMeta().dwgNo || "E-" + String(page.no).padStart(3, "0");
}
function devLocation(dev) {
  const f = findDevice(dev.id);
  const pageNo = f ? f.page.no : "?";
  return pageNo + "." + sheetCol(dev.x);
}

/** コイルにリンクされた接点一覧 (接点ミラー / クロスリファレンス) */
function linkedContacts(coilDev) {
  const out = [];
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    if (d.linkTo === coilDev.id) out.push(d);
  }));
  return out;
}

/* ══════════════ ワイヤ ══════════════ */
/* 線種。solid のみが電気的な配線で、破線・一点鎖線は作図線 (作図補助・
   区画表現) として扱い、ネット解析・シミュレーション・DRC・線番・
   端子表・接続リストのいずれからも除外する。
   線の要素長さは JIS Z 8312 に従う (細線 d=0.25mm、破線=12d/3d、
   一点鎖線=24d/3d/点(0.5d)/3d)。dxf は同じ寸法の DXF LTYPE パターン。 */
const WIRE_STYLES = {
  solid:   { name: "実線 (配線)",                 dash: "",                     dxf: null },
  dash:    { name: "破線 (かくれ線・区画)",       dash: "3 0.75",               dxf: [3, -0.75] },
  dashdot: { name: "一点鎖線 (中心線・基準線)",   dash: "6 0.75 0.125 0.75",    dxf: [6, -0.75, 0, -0.75] },
  dashdotdot: { name: "二点鎖線 (想像線・隣接機器)", dash: "6 0.75 0.125 0.75 0.125 0.75", dxf: [6, -0.75, 0, -0.75, 0, -0.75] },
};
/* 導通するか。既定は「実線=配線 / それ以外=作図線」だが、w.aux を明示すれば
   線種と独立に指定できる (破線で描く盤外配線を回路として残す等)。 */
function isWireConductive(w) {
  if (w.aux !== undefined) return !w.aux;
  return !w.style || w.style === "solid";
}
/** 電気的に有効な (実線の) 配線だけを返す */
function condWires(page) { return page.wires.filter(isWireConductive); }

function addWire(page, pts, opts = {}) {
  // raw: グリッドに丸めない (DXF 取り込みなど、元図形の座標を保つ場合)
  const q = opts.raw ? (v => Math.round(v * 100) / 100) : snap;
  const wire = { id: uid("w"), pts: pts.map(p => [q(p[0]), q(p[1])]), num: opts.num || null };
  if (opts.style && opts.style !== "solid") wire.style = opts.style;
  // 長さ0の連続点を除去
  wire.pts = wire.pts.filter((p, i) => i === 0 || p[0] !== wire.pts[i - 1][0] || p[1] !== wire.pts[i - 1][1]);
  if (wire.pts.length < 2) return null;
  page.wires.push(wire);
  return wire;
}

/** 配線上へのシンボル後付け: ピンが載った配線をピン位置で分割し、
    デバイスの2ピン間に完全に挟まれた区間は削除する。
    (シンボル設置→配線 の流れと同じ見た目・接続になる) */
function spliceDeviceIntoWires(page, dev) {
  const pins = devPins(dev);
  // 1) 各ピンで配線を分割
  pins.forEach(pin => {
    for (let wi = page.wires.length - 1; wi >= 0; wi--) {
      const w = page.wires[wi];
      if (!isWireConductive(w)) continue; // 作図線は分割しない
      for (let i = 0; i < w.pts.length - 1; i++) {
        if (ptOnSeg(pin.x, pin.y, w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1])) {
          const ptsA = [...w.pts.slice(0, i + 1), [pin.x, pin.y]];
          const ptsB = [[pin.x, pin.y], ...w.pts.slice(i + 1)];
          const mk = pts => ({ id: uid("w"), pts, num: w.num, fixed: w.fixed, numShow: false, spec: w.spec, stub: w.stub });
          page.wires.splice(wi, 1, mk(ptsA), mk(ptsB));
          break;
        }
      }
    }
  });
  // 2) デバイスの2ピン間に一致する配線 (シンボルに隠れる区間) を削除
  const isPin = p => pins.some(pin => Math.abs(pin.x - p[0]) < .01 && Math.abs(pin.y - p[1]) < .01);
  page.wires = page.wires.filter(w => {
    if (!isWireConductive(w)) return true;
    const a = w.pts[0], b = w.pts[w.pts.length - 1];
    if (!isPin(a) || !isPin(b)) return true;
    if (Math.abs(a[0] - b[0]) < .01 && Math.abs(a[1] - b[1]) < .01) return false; // 零長
    // 直線1区間でピン→ピンなら本体に重なるため削除
    return w.pts.length > 2;
  });
}

function ptOnSeg(px, py, x1, y1, x2, y2) {
  const eps = 0.01;
  if (Math.abs(x1 - x2) < eps) { // 垂直
    return Math.abs(px - x1) < eps && py > Math.min(y1, y2) + eps && py < Math.max(y1, y2) - eps;
  }
  if (Math.abs(y1 - y2) < eps) { // 水平
    return Math.abs(py - y1) < eps && px > Math.min(x1, x2) + eps && px < Math.max(x1, x2) - eps;
  }
  return false;
}

/* ══════════════ ネットリスト解析 ══════════════
   Union-Find でページ内の電気的接続をまとめる。
   ノード = ワイヤ端点/角 + デバイスピン。
   ワイヤ区間は常に導通。デバイスは conductivePairs() に従う。      */
function UnionFind() {
  const parent = new Map();
  const find = k => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union, parent };
}

/**
 * デバイスが導通させるピンペア。
 * mode:
 *  - "sim":    シミュレーション状態に従う
 *  - "closed": 全接点を閉として扱う (DRC の到達性チェック用)
 *  - "open":   スイッチ要素はすべて開 (配線番号は接点を跨いで伝播しない)
 */
function conductivePairs(dev, mode = "closed") {
  const sym = symOf(dev.sym);
  switch (sym.sim) {
    case "contact_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1]] : [];
    case "contact_nc":
      if (mode === "open" || mode === "split") return [];
      if (mode === "sim") return simActiveState(dev) ? [] : [[0, 1]];
      return [[0, 1]];
    case "contact2_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1], [2, 3]] : [];
    case "contact3_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1], [2, 3], [4, 5]] : [];
    case "breaker":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1]];
    case "breaker2":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1], [2, 3]];
    case "breaker3":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1], [2, 3], [4, 5]];
    case "passthru":
      // 端子: 線番も通す。"split" は端子表用に両側を分離
      return mode === "split" ? [] : (sym.pins.length >= 2 ? [[0, 1]] : []);
    case "fuse":
      // ヒューズ: 導通するが線番は跨がない (実務では番号が変わる)
      return (mode === "open" || mode === "split") ? [] : [[0, 1]];
    case "passthru2":
      return (mode === "open" || mode === "split") ? [] : [[0, 1], [2, 3]];
    case "passthru3":
      // サーマルリレー主回路: 導通するが線番は跨がない (2L1 → U1)
      return (mode === "open" || mode === "split") ? [] : [[0, 1], [2, 3], [4, 5]];
    default: return []; // coil / load / trafo(絶縁) / source は導通しない(消費・供給)
  }
}

/** 電位リンクのタグから極性を判定 (+24V/L+ → P極, 0V/M/N → N極) */
function linkPolarity(dev) {
  const t = (dev.tag || "").replace(/^-/, "").toUpperCase();
  if (["+24V", "24V", "L+", "P24"].includes(t)) return "P";
  if (["0V", "M", "N", "-V", "GND"].includes(t)) return "N";
  return null;
}

/**
 * ページ間電位リンクの伝播: 同じタグの電位リンクは全ページで同一電位。
 * pagesData: [{ page, pinNet, pNets, nNets, acNets }]
 * いずれかのページでリンクのネットが P/N/AC なら、同タグ全リンクのネットにも付与。
 */
function propagateLinkGroups(pagesData) {
  const groups = new Map(); // tag → [{pd, net}]
  pagesData.forEach(pd => {
    pd.page.devices.forEach(dev => {
      if (symOf(dev.sym).sim !== "link" || !dev.tag) return;
      const net = pd.pinNet(dev, 0);
      if (!net) return;
      const key = dev.tag.replace(/^-/, "").toUpperCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ pd, net });
    });
  });
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    groups.forEach(list => {
      ["pNets", "nNets", "acNets"].forEach(kind => {
        const hot = list.some(({ pd, net }) => pd[kind].has(net));
        if (hot) list.forEach(({ pd, net }) => {
          if (!pd[kind].has(net)) { pd[kind].add(net); moved = true; }
        });
      });
    });
    if (!moved) break;
  }
}

/** 連動接点の実効端子番号: 同一コイル配下の n 番目の接点は 13/14 → n3/n4 に採番 */
function effectivePinName(dev, idx) {
  const sym = symOf(dev.sym);
  const base = sym.pins[idx] ? sym.pins[idx].n : "";
  if (!dev.linkTo || !/^[1-8][1-8]$/.test(base)) return base;
  const f = findDevice(dev.linkTo);
  if (!f) return base;
  const siblings = linkedContacts(f.dev).filter(c => /^[1-8][1-8]$/.test((symOf(c.sym).pins[0] || {}).n || ""));
  const pos = siblings.findIndex(c => c.id === dev.id);
  if (pos < 0) return base;
  return String(pos + 1) + base[1];
}

/**
 * ページのネットを計算。
 * @returns { uf, nodeNet: Map(ptKey→netRoot), wireNet: Map(wireId→netRoot), pinNet: (dev,pinIdx)→netRoot }
 */
function computeNets(page, mode = "closed") {
  const uf = UnionFind();
  const wires = condWires(page); // 作図線 (破線・一点鎖線) は導通しない
  // ワイヤ: 各区間の端点を union
  wires.forEach(w => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      uf.union(ptKey(w.pts[i][0], w.pts[i][1]), ptKey(w.pts[i + 1][0], w.pts[i + 1][1]));
    }
  });
  // T接続: ワイヤ端点が他ワイヤの区間中点に載る場合
  wires.forEach(w1 => {
    [w1.pts[0], w1.pts[w1.pts.length - 1]].forEach(ep => {
      wires.forEach(w2 => {
        if (w1 === w2) return;
        for (let i = 0; i < w2.pts.length - 1; i++) {
          if (ptOnSeg(ep[0], ep[1], w2.pts[i][0], w2.pts[i][1], w2.pts[i + 1][0], w2.pts[i + 1][1])) {
            uf.union(ptKey(ep[0], ep[1]), ptKey(w2.pts[i][0], w2.pts[i][1]));
          }
        }
      });
    });
  });
  // デバイスピン: ワイヤ区間の中間に載っているピンをその区間へ接続
  page.devices.forEach(dev => {
    devPins(dev).forEach(pin => {
      wires.forEach(w => {
        for (let i = 0; i < w.pts.length - 1; i++) {
          if (ptOnSeg(pin.x, pin.y, w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1])) {
            uf.union(ptKey(pin.x, pin.y), ptKey(w.pts[i][0], w.pts[i][1]));
          }
        }
      });
    });
  });
  // デバイスの導通ペア
  page.devices.forEach(dev => {
    const pins = devPins(dev);
    conductivePairs(dev, mode).forEach(([a, b]) => {
      if (pins[a] && pins[b]) uf.union(ptKey(pins[a].x, pins[a].y), ptKey(pins[b].x, pins[b].y));
    });
  });
  const pinNet = (dev, idx) => {
    const pins = devPins(dev);
    return pins[idx] ? uf.find(ptKey(pins[idx].x, pins[idx].y)) : null;
  };
  const wireNet = new Map();
  wires.forEach(w => wireNet.set(w.id, uf.find(ptKey(w.pts[0][0], w.pts[0][1]))));
  return { uf, pinNet, wireNet };
}

/** ワイヤ端点がデバイスピンに接続しているか (座標一致) */
function pinAtPoint(page, x, y) {
  for (const dev of page.devices) {
    for (const p of devPins(dev)) {
      if (Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01) return { dev, pin: p };
    }
  }
  return null;
}

/** ジャンクション(T接続)ドット位置の一覧 */
function junctionDots(page) {
  const dots = [];
  const endpointCount = new Map(); // 同一点に3本以上の端点が集まる場合
  const wires = condWires(page); // 作図線には接続ドットを打たない
  wires.forEach(w => {
    [w.pts[0], w.pts[w.pts.length - 1]].forEach(ep => {
      const k = ptKey(ep[0], ep[1]);
      endpointCount.set(k, (endpointCount.get(k) || 0) + 1);
      // 他ワイヤの区間中点に載る端点
      wires.forEach(w2 => {
        if (w === w2) return;
        for (let i = 0; i < w2.pts.length - 1; i++) {
          if (ptOnSeg(ep[0], ep[1], w2.pts[i][0], w2.pts[i][1], w2.pts[i + 1][0], w2.pts[i + 1][1])) {
            dots.push([ep[0], ep[1]]);
          }
        }
      });
    });
  });
  endpointCount.forEach((n, k) => {
    if (n >= 3) { const [x, y] = k.split(",").map(v => v / 10); dots.push([x, y]); }
  });
  return dots;
}

/* ══════════════ 配線番号の自動付与 ══════════════ */
function autoNumberWires() {
  // 全ページの予約語 (電位名・電位リンク名・手動固定線番) を先に集めておき、
  // 連番がそれらと衝突して同じ線番が2箇所に印字されるのを防ぐ
  const reserved = new Set();
  App.project.pages.forEach(page => {
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.sim === "psu") { reserved.add("+24V"); reserved.add("0V"); }
      if (sym.sim === "link" && dev.tag) reserved.add(dev.tag.replace(/^-/, ""));
    });
    condWires(page).forEach(w => { if (w.fixed && w.num) reserved.add(String(w.num)); });
  });
  let n = 10;
  const nextNum = () => { while (reserved.has(String(n))) n++; reserved.add(String(n)); return String(n++); };
  App.project.pages.forEach(page => {
    // "open" モード: 接点・コイルを跨いで番号が伝播しない (実務どおり区間ごとに採番)
    const { pinNet, wireNet } = computeNets(page, "open");
    const netNum = new Map();
    // 1) 電源系ネット・電位リンクには電位名を付ける
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.sim === "psu") {
        const pNet = pinNet(dev, 2), nNet = pinNet(dev, 3);
        if (pNet) netNum.set(pNet, "+24V");
        if (nNet) netNum.set(nNet, "0V");
      }
      if (sym.sim === "link" && dev.tag) {
        const net = pinNet(dev, 0);
        if (net) netNum.set(net, dev.tag.replace(/^-/, ""));
      }
    });
    // 2) 固定番号 (主回路の相名 L1/U1 等、手動で付けた線番) を尊重
    const wires = condWires(page); // 作図線には線番を付けない
    wires.forEach(w => {
      if (w.fixed && w.num) netNum.set(wireNet.get(w.id), w.num);
    });
    // 3) 残りに連番を振り、ネットごとに最長区間のワイヤ1本にだけラベルを表示
    const bestOfNet = new Map();
    wires.forEach(w => {
      const net = wireNet.get(w.id);
      if (!netNum.has(net)) netNum.set(net, nextNum());
      w.num = netNum.get(net);
      w.numShow = false;
      let maxSeg = 0;
      for (let i = 0; i < w.pts.length - 1; i++) {
        maxSeg = Math.max(maxSeg, Math.abs(w.pts[i + 1][0] - w.pts[i][0]) + Math.abs(w.pts[i + 1][1] - w.pts[i][1]));
      }
      const cur = bestOfNet.get(net);
      if (!cur || maxSeg > cur.maxSeg) bestOfNet.set(net, { w, maxSeg });
    });
    bestOfNet.forEach(({ w }) => { w.numShow = true; }); // 全ネット必ず1箇所は表示
  });
}

/* ══════════════ 通電シミュレーション ══════════════ */
function simActiveState(dev) {
  const sym = symOf(dev.sym);
  if (sym.sim === "contact_no" || sym.sim === "contact_nc" || sym.sim === "contact2_no" || sym.sim === "contact3_no") {
    if (dev.linkTo) {
      // コイル連動接点: タイマは遅延を考慮
      const t = App.sim.timers[dev.linkTo];
      if (t) return t.output;
      return !!App.sim.states[dev.linkTo];
    }
    return !!App.sim.states[dev.id]; // 手動操作 (ボタン等)
  }
  return false;
}

/**
 * シミュレーション1ステップ: 全ページを対象に、コイル励磁状態が安定するまで反復。
 * P極(+24V / L)到達ネットと N極(0V / N)到達ネットを求め、
 * コイル/負荷は両極にまたがれば励磁。ページを跨ぐ連動 (制御回路のコイル →
 * 主回路の接触器) はリンク接点の状態参照で成立する。
 */
function simCollectPage(page) {
  const { pinNet, wireNet } = computeNets(page, "sim");
  const pNets = new Set(), nNets = new Set(), acNets = new Set();
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim === "psu") {
      const p = pinNet(dev, 2), n0 = pinNet(dev, 3);
      if (p) pNets.add(p);
      if (n0) nNets.add(n0);
    }
    if (sym.sim === "link") {
      // 明示極性リンク (+24V/0V) はそのページの電源になる
      const pol = linkPolarity(dev);
      const net = pinNet(dev, 0);
      if (net && pol === "P") pNets.add(net);
      if (net && pol === "N") nNets.add(net);
    }
    if (sym.sim === "source3") {
      sym.pins.forEach((_, i) => { const net = pinNet(dev, i); if (net) acNets.add(net); });
    }
    if (sym.sim === "source1") {
      // 単相電源: L を P 極・N を N 極として扱う (負荷判定は DC と同じ「両極にまたがる」)
      const l = pinNet(dev, 0), n = pinNet(dev, 1);
      if (l) pNets.add(l);
      if (n) nNets.add(n);
    }
  });
  return { page, pinNet, wireNet, pNets, nNets, acNets };
}

function simSolve() {
  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    // 1) 全ページのネット + 電源を収集し、電位リンク(同タグ)でページ間伝播
    const pagesData = App.project.pages.map(simCollectPage);
    propagateLinkGroups(pagesData);
    // 2) 励磁判定
    const byPage = new Map();
    pagesData.forEach(pd => {
      pd.page.devices.forEach(dev => {
        const sym = symOf(dev.sym);
        let en = false;
        if (sym.sim === "coil" || sym.sim === "load") {
          const a = pd.pinNet(dev, 0), b = pd.pinNet(dev, 1);
          en = (pd.pNets.has(a) && pd.nNets.has(b)) || (pd.pNets.has(b) && pd.nNets.has(a));
        } else if (sym.sim === "load3") {
          let hot = 0;
          sym.pins.forEach((pin, i) => { if (pin.n !== "PE" && pd.acNets.has(pd.pinNet(dev, i))) hot++; });
          en = hot >= 2;
        }
        if (sym.sim === "coil" || sym.sim === "load" || sym.sim === "load3") {
          if (!!App.sim.states[dev.id] !== en) changed = true;
          App.sim.states[dev.id] = en;
        }
      });
      byPage.set(pd.page.id, { pNets: pd.pNets, nNets: pd.nNets, acNets: pd.acNets, wireNet: pd.wireNet, pinNet: pd.pinNet });
    });
    if (updateTimers()) changed = true;
    if (!changed) {
      App.sim.energizedByPage = byPage;
      App.sim.energized = byPage.get(curPage().id) || null;
      return;
    }
  }
  App.sim.energized = null;
  App.sim.energizedByPage = null;
}

function updateTimers() {
  const now = performance.now();
  let changed = false;
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim !== "coil" || !sym.timer) return;
    const en = !!App.sim.states[dev.id];
    let t = App.sim.timers[dev.id];
    if (!t) t = App.sim.timers[dev.id] = { output: false, since: null };
    const before = t.output;
    const delay = (parseFloat(dev.props.delay) || 2) * 1000;
    if (sym.timer === "on") {
      if (en) {
        if (t.since === null) t.since = now;
        t.output = (now - t.since) >= delay;
      } else { t.since = null; t.output = false; }
    } else { // off-delay
      if (en) { t.since = null; t.output = true; }
      else if (t.output) {
        if (t.since === null) t.since = now;
        if ((now - t.since) >= delay) { t.output = false; t.since = null; }
      }
    }
    if (t.output !== before) changed = true;
  }));
  return changed;
}

function simStart() {
  App.sim.running = true;
  App.sim.states = {};
  App.sim.timers = {};
  simSolve();
}
function simStop() {
  App.sim.running = false;
  App.sim.states = {};
  App.sim.timers = {};
  App.sim.energized = null;
}

/* ══════════════ DRC (設計ルールチェック) ══════════════ */
const DRC_RULES = [
  "未接続ピン", "宙吊り配線端点", "デバイスタグ重複", "コイル未リンク接点",
  "接点なしコイル", "接点数超過", "電源未到達負荷", "無開閉直結コイル", "電源短絡",
  "自動生成時の警告", "図枠外・表題欄との重なり", "文字の重なり", "未登録シンボル",
  "線番の重複",
];

function drcSources(page, pinNet) {
  const pNets = new Set(), nNets = new Set();
  page.devices.forEach(d => {
    const s = symOf(d.sym);
    if (s.sim === "psu") { pNets.add(pinNet(d, 2)); nNets.add(pinNet(d, 3)); }
    if (s.sim === "source1") { pNets.add(pinNet(d, 0)); nNets.add(pinNet(d, 1)); }
    if (s.sim === "link") {
      const pol = linkPolarity(d);
      const net = pinNet(d, 0);
      if (net && pol === "P") pNets.add(net);
      if (net && pol === "N") nNets.add(net);
    }
  });
  return { pNets, nNets };
}

function drcCollect(page, mode) {
  const { pinNet, wireNet } = computeNets(page, mode);
  const { pNets, nNets } = drcSources(page, pinNet);
  return { page, pinNet, wireNet, pNets, nNets, acNets: new Set() };
}

function runDRC() {
  const issues = [];
  const tagSeen = new Map();
  // 全ページのネットを先に解析し、電位リンク(同タグ)でページ間の電位を伝播させる
  const closedData = App.project.pages.map(p => drcCollect(p, "closed"));
  propagateLinkGroups(closedData);
  const openData = App.project.pages.map(p => drcCollect(p, "open"));
  propagateLinkGroups(openData);
  App.project.pages.forEach((page, pageIdx) => {
    applySheet(page);        // 図枠まわりの検査はページごとの用紙・尺度で行う
    const closed = closedData[pageIdx];
    const open = openData[pageIdx];
    const srcClosed = { pNets: closed.pNets, nNets: closed.nNets };
    const srcOpen = { pNets: open.pNets, nNets: open.nNets };

    // ワイヤ端点集合 / 区間集合
    const wireEndpoints = new Map(); // key → count
    const drcWires = condWires(page); // 作図線は検図対象外
    drcWires.forEach(w => w.pts.forEach(p => {
      const k = ptKey(p[0], p[1]);
      wireEndpoints.set(k, (wireEndpoints.get(k) || 0) + 1);
    }));
    const wireSegs = [];
    drcWires.forEach(w => { for (let i = 0; i < w.pts.length - 1; i++) wireSegs.push([w.pts[i], w.pts[i + 1], w.id]); });
    const allPins = [];
    page.devices.forEach(d => devPins(d).forEach(p => allPins.push(p)));

    // 自動生成時に配置できなかった要素 (無音の機器欠落を検図で必ず可視化する)
    (page.genWarnings || []).forEach(msg => {
      issues.push({ sev: "err", msg: `自動生成: ${msg}`, page: page.no, target: null, loc: `${page.no}.-` });
    });

    // 図枠外へのはみ出し / 表題欄・改訂履歴欄との重なり (用紙・尺度変更後の破綻を必ず可視化する)
    const fr = frameRect();
    const blocks = titleBlocksRects();       // 表題欄 + 改訂履歴欄
    const blockName = r => (r.kind === "rev" ? "改訂履歴欄" : "表題欄");
    const outOfFrame = b => b.x < fr.x || b.y < fr.y || b.x + b.w > fr.x + fr.w || b.y + b.h > fr.y + fr.h;
    const overlaps = (b, r) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    page.devices.forEach(dev => {
      const b = devBounds(dev);
      const tag = displayTag(dev) || symOf(dev.sym).name;
      if (outOfFrame(b)) {
        issues.push({ sev: "err", msg: `${tag} が図枠 (輪郭線) の外にはみ出しています`, page: page.no, target: dev.id, loc: `${page.no}.${sheetCol(dev.x)}` });
      } else {
        const hitR = blocks.find(r => overlaps(b, r));
        if (hitR) issues.push({ sev: "err", msg: `${tag} が${blockName(hitR)}に重なっています`, page: page.no, target: dev.id, loc: `${page.no}.${sheetCol(dev.x)}` });
      }
    });
    page.wires.forEach(w => {
      // 頂点だけでなく区間で判定する (両端が枠内でも途中が枠外/表題欄上を通る場合がある)
      const outside = w.pts.some(p => p[0] < fr.x || p[1] < fr.y || p[0] > fr.x + fr.w || p[1] > fr.y + fr.h);
      if (outside) {
        issues.push({ sev: "err", msg: `配線が図枠 (輪郭線) の外にはみ出しています`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(w.pts[0][0])}` });
        return;
      }
      for (let i = 0; i < w.pts.length - 1 && i < 200; i++) {
        const hitR = blocks.find(r => segCrossesRect(w.pts[i], w.pts[i + 1], r));
        if (hitR) {
          issues.push({ sev: "err", msg: `配線が${blockName(hitR)}に重なっています`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(w.pts[i][0])}` });
          break;
        }
      }
    });
    // 用紙に出る文字要素どうし・文字と図記号の重なり (検図の要)
    const f4 = contentScale();
    const labels = [];
    page.devices.forEach(dev => {
      deviceLabelBoxes(page, dev).forEach(o => labels.push({ ...o.box, dev, what: `${displayTag(dev) || "機器"} の文字` }));
      // ピン番号 (描画と同じ位置で判定する)
      const symD = symOf(dev.sym);
      symD.pins.forEach((p, pi) => {
        const vis = pinLabelVisible(page, dev, pi);
        if (!vis) return;
        const h = TEXT_H.small * f4, w2 = textWidthMM(vis.name, h);
        const rotated = (dev.rot || 0) % 360 !== 0;
        const isTop = !rotated && (p.y <= 0 || (symD.horizontalPins && p.y <= symD.bounds[1] + 2));
        const ty = rotated ? vis.abs.y - 1.6 * f4 : vis.abs.y + (isTop ? 3.4 : -1.6) * f4;
        labels.push({ x: vis.abs.x + 1 * f4, y: ty - h, w: w2, h, dev, what: `${displayTag(dev) || "機器"} の端子番号` });
      });
    });
    // 線番・電線仕様・注記
    condWires(page).forEach(w => {
      if (!w.num || w.numShow === false) return;
      const [mx, my, horiz] = wireLabelPos(w, page);
      const h = TEXT_H.small * f4, w2 = textWidthMM(w.num, h);
      labels.push(horiz ? { x: mx - w2 / 2, y: my - h, w: w2, h, wire: w, what: `線番 ${w.num}` }
                        : { x: mx - h, y: my - w2 / 2, w: h, h: w2, wire: w, what: `線番 ${w.num}` });
    });
    page.texts.forEach(t => {
      const b0 = textBounds(t);
      labels.push({ ...b0, text: t, what: `注記「${t.text}」` });
    });
    /* 判定は絶対量で行う: 重なり幅 0.3mm 超 かつ 高さ方向が文字高の 40% 超 */
    const realHit = (a, b2) => {
      const ox = Math.min(a.x + a.w, b2.x + b2.w) - Math.max(a.x, b2.x);
      const oy = Math.min(a.y + a.h, b2.y + b2.h) - Math.max(a.y, b2.y);
      return ox > 0.3 * f4 && oy > Math.min(a.h, b2.h) * 0.4;
    };
    const sameOwner = (a, b2) => (a.dev && a.dev === b2.dev) || (a.wire && a.wire === b2.wire) || (a.text && a.text === b2.text);
    let overlapCount = 0, overlapTotal = 0;
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      const other = labels.find((b2, j) => j !== i && !sameOwner(a, b2) && realHit(a, b2));
      const onSym = other ? null : page.devices.find(d => d !== a.dev && realHit(a, insetRect(devBounds(d), 1.5 * f4)));
      if (!other && !onSym) continue;
      overlapTotal++;
      if (overlapCount >= 20) continue;
      overlapCount++;
      const target = other ? other.what : `${displayTag(onSym) || "機器"} の図記号`;
      issues.push({ sev: "warn", msg: `${a.what} が ${target} と重なっています`, page: page.no, target: (a.dev || a.wire || a.text || {}).id || null, loc: `${page.no}.${sheetCol(a.x)}` });
    }
    if (overlapTotal > overlapCount) {
      issues.push({ sev: "warn", msg: `文字の重なりは他に ${overlapTotal - overlapCount} 箇所あります`, page: page.no, target: null, loc: `${page.no}.-` });
    }

    // 縮小尺度では図記号だけが用紙上小さくなるため、回路図ページでは必ず知らせる
    if (sheetScale() > 1 && page.devices.length) {
      const f3 = sheetScale();
      const minH = TEXT_H.small / f3;   // 用紙上の最小文字高
      issues.push({
        sev: minH < 2.5 ? "err" : "warn",
        msg: `尺度 ${pageSheetMeta(page).scale} では図記号・文字が用紙上 1/${f3} になります` +
             (minH < 2.5 ? ` — 最小文字高 ${minH.toFixed(2)}mm は JIS Z 8313 の 2.5mm を下回ります (回路図は NS または 1:1 を推奨)` : ""),
        page: page.no, target: null, loc: `${page.no}.-`,
      });
    }

    // 注記テキスト・破線枠も同じ検査にかける
    page.texts.forEach(t => {
      // 文字幅は概算のため 0.5mm の余裕を見る (誤検出を避ける)
      const b0 = textBounds(t);
      const b = { x: b0.x + 0.5, y: b0.y + 0.5, w: Math.max(0, b0.w - 1), h: Math.max(0, b0.h - 1) };
      if (outOfFrame(b)) {
        issues.push({ sev: "err", msg: `注記「${t.text}」が図枠の外にはみ出しています`, page: page.no, target: t.id, loc: `${page.no}.${sheetCol(t.x)}` });
      } else {
        const hitR = blocks.find(r => overlaps(b, r));
        if (hitR) issues.push({ sev: "err", msg: `注記「${t.text}」が${blockName(hitR)}に重なっています`, page: page.no, target: t.id, loc: `${page.no}.${sheetCol(t.x)}` });
      }
    });
    pageZones(page).forEach(z => {
      const b = { x: z.x, y: z.y, w: z.w, h: z.h };
      if (outOfFrame(b)) {
        issues.push({ sev: "err", msg: `破線枠${z.label ? ` (${z.label})` : ""} が図枠の外にはみ出しています`, page: page.no, target: z.id, loc: `${page.no}.${sheetCol(z.x)}` });
      } else {
        // 枠線が欄を横切る場合のみ指摘 (内側に欄を含むだけなら図として成立する)
        const edges = [[[z.x, z.y], [z.x + z.w, z.y]], [[z.x + z.w, z.y], [z.x + z.w, z.y + z.h]],
                       [[z.x + z.w, z.y + z.h], [z.x, z.y + z.h]], [[z.x, z.y + z.h], [z.x, z.y]]];
        const hitR = blocks.find(r => edges.some(([a, b2]) => segCrossesRect(a, b2, r)));
        if (hitR) issues.push({ sev: "err", msg: `破線枠${z.label ? ` (${z.label})` : ""} が${blockName(hitR)}に重なっています`, page: page.no, target: z.id, loc: `${page.no}.${sheetCol(z.x)}` });
      }
    });

    // 電源短絡 (+24V と 0V が閉状態で同一ネット)
    for (const p of srcClosed.pNets) {
      if (p && srcClosed.nNets.has(p)) {
        issues.push({ sev: "err", msg: "+24V と 0V が短絡しています (接点閉時)", page: page.no, target: null, loc: `${page.no}.-` });
        break;
      }
    }

    // 宙吊り配線端点 (ピンにも他ワイヤにも接続しない末端)。stub=意図的な引込線/レール端は除外
    drcWires.forEach(w => {
      if (w.stub) return;
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(ep => {
        const k = ptKey(ep[0], ep[1]);
        const attached =
          (wireEndpoints.get(k) || 0) >= 2 ||
          allPins.some(p => Math.abs(p.x - ep[0]) < .01 && Math.abs(p.y - ep[1]) < .01) ||
          wireSegs.some(([a, b, wid]) => wid !== w.id && ptOnSeg(ep[0], ep[1], a[0], a[1], b[0], b[1]));
        if (!attached) {
          issues.push({ sev: "warn", msg: `配線の端点 (${ep[0]}, ${ep[1]}) がどこにも接続していません`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(ep[0])}` });
        }
      });
    });

    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.missing) {
        issues.push({ sev: "err", msg: `${dev.tag || "機器"} のシンボル定義 (${dev.sym}) が見つかりません — 元の図面から再取り込みが必要です`, page: page.no, target: dev.id, loc: devLocation(dev) });
      }
      // 未接続ピン (絶縁処理端末など「未接続であること」を示す記号は除外)
      if (!sym.noDrc) devPins(dev).forEach(pin => {
        const onWire = wireEndpoints.has(ptKey(pin.x, pin.y)) ||
          wireSegs.some(([a, b]) => ptOnSeg(pin.x, pin.y, a[0], a[1], b[0], b[1])) ||
          page.devices.some(d2 => d2 !== dev && devPins(d2).some(p2 => Math.abs(p2.x - pin.x) < .01 && Math.abs(p2.y - pin.y) < .01));
        if (!onWire) {
          issues.push({ sev: "warn", msg: `${displayTag(dev) || sym.name} のピン ${pin.name || pin.idx + 1} が未接続です`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      });
      // タグ重複 (電位リンクは同タグで対にするのが仕様なので除外)
      if (dev.tag && !dev.linkTo && sym.sim !== "link") {
        if (tagSeen.has(dev.tag)) {
          issues.push({ sev: "err", msg: `デバイスタグ ${dev.tag} が重複しています`, page: page.no, target: dev.id, loc: devLocation(dev) });
        } else tagSeen.set(dev.tag, dev.id);
      }
      // リンク未設定の補助接点
      if (sym.linked && !dev.linkTo) {
        issues.push({ sev: "warn", msg: `${sym.name} ${dev.tag} がコイルにリンクされていません`, page: page.no, target: dev.id, loc: devLocation(dev) });
      }
      if (sym.mirror) {
        const contacts = linkedContacts(dev);
        // 接点なしコイル
        if (sym.sim === "coil" && contacts.length === 0 && dev.sym !== "plc_di") {
          issues.push({ sev: "warn", msg: `コイル ${dev.tag} に連動する接点がありません`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
        // 接点数超過 (物理リレーの接点残数)
        const max = dev.props.maxContacts || sym.maxContacts || 4;
        if (contacts.length > max) {
          issues.push({ sev: "err", msg: `${dev.tag} の連動接点が ${contacts.length} 点あり、実装可能数 ${max} 点を超えています`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      }
      if (sym.sim === "coil" || sym.sim === "load") {
        const a = closed.pinNet(dev, 0), b = closed.pinNet(dev, 1);
        // 電源未到達 (全接点閉でも電源に届かない)
        if (srcClosed.pNets.size) {
          const ok = (srcClosed.pNets.has(a) && srcClosed.nNets.has(b)) || (srcClosed.pNets.has(b) && srcClosed.nNets.has(a));
          if (!ok) issues.push({ sev: "err", msg: `${displayTag(dev)} が電源 (+24V/0V) に接続されていません`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
        // 無開閉直結 (接点を1つも介さず両極に直結 → 電源投入と同時に動作)
        const ao = open.pinNet(dev, 0), bo = open.pinNet(dev, 1);
        const direct = (srcOpen.pNets.has(ao) && srcOpen.nNets.has(bo)) || (srcOpen.pNets.has(bo) && srcOpen.nNets.has(ao));
        if (direct) {
          issues.push({ sev: "err", msg: `${displayTag(dev)} が開閉要素なしで電源間に直結しています (投入と同時に動作)`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      }
    });
  });

  // 線番の重複 — 電気的につながっていない別ネットに同じ線番が印字されると誤結線になる。
  // 電位名 (+24V/0V) と電位リンク名はページをまたいで同一で正しいので除外する。
  const potentialNames = new Set();
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim === "psu") { potentialNames.add("+24V"); potentialNames.add("0V"); }
    if (sym.sim === "link" && dev.tag) potentialNames.add(dev.tag.replace(/^-/, ""));
  }));
  const numUse = new Map();               // 線番 → ネット代表の配列
  App.project.pages.forEach((page, pageIdx) => {
    const wn = openData[pageIdx].wireNet;
    const seenNet = new Set();
    condWires(page).forEach(w => {
      if (w.num == null || w.num === "") return;
      const num = String(w.num);
      const netKey = `${page.no}#${wn.get(w.id)}`;
      if (seenNet.has(num + "|" + netKey)) return;
      seenNet.add(num + "|" + netKey);
      if (!numUse.has(num)) numUse.set(num, []);
      numUse.get(num).push({ page, w, netKey });
    });
  });
  numUse.forEach((list, num) => {
    if (list.length < 2) return;
    const samePage = new Map();
    list.forEach(e => { samePage.set(e.page.no, (samePage.get(e.page.no) || 0) + 1); });
    const dupInPage = [...samePage.entries()].filter(([, c]) => c >= 2);
    if (dupInPage.length) {
      const e = list.find(v => v.page.no === dupInPage[0][0]);
      issues.push({
        sev: "err",
        msg: `線番 ${num} が同一ページ内の異なる ${dupInPage[0][1]} 本のネットに重複しています`,
        page: e.page.no, target: e.w.id, loc: `${e.page.no}.${sheetCol(e.w.pts[0][0])}`,
      });
    } else if (!potentialNames.has(num)) {
      const pages = [...new Set(list.map(v => v.page.no))];
      issues.push({
        sev: "warn",
        msg: `線番 ${num} が複数ページ (${pages.join(", ")}) の別ネットに使われています`,
        page: list[0].page.no, target: list[0].w.id, loc: `${list[0].page.no}.${sheetCol(list[0].w.pts[0][0])}`,
      });
    }
  });

  applySheet(curPage());   // 現在ページの図枠に戻す
  return issues;
}

/* ══════════════ 部品表 (BOM) ══════════════ */
const BOM_EXCLUDE = new Set(["link", "supply3", "supply1", "earth"]); // 購買部品でないもの
function buildBOM() {
  const rows = new Map();
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    if (dev.linkTo) return; // 連動接点は親デバイスの一部
    const sym = symOf(dev.sym);
    if (BOM_EXCLUDE.has(sym.id)) return;
    // 端子は本数だけ数える (タグ -X1:n を -X1 に集約)
    const baseTag = sym.id === "terminal" ? (dev.tag || "-X1").split(":")[0] : null;
    const key = sym.id === "terminal" ? "terminal|" + baseTag : dev.sym + "|" + (dev.typeRef || "");
    if (!rows.has(key)) rows.set(key, { name: sym.name, typeRef: dev.typeRef || "—", tags: [] });
    rows.get(key).tags.push(displayTag(dev) || "—");
  }));
  return [...rows.values()].sort((a, b) => (a.tags[0] || "").localeCompare(b.tags[0] || ""));
}

function bomCSV() {
  const rows = buildBOM();
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return "﻿名称,型式,数量,デバイスタグ\n" +
    rows.map(r => [esc(r.name), esc(r.typeRef), r.tags.length, esc(r.tags.join(" "))].join(",")).join("\n");
}

/** PLC アドレス一覧 */
function buildPLCList() {
  const rows = [];
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    if (dev.sym === "plc_di" || dev.sym === "plc_do") {
      rows.push({ tag: dev.tag, addr: dev.desc || "—", kind: dev.sym === "plc_di" ? "入力" : "出力", loc: devLocation(dev) });
    }
  }));
  return rows.sort((a, b) => a.addr.localeCompare(b.addr));
}

/** 接続 (ワイヤ) リスト: 線番ごとに接続先デバイス:ピンを列挙 */
function buildConnectionList() {
  const rows = [];
  App.project.pages.forEach(page => {
    const { pinNet, wireNet } = computeNets(page, "open");
    const netName = new Map();
    condWires(page).forEach(w => { if (w.num) netName.set(wireNet.get(w.id), w.num); });
    const netPins = new Map();
    page.devices.forEach(dev => {
      devPins(dev).forEach(pin => {
        const net = pinNet(dev, pin.idx);
        if (!net) return;
        if (!netPins.has(net)) netPins.set(net, []);
        const sym = symOf(dev.sym);
        const label = dev.sym === "terminal" || sym.sim === "link"
          ? (dev.tag || sym.name)
          : `${displayTag(dev) || sym.name}:${effectivePinName(dev, pin.idx) || pin.idx + 1}`;
        if (!netPins.get(net).includes(label)) netPins.get(net).push(label); // 端子等の重複列挙を防ぐ
      });
    });
    netPins.forEach((pins, net) => {
      if (pins.length >= 2) rows.push({ page: page.no, num: netName.get(net) || "(直結)", pins });
    });
  });
  return rows.sort((a, b) => a.page - b.page || String(a.num).localeCompare(String(b.num), undefined, { numeric: true }));
}
function connectionCSV() {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return "﻿ページ,線番,接続先\n" +
    buildConnectionList().map(r => [r.page, esc(r.num), esc(r.pins.join(" ⇔ "))].join(",")).join("\n");
}

/** 端子表: 端子ごとの内部/外部接続。
    "split" モード (端子を開いた状態) で解析し、端子の両側を区別する */
function buildTerminalList() {
  const rows = [];
  App.project.pages.forEach(page => {
    const split = computeNets(page, "split");
    const netName = new Map();
    condWires(page).forEach(w => { if (w.num) netName.set(split.wireNet.get(w.id), w.num); });
    const pinsOfNet = new Map();
    page.devices.forEach(dev => devPins(dev).forEach(pin => {
      const net = split.pinNet(dev, pin.idx);
      if (!net) return;
      if (!pinsOfNet.has(net)) pinsOfNet.set(net, []);
      pinsOfNet.get(net).push({ dev, pin });
    }));
    const pinLabel = (d, idx) => {
      const s = symOf(d.sym);
      if (d.sym === "terminal" || s.sim === "link") return d.tag || s.name;
      return `${displayTag(d) || s.name}:${effectivePinName(d, idx) || idx + 1}`;
    };
    page.devices.forEach(dev => {
      if (dev.sym !== "terminal") return;
      const side = i => {
        const net = split.pinNet(dev, i);
        const others = (pinsOfNet.get(net) || []).filter(e => e.dev !== dev)
          .map(e => pinLabel(e.dev, e.pin.idx));
        return { num: netName.get(net) || "(直結)", others };
      };
      const s0 = side(0), s1 = side(1);
      // 接続点の少ない側 = 現場機器側 (外部)、多い側 = 盤内 (内部) と判定
      const ext = s0.others.length <= s1.others.length ? s0 : s1;
      const int_ = ext === s0 ? s1 : s0;
      rows.push({ tag: dev.tag || "-X?", page: page.no, int: int_, ext });
    });
  });
  return rows.sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }));
}
function terminalCSV() {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const fmt = side => side.others.length > 4
    ? `${side.others.slice(0, 4).join(" ")} ほか${side.others.length - 4}点`
    : side.others.join(" ");
  return "﻿端子,ページ,外部側 線番,外部側 接続 (現場),内部側 線番,内部側 接続 (盤内)\n" +
    buildTerminalList().map(r => [esc(r.tag), r.page, esc(r.ext.num), esc(fmt(r.ext)), esc(r.int.num), esc(fmt(r.int))].join(",")).join("\n");
}

/* ══════════════ 元に戻す / やり直し ══════════════ */
function commit() {
  App.labelRev++;          // ラベル配置キャッシュを無効化
  App.undoStack.push(JSON.stringify(App.project));
  if (App.undoStack.length > 100) App.undoStack.shift();
  App.redoStack.length = 0;
  App.dirty = true;                   // ファイルへ未保存の変更あり
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
}
/** Undo/Redo 後も、まだ存在するオブジェクトの選択は維持する */
function retainSelection() {
  const alive = new Set();
  App.project.pages.forEach(pg => {
    pg.devices.forEach(d => alive.add(d.id));
    pg.wires.forEach(w => alive.add(w.id));
    pg.texts.forEach(t => alive.add(t.id));
    (pg.zones || []).forEach(z => alive.add(z.id));
  });
  [...App.selection].forEach(id => { if (!alive.has(id)) App.selection.delete(id); });
}
function undo() {
  if (App.sim.running) return false;
  if (!App.undoStack.length) return false;
  App.redoStack.push(JSON.stringify(App.project));
  App.project = JSON.parse(App.undoStack.pop());
  mergeProjectSymbols();
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  applySheet(); // 用紙・尺度も一緒に巻き戻す
  retainSelection();
  App.dirty = true;
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
  return true;
}
function redo() {
  if (App.sim.running) return false;
  if (!App.redoStack.length) return false;
  App.undoStack.push(JSON.stringify(App.project));
  App.project = JSON.parse(App.redoStack.pop());
  mergeProjectSymbols();
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  applySheet();
  retainSelection();
  App.dirty = true;
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
  return true;
}

/* ══════════════ 保存 / 読込 ══════════════ */
const LS_KEY = "electracad.project.v1";
function saveLocal() {
  syncProjectSymbols();
  try { localStorage.setItem(LS_KEY, JSON.stringify(App.project)); } catch (e) { /* 容量超過等は無視 */ }
}
function loadLocal() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) { const p = JSON.parse(s); if (p && p.pages && p.pages.length) return p; }
  } catch (e) { /* 破損データは無視 */ }
  return null;
}
function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
