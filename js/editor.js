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
  Editor.layers.sheet.innerHTML = sheetSVG(page);
  Editor.layers.wires.innerHTML = wiresSVG(page);
  Editor.layers.devices.innerHTML = devicesSVG(page);
  Editor.layers.texts.innerHTML = textsSVG(page);
  Editor.layers.overlay.innerHTML = overlaySVG(page);
  updateStatusCount();
}

/* ── シート (図枠 + グリッド + 表題欄) ── */
function sheetSVG(page) {
  const { w, h, margin: m, cols, rows } = SHEET;
  let out = "";
  // 影 + 用紙
  out += `<rect x="2.5" y="3.5" width="${w}" height="${h}" fill="rgba(0,0,0,.45)" rx="1"/>`;
  out += `<rect x="0" y="0" width="${w}" height="${h}" fill="#f7f8f5" rx="0.5"/>`;
  // グリッド
  let grid = "";
  for (let x = m; x <= w - m; x += GRID) grid += `M${x},${m} V${h - m}`;
  for (let y = m; y <= h - m; y += GRID) grid += `M${m},${y} H${w - m}`;
  out += `<path d="${grid}" stroke="rgba(30,50,90,.055)" stroke-width="0.3" fill="none"/>`;
  let grid2 = "";
  for (let x = m; x <= w - m; x += GRID * 4) grid2 += `M${x},${m} V${h - m}`;
  for (let y = m; y <= h - m; y += GRID * 4) grid2 += `M${m},${y} H${w - m}`;
  out += `<path d="${grid2}" stroke="rgba(30,50,90,.09)" stroke-width="0.3" fill="none"/>`;
  // 図枠 (二重線)
  out += `<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${INK}" stroke-width="0.7"/>`;
  out += `<rect x="${m - 5}" y="${m - 5}" width="${w - 2 * m + 10}" height="${h - 2 * m + 10}" fill="none" stroke="${INK}" stroke-width="0.35"/>`;
  // 列参照 (0-9) / 行参照 (A-F)
  const cw = (w - 2 * m) / cols, rh = (h - 2 * m) / rows;
  for (let i = 0; i < cols; i++) {
    const cx = m + cw * i + cw / 2;
    out += `<text x="${cx}" y="${m - 1.2}" font-size="3.4" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${i}</text>`;
    out += `<text x="${cx}" y="${h - m + 4}" font-size="3.4" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${i}</text>`;
    if (i) out += `<path d="M${m + cw * i},${m - 5} V${m}" stroke="${INK_SOFT}" stroke-width="0.25"/><path d="M${m + cw * i},${h - m} V${h - m + 5}" stroke="${INK_SOFT}" stroke-width="0.25"/>`;
  }
  for (let i = 0; i < rows; i++) {
    const cy = m + rh * i + rh / 2 + 1.2;
    const ch = String.fromCharCode(65 + i);
    out += `<text x="${m - 2.6}" y="${cy}" font-size="3.4" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${ch}</text>`;
    out += `<text x="${w - m + 2.6}" y="${cy}" font-size="3.4" text-anchor="middle" fill="${INK_SOFT}" font-family="monospace">${ch}</text>`;
    if (i) out += `<path d="M${m - 5},${m + rh * i} H${m}" stroke="${INK_SOFT}" stroke-width="0.25"/><path d="M${w - m},${m + rh * i} H${w - m + 5}" stroke="${INK_SOFT}" stroke-width="0.25"/>`;
  }
  // 表題欄 (図番・改訂・設計/検図欄つき)
  const tbW = 150, tbH = 30, tbX = w - m - tbW, tbY = h - m - tbH;
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const meta = App.project.meta || {};
  const c1 = tbX, c2 = tbX + 52, c3 = tbX + 104, c4 = tbX + 126;
  const r1 = tbY, r2 = tbY + 10, r3 = tbY + 20, r4 = tbY + tbH;
  const cell = (x, y, label, value, valSize = 3.4, bold = false) =>
    `<text x="${x + 2}" y="${y + 3.4}" font-size="2.4" fill="${INK_SOFT}">${label}</text>` +
    `<text x="${x + 2}" y="${y + 8.2}" font-size="${valSize}" fill="${INK}"${bold ? ' font-weight="bold"' : ""}>${escXML(value)}</text>`;
  out += `<g font-family="sans-serif">
    <rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="#fff" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${c1},${r2} H${tbX + tbW} M${c1},${r3} H${tbX + tbW} M${c2},${r1} V${r4} M${c3},${r1} V${r4} M${c4},${r1} V${r4}"
      stroke="${INK}" stroke-width="0.28"/>
    ${cell(c1, r1, "プロジェクト", App.project.name, 3.6, true)}
    ${cell(c2, r1, "ページ名", page.name, 3.6, true)}
    ${cell(c3, r1, "図番", meta.dwgNo || "E-" + String(page.no).padStart(3, "0"))}
    ${cell(c4, r1, "改訂", meta.rev || "0")}
    ${cell(c1, r2, "設計", meta.designer || "—")}
    ${cell(c2, r2, "検図", meta.checker || "—")}
    ${cell(c3, r2, "日付", dateStr, 3)}
    ${cell(c4, r2, "尺度", "1:1")}
    ${cell(c1, r3, "作成", "ElectraCAD Studio", 3)}
    ${cell(c2, r3, "用紙", "A3 (420×297)", 3)}
    <text x="${c3 + 2}" y="${r3 + 3.4}" font-size="2.4" fill="${INK_SOFT}">ページ</text>
    <text x="${c3 + 2}" y="${r3 + 8.6}" font-size="4.6" fill="${INK}" font-weight="bold">${page.no} / ${App.project.pages.length}</text>
    <path d="M${c4 + 8},${r3 + 6.5} l3.5,-4.5 h2.5 l-3.5,4.5 h4 l-8,3.5 2,-3.5 z" fill="#2f6fd6"/>
  </g>`;
  return out;
}

/* ── ワイヤ ── */
function wiresSVG(page) {
  let out = "";
  const sim = App.sim.running ? App.sim.energized : null;
  page.wires.forEach(w => {
    const d = "M" + w.pts.map(p => p[0] + "," + p[1]).join(" L");
    let color = INK, sw = 0.55;
    if (sim && sim.wireNet) {
      const net = sim.wireNet.get(w.id);
      if (sim.pNets.has(net) || sim.acNets.has(net)) { color = SIM_P; sw = 0.9; }
      else if (sim.nNets.has(net)) { color = SIM_N; sw = 0.9; }
    }
    const selected = App.selection.has(w.id);
    if (selected) out += `<path d="${d}" stroke="${SEL}" stroke-width="2.2" fill="none" opacity="0.28" stroke-linecap="round"/>`;
    out += `<path d="${d}" stroke="${color}" stroke-width="${sw}" fill="none" data-id="${w.id}" class="wire"/>`;
    // 当たり判定用の太い透明パス
    out += `<path d="${d}" stroke="rgba(0,0,0,0)" stroke-width="4" fill="none" data-id="${w.id}" class="wire-hit"/>`;
    // 配線番号 (numShow=false のワイヤはネット内の代表ワイヤに表示を譲る)
    if (w.num && w.numShow !== false) {
      const [mx, my, horiz] = wireLabelPos(w);
      // 縦区間は配線から法線方向 (左) にオフセットして重なりを防ぐ
      const lx = horiz ? mx : mx - 0.6, ly = horiz ? my : my;
      out += `<text x="${lx}" y="${ly}" font-size="3" fill="#7a4ec2" font-family="monospace" text-anchor="middle"${horiz ? "" : ` transform="rotate(-90 ${lx} ${ly})"`}>${escXML(w.num)}</text>`;
    }
  });
  // ジャンクションドット
  junctionDots(page).forEach(([x, y]) => {
    let color = INK;
    if (sim && sim.wireNet) { /* 色はワイヤに追従させる程度で省略 */ }
    out += `<circle cx="${x}" cy="${y}" r="1.05" fill="${color}"/>`;
  });
  return out;
}
function wireLabelPos(w) {
  // 最長区間の中点にラベル
  let best = 0, bi = 0;
  for (let i = 0; i < w.pts.length - 1; i++) {
    const len = Math.abs(w.pts[i + 1][0] - w.pts[i][0]) + Math.abs(w.pts[i + 1][1] - w.pts[i][1]);
    if (len > best) { best = len; bi = i; }
  }
  const a = w.pts[bi], b = w.pts[bi + 1];
  const horiz = Math.abs(b[1] - a[1]) < 0.01;
  return [(a[0] + b[0]) / 2 + (horiz ? 0 : -1.8), (a[1] + b[1]) / 2 - 1.4, horiz];
}

/* ── デバイス ── */
function devicesSVG(page) {
  let out = "";
  const simOn = App.sim.running;
  page.devices.forEach(dev => {
    const sym = SYMBOLS_BY_ID[dev.sym];
    if (!sym) return;
    const selected = App.selection.has(dev.id);
    const hovered = Editor.hover.devId === dev.id;
    let color = INK;
    let extra = "";
    if (simOn) {
      const st = simDevVisual(dev, sym);
      if (st.color) color = st.color;
      extra = st.extra || "";
    }
    out += `<g transform="translate(${dev.x},${dev.y}) rotate(${dev.rot || 0})" data-id="${dev.id}" class="device" style="color:${color}">`;
    if (selected || hovered) {
      const [bx, by, bw, bh] = sym.bounds;
      out += `<rect x="${bx - 2}" y="${by - 2}" width="${bw + 4}" height="${bh + 4}" fill="${selected ? "rgba(31,122,224,.10)" : "rgba(31,122,224,.05)"}" stroke="${SEL}" stroke-width="${selected ? 0.5 : 0.3}" stroke-dasharray="${selected ? "none" : "1.5 1.2"}" rx="1"/>`;
    }
    out += extra;
    out += symBodySVG(sym, { strokeWidth: 1.15 * 0.42 }); // 画面上で約0.5mm相当
    // 端子番号 (13/14, A1/A2, X1/X2 …) — EPLAN同様ピン脇に表示。
    // 連動接点は同一コイル内の順位で 13/14 → 23/24 と自動採番。
    // 隣接ワイヤの線番と同名 (主回路の U1 等) なら二重表示を抑制。
    sym.pins.forEach((p, pi) => {
      if (!p.n || dev.sym === "terminal") return;
      const name = effectivePinName(dev, pi);
      if (!name) return;
      const abs = pinAbs(dev, p);
      const dupWire = page.wires.some(wr => wr.num === name &&
        wr.pts.some(pt => Math.abs(pt[0] - abs.x) < .01 && Math.abs(pt[1] - abs.y) < .01));
      if (dupWire) return;
      const isTop = p.y <= 0 || (sym.horizontalPins && p.y <= sym.bounds[1] + 2);
      out += `<text x="${p.x + 1}" y="${p.y + (isTop ? 3.4 : -1.6)}" font-size="2.5" fill="#8a93a6" stroke="none" font-family="monospace">${escXML(name)}</text>`;
    });
    out += `</g>`;
    // タグ・機能テキスト (回転に追従させず水平表示)
    out += devLabelsSVG(dev, sym);
    // コイルの接点ミラー
    if (sym.mirror) out += mirrorSVG(dev);
  });
  return out;
}

function simDevVisual(dev, sym) {
  const en = !!App.sim.states[dev.id];
  const t = App.sim.timers[dev.id];
  switch (sym.sim) {
    case "contact_no": case "contact_nc": case "contact3_no": {
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

function devLabelsSVG(dev, sym) {
  const b = devBounds(dev);
  const tag = displayTag(dev);
  let out = "";
  const horizontal = (dev.rot || 0) % 180 !== 0;
  if (horizontal) {
    // 横向きデバイス: タグは右肩に置く (レール・隣接ピン名との重なり防止)
    if (tag) out += `<text x="${b.x + b.w - 2.5}" y="${b.y - 2}" font-size="3.6" text-anchor="start" fill="${INK}" font-weight="600" font-family="monospace">${escXML(tag)}</text>`;
    if (dev.desc) out += `<text x="${b.x + b.w / 2}" y="${b.y + b.h + 4}" font-size="2.8" text-anchor="middle" fill="${INK_SOFT}">${escXML(dev.desc)}</text>`;
    return out;
  }
  const labelX = b.x - 2.2, labelYc = b.y + b.h / 2;
  if (tag) {
    out += `<text x="${labelX}" y="${labelYc - 0.6}" font-size="3.6" text-anchor="end" fill="${INK}" font-weight="600" font-family="monospace">${escXML(tag)}</text>`;
  }
  if (dev.desc) {
    out += `<text x="${labelX}" y="${labelYc + (tag ? 3.4 : 0.8)}" font-size="2.8" text-anchor="end" fill="${INK_SOFT}">${escXML(dev.desc)}</text>`;
  }
  // リンク接点のクロスリファレンス (親コイル位置 /ページ.列)
  if (dev.linkTo) {
    const f = findDevice(dev.linkTo);
    if (f) {
      out += `<text x="${b.x + b.w + 1.6}" y="${labelYc + 1.2}" font-size="3" fill="#7a4ec2" font-family="monospace">/${devLocation(f.dev)}</text>`;
    }
  }
  return out;
}

/** コイル下の接点ミラー (EPLAN流クロスリファレンス表)
    0Vへの縦配線を避けて右側にオフセット。端子番号と NO/NC 種別つき */
function mirrorSVG(coilDev) {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return "";
  const csym0 = SYMBOLS_BY_ID[coilDev.sym];
  // 多極デバイス (サーマル等) は極間の配線を避けて左下に表示
  const wide = csym0.bounds[2] > 20;
  const x = wide ? coilDev.x - 24 : coilDev.x + 3;
  const y0 = coilDev.y + 24;
  const MAXROWS = 4;
  let out = `<g font-family="monospace">`;
  out += `<path d="M${coilDev.x + 2.5},${coilDev.y + 21.5} L${x},${y0 - 2.5}" stroke="${INK_SOFT}" stroke-width="0.2" stroke-dasharray="1 1"/>`;
  contacts.slice(0, MAXROWS).forEach((c, i) => {
    const cy = y0 + i * 4.2;
    const csym = SYMBOLS_BY_ID[c.sym];
    const n0 = effectivePinName(c, 0), n1 = effectivePinName(c, 1);
    const pinLabel = (n0 && n1) ? `${n0}·${n1}` : "";
    // ミニ接点グリフ (NC は横バーつき)
    if (csym.sim === "contact_nc") {
      out += `<path d="M${x},${cy + 1.5} h2 l2.6,-2.8 m-2.6,0 h2.6 m0,2.8 h0.8" stroke="${INK_SOFT}" stroke-width="0.35" fill="none"/>`;
    } else {
      out += `<path d="M${x},${cy + 1.5} h2 l2.6,-2.8 m0.6,2.8 h0.8" stroke="${INK_SOFT}" stroke-width="0.35" fill="none"/>`;
    }
    out += `<text x="${x + 7}" y="${cy + 2.3}" font-size="2.4" fill="${INK_SOFT}">${pinLabel}</text>`;
    out += `<text x="${x + 15}" y="${cy + 2.3}" font-size="2.6" fill="#7a4ec2">/${devLocation(c)}</text>`;
  });
  if (contacts.length > MAXROWS) {
    out += `<text x="${x}" y="${y0 + MAXROWS * 4.2 + 2}" font-size="2.4" fill="${INK_SOFT}">+${contacts.length - MAXROWS} …</text>`;
  }
  out += `</g>`;
  return out;
}

/* ── テキスト ── */
function textsSVG(page) {
  let out = "";
  page.texts.forEach(t => {
    const selected = App.selection.has(t.id);
    if (selected) {
      const wApprox = (t.text.length * (t.size || 4)) * 0.62 + 2;
      out += `<rect x="${t.x - wApprox / 2}" y="${t.y - (t.size || 4)}" width="${wApprox}" height="${(t.size || 4) + 2.5}" fill="rgba(31,122,224,.1)" stroke="${SEL}" stroke-width="0.35" rx="0.8"/>`;
    }
    out += `<text x="${t.x}" y="${t.y}" font-size="${t.size || 4}" text-anchor="${t.anchor || "middle"}" fill="${INK}" data-id="${t.id}" class="cadtext" font-family="sans-serif">${escXML(t.text)}</text>`;
  });
  return out;
}

/* ── オーバーレイ (ピン / 作図中ワイヤ / ゴースト / ラバーバンド) ── */
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
    const sym = SYMBOLS_BY_ID[g.symId];
    out += `<g transform="translate(${g.x},${g.y}) rotate(${g.rot || 0})" opacity="0.55" style="color:${SEL}">${symBodySVG(sym, { strokeWidth: 0.55 })}</g>`;
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
  const sym = SYMBOLS_BY_ID[ghost.symId];
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
  // テキスト
  for (let i = page.texts.length - 1; i >= 0; i--) {
    const t = page.texts[i];
    const w = t.text.length * (t.size || 4) * 0.62 + 2, h = (t.size || 4) + 2;
    if (wx > t.x - w / 2 && wx < t.x + w / 2 && wy > t.y - h && wy < t.y + 1.5) return { type: "text", obj: t };
  }
  // デバイス
  for (let i = page.devices.length - 1; i >= 0; i--) {
    const d = page.devices[i];
    const b = devBounds(d);
    if (wx > b.x - 1.5 && wx < b.x + b.w + 1.5 && wy > b.y - 1.5 && wy < b.y + b.h + 1.5) return { type: "device", obj: d };
  }
  // ワイヤ
  for (let i = page.wires.length - 1; i >= 0; i--) {
    const w = page.wires[i];
    for (let j = 0; j < w.pts.length - 1; j++) {
      if (distToSeg(wx, wy, w.pts[j], w.pts[j + 1]) < 1.6) return { type: "wire", obj: w };
    }
  }
  return null;
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

  svg.addEventListener("wheel", e => {
    e.preventDefault();
    // Shift+ホイール = 横スクロール / Ctrl+ホイール = 細かいズーム / ホイール = ズーム
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;      // 行単位デバイスをピクセル相当へ
    else if (e.deltaMode === 2) dy *= 120;
    if (e.shiftKey) {
      Editor.view.tx -= (dy !== 0 ? dy : e.deltaX) * 0.6;
      requestRender();
      return;
    }
    // 移動量に比例した滑らかなズーム (ホイール1ノッチ≈9%、タッチパッドは微小刻み)
    const speed = e.ctrlKey ? 0.0006 : 0.0011;
    const factor = Math.max(0.75, Math.min(1.35, Math.exp(-dy * speed)));
    zoomAt(e.clientX, e.clientY, factor);
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
      const sym = SYMBOLS_BY_ID[hit.obj.sym];
      if ((sym.sim === "contact_no" || sym.sim === "contact_nc") && !hit.obj.linkTo) {
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
      const hit = hitTest(w.x, w.y);
      const newHover = hit && hit.type === "device" ? hit.obj.id : null;
      if (newHover !== Editor.hover.devId) { Editor.hover.devId = newHover; requestRender(); }
      if (App.sim.running && hit && hit.type === "device") {
        const sym = SYMBOLS_BY_ID[hit.obj.sym];
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
    const dx = snap(w.x - d.startW.x), dy = snap(w.y - d.startW.y);
    if (dx === 0 && dy === 0 && !d.moved) return;
    d.moved = true;
    applyMove(d.attach, dx, dy);
    requestRender();
  }
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
      UI.showProps();
    }
    requestRender();
    return;
  }
  if (d.type === "move" && d.moved) {
    // 移動確定 → Undo 履歴
    App.undoStack.push(d.snapshot);
    if (App.undoStack.length > 100) App.undoStack.shift();
    App.redoStack.length = 0;
    saveLocal();
    UI.setMsg("移動しました");
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
  } else if (hit && hit.type === "device") {
    App.selection.clear();
    App.selection.add(hit.obj.id);
    UI.showProps(true);
    requestRender();
  }
}

function finishWireDraft() {
  const d = Editor.wireDraft;
  Editor.wireDraft = null;
  if (d && d.pts.length >= 2) {
    commit();
    addWire(curPage(), d.pts);
    UI.setMsg("配線を作成しました");
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
  UI.setMsg(`${SYMBOLS_BY_ID[symId].name} — クリックで連続配置 / R で回転 / Esc・右クリックで終了`);
}
function placeGhost() {
  const g = Editor.ghost;
  if (!g) return;
  commit();
  const dev = addDevice(curPage(), g.symId, g.x, g.y, { rot: g.rot });
  App.selection.clear();
  App.selection.add(dev.id);
  UI.setMsg(`${SYMBOLS_BY_ID[g.symId].name} ${dev.tag || ""} を配置 — 続けてクリックで連続配置、Escで終了`);
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
  // リンク切れ解消
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    if (d.linkTo && !findDevice(d.linkTo)) d.linkTo = null;
  }));
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
  const issuesAfter = runDRC().length;
  if (issuesAfter <= issuesBefore) return true;
  App.project = JSON.parse(snapshot);
  App.undoStack.pop(); // commit() で積んだ分を捨てる (取り消したので履歴に残さない)
  retainSelection();
  UI.setMsg("⚠ 回転すると回路の接続が壊れるため中止しました — 配線を外してから回転してください");
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
  if (!devs.length && !wires.length && !texts.length) return;
  App.clipboard = deepCopy({ devs, wires, texts });
  UI.setMsg(`${devs.length + wires.length + texts.length} 個をコピーしました`);
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
  let minX = Infinity, minY = Infinity;
  cb.devs.forEach(d => { minX = Math.min(minX, d.x); minY = Math.min(minY, d.y); });
  cb.wires.forEach(w => w.pts.forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); }));
  cb.texts.forEach(t => { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); });
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
    d.x += dx; d.y += dy;
    page.devices.push(d);
    App.selection.add(d.id);
  });
  // linkTo の再マップ / タグ振り直し
  cb.devs.forEach((d0, i) => {
    const d = page.devices[page.devices.length - cb.devs.length + i];
    if (d.linkTo && idMap[d.linkTo]) d.linkTo = idMap[d.linkTo];
    if (d.tag && !d.linkTo) {
      const sym = SYMBOLS_BY_ID[d.sym];
      if (sym.letter) d.tag = nextTag(sym.letter);
    }
  });
  cb.wires.forEach(w0 => {
    const w = deepCopy(w0);
    w.id = uid("w");
    w.pts = w.pts.map(p => [p[0] + dx, p[1] + dy]);
    w.num = null;
    page.wires.push(w);
    App.selection.add(w.id);
  });
  cb.texts.forEach(t0 => {
    const t = deepCopy(t0);
    t.id = uid("t");
    t.x += dx; t.y += dy;
    page.texts.push(t);
    App.selection.add(t.id);
  });
  UI.setMsg("カーソル位置に貼り付けました");
  requestRender();
}

function nudgeSelection(dx, dy) {
  if (App.sim.running) return;
  if (!App.selection.size) return;
  commit();
  const attach = buildMoveAttachment();
  applyMove(attach, dx, dy);
  requestRender();
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
  const body =
    `<g>${sheetSVG(page)}</g><g>${wiresSVG(page)}</g><g>${devicesSVG(page)}</g><g>${textsSVG(page)}</g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 ${SHEET.w + 10} ${SHEET.h + 10}" font-family="sans-serif">${body}</svg>`;
}
