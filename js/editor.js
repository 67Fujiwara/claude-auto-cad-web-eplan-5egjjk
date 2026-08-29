/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — エディタ (SVGレンダリング & インタラクション)
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const INK = "#1b2334";        // シート上の描画色
const INK_SOFT = "#5a6579";   // 補助テキスト
const SEL = "#1f7ae0";        // 選択色
const SIM_P = "#0aa64b";      // 通電(+)
const SIM_N = "#2f6fd6";      // 通電(0V)

const Editor = {
  svg: null,
  view: { tx: 40, ty: 30, s: 2.2 },
  layers: {},
  hover: { devId: null, pin: null },
  drag: null,            // 進行中の操作
  wireDraft: null,       // 配線作図中 { pts:[[x,y]...], cur:[x,y] }
  ghost: null,           // ライブラリからの配置ゴースト { symId, x, y, rot }
  renderQueued: false,
};

/* ══════════════ 座標変換 ══════════════ */
function screenToWorld(clientX, clientY) {
  const r = Editor.svg.getBoundingClientRect();
  const { tx, ty, s } = Editor.view;
  return { x: (clientX - r.left - tx) / s, y: (clientY - r.top - ty) / s };
}
function zoomAt(clientX, clientY, factor) {
  const r = Editor.svg.getBoundingClientRect();
  const v = Editor.view;
  const px = clientX - r.left, py = clientY - r.top;
  const ns = Math.max(0.35, Math.min(12, v.s * factor));
  v.tx = px - (px - v.tx) * (ns / v.s);
  v.ty = py - (py - v.ty) * (ns / v.s);
  v.s = ns;
  requestRender();
  updateZoomLabel();
}
function zoomFit() {
  // ページ切替直後は renderAll (rAF 待ち) より先に呼ばれるので、
  // 用紙・尺度が違うページでも正しく収まるよう、先にこのページの図枠を適用する
  applySheet(curPage());
  const r = Editor.svg.getBoundingClientRect();
  const pad = 36;
  const s = Math.min((r.width - pad * 2) / SHEET.w, (r.height - pad * 2) / SHEET.h);
  Editor.view.s = s;
  Editor.view.tx = (r.width - SHEET.w * s) / 2;
  Editor.view.ty = (r.height - SHEET.h * s) / 2;
  requestRender();
  updateZoomLabel();
}
function updateZoomLabel() {
  const el = document.getElementById("zoomLabel");
  if (el) el.textContent = Math.round(Editor.view.s / 2.2 * 100) + "%";
}

/* ══════════════ レンダリング ══════════════ */
function requestRender() {
  if (Editor.renderQueued) return;
  Editor.renderQueued = true;
  requestAnimationFrame(() => { Editor.renderQueued = false; renderAll(); });
}

function renderAll() {
  applySheet(curPage());   // ページごとの用紙・尺度
  const svg = Editor.svg;
  if (!svg) return;
  const page = curPage();
  // シミュレーション中: 表示中ページの通電情報を選ぶ (全ページ同時解決)
  if (App.sim.running && App.sim.energizedByPage) {
    App.sim.energized = App.sim.energizedByPage.get(page.id) || null;
  }
  const { tx, ty, s } = Editor.view;
  const world = svg.querySelector("#world");
  world.setAttribute("transform", `translate(${tx},${ty}) scale(${s})`);
  Editor.layers.sheet.innerHTML = sheetSVG(page) + zonesSVG(page) + kindSVG(page);
  Editor.layers.wires.innerHTML = wiresSVG(page);
  Editor.layers.devices.innerHTML = devicesSVG(page);
  Editor.layers.texts.innerHTML = textsSVG(page);
  Editor.layers.overlay.innerHTML = overlaySVG(page);
  updateStatusCount();
}

/* ── シート (図枠 + グリッド + 表題欄) ── */
function sheetSVG(page, opts = {}) {
  const { w, h, margin: m, marginLeft: ml, cols, rows } = SHEET;
  const fr = sheetScale(); // 尺度 (線幅・文字高はこの倍率で描き、用紙上では常に同じ大きさ)
  const print = !!opts.print;   // 出力用: 画面専用の影・作図グリッドを描かない
  let out = "";
  // 影 + 用紙
  if (!print) out += `<rect x="2.5" y="3.5" width="${w}" height="${h}" fill="rgba(0,0,0,.45)" rx="1"/>`;
  out += `<rect x="0" y="0" width="${w}" height="${h}" fill="#fff" rx="${print ? 0 : 0.5}"/>`;
  // 作図グリッド (画面専用。出力・印刷には載せない)
  if (!print) {
    let grid = "";
    for (let x = ml; x <= w - m; x += GRID) grid += `M${x},${m} V${h - m}`;
    for (let y = m; y <= h - m; y += GRID) grid += `M${ml},${y} H${w - m}`;
    out += `<path d="${grid}" stroke="rgba(30,50,90,.055)" stroke-width="${0.3 * fr}" fill="none"/>`;
    let grid2 = "";
    for (let x = ml; x <= w - m; x += GRID * 4) grid2 += `M${x},${m} V${h - m}`;
    for (let y = m; y <= h - m; y += GRID * 4) grid2 += `M${ml},${y} H${w - m}`;
    out += `<path d="${grid2}" stroke="rgba(30,50,90,.09)" stroke-width="${0.3 * fr}" fill="none"/>`;
  }
  // 輪郭線 (JIS Z 8311: とじ代側 20mm・他辺 c)
  out += `<rect x="${ml}" y="${m}" width="${w - ml - m}" height="${h - 2 * m}" fill="none" stroke="${INK}" stroke-width="${LINE_W.extra * fr}"/>`;
  // 中心マーク (4辺の中点。輪郭線の内側 5mm まで) — JIS Z 8311 必須
  const cmw = LINE_W.thick * fr, cm5 = 5 * fr;
  const cxm = w / 2, cym = h / 2;   // 中心マークは用紙の対称軸上 (JIS Z 8311)
  out += `<path d="M${cxm},0 V${m + cm5} M${cxm},${h} V${h - m - cm5} M0,${cym} H${ml + cm5} M${w},${cym} H${w - m - cm5}"
    stroke="${INK}" stroke-width="${cmw}" fill="none"/>`;
  // 裁断マーク (用紙四隅・10×5mm の塗り) — JIS Z 8311
  const tmL = 10 * fr, tmS = 5 * fr;
  [[0, 0, tmS, tmL], [0, 0, tmL, tmS],
   [w - tmS, 0, tmS, tmL], [w - tmL, 0, tmL, tmS],
   [0, h - tmL, tmS, tmL], [0, h - tmS, tmL, tmS],
   [w - tmS, h - tmL, tmS, tmL], [w - tmL, h - tmS, tmL, tmS]].forEach(([tx, ty, tw, th]) => {
    out += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="${INK}" stroke="none"/>`;
  });
  // 格子参照: 列 1,2,3… / 行 A,B,C… (I・O は使わない)
  const cw = (w - ml - m) / cols, rh = (h - 2 * m) / rows;
  const fs = TEXT_H.normal * fr, tick = 0.35 * fr, zw = 5 * fr;
  for (let i = 0; i < cols; i++) {
    const cx = ml + cw * i + cw / 2;
    out += `<text x="${cx}" y="${m - 1.4 * fr}" font-size="${svgFontSize(fs, true)}" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${i + 1}</text>`;
    out += `<text x="${cx}" y="${h - m + 4.2 * fr}" font-size="${svgFontSize(fs, true)}" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${i + 1}</text>`;
    if (i) out += `<path d="M${ml + cw * i},${m - zw} V${m}" stroke="${INK_SOFT}" stroke-width="${tick}"/><path d="M${ml + cw * i},${h - m} V${h - m + zw}" stroke="${INK_SOFT}" stroke-width="${tick}"/>`;
  }
  for (let i = 0; i < rows; i++) {
    const cy = m + rh * i + rh / 2 + 1.3 * fr;
    const ch = SHEET_ROW_LETTERS[i] || "Z";
    out += `<text x="${ml - 2.8 * fr}" y="${cy}" font-size="${svgFontSize(fs, true)}" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${ch}</text>`;
    out += `<text x="${w - m + 2.8 * fr}" y="${cy}" font-size="${svgFontSize(fs, true)}" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${ch}</text>`;
    if (i) out += `<path d="M${ml - zw},${m + rh * i} H${ml}" stroke="${INK_SOFT}" stroke-width="${tick}"/><path d="M${w - m},${m + rh * i} H${w - m + zw}" stroke="${INK_SOFT}" stroke-width="${tick}"/>`;
  }
  // 表題欄 (JIS Z 8311: 右下・輪郭線に接する。図番/図名/企業名/署名/日付/尺度/投影法を記入)
  const meta = projectMeta();
  const pm = pageSheetMeta(page);          // 用紙・尺度はページ固有設定を優先
  const S = v => v * fr;                       // 用紙実寸 mm → 作図領域 mm
  const tbr = titleBlockRect();
  const tbW = tbr.w, tbH = tbr.h, tbX = tbr.x, tbY = tbr.y;
  const [pw, ph] = paperSize(pm.paper, pm.orient);
  // 列割りは engine の TITLE_BLOCK (画面と DXF で同一)
  const cwmm = TITLE_BLOCK.cols;
  const cx = [0, cwmm[0], cwmm[0] + cwmm[1], cwmm[0] + cwmm[1] + cwmm[2]];
  const c1 = tbX, c2 = tbX + S(cx[1]), c3 = tbX + S(cx[2]), c4 = tbX + S(cx[3]);
  const cw2 = cwmm.map(S);
  const r1 = tbY, r2 = tbY + S(TITLE_BLOCK.rowH), r3 = tbY + S(TITLE_BLOCK.rowH * 2), r4 = tbY + tbH;
  /* セル。値が欄幅を超える場合は文字高を段階的に落とし、それでも入らなければ
     clipPath で切る (隣の欄へはみ出させない)。 */
  let clipN = 0;
  const clipBase = "tb" + (page.id || "p").replace(/[^a-zA-Z0-9]/g, "");
  const cell = (x, y, ci, label, value, valSize = TEXT_H.normal, bold = false) => {
    const cwv = TITLE_BLOCK.cols[ci] - 3.4;              // 用紙上 mm
    const size = fitTextSize(String(value), cwv, valSize, bold);
    const shown = truncateToWidth(String(value), cwv, size, bold);
    const id = `${clipBase}c${clipN++}`;                 // ページ間で id が衝突しないように
    return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${cw2[ci]}" height="${S(10)}"/></clipPath>` +
      `<g clip-path="url(#${id})">` +
      `<text x="${x + S(2)}" y="${y + S(3.6)}" font-size="${svgFontSizeFor(label, S(TEXT_H.small))}" fill="${INK_SOFT}">${escXML(label)}</text>` +
      `<text x="${x + S(2)}" y="${y + S(8.4)}" font-size="${svgFontSizeFor(shown, S(size), false, { bold })}" fill="${INK}"${bold ? ' font-weight="bold"' : ""}>${escXML(shown)}</text></g>`;
  };
  out += revisionTableSVG(tbX, tbY, tbW, S, fr, meta, clipBase + "r");
  out += `<g font-family="sans-serif" data-titleblock="1">
    <rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="#fff" stroke="${INK}" stroke-width="${S(LINE_W.thick)}"/>
    <path d="M${c1},${r2} H${tbX + tbW} M${c1},${r3} H${tbX + tbW} M${c2},${r1} V${r4} M${c3},${r1} V${r4} M${c4},${r1} V${r4}"
      stroke="${INK}" stroke-width="${S(LINE_W.thin)}"/>
    ${cell(c1, r1, 0, "図名 (プロジェクト)", App.project.name, TEXT_H.normal, true)}
    ${cell(c2, r1, 1, "ページ名", page.name, TEXT_H.normal, true)}
    ${cell(c3, r1, 2, "図面番号", pageDwgNo(page))}
    ${cell(c4, r1, 3, "改訂", meta.rev || "0")}
    ${cell(c1, r2, 0, "設計 (署名)", meta.designer || "—")}
    ${cell(c2, r2, 1, "検図 (署名)", meta.checker || "—")}
    ${cell(c3, r2, 2, "日付", meta.date || todayStr())}
    ${cell(c4, r2, 3, "尺度", pm.scale || "1:1")}
    ${cell(c1, r3, 0, "企業 (団体) 名", meta.author || "—")}
    ${cell(c2, r3, 1, "用紙 / 投影法", `${paperLabel(pm)} / ${meta.proj || PROJ_DEFAULT}`)}
    <text x="${c3 + S(2)}" y="${r3 + S(3.6)}" font-size="${svgFontSizeFor("ページ", S(TEXT_H.small))}" fill="${INK_SOFT}">ページ</text>
    <text x="${c3 + S(2)}" y="${r3 + S(8.8)}" font-size="${svgFontSize(S(TEXT_H.large), false, true)}" fill="${INK}" font-weight="bold">${page.no} / ${App.project.pages.length}</text>
    ${projSymbolSVG(c4 + S(2.5), r3 + S(2.4), S(1), meta.proj)}
  </g>`;
  return out;
}

/** 改訂履歴欄 (表題欄の直上。JIS Z 8311 附属書: 改訂記号・日付・内容・承認)。
    寸法は engine の REV_TABLE / revisionRect() を使い、DXF と同一にする。 */
function revisionTableSVG(tbX, tbY, tbW, S, fr, meta, idBase = "rv") {
  const rows = revisionRows();
  const rect = revisionRect();
  if (!rows.length || !rect) return "";
  const rh = S(REV_TABLE.rowH), h = rect.h;
  const y0 = rect.y;
  tbX = rect.x; tbW = rect.w;     // 表題欄の左隣 (または直上) に置く
  const cols = revColWidths(tbW, S);
  const xs = [tbX];
  cols.forEach(c => xs.push(xs[xs.length - 1] + c));
  const head = ["改訂", "日付", "内容", "承認"];
  let out = `<g font-family="sans-serif" data-revtable="1">
    <rect x="${tbX}" y="${y0}" width="${tbW}" height="${h}" fill="#fff" stroke="${INK}" stroke-width="${S(LINE_W.thick)}"/>`;
  let grid = "";
  for (let i = 1; i <= rows.length; i++) grid += `M${tbX},${y0 + rh * i} H${tbX + tbW} `;
  xs.slice(1, -1).forEach(x => { grid += `M${x},${y0} V${y0 + h} `; });
  out += `<path d="${grid}" stroke="${INK}" stroke-width="${S(LINE_W.thin)}" fill="none"/>`;
  head.forEach((t, i) => {
    out += `<text x="${xs[i] + S(1.6)}" y="${y0 + rh - S(1.6)}" font-size="${svgFontSizeFor(t, S(TEXT_H.small))}" fill="${INK_SOFT}">${t}</text>`;
  });
  // 新しい改訂が上に来るように下から積む (JIS の一般的な書式)
  let rc = 0;
  rows.slice().reverse().forEach((r, ri) => {
    const y = y0 + rh * (ri + 1);
    [r.rev, r.date, r.desc, r.appr].forEach((v, i) => {
      if (!v) return;
      const id = `${idBase}${rc++}`;
      out += `<clipPath id="${id}"><rect x="${xs[i]}" y="${y}" width="${cols[i]}" height="${rh}"/></clipPath>` +
        `<g clip-path="url(#${id})"><text x="${xs[i] + S(1.6)}" y="${y + rh - S(1.6)}" font-size="${svgFontSizeFor(v, S(TEXT_H.small))}" fill="${INK}">${escXML(v)}</text></g>`;
    });
  });
  return out + `</g>`;
}
/** 改訂履歴欄の列幅 (記号/日付/内容/承認) */
function revColWidths(tbW, S) {
  const c = REV_TABLE.cols;
  return [S(c[0]), S(c[1]), tbW - S(c[0]) - S(c[1]) - S(c[3]), S(c[3])];
}

/** 投影法の記号 (JIS Z 8316 / ISO 5456-2)。円すい台とその端面図を並べ、
    第三角法は端面図 (同心円) を右、第一角法は左に置く。同心円の径は
    円すい台の大端 (φ6) と小端 (φ3.72) に一致させる。 */
function projSymbolSVG(x, y, u, proj) {
  if (proj === "該当なし (回路図)") return "";
  const first = proj === "第一角法";
  const big = 3 * u, smallR = 1.86 * u, cy = y + 3.6 * u;
  // 2つの投影図は 0.5mm 以上離す (円すい台の端面線が同心円を貫通しないように)
  const bx = x + (first ? 14.3 * u : 5.2 * u), sx = x + (first ? 5.2 * u : 14.3 * u);
  const sw = LINE_W.thin * u;
  return `<g stroke="${INK}" stroke-width="${sw}" fill="none">
    <path d="M${bx - big * 1.7},${cy - big} L${bx + big * 1.7},${cy - smallR} M${bx - big * 1.7},${cy + big} L${bx + big * 1.7},${cy + smallR}
             M${bx - big * 1.7},${cy - big} V${cy + big} M${bx + big * 1.7},${cy - smallR} V${cy + smallR}"/>
    <circle cx="${sx}" cy="${cy}" r="${big}"/><circle cx="${sx}" cy="${cy}" r="${smallR}"/>
  </g>`;
}

/* ── 破線枠 (盤外エリア / 機器グループ) ── */
function zonesSVG(page, opts = {}) {
  let out = "";
  const print = !!opts.print;
  const fr = contentScale();
  const dash = WIRE_STYLES.dash.dash.split(" ").map(v => v * fr).join(" ");
  pageZones(page).forEach(z => {
    const selected = !print && App.selection.has(z.id);
    const zk = objScale(z);            // 尺度の違うページから貼った枠の倍率
    const zdash = zk !== 1 ? WIRE_STYLES.dash.dash.split(" ").map(v => v * fr * zk).join(" ") : dash;
    out += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="${2 * fr * zk}" fill="none"
      stroke="${selected ? SEL : INK}" stroke-width="${(selected ? LINE_W.thick : LINE_W.thin) * fr * zk}" stroke-dasharray="${zdash}"/>`;
    if (z.label) {
      const lp = zoneLabelPos(z);
      out += `<text x="${lp.x}" y="${lp.y}" font-size="${svgFontSizeFor(z.label, lp.size)}" fill="${INK}" font-family="sans-serif">${escXML(z.label)}</text>`;
    }
    // 選択中はつまみ (角 4 + 辺の中央 4)。マウスでつまんで幅と高さを変えられる
    if (selected) {
      zoneHandles(z).forEach(h => {
        out += `<rect x="${h.x - 1.4}" y="${h.y - 1.4}" width="2.8" height="2.8" fill="#fff" stroke="${SEL}" stroke-width="0.35"/>`;
      });
      // コメントは枠と別につまんで動かせる (点線で囲って掴めることを示す)
      const lb = zoneLabelBox(z);
      if (lb) {
        out += `<rect x="${lb.x - 0.6}" y="${lb.y - 0.6}" width="${lb.w + 1.2}" height="${lb.h + 1.2}" fill="none"
          stroke="${SEL}" stroke-width="0.25" stroke-dasharray="1 0.8"/>`;
      }
    }
  });
  return out;
}

/** 破線枠のつまみ (角 4 + 辺の中央 4)。hx/hy は −1/0/+1 でどの縁を動かすか */
function zoneHandles(z) {
  const out = [];
  [-1, 0, 1].forEach(hy => [-1, 0, 1].forEach(hx => {
    if (hx === 0 && hy === 0) return;
    out.push({ hx, hy, x: z.x + (hx + 1) / 2 * z.w, y: z.y + (hy + 1) / 2 * z.h });
  }));
  return out;
}
/** 選択中の破線枠の「コメント」を掴んだか (枠のつまみより先に見る) */
/** 図面座標 → 機器ローカル座標 (回転・倍率の逆変換) */
function devLocalXY(dev, wx, wy) {
  const r = (dev.rot || 0) * Math.PI / 180, k = devScale(dev);
  const c = Math.cos(r), sn = Math.sin(r);
  const px = wx - dev.x, py = wy - dev.y;
  return { x: (px * c + py * sn) / k, y: (-px * sn + py * c) / k };
}
/** PLC 入出力結線図の機能欄 (コメント欄) の下線をつまんだか。
    行の下線 ±2.2mm の帯だけ拾う — 行間の空白は従来どおり機器の移動に使える */
function fnColAt(page, wx, wy) {
  for (let i = page.devices.length - 1; i >= 0; i--) {
    const dev = page.devices[i];
    const sp = symOf(dev.sym).ioSheet;
    if (!sp || !sp.rows || !sp.fnW) continue;
    const l = devLocalXY(dev, wx, wy);
    const fx = (sp.fnX !== undefined ? sp.fnX : (sp.fnTextX || 0) - 1) + devFnDx(dev);
    if (l.x < fx - 1 || l.x > fx + sp.fnW + 1) continue;
    if (sp.rows.some(rr => Math.abs(l.y - (rr.y + 1.5)) < 2.2)) return { dev };
  }
  return null;
}

function zoneLabelAt(page, wx, wy) {
  for (const z of pageZones(page)) {
    if (!App.selection.has(z.id)) continue;
    const b = zoneLabelBox(z);
    if (!b) continue;
    if (wx > b.x - 1 && wx < b.x + b.w + 1 && wy > b.y - 1 && wy < b.y + b.h + 1) return z;
  }
  return null;
}
/** 選択中の破線枠のつまみが (wx,wy) の近くにあれば返す */
function zoneHandleAt(page, wx, wy) {
  for (const z of pageZones(page)) {
    if (!App.selection.has(z.id)) continue;
    for (const h of zoneHandles(z)) {
      if (Math.abs(wx - h.x) < 2.2 && Math.abs(wy - h.y) < 2.2) return { z, h };
    }
  }
  return null;
}

/* ── ワイヤ ── */
function wiresSVG(page, opts = {}) {
  let out = "";
  const print = !!opts.print;
  const sim = App.sim.running ? App.sim.energized : null;
  const fr = contentScale();
  // 丸端子などの下は導体を描かない (電気的にはつながったまま・端子を動かせば戻る)
  const masks = pageWireMasks(page);
  page.wires.forEach(w => {
    // 見せる線は円の内側を抜いた小片。当たり判定・選択は元の線のまま
    const dOf = pts2 => "M" + pts2.map(p => p[0] + "," + p[1]).join(" L");
    const d = trimPolyByCircles(w.pts, masks).map(dOf).join(" ");
    const cond = isWireConductive(w);
    // 線の太さは JIS Z 8312 の系列 (配線=太線 0.5 / 作図線=細線 0.25、比 2:1)
    const wk = objScale(w);            // 尺度の違うページから貼った配線の倍率
    let color = INK, sw = (cond ? LINE_W.thick : LINE_W.thin) * fr * wk;
    if (cond && sim && sim.wireNet) {
      const net = sim.wireNet.get(w.id);
      if (sim.pNets.has(net) || sim.acNets.has(net)) { color = SIM_P; sw = LINE_W.extra * fr * wk; }
      else if (sim.nNets.has(net)) { color = SIM_N; sw = LINE_W.extra * fr * wk; }
    }
    const st = WIRE_STYLES[w.style] || WIRE_STYLES.solid;
    const da = wireDashArray(w, fr * wk);
    const dash = da ? ` stroke-dasharray="${da}" stroke-linecap="${st.round ? "round" : "butt"}"` : "";
    const selected = !print && App.selection.has(w.id);
    if (selected) out += `<path d="${d}" stroke="${SEL}" stroke-width="${2.2 * fr}" fill="none" opacity="0.28" stroke-linecap="round"/>`;
    out += `<path d="${d}" stroke="${color}" stroke-width="${sw}" fill="none"${dash} data-id="${w.id}" class="wire"/>`;
    // 当たり判定用の太い透明パス (画面のみ)
    if (!print) out += `<path d="${dOf(w.pts)}" stroke="rgba(0,0,0,0)" stroke-width="${4 * fr}" fill="none" data-id="${w.id}" class="wire-hit"/>`;
    // 配線番号 (numShow=false のワイヤはネット内の代表ワイヤに表示を譲る)
    if (w.num && w.numShow !== false && cond) {
      const [mx, my, horiz] = wireLabelPos(w, page);
      // 位置は wireLabelPos が確定済み (当たり判定矩形と完全に一致させる)
      const lx = mx, ly = my;
      out += `<text x="${lx}" y="${ly}" font-size="${svgFontSizeFor(w.num, TEXT_H.small * fr * wk, true)}" fill="#7a4ec2" font-family="monospace" text-anchor="middle"${horiz ? "" : ` transform="rotate(-90 ${lx} ${ly})"`}>${escXML(w.num)}</text>`;
    }
    // 電線仕様 (例 KIV(BL)-1.25sq) — 線番の反対側にイタリックで表示
    if (w.spec && w.numShow !== false) {   // 線番と同じ代表1本にだけ表示する
      const [mx, my, horiz, gap, side] = wireLabelPos(w, page);
      const [sx, sy] = wireSpecAnchor(mx, my, horiz, gap, side);
      out += `<text x="${sx}" y="${sy}" font-size="${svgFontSizeFor(w.spec, TEXT_H.small * fr * wk, true)}" fill="#4a6b52" font-family="monospace" font-style="italic" text-anchor="middle"${horiz ? "" : ` transform="rotate(-90 ${sx} ${sy})"`}>${escXML(w.spec)}</text>`;
    }
  });
  /* ジャンクションドット (直径は線幅の約3倍)。丸端子の円の中には打たない —
     端子の丸そのものが接続を表しているので、二重に描くと黒点で潰れる */
  junctionDots(page).forEach(([x, y]) => {
    if (masks.some(c => Math.hypot(x - c.x, y - c.y) < c.r + 0.01)) return;
    out += `<circle cx="${x}" cy="${y}" r="${LINE_W.thick * 1.5 * fr}" fill="${INK}"/>`;
  });
  return out;
}

/* ── デバイス ── */
function devicesSVG(page, opts = {}) {
  let out = "";
  const print = !!opts.print;
  const simOn = App.sim.running;
  const fr = contentScale();
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (!sym) return;
    const selected = !print && App.selection.has(dev.id);
    const hovered = !print && Editor.hover.devId === dev.id;
    let color = INK;
    let extra = "";
    if (simOn) {
      const st = simDevVisual(dev, sym);
      if (st.color) color = st.color;
      extra = st.extra || "";
    }
    const dk = devScale(dev);          // 貼り付け先の尺度に合わせた機器ごとの倍率
    out += `<g transform="translate(${dev.x},${dev.y}) rotate(${dev.rot || 0})${dk !== 1 ? ` scale(${dk})` : ""}" data-id="${dev.id}" class="device" style="color:${color}">`;
    if (selected || hovered) {
      const [bx, by, bw, bh] = sym.bounds;
      out += `<rect x="${bx - 2}" y="${by - 2}" width="${bw + 4}" height="${bh + 4}" fill="${selected ? "rgba(31,122,224,.10)" : "rgba(31,122,224,.05)"}" stroke="${SEL}" stroke-width="${(selected ? 0.5 : 0.3) / dk}" stroke-dasharray="${selected ? "none" : "1.5 1.2"}" rx="1"/>`;
    }
    out += extra;
    // シンボルの線は太線 0.5mm (グループの scale で用紙上一定になる)
    out += symBodySVG(sym, { strokeWidth: LINE_W.thick, textScale: 1, rot: dev.rot || 0 });
    // 機能欄 (コメント欄) の下線 — body でなくここで引く。ドラッグ位置 (fnDx) に追従
    if (sym.ioSheet && sym.ioSheet.rows && sym.ioSheet.fnW) {
      const fx = (sym.ioSheet.fnX !== undefined ? sym.ioSheet.fnX : (sym.ioSheet.fnTextX || 0) - 1) + devFnDx(dev);
      let dfn = "";
      sym.ioSheet.rows.forEach(rr => { dfn += `M${fx},${rr.y + 1.5} H${fx + sym.ioSheet.fnW} `; });
      out += `<path d="${dfn}" stroke="currentColor" stroke-width="0.25" fill="none"/>`;
    }
    out += `</g>`;
    // 端子番号 (13/14, A1/A2, X1/X2 …) — EPLAN同様ピン脇に表示。
    // 連動接点は同一コイル内の順位で 13/14 → 23/24 と自動採番。
    // 隣接ワイヤの線番と同名 (主回路の U1 等) なら二重表示を抑制。
    // 回転グループの外で描くため、機器を回してもピン番号は水平を保つ。
    sym.pins.forEach((p, pi) => {
      const vis = pinLabelVisible(page, dev, pi);
      if (!vis) return;
      const name = vis.name;
      const pos = pinLabelPos(page, dev, pi);      // 位置は検図・DXF と同じ探索結果
      if (!pos) return;
      const tx = pos.x, ty = pos.y;
      out += `<text x="${tx}" y="${ty}" font-size="${svgFontSizeFor(name, pos.size || TEXT_H.small * fr, true)}" fill="#42506a" stroke="none" font-family="monospace">${escXML(name)}</text>`;
    });
    // タグ・機能テキスト (回転に追従させず水平表示)
    out += devLabelsSVG(dev, sym, page, { print });
    // コイルの接点ミラー
    if (sym.mirror) out += mirrorSVG(dev);
  });
  return out;
}

function simDevVisual(dev, sym) {
  const en = !!App.sim.states[dev.id];
  const t = App.sim.timers[dev.id];
  switch (sym.sim) {
    case "contact_no": case "contact_nc": case "contact2_no": case "contact3_no":
    case "contact2_nc": case "changeover": {
      const act = simActiveState(dev);
      return { color: act ? SIM_P : null };
    }
    case "coil":
      return { color: (t ? t.output : en) ? SIM_P : null };
    case "load": {
      if (!en) return {};
      if (dev.sym === "lamp") return { color: "#c77b00", extra: `<circle cx="0" cy="10" r="7.5" fill="rgba(255,190,60,.4)"/>` };
      return { color: "#c77b00" };
    }
    case "load3":
      return en ? { color: "#c77b00", extra: `<circle cx="0" cy="21" r="11.5" fill="rgba(255,190,60,.28)"/>` } : {};
    case "passthru3": case "passthru2":
      // サーマルリレー: トリップ中は赤系で表示
      return App.sim.states[dev.id] ? { color: "#c23b3b" } : {};
    default: return {};
  }
}

function devLabelsSVG(dev, sym, page, opts = {}) {
  const fr = contentScale();
  const b = devBounds(dev);
  let out = "";
  // 配置はエンジンの deviceLabelBoxes に一本化 (検図・DXF と同じ結果になる)
  const boxes = deviceLabelBoxes(page || curPage(), dev);
  boxes.forEach((o) => {
    // タグの表示モード (シンボルDBで選ぶ): 非表示 / 出力時非表示に従う
    if (o.isTag && !tagShownFor(dev, !!opts.print)) return;
    const isTag = o.isTag;
    out += `<text x="${o.x}" y="${o.y}" font-size="${svgFontSizeFor(o.text, o.size, isTag, { bold: isTag })}" text-anchor="${o.anchor}" fill="${isTag ? INK : INK_SOFT}"` +
      `${isTag ? ' font-weight="600" font-family="monospace"' : ""}>${escXML(o.text)}</text>`;
  });
  // 入出力結線図の機能欄 (行ごとの文言)
  deviceRowTexts(page || curPage(), dev).forEach(o => {
    out += `<text x="${o.x}" y="${o.y}" font-size="${svgFontSizeFor(o.text, o.size, false)}" fill="${INK}" stroke="none" font-family="sans-serif">${escXML(o.text)}</text>`;
  });
  // リンク接点のクロスリファレンス (親コイル位置 /ページ.列)。
  // タグを右へ寄せた機器では、その下に置いて重ならないようにする
  const xr = deviceXrefBox(page || curPage(), dev);
  if (xr) {
    out += `<text x="${xr.x}" y="${xr.y}" font-size="${svgFontSizeFor(xr.text, xr.size, true)}" fill="${xr.ink ? INK : "#7a4ec2"}" font-family="monospace"${xr.anchor ? ` text-anchor="${xr.anchor}"` : ""}${xr.angle ? ` transform="rotate(${-xr.angle} ${xr.x} ${xr.y})"` : ""}>${escXML(xr.text)}</text>`;
  }
  return out;
}

/** コイル下の接点ミラー (EPLAN流クロスリファレンス表)
    0Vへの縦配線を避けて右側にオフセット。端子番号と NO/NC 種別つき */
function mirrorSVG(coilDev) {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return "";
  const mfr = contentScale();           // 表の寸法は用紙上一定 (文字と同じ空間)
  const org = mirrorOrigin(coilDev);      // 位置は検図・DXF と同じ探索結果を使う
  const x = org.x, y0 = org.y0;
  const rowH = 4.2 * mfr;
  const MAXROWS = 4;
  const cols = mirrorCols(contacts.slice(0, 4));   // 桁被りを防ぐ動的な列位置
  let out = `<g font-family="monospace">`;
  out += `<path d="M${coilDev.x},${coilDev.y + 20 * mfr} L${x},${y0 - 1.5 * mfr}" stroke="${INK_SOFT}" stroke-width="${LINE_W.thin * mfr}" stroke-dasharray="${fitDashPattern(WIRE_STYLES.dash.dash.split(" ").map(v => v * mfr), Math.hypot(x - coilDev.x, y0 - 1.5 * mfr - coilDev.y - 20 * mfr)).join(" ")}" stroke-linecap="butt"/>`;
  contacts.slice(0, MAXROWS).forEach((c, i) => {
    const cy = y0 + i * rowH;
    const csym = symOf(c.sym);
    const n0 = effectivePinName(c, 0), n1 = effectivePinName(c, 1);
    const pinLabel = (n0 && n1) ? `${n0}·${n1}` : "";
    const M = v => v * mfr;
    // ミニ接点グリフ (NC は横バーつき)
    if (csym.sim === "contact_nc") {
      out += `<path d="M${x},${cy + M(1.5)} h${M(2)} l${M(2.6)},${M(-2.8)} m${M(-2.6)},0 h${M(2.6)} m0,${M(2.8)} h${M(0.8)}" stroke="${INK_SOFT}" stroke-width="${LINE_W.thin * mfr}" fill="none"/>`;
    } else {
      out += `<path d="M${x},${cy + M(1.5)} h${M(2)} l${M(2.6)},${M(-2.8)} m${M(0.6)},${M(2.8)} h${M(0.8)}" stroke="${INK_SOFT}" stroke-width="${LINE_W.thin * mfr}" fill="none"/>`;
    }
    out += `<text x="${x + M(cols.pin)}" y="${cy + M(2.3)}" font-size="${svgFontSizeFor(pinLabel, TEXT_H.small * mfr, true)}" font-family="monospace" fill="${INK_SOFT}">${pinLabel}</text>`;
    out += `<text x="${x + M(cols.ref)}" y="${cy + M(2.3)}" font-size="${svgFontSize(TEXT_H.small * mfr, true)}" font-family="monospace" fill="#7a4ec2">/${devLocation(c)}</text>`;
  });
  if (contacts.length > MAXROWS) {
    out += `<text x="${x}" y="${y0 + MAXROWS * rowH + 2 * mfr}" font-size="${svgFontSize(TEXT_H.small * mfr, true)}" font-family="monospace" fill="${INK_SOFT}">+${contacts.length - MAXROWS} …</text>`;
  }
  out += `</g>`;
  return out;
}

/* ── テキスト ── */
function textsSVG(page, opts = {}) {
  let out = "";
  const print = !!opts.print;
  const fr = contentScale();
  page.texts.forEach(t => {
    const h = textHeight(t) * fr;   // 用紙上の文字高 × 尺度
    const selected = !print && App.selection.has(t.id);
    if (selected) {
      const wApprox = t.text.length * h * 0.62 + 2 * fr;
      out += `<rect x="${t.x - wApprox / 2}" y="${t.y - h}" width="${wApprox}" height="${h + 2.5 * fr}" fill="rgba(31,122,224,.1)" stroke="${SEL}" stroke-width="${LINE_W.thin * fr}" rx="${0.8 * fr}"/>`;
    }
    // noMin: 取り込んだ図面の文字は元の寸法に忠実に (和文の最小呼びへ持ち上げない)
    out += `<text x="${t.x}" y="${t.y}" font-size="${svgFontSizeFor(t.text, h, false, { noMin: !!t.noMin })}" text-anchor="${t.anchor || "middle"}" fill="${INK}" data-id="${t.id}" class="cadtext" font-family="sans-serif">${escXML(t.text)}</text>`;
  });
  return out;
}
/** 自由文字の高さ (既定は JIS Z 8313 の呼び 3.5mm) */
function textHeight(t) { return t.size || TEXT_H.normal; }

/* ── オーバーレイ (ピン / 作図中ワイヤ / ゴースト / ラバーバンド) ── */
/* ══════════════ 表紙・目次・仕様 (図面集の頭 3 枚) ══════════════
   図枠 (輪郭線・表題欄) は回路ページと同じものを使い、その内側へ描く。
   中身はページの内容から毎回組み立てる — 目次はページを足せば自動で増える */
function sheetInner() {
  const { w, h, margin: m, marginLeft: ml } = SHEET;
  return { x: ml, y: m, w: w - ml - m, h: h - 2 * m };
}
/** 罫線つきの表 (目次・仕様で共用)。cols = [{w, align}] / rows = [[cell…]] */
function tableSVG(x, y, cols, rows, o = {}) {
  const rh = o.rh || 8, th = o.th || TEXT_H.normal;
  const W = cols.reduce((a, c) => a + c.w, 0);
  let d = "";
  for (let i = 0; i <= rows.length; i++) d += `M${x},${y + i * rh} H${x + W} `;
  let ax = x;
  cols.forEach((c, i) => { d += `M${ax},${y} V${y + rows.length * rh} `; ax += c.w; });
  d += `M${x + W},${y} V${y + rows.length * rh}`;
  let out = `<path d="${d}" stroke="${INK}" stroke-width="${LINE_W.thin}" fill="none"/>`;
  rows.forEach((row, r) => {
    let cx = x;
    row.forEach((cell, i) => {
      const c = cols[i] || cols[cols.length - 1];
      const al = c.align || "middle";
      const tx = al === "start" ? cx + 2 : al === "end" ? cx + c.w - 2 : cx + c.w / 2;
      if (cell !== "" && cell != null) {
        out += `<text x="${tx}" y="${y + r * rh + rh / 2 + th * 0.36}" font-size="${svgFontSizeFor(String(cell), th)}" text-anchor="${al}" fill="${INK}" font-family="sans-serif">${escXML(String(cell))}</text>`;
      }
      cx += c.w;
    });
  });
  return out;
}
/** 表紙 — 客先名と装置名を中央に置き、下線を引く */
function coverSVG(page) {
  const b = sheetInner();
  const cx = b.x + b.w / 2;
  const cust = (page.cover && page.cover.customer) || "";
  const title = (page.cover && page.cover.title !== undefined && page.cover.title !== "")
    ? page.cover.title : (App.project.name || "");
  const line = (y, txt, size) => {
    if (!txt) return "";
    const wdt = Math.max(textWidthMM(txt, size) + 24, b.w * 0.45);
    return `<text x="${cx}" y="${y}" font-size="${svgFontSizeFor(txt, size)}" text-anchor="middle" fill="${INK}" font-family="sans-serif" font-weight="600">${escXML(txt)}</text>` +
      `<path d="M${cx - wdt / 2},${y + 2.5} H${cx + wdt / 2}" stroke="${INK}" stroke-width="${LINE_W.thin}"/>`;
  };
  return line(b.y + b.h * 0.34, cust, 7) + line(b.y + b.h * 0.47, title, 7);
}
/** 目次 — ページ名と図番。行が多ければ 2 段組にする (実務の目次の作法) */
function tocSVG(page) {
  const b = sheetInner();
  const rows = tocRows();
  // 行が少ないうちは 1 列で十分 (2 列に割ると右へ 1 行だけ飛んで読みにくい)
  const per = rows.length <= 14 ? rows.length : Math.ceil(rows.length / 2);
  const cols = [{ w: 78, align: "middle" }, { w: 22, align: "middle" }];
  const head = ["名称", "項"];
  let out = `<text x="${b.x + 4}" y="${b.y + 10}" font-size="${svgFontSizeFor("目次", 5)}" fill="${INK}" font-family="sans-serif">目次</text>`;
  const y0 = b.y + 18;
  const left = rows.slice(0, per), right = rows.slice(per);
  out += tableSVG(b.x + 8, y0, cols, [head, ...left.map(r => [r.name, r.no])]);
  if (right.length) out += tableSVG(b.x + 8 + 100 + 16, y0, cols, [head, ...right.map(r => [r.name, r.no])]);
  return out;
}
/** 仕様 — 選ぶだけのチェックシート。選んだ項目に ◯ を打つ */
function specSVG(page) {
  const b = sheetInner();
  const sel = (page.spec && page.spec.sel) || {};
  const memo = (page.spec && page.spec.memo) || {};
  let out = "";
  Editor.specBoxes = [];        // 選択肢の枠 (図面座標)。クリック判定に使う
  const colW = (b.w - 16) / 2;
  SPEC_FORM.forEach((sec, si) => {
    const x = b.x + 6 + si * (colW + 4);
    let y = b.y + 12;
    out += `<text x="${x}" y="${y}" font-size="${svgFontSizeFor(sec.title, 5)}" fill="${INK}" font-family="sans-serif">${escXML(sec.title)}</text>`;
    y += 8;
    sec.groups.forEach(g => {
      out += `<text x="${x}" y="${y}" font-size="${svgFontSizeFor(g.name, TEXT_H.normal)}" fill="${INK}" font-family="sans-serif">${escXML(g.name)}</text>`;
      y += 3;
      const rh = 7.5, ow = colW - 6;
      g.opts.forEach((opt, oi) => {
        const on = sel[g.k] === oi;
        const cy = y + rh / 2;
        // 選択マーク: 選んだ番号を ◯ で囲む (図面の様式と同じ)
        Editor.specBoxes.push({ x, y, w: ow, h: rh, k: g.k, i: oi });
        out += `<rect x="${x}" y="${y}" width="${ow}" height="${rh}" fill="none" stroke="${INK}" stroke-width="${LINE_W.thin}" class="spec-opt" data-k="${g.k}" data-i="${oi}"/>`;
        out += `<text x="${x + 6}" y="${cy + 1.2}" font-size="${svgFontSizeFor(String(oi + 1), TEXT_H.small)}" text-anchor="middle" fill="${INK}" font-family="sans-serif">${oi + 1}</text>`;
        if (on) out += `<circle cx="${x + 6}" cy="${cy}" r="2.6" fill="none" stroke="${INK}" stroke-width="${LINE_W.thin}"/>`;
        out += `<text x="${x + 11}" y="${cy + 1.2}" font-size="${svgFontSizeFor(opt, TEXT_H.small)}" fill="${INK}" font-family="sans-serif">${escXML(opt)}</text>`;
        if (g.fixed && oi === 0) {
          out += `<text x="${x + ow - 2}" y="${cy + 1.2}" font-size="${svgFontSizeFor(g.fixed, TEXT_H.small)}" text-anchor="end" fill="${INK}" font-family="sans-serif">${escXML(g.fixed)}</text>`;
        }
        y += rh;
      });
      if (g.memo && memo[g.k]) {
        out += `<text x="${x + 2}" y="${y + 4}" font-size="${svgFontSizeFor(memo[g.k], TEXT_H.small)}" fill="${INK}" font-family="sans-serif">${escXML(g.memo)}: ${escXML(memo[g.k])}</text>`;
        y += 6;
      }
      y += 3;
    });
  });
  return out;
}
/** 頭 3 枚の中身 (図枠の内側に描く) */
function kindSVG(page) {
  if (page.kind === "cover") return coverSVG(page);
  if (page.kind === "toc") return tocSVG(page);
  if (page.kind === "spec") return specSVG(page);
  return "";
}

function overlaySVG(page) {
  let out = "";
  const toolWire = App.tool === "wire";
  // 未接続ピン = 赤丸 (EPLAN流)。配線ツール中は全ピン表示
  const wireEndpoints = new Set();
  page.wires.forEach(w => w.pts.forEach(p => wireEndpoints.add(ptKey(p[0], p[1]))));
  const wireSegs = [];
  page.wires.forEach(w => { for (let i = 0; i < w.pts.length - 1; i++) wireSegs.push([w.pts[i], w.pts[i + 1]]); });
  page.devices.forEach(dev => {
    devPins(dev).forEach(pin => {
      const connected = wireEndpoints.has(ptKey(pin.x, pin.y)) ||
        wireSegs.some(([a, b]) => ptOnSeg(pin.x, pin.y, a[0], a[1], b[0], b[1])) ||
        page.devices.some(d2 => d2 !== dev && devPins(d2).some(p2 => Math.abs(p2.x - pin.x) < .01 && Math.abs(p2.y - pin.y) < .01));
      if (!connected) {
        out += `<circle cx="${pin.x}" cy="${pin.y}" r="0.9" fill="#d43f3f"/>`;
      } else if (toolWire) {
        out += `<circle cx="${pin.x}" cy="${pin.y}" r="0.8" fill="none" stroke="#1f7ae0" stroke-width="0.3"/>`;
      }
    });
  });
  // ホバー中のピン強調
  if (Editor.hover.pin) {
    const p = Editor.hover.pin;
    out += `<circle cx="${p.x}" cy="${p.y}" r="1.8" fill="none" stroke="#1f7ae0" stroke-width="0.5"/>`;
  }
  // 作図中ワイヤ
  if (Editor.wireDraft) {
    const d = Editor.wireDraft;
    const pts = [...d.pts, ...(d.cur ? routeOrtho(d.pts[d.pts.length - 1], d.cur) : [])];
    if (pts.length >= 2) {
      out += `<path d="M${pts.map(p => p[0] + "," + p[1]).join(" L")}" stroke="${SEL}" stroke-width="0.55" fill="none" stroke-dasharray="2 1.4"/>`;
    }
    out += `<circle cx="${d.pts[0][0]}" cy="${d.pts[0][1]}" r="1" fill="${SEL}"/>`;
  }
  // 配置ゴースト
  if (Editor.ghost) {
    const g = Editor.ghost;
    const sym = symOf(g.symId);
    out += `<g transform="translate(${g.x},${g.y}) rotate(${g.rot || 0})" opacity="0.55" style="color:${SEL}">${symBodySVG(sym, { strokeWidth: LINE_W.thick, textScale: 1, rot: g.rot || 0 })}</g>`;
    devPinsOf(g).forEach(p => { out += `<circle cx="${p.x}" cy="${p.y}" r="0.9" fill="${SEL}"/>`; });
  }
  // ラバーバンド (右→左ドラッグは交差選択: 緑破線)
  if (Editor.drag && Editor.drag.type === "rubber") {
    const { x0, y0, x1, y1 } = Editor.drag;
    const crossing = x1 < x0;
    const color = crossing ? "#0aa64b" : SEL;
    out += `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" fill="${crossing ? "rgba(10,166,75,.07)" : "rgba(31,122,224,.08)"}" stroke="${color}" stroke-width="0.35" stroke-dasharray="${crossing ? "1 1.2" : "2 1.5"}"/>`;
  }
  return out;
}
function devPinsOf(ghost) {
  const sym = symOf(ghost.symId);
  return sym.pins.map(p => pinAbs({ x: ghost.x, y: ghost.y, rot: ghost.rot || 0 }, p));
}

/** 直交ルーティング: a→b を L字で結ぶ (水平優先/垂直優先を自動判定) */
function routeOrtho(a, b) {
  if (Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01) return [b];
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
  return dx > dy ? [[b[0], a[1]], b] : [[a[0], b[1]], b];
}

function escXML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ══════════════ ヒットテスト ══════════════ */
function hitTest(wx, wy) {
  const page = curPage();
  const cands = [];
  // テキスト (最前面)
  for (let i = page.texts.length - 1; i >= 0; i--) {
    const t = page.texts[i];
    const fr = contentScale();
    const th = textHeight(t) * fr;
    const w = t.text.length * th * 0.62 + 2 * fr, h = th + 2 * fr;
    if (wx > t.x - w / 2 && wx < t.x + w / 2 && wy > t.y - h && wy < t.y + 1.5) cands.push({ type: "text", obj: t });
  }
  /* ワイヤは機器より先に拾う。機器の外形箱 (bounds) は線より広いので、
     機器と重なった導体が箱に食われて選べなくなる (囲み記号や端子を貫く線) */
  for (let i = page.wires.length - 1; i >= 0; i--) {
    const w = page.wires[i];
    for (let j = 0; j < w.pts.length - 1; j++) {
      if (distToSeg(wx, wy, w.pts[j], w.pts[j + 1]) < 1.6) { cands.push({ type: "wire", obj: w }); break; }
    }
  }
  // 破線枠 (枠線の近傍のみ。内側は空クリック扱いにして中の機器を選べるように)。
  // 機器より先 — 機器の外形箱が枠線に乗ると枠を選べなくなるため
  const zs = pageZones(page);
  for (let i = zs.length - 1; i >= 0; i--) {
    const z = zs[i];
    const near = (a, b) => distToSeg(wx, wy, a, b) < 2;
    if (near([z.x, z.y], [z.x + z.w, z.y]) || near([z.x + z.w, z.y], [z.x + z.w, z.y + z.h]) ||
        near([z.x + z.w, z.y + z.h], [z.x, z.y + z.h]) || near([z.x, z.y + z.h], [z.x, z.y])) {
      cands.push({ type: "zone", obj: z });
    }
  }
  // デバイス
  for (let i = page.devices.length - 1; i >= 0; i--) {
    const d = page.devices[i];
    const sym = symOf(d.sym);
    if (sym.enclosure) {
      /* 囲み記号 (多芯ケーブル・シールド) は輪郭の近傍だけを拾う。
         面全体で拾うと、囲んだ導体や下の破線枠が選べなくなる。
         輪郭は長円 = 芯 (ローカル (0,0)〜(0,span-10)) から半幅 enclosure の等距離線 */
      const st = Math.max(0, (sym.span || (sym.stretch && sym.stretch.def) || 25) - 10);
      const p0 = pinAbs(d, { x: 0, y: 0 }), p1 = pinAbs(d, { x: 0, y: st });
      if (Math.abs(distToSeg(wx, wy, [p0.x, p0.y], [p1.x, p1.y]) - sym.enclosure) < 2.5) {
        cands.push({ type: "device", obj: d });
      }
      continue;
    }
    const b = devBounds(d);
    if (wx > b.x - 1.5 && wx < b.x + b.w + 1.5 && wy > b.y - 1.5 && wy < b.y + b.h + 1.5) cands.push({ type: "device", obj: d });
  }
  if (!cands.length) return null;
  // 選択中のものが重なりの中にあればそれを返す (選択済みの機器を、上に重なる
  // 導体や枠線ごしにつまんでドラッグ・shift+クリックで外せるように)
  return cands.find(c => App.selection.has(c.obj.id)) || cands[0];
}
/** 直交線分と矩形の交差判定 (交差選択用) */
function segIntersectsRect(a, b, x0, y0, x1, y1) {
  const sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]);
  const sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
  return sx0 <= x1 && sx1 >= x0 && sy0 <= y1 && sy1 >= y0;
}
function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(px - cx, py - cy);
}
/** 近傍ピン検索 */
function findPinNear(wx, wy, radius = 3) {
  const page = curPage();
  let best = null, bd = radius;
  page.devices.forEach(dev => {
    devPins(dev).forEach(pin => {
      const d = Math.hypot(pin.x - wx, pin.y - wy);
      if (d < bd) { bd = d; best = { ...pin, dev }; }
    });
  });
  return best;
}

/* ══════════════ 操作 (マウス) ══════════════ */
function setupEditor() {
  const svg = document.getElementById("canvas");
  Editor.svg = svg;
  svg.innerHTML = `<g id="world">
    <g id="lySheet"></g><g id="lyWires"></g><g id="lyDevices"></g><g id="lyTexts"></g><g id="lyOverlay"></g>
  </g>`;
  Editor.layers = {
    sheet: svg.querySelector("#lySheet"),
    wires: svg.querySelector("#lyWires"),
    devices: svg.querySelector("#lyDevices"),
    texts: svg.querySelector("#lyTexts"),
    overlay: svg.querySelector("#lyOverlay"),
  };

  // ズーム倍率 (1ノッチあたりの%)。表示メニュー「ズーム速度…」で調節・保存
  Editor.zoomStep = (() => {
    const v = parseFloat(localStorage.getItem("electracad.zoomStep"));
    return (v >= 0.04 && v <= 0.5) ? v : 0.18;
  })();
  Editor.wheelAcc = 0;
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    // Shift+ホイール = 横スクロール / Ctrl+ホイール = 微調整 / ホイール = 段階ズーム
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;      // 行単位デバイスをピクセル相当へ
    else if (e.deltaMode === 2) dy *= 120;
    if (e.shiftKey) {
      Editor.view.tx -= (dy !== 0 ? dy : e.deltaX) * 0.6;
      requestRender();
      return;
    }
    // 段階式ズーム: ホイール1ノッチ = 1ステップ (タッチパッドは累積で1ステップ扱い)
    Editor.wheelAcc += dy;
    const NOTCH = 100;
    let steps = 0;
    while (Editor.wheelAcc <= -NOTCH) { Editor.wheelAcc += NOTCH; steps++; }
    while (Editor.wheelAcc >= NOTCH) { Editor.wheelAcc -= NOTCH; steps--; }
    if (!steps) return;
    const step = e.ctrlKey ? Editor.zoomStep / 3 : Editor.zoomStep;
    zoomAt(e.clientX, e.clientY, Math.pow(1 + step, steps));
  }, { passive: false });

  svg.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("contextmenu", e => { e.preventDefault(); cancelDraft(); });
  window.addEventListener("resize", requestRender);
}

function cancelDraft() {
  if (Editor.wireDraft) { Editor.wireDraft = null; requestRender(); }
  if (Editor.ghost) { Editor.ghost = null; Editor.svg.style.cursor = ""; requestRender(); }
}
/** 配線作図中に1頂点戻る (Backspace) */
function wireDraftBack() {
  const d = Editor.wireDraft;
  if (!d) return false;
  if (d.pts.length <= 1) { Editor.wireDraft = null; } else { d.pts.pop(); }
  requestRender();
  return true;
}

function onMouseDown(e) {
  const svg = Editor.svg;
  if (App.tool !== "text") svg.focus();
  const w = screenToWorld(e.clientX, e.clientY);
  const sx = snap(w.x), sy = snap(w.y);

  // 中ボタン or パンツール or Space → パン
  if (e.button === 1 || App.tool === "pan" || Editor.spaceHeld) {
    Editor.drag = { type: "pan", startX: e.clientX, startY: e.clientY, tx0: Editor.view.tx, ty0: Editor.view.ty };
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  // ゴースト配置中 → 配置確定
  if (Editor.ghost) {
    placeGhost();
    return;
  }

  // シミュレーションモード → 入力機器の操作
  if (App.sim.running) {
    const hit = hitTest(w.x, w.y);
    if (hit && hit.type === "device") {
      const sym = symOf(hit.obj.sym);
      if ((sym.sim === "contact_no" || sym.sim === "contact_nc" ||
           sym.sim === "contact2_nc" || sym.sim === "changeover") && !hit.obj.linkTo) {
        if (sym.momentary) {
          App.sim.states[hit.obj.id] = true;
          Editor.drag = { type: "simhold", devId: hit.obj.id };
        } else {
          App.sim.states[hit.obj.id] = !App.sim.states[hit.obj.id];
        }
        simSolve();
        requestRender();
      } else if (sym.sim === "passthru3" || sym.sim === "passthru2") {
        // サーマルリレー: クリックでトリップ模擬 (95-96が開き、97-98が閉じる)
        App.sim.states[hit.obj.id] = !App.sim.states[hit.obj.id];
        UI.setMsg(App.sim.states[hit.obj.id]
          ? `${hit.obj.tag} をトリップさせました (過負荷模擬)`
          : `${hit.obj.tag} を復帰させました`);
        simSolve();
        requestRender();
      }
    }
    return;
  }

  /* 仕様ページ: 選択肢の枠をクリックすると ◯ が移る (選ぶだけの様式)。
     回路は描かないページなので、作図ツールはここで打ち切る */
  if (curPage().kind) {
    if (curPage().kind === "spec") {
      const box = (Editor.specBoxes || []).find(o =>
        w.x >= o.x && w.x <= o.x + o.w && w.y >= o.y && w.y <= o.y + o.h);
      if (box) {
        commit();
        const pg = curPage();
        pg.spec = pg.spec || defaultSpec();
        pg.spec.sel[box.k] = box.i;
        requestRender();
        UI.setMsg("仕様を選びました (クリックで ◯ が移ります)");
        return;
      }
    }
    return;
  }
  if (App.tool === "wire") {
    const pin = findPinNear(w.x, w.y);
    const px = pin ? pin.x : sx, py = pin ? pin.y : sy;
    if (!Editor.wireDraft) {
      Editor.wireDraft = { pts: [[px, py]], cur: null };
    } else {
      const last = Editor.wireDraft.pts[Editor.wireDraft.pts.length - 1];
      const seg = routeOrtho(last, [px, py]);
      Editor.wireDraft.pts.push(...seg);
      // ピン上 or 既存ワイヤ上でクリックしたら完了
      const onWire = curPage().wires.some(wr => {
        for (let i = 0; i < wr.pts.length - 1; i++) {
          if (ptOnSeg(px, py, wr.pts[i][0], wr.pts[i][1], wr.pts[i + 1][0], wr.pts[i + 1][1])) return true;
          if (Math.abs(wr.pts[i][0] - px) < .01 && Math.abs(wr.pts[i][1] - py) < .01) return true;
        }
        return false;
      });
      if (pin || onWire) finishWireDraft();
    }
    requestRender();
    return;
  }

  if (App.tool === "text") {
    e.preventDefault(); // SVGへのフォーカス移動で入力欄が即blurするのを防ぐ
    UI.openTextInput(e.clientX, e.clientY, sx, sy);
    return;
  }

  // 選択ツール
  /* 選択中の破線枠のつまみが最優先 (枠線や中の機器より先に拾う)。
     つまんだ縁だけを動かして幅・高さを変える */
  const zl = zoneLabelAt(curPage(), w.x, w.y);
  if (zl) {
    // 破線枠のコメントだけを動かす (枠そのものは動かさない)
    const f0 = contentScale();
    Editor.drag = { type: "zoneLabel", z: zl,
      lx0: zl.lx !== undefined ? zl.lx : ZONE_LABEL_DX * f0,
      ly0: zl.ly !== undefined ? zl.ly : ZONE_LABEL_DY * f0,
      wx0: w.x, wy0: w.y, moved: false, snapshot: JSON.stringify(App.project) };
    requestRender();
    return;
  }
  const zh = zoneHandleAt(curPage(), w.x, w.y);
  if (zh) {
    Editor.drag = { type: "zoneResize", z: zh.z, hx: zh.h.hx, hy: zh.h.hy,
      x0: zh.z.x, y0: zh.z.y, w0: zh.z.w, h0: zh.z.h, moved: false,
      snapshot: JSON.stringify(App.project) };
    requestRender();
    return;
  }
  // PLC 結線図のコメント欄 (機能欄の下線) をつまんだ → 欄だけ横に動かす
  const fc = fnColAt(curPage(), w.x, w.y);
  if (fc) {
    Editor.drag = { type: "fnCol", dev: fc.dev, dx0: devFnDx(fc.dev),
      wx0: w.x, wy0: w.y, moved: false, snapshot: JSON.stringify(App.project) };
    requestRender();
    return;
  }
  const hit = hitTest(w.x, w.y);
  if (hit) {
    const id = hit.obj.id;
    if (e.shiftKey) {
      if (App.selection.has(id)) App.selection.delete(id); else App.selection.add(id);
    } else if (!App.selection.has(id)) {
      App.selection.clear();
      App.selection.add(id);
    }
    // 移動ドラッグ準備
    Editor.drag = {
      type: "move", startW: w, moved: false,
      snapshot: JSON.stringify(App.project),
      attach: buildMoveAttachment(),
    };
    UI.showProps();
    requestRender();
  } else {
    if (!e.shiftKey) App.selection.clear();
    Editor.drag = { type: "rubber", x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: e.shiftKey };
    UI.showProps();
    requestRender();
  }
}

/** 移動対象デバイスのピンに接続するワイヤ端点を記録 */
function buildMoveAttachment() {
  const page = curPage();
  const map = []; // {wire, ptIdx, devId, dx, dy}  … dx,dy はピンからの相対(常に0)
  const selDevs = page.devices.filter(d => App.selection.has(d.id));
  const selWires = page.wires.filter(w => App.selection.has(w.id));
  selDevs.forEach(dev => {
    devPins(dev).forEach(pin => {
      page.wires.forEach(wire => {
        if (App.selection.has(wire.id)) return; // 選択ワイヤは丸ごと動く
        wire.pts.forEach((p, i) => {
          if ((i === 0 || i === wire.pts.length - 1) && Math.abs(p[0] - pin.x) < .01 && Math.abs(p[1] - pin.y) < .01) {
            map.push({ wireId: wire.id, ptIdx: i });
          }
        });
      });
    });
  });
  return {
    devIds: selDevs.map(d => ({ id: d.id, x0: d.x, y0: d.y })),
    wireIds: selWires.map(w => ({ id: w.id, pts0: deepCopy(w.pts) })),
    endpoints: map,
    textIds: page.texts.filter(t => App.selection.has(t.id)).map(t => ({ id: t.id, x0: t.x, y0: t.y })),
    zoneIds: pageZones(page).filter(z => App.selection.has(z.id)).map(z => ({ id: z.id, x0: z.x, y0: z.y })),
  };
}

function onMouseMove(e) {
  const w = screenToWorld(e.clientX, e.clientY);
  Editor.lastWorld = w;
  updateStatusCoords(w);

  if (Editor.ghost) {
    Editor.ghost.x = snap(w.x); Editor.ghost.y = snap(w.y);
    requestRender();
    return;
  }
  if (Editor.wireDraft) {
    const pin = findPinNear(w.x, w.y);
    Editor.hover.pin = pin || null;
    Editor.wireDraft.cur = pin ? [pin.x, pin.y] : [snap(w.x), snap(w.y)];
    requestRender();
    return;
  }

  const d = Editor.drag;
  if (!d) {
    // ホバー
    if (App.tool === "select" || App.sim.running) {
      // 破線枠のつまみの上ではリサイズカーソルにする (向きも縁に合わせる)
      if (App.tool === "select" && !App.sim.running) {
        const zh2 = zoneHandleAt(curPage(), w.x, w.y);
        Editor.svg.style.cursor = !zh2 ? "" :
          zh2.h.hx && zh2.h.hy ? (zh2.h.hx * zh2.h.hy > 0 ? "nwse-resize" : "nesw-resize") :
          zh2.h.hx ? "ew-resize" : "ns-resize";
      }
      const hit = hitTest(w.x, w.y);
      const newHover = hit && hit.type === "device" ? hit.obj.id : null;
      if (newHover !== Editor.hover.devId) { Editor.hover.devId = newHover; requestRender(); }
      if (App.sim.running && hit && hit.type === "device") {
        const sym = symOf(hit.obj.sym);
        const clickable = ((sym.sim === "contact_no" || sym.sim === "contact_nc") && !hit.obj.linkTo) || sym.sim === "passthru3" || sym.sim === "passthru2";
        Editor.svg.style.cursor = clickable ? "pointer" : "default";
      }
    } else if (App.tool === "wire") {
      const pin = findPinNear(w.x, w.y);
      if ((pin && !Editor.hover.pin) || (!pin && Editor.hover.pin) ||
          (pin && Editor.hover.pin && (pin.x !== Editor.hover.pin.x || pin.y !== Editor.hover.pin.y))) {
        Editor.hover.pin = pin;
        requestRender();
      }
    }
    return;
  }

  if (d.type === "pan") {
    Editor.view.tx = d.tx0 + (e.clientX - d.startX);
    Editor.view.ty = d.ty0 + (e.clientY - d.startY);
    requestRender();
    return;
  }
  if (d.type === "rubber") {
    d.x1 = w.x; d.y1 = w.y;
    requestRender();
    return;
  }
  if (d.type === "move") {
    /* 破線枠だけを動かしているときは 0.5mm 刻み。機器・配線が混ざるときは
       端子が格子から外れないよう 5mm のまま */
    const a = d.attach;
    const zonesOnly = (a.zoneIds || []).length > 0 &&
      !a.devIds.length && !a.wireIds.length && !(a.textIds || []).length;
    const st = zonesOnly ? snapZone : snap;
    let dx = st(w.x - d.startW.x), dy = st(w.y - d.startW.y);
    /* 端子どうしの吸着 — 格子だけでは真横に揃わない記号を合わせる。
       Alt を押しているあいだは切る (格子ちょうどに置きたいとき) */
    if (!zonesOnly && !e.altKey) {          // 機器・配線とも端子どうしの吸着を効かせる
      const c = alignSnapOffset(d.attach, dx, dy);
      dx += c.cx; dy += c.cy;
      d.snapped = !!(c.cx || c.cy);
    } else d.snapped = false;
    if (dx === 0 && dy === 0 && !d.moved) return;
    d.moved = true;
    applyMove(d.attach, dx, dy);
    requestRender();
  }
  if (d.type === "zoneLabel") {
    // コメントは 0.5mm 刻みで動かす (文字なので 5mm 格子だと粗すぎる)
    const q = v => Math.round(v * 2) / 2;
    const nx = q(d.lx0 + (w.x - d.wx0)), ny = q(d.ly0 + (w.y - d.wy0));
    if (nx !== d.z.lx || ny !== d.z.ly) d.moved = true;
    d.z.lx = nx; d.z.ly = ny;
    requestRender();
  }
  if (d.type === "fnCol") {
    // コメント欄は記号ローカルの横方向だけ 0.5mm 刻みで動かす (行は端子に固定)
    const l1 = devLocalXY(d.dev, w.x, w.y), l0 = devLocalXY(d.dev, d.wx0, d.wy0);
    const nd = Math.round((d.dx0 + (l1.x - l0.x)) * 2) / 2;
    if (nd !== devFnDx(d.dev)) {
      d.moved = true;
      d.dev.props = d.dev.props || {};
      if (nd) d.dev.props.fnDx = nd; else delete d.dev.props.fnDx;
      App.labelRev++;
      requestRender();
    }
  }
  if (d.type === "zoneResize") {
    /* つまんだ縁だけを 0.5mm 刻みで動かす。最小 10×10mm — 裏返さない */
    const z = d.z, MIN = 10;
    const gx = snapZone(w.x), gy = snapZone(w.y);
    if (d.hx < 0) { const nx = Math.min(gx, d.x0 + d.w0 - MIN); z.x = nx; z.w = d.x0 + d.w0 - nx; }
    if (d.hx > 0) { z.w = Math.max(MIN, gx - d.x0); }
    if (d.hy < 0) { const ny = Math.min(gy, d.y0 + d.h0 - MIN); z.y = ny; z.h = d.y0 + d.h0 - ny; }
    if (d.hy > 0) { z.h = Math.max(MIN, gy - d.y0); }
    d.moved = z.x !== d.x0 || z.y !== d.y0 || z.w !== d.w0 || z.h !== d.h0;
    requestRender();
  }
}

/* 端子どうしの吸着 (オブジェクトスナップ)。
   機器は 5mm 格子で動くので、端子の張り出しが 5mm の倍数でない記号
   (M12 コネクタなど) は配線や相手の端子と真横に揃えられない。
   格子で動かしたうえで、あと格子の半分 (2.5mm) 以内に「揃う相手」があれば、
   その差だけ足して合わせる。格子上どうしなら差は 0 か 5mm 以上なので、
   格子移動と取り合いにならない — 効くのは格子から外れた端子のときだけ */
const ALIGN_TOL = GRID / 2;
function alignSnapOffset(attach, dx, dy) {
  const page = curPage();
  const movingD = new Set(attach.devIds.map(o => o.id));
  const movingW = new Set(attach.wireIds.map(o => o.id));
  /* 動かしている機器につながっている配線は、端点が機器と一緒に動くので
     「揃える相手」から外す (自分の写しに吸い寄せられてしまう) */
  (attach.endpoints || []).forEach(ep => movingW.add(ep.wireId));
  const pins = [];
  attach.devIds.forEach(({ id, x0, y0 }) => {
    const dev = page.devices.find(d => d.id === id);
    if (dev) devPins({ ...dev, x: x0 + dx, y: y0 + dy }).forEach(p => pins.push(p));
  });
  /* 配線を動かしているときは、その頂点を「揃えたい点」として扱う。
     機器の端子が格子から外れていると、5mm 格子だけでは届かないため */
  attach.wireIds.forEach(({ id, pts0 }) => {
    pts0.forEach(q => pins.push({ x: q[0] + dx, y: q[1] + dy }));
  });
  if (!pins.length) return { cx: 0, cy: 0 };
  // 揃える相手: 静止している機器の端子と、動かしていない配線の頂点
  const xs = [], ys = [];
  page.devices.forEach(d => {
    if (movingD.has(d.id)) return;
    devPins(d).forEach(p => { xs.push(p.x); ys.push(p.y); });
  });
  page.wires.forEach(w => {
    if (movingW.has(w.id)) return;
    w.pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); });
  });
  // いちばん小さい補正を選ぶ (どの端子でも良いので、揃う組を総当たりで探す)
  const pick = (vals, cur) => {
    let bd = 0;
    vals.forEach(v => {
      const d2 = v - cur;
      if (Math.abs(d2) > 0.001 && Math.abs(d2) <= ALIGN_TOL + 0.001 && (bd === 0 || Math.abs(d2) < Math.abs(bd))) bd = d2;
    });
    return bd;
  };
  let cx = 0, cy = 0;
  pins.forEach(p => {
    const ax = pick(xs, p.x), ay = pick(ys, p.y);
    if (ax && (cx === 0 || Math.abs(ax) < Math.abs(cx))) cx = ax;
    if (ay && (cy === 0 || Math.abs(ay) < Math.abs(cy))) cy = ay;
  });
  return { cx, cy };
}

function applyMove(attach, dx, dy) {
  const page = curPage();
  attach.devIds.forEach(({ id, x0, y0 }) => {
    const dev = page.devices.find(d => d.id === id);
    if (dev) { dev.x = x0 + dx; dev.y = y0 + dy; }
  });
  attach.textIds.forEach(({ id, x0, y0 }) => {
    const t = page.texts.find(t => t.id === id);
    if (t) { t.x = x0 + dx; t.y = y0 + dy; }
  });
  (attach.zoneIds || []).forEach(({ id, x0, y0 }) => {
    const z = pageZones(page).find(z => z.id === id);
    if (z) { z.x = x0 + dx; z.y = y0 + dy; }
  });
  attach.wireIds.forEach(({ id, pts0 }) => {
    const wr = page.wires.find(w => w.id === id);
    if (wr) wr.pts = pts0.map(p => [p[0] + dx, p[1] + dy]);
  });
  // 接続ワイヤ端点の追従 + 直交補正
  attach.endpoints.forEach(ep => {
    const wr = page.wires.find(w => w.id === ep.wireId);
    if (!wr) return;
    if (ep.orig === undefined) ep.orig = deepCopy(wr.pts);
    const pts = deepCopy(ep.orig);
    const idx = ep.ptIdx;
    const old = pts[idx];
    const np = [old[0] + dx, old[1] + dy];
    pts[idx] = np;
    const adjIdx = idx === 0 ? 1 : pts.length - 2;
    if (adjIdx >= 0 && adjIdx < pts.length && adjIdx !== idx) {
      const adj = pts[adjIdx];
      const wasVert = Math.abs(ep.orig[idx][0] - ep.orig[adjIdx][0]) < 0.01;
      if (pts.length === 2) {
        // 2点ワイヤが斜めになるなら L 字に折る
        if (Math.abs(np[0] - adj[0]) > 0.01 && Math.abs(np[1] - adj[1]) > 0.01) {
          pts.length = 0;
          if (idx === 0) pts.push(np, wasVert ? [np[0], adj[1]] : [adj[0], np[1]], adj);
          else pts.push(adj, wasVert ? [np[0], adj[1]] : [adj[0], np[1]], np);
        }
      } else {
        // 多点ワイヤ: 隣接点をずらして直交を維持
        if (wasVert) adj[0] = np[0]; else adj[1] = np[1];
      }
    }
    wr.pts = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > .001 || Math.abs(p[1] - pts[i - 1][1]) > .001);
  });
}

function onMouseUp(e) {
  const d = Editor.drag;
  if (!d) return;
  Editor.drag = null;
  if (d.type === "simhold") {
    App.sim.states[d.devId] = false;
    simSolve();
    requestRender();
    return;
  }
  if (d.type === "rubber") {
    const page = curPage();
    const crossing = d.x1 < d.x0; // 右→左ドラッグ = 交差選択 (AutoCAD流)
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if (x1 - x0 > 1 || y1 - y0 > 1) {
      if (!d.additive) App.selection.clear();
      const rectHit = (bx, by, bw, bh) => crossing
        ? bx < x1 && bx + bw > x0 && by < y1 && by + bh > y0        // 交差: 一部でも触れれば選択
        : bx >= x0 && bx + bw <= x1 && by >= y0 && by + bh <= y1;   // 窓: 完全包含のみ
      page.devices.forEach(dev => {
        const b = devBounds(dev);
        if (rectHit(b.x, b.y, b.w, b.h)) App.selection.add(dev.id);
      });
      page.wires.forEach(w => {
        const inside = crossing
          ? w.pts.some((p, i) => i < w.pts.length - 1 && segIntersectsRect(p, w.pts[i + 1], x0, y0, x1, y1))
          : w.pts.every(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
        if (inside) App.selection.add(w.id);
      });
      page.texts.forEach(t => {
        if (t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) App.selection.add(t.id);
      });
      // 破線枠 (交差選択=枠線が範囲に触れる / 窓選択=枠全体が入る)
      pageZones(page).forEach(z => {
        const hit = crossing
          ? rectHit(z.x, z.y, z.w, z.h) && !(z.x < x0 && z.x + z.w > x1 && z.y < y0 && z.y + z.h > y1)
          : rectHit(z.x, z.y, z.w, z.h);
        if (hit) App.selection.add(z.id);
      });
      UI.showProps();
    }
    requestRender();
    return;
  }
  if (d.type === "zoneLabel") {
    if (d.moved) {
      App.labelRev++;
      App.undoStack.push(d.snapshot);
      if (App.undoStack.length > 100) App.undoStack.shift();
      App.redoStack.length = 0;
      saveLocal();
      UI.setMsg("破線枠のコメントを動かしました (プロパティの「位置を戻す」で既定へ)");
    }
    Editor.drag = null;
    requestRender();
    return;
  }
  if (d.type === "fnCol") {
    if (d.moved) {
      App.labelRev++;
      App.undoStack.push(d.snapshot);
      if (App.undoStack.length > 100) App.undoStack.shift();
      App.redoStack.length = 0;
      saveLocal();
      UI.setMsg(`コメント欄を動かしました (${devFnDx(d.dev) >= 0 ? "+" : ""}${devFnDx(d.dev)}mm — プロパティの「既定に戻す」で元へ)`);
      UI.showProps();
    }
    Editor.drag = null;
    requestRender();
    return;
  }
  if (d.type === "zoneResize") {
    if (d.moved) {
      App.labelRev++;
      App.undoStack.push(d.snapshot);
      if (App.undoStack.length > 100) App.undoStack.shift();
      App.redoStack.length = 0;
      saveLocal();
      UI.setMsg(`枠を ${d.z.w}×${d.z.h}mm にしました`);
    }
    requestRender();
    return;
  }
  if (d.type === "move" && d.moved) {
    // 移動確定 → Undo 履歴。commit() を通らないパスなので、ラベル配置
    // キャッシュの世代をここで進めないと画面も DXF も古い位置のまま出る
    App.labelRev++;
    App.undoStack.push(d.snapshot);
    if (App.undoStack.length > 100) App.undoStack.shift();
    App.redoStack.length = 0;
    saveLocal();
    UI.setMsg(d.snapped
      ? "端子の高さ・位置を相手に合わせました (Alt を押しながらだと格子のまま / Shift+矢印で 0.5mm 微調整)"
      : "移動しました");
    UI.showProps();      // X/Y は 0.5mm 単位で動くので、欄も動いた値に更新する
    requestRender();
  }
}

function onDblClick(e) {
  if (App.sim.running) return; // シミュレーション中は編集系ダイアログを開かない
  const w = screenToWorld(e.clientX, e.clientY);
  if (App.tool === "wire" && Editor.wireDraft) {
    finishWireDraft();
    return;
  }
  const hit = hitTest(w.x, w.y);
  if (hit && hit.type === "text") {
    UI.openTextInput(e.clientX, e.clientY, hit.obj.x, hit.obj.y, hit.obj);
  } else if (hit && hit.type === "wire") {
    // 配線ダブルクリック = 線番のインライン編集 (作図線は線番を持たないのでプロパティを開く)
    App.selection.clear();
    App.selection.add(hit.obj.id);
    if (isWireConductive(hit.obj)) UI.openWireNumInput(e.clientX, e.clientY, hit.obj);
    else UI.showProps();
    requestRender();
  } else if (hit && hit.type === "device" || hit && hit.type === "zone") {
    App.selection.clear();
    App.selection.add(hit.obj.id);
    UI.showProps(true);
    requestRender();
  } else if (!hit && inTitleBlock(w.x, w.y)) {
    UI.sheetSetup(); // 表題欄のダブルクリックで図枠設定を開く
  }
}

/** 表題欄 (右下) の内側か */
function inTitleBlock(x, y) {
  return titleBlocksRects().some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

function finishWireDraft() {
  const d = Editor.wireDraft;
  Editor.wireDraft = null;
  if (d && d.pts.length >= 2) {
    commit();
    /* raw: 作図中に決めた座標をそのまま使う。頂点は既に 5mm 格子か端子の上に
       乗せてあるので、ここで格子へ丸めると、格子から外れた端子 (M12 など) に
       合わせた端点が引き戻されて線が端子から外れる */
    const w = addWire(curPage(), d.pts, { raw: true });
    /* 線番は手で入れなくても付く: 図番×100+連番で、機器を跨ぐと区間が
       変わる。引いた瞬間に振るので、そのまま図面に表示される */
    autoNumberWires();
    UI.setMsg(w && w.num ? `配線を作成しました (線番 ${w.num} — 図番×100+連番の自動採番。手で変えると保護されます)` : "配線を作成しました");
  }
  requestRender();
}

/* ── ゴースト配置 (ライブラリから / 連続配置対応) ── */
function startGhost(symId, rot = 0) {
  if (App.sim.running) return;
  Editor.wireDraft = null; // 作図中の配線残骸を持ち込まない
  App.tool = "select";
  UI.syncToolButtons();
  Editor.ghost = { symId, x: -1000, y: -1000, rot };
  Editor.svg.style.cursor = "copy";
  UI.setMsg(`${symOf(symId).name} — クリックで連続配置 / R で回転 / Esc・右クリックで終了`);
}
function placeGhost() {
  const g = Editor.ghost;
  if (!g) return;
  commit();
  const dev = addDevice(curPage(), g.symId, g.x, g.y, { rot: g.rot });
  // 既存配線の上に置いた場合は配線を自動分割して割り込む (線の重なりを防ぐ)
  spliceDeviceIntoWires(curPage(), dev);
  /* ピンが乗った配線は「機器につながる回路」になった瞬間なので、ここで
     線番を振り直す (機器を跨いだ区間の破断もこのタイミングで反映される) */
  autoNumberWires();
  App.selection.clear();
  App.selection.add(dev.id);
  /* 入出力結線図の枠は、置いた瞬間に P24V/N24V のレールと各行の分岐を引く
     (下地はあらかじめ引いてある、が実務の姿。引き直しはプロパティから) */
  const sc = dev && symOf(dev.sym).ioSheet ? buildIoScaffold(curPage(), dev) : 0;
  UI.setMsg(`${symOf(g.symId).name} ${dev.tag || ""} を配置` +
    (sc ? ` — P24V/N24V のレールと下地を引きました` : ` — 続けてクリックで連続配置、Escで終了`));
  // ゴーストは維持して連続配置 (EPLANの挿入モード)
  UI.showProps();
  requestRender();
}

/* ══════════════ 編集操作 ══════════════ */
function deleteSelection() {
  if (App.sim.running) { UI.setMsg("シミュレーション中は編集できません (Escで終了)"); return; }
  if (!App.selection.size) return;
  commit();
  const page = curPage();
  page.devices = page.devices.filter(d => !App.selection.has(d.id));
  page.wires = page.wires.filter(w => !App.selection.has(w.id));
  page.texts = page.texts.filter(t => !App.selection.has(t.id));
  page.zones = pageZones(page).filter(z => !App.selection.has(z.id));
  // リンク切れ解消
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    if (d.linkTo && !findDevice(d.linkTo)) d.linkTo = null;
  }));
  // 機器が消えて回路でなくなった線から自動線番を外す (手動線番は保護)
  autoNumberWires();
  App.selection.clear();
  UI.setMsg("削除しました");
  UI.showProps();
  requestRender();
}

function rotateSelection() {
  if (App.sim.running) { UI.setMsg("シミュレーション中は編集できません (Escで終了)"); return; }
  // ゴースト配置中は配置前プレビューを回転
  if (Editor.ghost) {
    Editor.ghost.rot = ((Editor.ghost.rot || 0) + 90) % 360;
    requestRender();
    return;
  }
  const page = curPage();
  const devs = page.devices.filter(d => App.selection.has(d.id));
  const selWires = page.wires.filter(w => App.selection.has(w.id));
  const selTexts = page.texts.filter(t => App.selection.has(t.id));
  if (!devs.length && !selWires.length) {
    UI.setMsg("回転するデバイスを選択してください");
    return;
  }

  // ── セーフティネット: 回転で DRC 指摘が増える (= 回路が壊れる) 場合は
  //    自動で取り消して警告する。電気CADで無音の破壊は許されない。──
  const issuesBefore = runDRC().length;
  const snapshot = JSON.stringify(App.project);

  if (devs.length === 1 && selWires.length === 0) {
    const dev = devs[0];
    const attached = collectAttachedEndpoints(page, [dev]);
    commit();
    dev.rot = ((dev.rot || 0) + 90) % 360;
    reattachAfterTransform(page, [dev], attached);
    if (!rotateGuard(snapshot, issuesBefore)) return;
    UI.setMsg("回転しました (接続配線を追従)");
    requestRender();
    return;
  }
  commit();

  if (devs.length + selWires.length >= 1) {
    // ── ブロック回転: 選択全体を共通中心のまわりに +90° 回す ──
    // (デバイス個別回転では接続が壊れるため、配線・テキストも含めて座標変換する)
    // 中心は「配置点・配線点」のバウンディングボックスから取る。回転は等長変換なので
    // この中心は押すたびに不変になり、R×4 で平行移動ドリフトしない。
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    devs.forEach(d => { minX = Math.min(minX, d.x); minY = Math.min(minY, d.y); maxX = Math.max(maxX, d.x); maxY = Math.max(maxY, d.y); });
    selWires.forEach(w => w.pts.forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }));
    selTexts.forEach(t => { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y); });
    // 2.5mm 倍数の中心なら 90° 回転後もグリッドに乗る
    const cx = Math.round((minX + maxX) / 5) * 2.5, cy = Math.round((minY + maxY) / 5) * 2.5;
    const rot = (x, y) => [cx - (y - cy), cy + (x - cx)]; // +90° (時計回り)
    const attached = collectAttachedEndpoints(page, devs);
    // 選択配線の端点が「選択外デバイスのピン」に乗っている場合は位置を記録し、
    // 回転後もそのピンへ繋ぎ直す (部分選択で接続が千切れるのを防ぐ)
    const anchors = [];
    selWires.forEach(w => {
      [0, w.pts.length - 1].forEach(idx => {
        const p = w.pts[idx];
        const anchored = page.devices.some(d => !App.selection.has(d.id) &&
          devPins(d).some(pin => Math.abs(pin.x - p[0]) < .01 && Math.abs(pin.y - p[1]) < .01));
        if (anchored) anchors.push({ w, isStart: idx === 0, x: p[0], y: p[1] });
      });
    });
    devs.forEach(d => {
      [d.x, d.y] = rot(d.x, d.y);
      d.rot = ((d.rot || 0) + 90) % 360;
    });
    selWires.forEach(w => { w.pts = w.pts.map(p => rot(p[0], p[1])); });
    selTexts.forEach(t => { [t.x, t.y] = rot(t.x, t.y); });
    // 選択外の接続ワイヤ端点を新しいピン位置へ追従
    reattachAfterTransform(page, devs, attached);
    // 選択配線の固定側端点を元のピンへ戻す
    anchors.forEach(a => moveWireEndpoint(a.w, a.isStart ? 0 : a.w.pts.length - 1, [a.x, a.y]));
    if (!rotateGuard(snapshot, issuesBefore)) return;
    UI.setMsg(anchors.length
      ? "ブロック回転しました (選択外デバイスへの接続は維持)"
      : "ブロック回転しました (選択全体を +90°)");
  }
  requestRender();
}

/** 回転後にDRC指摘が増えていたら回転自体を取り消す。true=続行可 */
function rotateGuard(snapshot, issuesBefore) {
  const after = runDRC();
  if (after.length <= issuesBefore) return true;
  // 何が起きるのかを具体的に伝える (図枠外へ出る / 接続が切れる など)
  const frameIssue = after.find(i => /図枠|表題欄/.test(i.msg));
  App.project = JSON.parse(snapshot);
  App.undoStack.pop(); // commit() で積んだ分を捨てる (取り消したので履歴に残さない)
  retainSelection();
  UI.setMsg(frameIssue
    ? "⚠ 回転すると図枠からはみ出すため中止しました — 用紙を大きくするか選択範囲を狭めてください"
    : "⚠ 回転すると回路の接続が壊れるため中止しました — 配線を外してから回転してください");
  requestRender();
  return false;
}

/** 選択デバイスのピンに乗っているワイヤ端点を記録 (選択済みワイヤは除外) */
function collectAttachedEndpoints(page, devs) {
  const attached = [];
  devs.forEach(dev => {
    const before = devPins(dev);
    page.wires.forEach(wire => {
      if (App.selection.has(wire.id)) return;
      wire.pts.forEach((p, i) => {
        if (i !== 0 && i !== wire.pts.length - 1) return;
        before.forEach((pin, pi) => {
          if (Math.abs(p[0] - pin.x) < .01 && Math.abs(p[1] - pin.y) < .01) attached.push({ wire, i, dev, pi });
        });
      });
    });
  });
  return attached;
}
function reattachAfterTransform(page, devs, attached) {
  attached.forEach(({ wire, i, dev, pi }) => {
    const after = devPins(dev);
    if (after[pi]) moveWireEndpoint(wire, i, [after[pi].x, after[pi].y]);
  });
}

/** ワイヤ端点を np へ移し、隣接点をずらして直交を維持する */
function moveWireEndpoint(wire, idx, np) {
  const pts = wire.pts;
  const old = pts[idx];
  const adjIdx = idx === 0 ? 1 : pts.length - 2;
  const wasVert = adjIdx >= 0 && Math.abs(old[0] - pts[adjIdx][0]) < 0.01;
  pts[idx] = np;
  if (adjIdx < 0 || adjIdx === idx) return;
  const adj = pts[adjIdx];
  if (Math.abs(np[0] - adj[0]) > 0.01 && Math.abs(np[1] - adj[1]) > 0.01) {
    if (pts.length === 2) {
      const mid = wasVert ? [np[0], adj[1]] : [adj[0], np[1]];
      pts.splice(idx === 0 ? 1 : 1, 0, mid);
    } else {
      if (wasVert) adj[0] = np[0]; else adj[1] = np[1];
    }
  }
  wire.pts = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > .001 || Math.abs(p[1] - pts[i - 1][1]) > .001);
}

function copySelection() {
  const page = curPage();
  const devs = page.devices.filter(d => App.selection.has(d.id));
  const wires = page.wires.filter(w => App.selection.has(w.id));
  const texts = page.texts.filter(t => App.selection.has(t.id));
  const zones = pageZones(page).filter(z => App.selection.has(z.id));
  if (!devs.length && !wires.length && !texts.length && !zones.length) return;
  App.clipboard = deepCopy({ devs, wires, texts, zones });
  // 貼り付け先の尺度が違うときに配置を合わせられるよう、コピー元の尺度を控える
  App.clipboard.scale = pageSheetMeta(page).scale;
  UI.setMsg(`${devs.length + wires.length + texts.length + zones.length} 個をコピーしました`);
}

function pasteClipboard() {
  if (App.sim.running) { UI.setMsg("シミュレーション中は編集できません (Escで終了)"); return; }
  if (!App.clipboard) return;
  commit();
  const page = curPage();
  const idMap = {};
  App.selection.clear();
  // 貼り付け位置: カーソル位置基準。カーソルが無効なら元位置+10mm (連続ペーストは累積)
  const cb = App.clipboard;
  // 尺度の異なるページへ貼るとき: 図記号・文字は常に 1:1 のまま、配置座標・
  // 配線経路・破線枠だけを尺度比で伸縮し、図枠に対する見た目 (占める割合) を保つ。
  // 尺度変更が図枠だけを広げる仕様と同じ考え方。端子の張り出しは伸縮しないので、
  // 端子につながっていた配線の端点は貼り付け後に端子へ吸着し直す
  const fSrc = scaleFactor(cb.scale || pageSheetMeta(page).scale);
  const fDst = scaleFactor(pageSheetMeta(page).scale);
  const kf = fSrc > 0 && fDst > 0 ? fDst / fSrc : 1;
  const rs = v => Math.round(v * kf * 100) / 100;
  const pinHooks = [];               // 元座標での「配線端点 ⇔ 機器端子」の接続
  if (kf !== 1) cb.wires.forEach((w0, wi) => [...new Set([0, w0.pts.length - 1])].forEach(pi => {
    const pt = w0.pts[pi];
    cb.devs.forEach((d0, di) => devPins(d0).forEach(pn => {
      if (Math.abs(pn.x - pt[0]) < 0.01 && Math.abs(pn.y - pt[1]) < 0.01)
        pinHooks.push({ wi, end: pi === 0 ? 0 : 1, di, pin: pn.idx });
    }));
  }));
  let minX = Infinity, minY = Infinity;
  cb.devs.forEach(d => { minX = Math.min(minX, rs(d.x)); minY = Math.min(minY, rs(d.y)); });
  cb.wires.forEach(w => w.pts.forEach(p => { minX = Math.min(minX, rs(p[0])); minY = Math.min(minY, rs(p[1])); }));
  cb.texts.forEach(t => { minX = Math.min(minX, rs(t.x)); minY = Math.min(minY, rs(t.y)); });
  (cb.zones || []).forEach(z => { minX = Math.min(minX, rs(z.x)); minY = Math.min(minY, rs(z.y)); });
  if (!isFinite(minX)) { minX = 0; minY = 0; }
  let dx, dy;
  const lw = Editor.lastWorld;
  if (lw && lw.x > -20 && lw.x < SHEET.w + 20 && lw.y > -20 && lw.y < SHEET.h + 20) {
    dx = snap(lw.x) - minX; dy = snap(lw.y) - minY;
  } else {
    cb.pasteCount = (cb.pasteCount || 0) + 1;
    dx = 10 * cb.pasteCount; dy = 10 * cb.pasteCount;
  }
  // 同じ位置への連続ペーストは 10mm ずつずらして完全重畳を防ぐ
  const key = dx + "," + dy;
  if (cb.lastKey !== undefined && cb.lastKey === key) {
    cb.dupCount = (cb.dupCount || 0) + 1;
    dx += 10 * cb.dupCount; dy += 10 * cb.dupCount;
  } else {
    cb.lastKey = key;
    cb.dupCount = 0;
  }
  cb.devs.forEach(d0 => {
    const d = deepCopy(d0);
    idMap[d0.id] = d.id = uid("d");
    d.x = rs(d.x) + dx; d.y = rs(d.y) + dy;
    if (kf !== 1) {                    // 図記号ごと伸縮して印刷上の大きさを保つ
      const ns = Math.round(devScale(d) * kf * 10000) / 10000;
      if (ns !== 1) d.scale = ns; else delete d.scale;
    }
    page.devices.push(d);
    App.selection.add(d.id);
  });
  // linkTo の再マップ / タグ振り直し
  let droppedGoto = 0;
  cb.devs.forEach((d0, i) => {
    const d = page.devices[page.devices.length - cb.devs.length + i];
    if (d.linkTo && idMap[d.linkTo]) d.linkTo = idMap[d.linkTo];
    // 行き先を別ページへ貼ると、指し先が貼り付け先そのものになることがある。
    // 自分の葉を指す相互参照は意味を成さないので落とす (検図でも err)
    if (symOf(d.sym).gotoRef && d.props && d.props.toPage === page.id) {
      delete d.props.toPage;
      droppedGoto++;
    }
    if (d.tag && !d.linkTo) {
      const sym = symOf(d.sym);
      if (sym.letter) d.tag = nextTag(sym.letter);
    }
  });
  cb.wires.forEach(w0 => {
    const w = deepCopy(w0);
    w.id = uid("w");
    w.pts = w.pts.map(p => [rs(p[0]) + dx, rs(p[1]) + dy]);
    if (kf !== 1) {                    // 線の太さ・線番の文字高も印刷実寸を保つ
      const ns = Math.round(objScale(w) * kf * 10000) / 10000;
      if (ns !== 1) w.scale = ns; else delete w.scale;
    }
    w.num = null;
    page.wires.push(w);
    App.selection.add(w.id);
  });
  cb.texts.forEach(t0 => {
    const t = deepCopy(t0);
    t.id = uid("t");
    t.x = rs(t.x) + dx; t.y = rs(t.y) + dy;
    if (kf !== 1) t.size = Math.round((t.size || TEXT_H.normal) * kf * 100) / 100;
    page.texts.push(t);
    App.selection.add(t.id);
  });
  // 破線枠 (コメントの位置・文字高もそのまま写す)
  (cb.zones || []).forEach(z0 => {
    const z = deepCopy(z0);
    z.id = uid("z");
    z.x = rs(z.x) + dx; z.y = rs(z.y) + dy;
    if (kf !== 1) {
      z.w = rs(z.w); z.h = rs(z.h);          // 枠の大きさも図枠に対する割合を保つ
      if (z.lx !== undefined) z.lx = rs(z.lx);
      if (z.ly !== undefined) z.ly = rs(z.ly);
      if (z.label) z.labelSize = Math.round(zoneLabelSize(z0) * kf * 100) / 100;
      const ns = Math.round(objScale(z) * kf * 10000) / 10000;
      if (ns !== 1) z.scale = ns; else delete z.scale;
    }
    pageZones(page).push(z);
    App.selection.add(z.id);
  });
  // 伸縮で端子位置 (張り出しは 1:1 のまま) からずれた配線端点を端子へ吸着し直す
  if (kf !== 1 && pinHooks.length) {
    const dBase = page.devices.length - cb.devs.length;
    const wBase = page.wires.length - cb.wires.length;
    pinHooks.forEach(h => {
      const d = page.devices[dBase + h.di], w = page.wires[wBase + h.wi];
      const pn = d && devPins(d)[h.pin];
      if (pn && w) moveWireEndpoint(w, h.end === 0 ? 0 : w.pts.length - 1, [pn.x, pn.y]);
    });
  }
  UI.setMsg("カーソル位置に貼り付けました");
  if (kf !== 1) UI.toast(`尺度 ${cb.scale} → ${pageSheetMeta(page).scale}: 図記号・文字も含めて ${Math.round(kf * 100) / 100} 倍にし、印刷上の大きさを保ちました`, 5200);
  // 黙って行き先を消すと気づけないので知らせる
  if (droppedGoto) UI.toast(`⚠ 行き先 ${droppedGoto} 個は自分のページを指すことになるため未設定にしました`, 4200);
  requestRender();
}

function nudgeSelection(dx, dy) {
  if (App.sim.running) return;
  if (!App.selection.size) return;
  commit();
  const attach = buildMoveAttachment();
  applyMove(attach, dx, dy);
  requestRender();
  // 0.5mm の微調整では、揃った/外れたが分かりにくいので座標を知らせる
  if (Math.abs(dx) < GRID && Math.abs(dy) < GRID) {
    const d0 = curPage().devices.find(dv => App.selection.has(dv.id));
    if (d0) UI.setMsg(`微調整 ${Math.abs(dx) ? "X" : "Y"} = ${(Math.abs(dx) ? d0.x : d0.y).toFixed(1)}mm (0.5mm 刻み / 矢印キーのみで 5mm)`);
  }
}

/* ══════════════ ステータスバー ══════════════ */
function updateStatusCoords(w) {
  const el = document.getElementById("stCoords");
  if (el) el.textContent = `X: ${w.x.toFixed(1)}  Y: ${w.y.toFixed(1)}`;
}
function updateStatusCount() {
  const el = document.getElementById("stCount");
  if (!el) return;
  const page = curPage();
  el.textContent = `デバイス ${page.devices.length} ・ 配線 ${page.wires.length}` +
    (App.selection.size ? ` ・ 選択 ${App.selection.size}` : "");
}

/* ══════════════ SVG エクスポート ══════════════ */
function exportSheetSVG(page = null) {
  page = page || curPage();
  applySheet(page);          // ページごとの用紙・尺度で図枠を張る
  const body =
    `<g>${sheetSVG(page, { print: true })}</g><g>${zonesSVG(page, { print: true })}</g>` +
    `<g>${wiresSVG(page, { print: true })}</g><g>${devicesSVG(page, { print: true })}</g><g>${textsSVG(page, { print: true })}</g>`;
  // viewBox は用紙そのもの (余白を足すと印刷時に尺度がずれるため)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" width="${SHEET.w / sheetScale()}mm" height="${SHEET.h / sheetScale()}mm" font-family="sans-serif">${body}</svg>`;
}
