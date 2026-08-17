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
  lw: LINE_W.thick,    // シンボル全体の線の太さ (mm)
  W: 60, H: 60,        // 作画領域 (mm)
  snap: 1,             // 図形のスナップ (mm)
};

const SYMEDIT_TOOLS = [
  ["line", "線", "折れ線 (クリックで頂点・ダブルクリック/Enter で確定)"],
  ["rect", "長方形", "対角の2点をクリック (ドラッグでも可)"],
  ["circle", "円", "中心 → 半径 をクリック (ドラッグでも可)"],
  ["arc", "円弧", "中心 → 開始 → 終了 の3クリック"],
  ["text", "文字", "クリックした位置に文字を入れる"],
  ["pin", "端子", "配線をつなぐ点。5mm グリッドに乗ります"],
  ["conn", "コネクタ", "多極コネクタ (CN3 など) をまとめて置く。クリックした位置が1番ピン"],
  ["select", "選択", "クリックで選択、Del で削除"],
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
  const dash = sh.style === "dash"
    ? ` stroke-dasharray="3 0.75" stroke-width="${LINE_W.thin}" stroke-linecap="butt"` : "";
  const extra = opts.hl ? ` stroke="${SEL}" stroke-width="0.8"` : "";
  if (sh.k === "line") {
    const d = sh.pts.map((p, i) => `${i ? "L" : "M"}${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join(" ");
    return `<path d="${d}${sh.closed ? " Z" : ""}"${dash}${extra}/>`;
  }
  if (sh.k === "rect") {
    return `<rect x="${+sh.x.toFixed(2)}" y="${+sh.y.toFixed(2)}" width="${+sh.w.toFixed(2)}" height="${+sh.h.toFixed(2)}"${sh.fill ? ' fill="currentColor" stroke="none"' : ""}${dash}${extra}/>`;
  }
  if (sh.k === "circle") {
    return `<circle cx="${+sh.x.toFixed(2)}" cy="${+sh.y.toFixed(2)}" r="${+sh.r.toFixed(2)}"${sh.fill ? ' fill="currentColor" stroke="none"' : ""}${dash}${extra}/>`;
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
    const fam = sh.mono ? "monospace" : "sans-serif";
    return `<text x="${+sh.x.toFixed(2)}" y="${+sh.y.toFixed(2)}" font-size="${svgFontSizeFor(sh.text, sh.h || TEXT_H.normal, !!sh.mono)}" text-anchor="middle" fill="currentColor" stroke="none" font-family="${fam}">${escXML(sh.text)}</text>`;
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

/* ══════════════ 画面 ══════════════ */
UI.openSymbolEditor = (symId = null) => {
  if (App.sim.running) { UI.setMsg("シミュレーション中はシンボルを作成できません"); return; }
  const S = SymEdit;
  S.shapes = []; S.pins = []; S.funcs = []; S.undo = []; S.sel = -1; S.draft = null;
  S.tool = "line"; S.style = "solid"; S.editingId = null; S.lw = LINE_W.thick;

  let meta = { name: "", nameEn: "", letter: "E", typ: "", desc: "", group: "自作", sim: "none", mono: false };
  if (symId && SYMBOLS_BY_ID[symId]) {
    const src = SYMBOLS_BY_ID[symId];
    S.editingId = symId;
    meta = {
      name: src.name || "", nameEn: src.nameEn || "", letter: src.letter || "E",
      typ: src.typ || "", desc: src.desc || "", group: src.group || "自作", sim: src.sim || "none",
    };
    S.pins = (src.pins || []).map(p => ({ x: p.x, y: p.y, n: p.n || "" }));
    S.funcs = Array.isArray(src.funcs) ? deepCopy(src.funcs) : [];
    S.shapes = Array.isArray(src.shapes) ? deepCopy(src.shapes) : [];
    if (!S.shapes.length && src.body) {
      // 図形一覧を持たない (DXF取り込み等) シンボルは、そのまま1つの図形として扱う
      S.shapes = [{ k: "raw", body: src.body }];
    }
  }

  if (S.shapes.length || S.pins.length) {
    const bd = symShapesBounds(S.shapes, S.pins);
    const need = Math.max(Math.abs(bd[0]), Math.abs(bd[1]), Math.abs(bd[0] + bd[2]), Math.abs(bd[1] + bd[3])) * 2 + 8;
    S.W = S.H = [40, 60, 100, 160].find(v => v >= need) || 160;
  } else { S.W = S.H = 60; }
  const body = h(`<div class="se-wrap">
    <div class="se-left">
      <div class="se-tools" id="seTools"></div>
      <div class="prop-note" id="seHint" style="margin:8px 0 0">折れ線: クリックで頂点、ダブルクリックか Enter で確定</div>
      <div class="prop-sect">線種</div>
      <div class="prop-row"><label class="chk"><input type="radio" name="seStyle" value="solid" checked/><span>実線 (導体・図記号)</span></label></div>
      <div class="prop-row"><label class="chk"><input type="radio" name="seStyle" value="dash"/><span>破線 (機械リンク・囲い)</span></label></div>
      <div class="prop-sect">線の太さ</div>
      <div class="prop-row"><select id="seLw">
        <option value="0.5">0.5 mm 太線 (図記号の標準)</option>
        <option value="0.25">0.25 mm 細線 (取り込み図形・補助)</option>
        <option value="0.35">0.35 mm 中線</option>
      </select></div>
      <div class="prop-sect">作画範囲</div>
      <div class="prop-row"><select id="seSize">
        ${[40, 60, 100, 160].map(v => `<option value="${v}"${v === S.W ? " selected" : ""}>${v} × ${v} mm</option>`).join("")}
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
        ${[["none", "なし (作図のみ)"], ["passthru", "素通し (端子台・接続)"],
           ["contact_no", "a接点 (メーク)"], ["contact_nc", "b接点 (ブレーク)"],
           ["coil", "コイル (励磁で接点が動く)"], ["load", "負荷 (ランプ・ソレノイド)"],
           ["breaker", "遮断器 (手動開閉)"]].map(([v, t]) =>
          `<option value="${v}"${meta.sim === v ? " selected" : ""}>${t}</option>`).join("")}
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
    <button class="btn-solid" id="seUndo">元に戻す</button>
    <button class="btn-solid" id="seClear">全消去</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="seCancel">キャンセル</button>
    <button class="btn-solid primary" id="seOk">${S.editingId ? "更新して保存" : "ライブラリに登録"}</button>
  </div>`);

  const m = UI.openModal({
    title: S.editingId ? "シンボルの編集" : "シンボルの作成",
    sub: "図形を描いて端子を置くと、自作の機器としてライブラリに登録できます",
    body, foot, wide: true,
    onclose: () => { document.removeEventListener("keydown", onKey, true); },
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
    S.tool = b.dataset.t; S.draft = null; S.sel = -1;
    toolsEl.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === S.tool));
    const t = SYMEDIT_TOOLS.find(x => x[0] === S.tool);
    hintEl.textContent = t ? t[2] : "";
    draw();
  });
  body.querySelectorAll('input[name="seStyle"]').forEach(r =>
    r.addEventListener("change", e => { S.style = e.target.value; }));
  body.querySelector("#seLw").value = String(S.lw);
  body.querySelector("#seLw").addEventListener("change", e => { S.lw = parseFloat(e.target.value) || LINE_W.thick; draw(); });
  body.querySelector("#seSize").addEventListener("change", e => {
    S.W = S.H = +e.target.value;
    S.svg.setAttribute("viewBox", `${-S.W / 2} ${-S.H / 2} ${S.W} ${S.H}`);
    draw();
  });

  // ── 描画 ──
  const push = () => { S.undo.push({ shapes: deepCopy(S.shapes), pins: deepCopy(S.pins), funcs: deepCopy(S.funcs) }); if (S.undo.length > 60) S.undo.shift(); };
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
    // 図形
    out += `<g fill="none" stroke="#e6edf7" stroke-width="${S.lw}" stroke-linecap="round" stroke-linejoin="round" color="#e6edf7">`;
    S.shapes.forEach((sh, i) => { out += sh.k === "raw" ? sh.body : symShapeSVG(sh, { hl: i === S.sel }); });
    out += `</g>`;
    // 作画中
    if (S.draft) {
      out += `<g fill="none" stroke="${SEL}" stroke-width="0.4" stroke-dasharray="1 0.8">${S.draft.k === "raw" ? "" : symShapeSVG(S.draft)}</g>`;
    }
    // 端子
    S.pins.forEach((p, i) => {
      out += `<circle cx="${p.x}" cy="${p.y}" r="0.9" fill="${S.sel === -2 - i ? SEL : "#e5484d"}" stroke="none"/>`;
      if (p.n) out += `<text x="${p.x + 1.6}" y="${p.y - 1.2}" font-size="2.6" fill="#8b96ab" font-family="monospace">${escXML(p.n)}</text>`;
    });
    S.svg.innerHTML = out;
    refreshSide();
  };
  const refreshSide = () => {
    const bd = symShapesBounds(S.shapes, S.pins);
    body.querySelector("#seBounds").textContent =
      `外接矩形: X ${bd[0]} / Y ${bd[1]} / 幅 ${bd[2]} / 高さ ${bd[3]} mm`;
    const prevSym = { bounds: bd, lw: S.lw, body: symShapesToBody(S.shapes.filter(s => s.k !== "raw")) + S.shapes.filter(s => s.k === "raw").map(s => s.body).join("") };
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
  const hitShape = (x, y) => {
    for (let i = S.shapes.length - 1; i >= 0; i--) {
      const sh = S.shapes[i];
      if (sh.k === "line" && sh.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 2)) return i;
      if (sh.k === "rect" && x > sh.x - 1 && x < sh.x + sh.w + 1 && y > sh.y - 1 && y < sh.y + sh.h + 1) return i;
      if ((sh.k === "circle" || sh.k === "arc") && Math.abs(Math.hypot(x - sh.x, y - sh.y) - sh.r) < 2) return i;
      if (sh.k === "text" && Math.abs(x - sh.x) < 6 && Math.abs(y - sh.y) < 3) return i;
      if (sh.k === "raw" && i === S.shapes.length - 1) return i;
    }
    return -1;
  };
  S.svg.addEventListener("mousemove", e => {
    const p = symEditXY(e);
    const g = S.tool === "pin" ? GRID : S.snap;
    const x = symSnap(p.x, g), y = symSnap(p.y, g);
    statusEl.textContent = `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`;
    if (!S.draft) return;
    const d = S.draft;
    if (d.k === "line") { d.pts = [...d.fixed, [x, y]]; }
    else if (d.k === "rect") { d.x = Math.min(d.ax, x); d.y = Math.min(d.ay, y); d.w = Math.abs(x - d.ax); d.h = Math.abs(y - d.ay); }
    else if (d.k === "circle") { d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y)); }
    else if (d.k === "arc") {
      if (d.step === 1) d.r = Math.max(0.5, Math.hypot(x - d.x, y - d.y));
      else { d.a1 = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI; }
    }
    draw();
  });
  // ドラッグ (押しながら動かして離す) でも図形を確定できるようにする。
  // クリック2回で描く従来の操作もそのまま使える。
  S.svg.addEventListener("mousedown", e => {
    S.downAt = { x: e.clientX, y: e.clientY };
    if (S.draft) return;
    if (S.tool !== "rect" && S.tool !== "circle") return;
    const p = symEditXY(e);
    const x = symSnap(p.x, S.snap), y = symSnap(p.y, S.snap);
    S.draft = S.tool === "rect"
      ? { k: "rect", ax: x, ay: y, x, y, w: 0, h: 0, style: S.style }
      : { k: "circle", x, y, r: 0.5, style: S.style };
    S.draftFromDown = true;      // この直後の click は1点目なので読み飛ばす
    // ここで再描画すると mousedown と mouseup の対象要素が変わり click が出なくなる。
    // 作画中の図形は次の mousemove で描かれるので、ここでは描き直さない。
  });
  S.svg.addEventListener("mouseup", e => {
    const d0 = S.downAt; S.downAt = null;
    if (!d0 || !S.draft) return;
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < 4) return;   // ドラッグしていない (クリック操作に任せる)
    S.draftFromDown = false;
    if (S.draft.k === "line" || S.draft.k === "arc") return;          // 折れ線・円弧は多点なのでクリック操作
    S.suppressClick = true;
    const d = S.draft;
    push();
    if (d.k === "rect") { if (d.w > 0.2 && d.h > 0.2) S.shapes.push({ k: "rect", x: d.x, y: d.y, w: d.w, h: d.h, style: d.style }); }
    else if (d.k === "circle") { if (d.r > 0.2) S.shapes.push({ k: "circle", x: d.x, y: d.y, r: d.r, style: d.style }); }
    S.draft = null; draw();
  });
  S.svg.addEventListener("click", e => {
    if (S.suppressClick) { S.suppressClick = false; return; }
    if (S.draftFromDown) { S.draftFromDown = false; return; }   // 押した時点で1点目を取っている
    const p = symEditXY(e);
    const g = S.tool === "pin" ? GRID : S.snap;
    const x = symSnap(p.x, g), y = symSnap(p.y, g);
    if (S.tool === "select") {
      const i = hitShape(x, y);
      const pi = S.pins.findIndex(q => Math.hypot(q.x - x, q.y - y) < 2);
      S.sel = pi >= 0 ? -2 - pi : i;
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
      else if (S.tool === "rect") S.draft = { k: "rect", ax: x, ay: y, x, y, w: 0, h: 0, style: S.style };
      else if (S.tool === "circle") S.draft = { k: "circle", x, y, r: 0.5, style: S.style };
      else if (S.tool === "arc") S.draft = { k: "arc", x, y, r: 0.5, a0: 0, a1: 90, step: 1, style: S.style };
      draw(); return;
    }
    const d = S.draft;
    if (d.k === "line") { d.fixed.push([x, y]); d.pts = [...d.fixed]; draw(); return; }
    if (d.k === "arc") {
      if (d.step === 1) { d.a0 = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI; d.a1 = d.a0 + 90; d.step = 2; draw(); return; }
      d.a1 = Math.atan2(y - d.y, x - d.x) * 180 / Math.PI;
      push(); S.shapes.push({ k: "arc", x: d.x, y: d.y, r: d.r, a0: d.a0, a1: d.a1, style: d.style });
      S.draft = null; draw(); return;
    }
    // rect / circle は2点目で確定
    push();
    if (d.k === "rect") { if (d.w > 0.2 && d.h > 0.2) S.shapes.push({ k: "rect", x: d.x, y: d.y, w: d.w, h: d.h, style: d.style }); }
    else if (d.k === "circle") { if (d.r > 0.2) S.shapes.push({ k: "circle", x: d.x, y: d.y, r: d.r, style: d.style }); }
    S.draft = null; draw();
  });
  S.svg.addEventListener("dblclick", () => { finishLine(); });
  const finishLine = () => {
    const d = S.draft;
    if (!d || d.k !== "line") return;
    if (d.fixed.length >= 2) { push(); S.shapes.push({ k: "line", pts: deepCopy(d.fixed), style: d.style }); }
    S.draft = null; draw();
  };

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
    if (e.key === "Escape") {
      if (S.draft) { S.draft = null; draw(); e.stopPropagation(); e.preventDefault(); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel !== -1) {
      push();
      if (S.sel <= -2) S.pins.splice(-2 - S.sel, 1); else S.shapes.splice(S.sel, 1);
      S.sel = -1; draw(); e.stopPropagation(); e.preventDefault();
    }
  };
  document.addEventListener("keydown", onKey, true);

  body.querySelector("#seFnAdd").addEventListener("click", () => {
    if (S.pins.length < 2) { alert("先に端子を2点以上置いてください (端子ツール / コネクタツール)"); return; }
    push();
    S.funcs.push({ kind: S.funcs.length ? "contact_no" : "coil", pins: [0, 1], name: "" });
    renderFuncs();
  });

  foot.querySelector("#seUndo").addEventListener("click", () => {
    const st = S.undo.pop();
    if (!st) return;
    S.shapes = st.shapes; S.pins = st.pins; S.funcs = st.funcs || []; S.draft = null; S.sel = -1; draw();
  });
  foot.querySelector("#seClear").addEventListener("click", () => {
    if (!confirm("作画した図形と端子をすべて消しますか？")) return;
    push(); S.shapes = []; S.pins = []; S.funcs = []; S.draft = null; S.sel = -1; draw();
  });
  foot.querySelector("#seCancel").addEventListener("click", m.close);

  foot.querySelector("#seOk").addEventListener("click", () => {
    const q = s => body.querySelector(s);
    const name = q("#seName").value.trim();
    if (!name) { alert("名称を入力してください"); q("#seName").focus(); return; }
    if (!S.shapes.length) { alert("図形が1つもありません。左のツールで作画してください"); return; }
    const bodySVG = symShapesToBody(S.shapes.filter(s => s.k !== "raw")) +
      S.shapes.filter(s => s.k === "raw").map(s => s.body).join("");
    const sim = q("#seSim").value;
    if (S.pins.length < 2 && sim !== "none" && !S.funcs.length) {
      if (!confirm("端子が2点未満です。回路の働きを設定しても通電計算はされません。\nこのまま登録しますか？")) return;
    }
    const dupName = [...SYMBOLS, ...DB_SYMBOLS].find(s => s.name === name && s.id !== S.editingId);
    if (dupName && !confirm(`「${name}」という名前のシンボルが既にあります。\nこのまま登録しますか？`)) return;

    const id = S.editingId || ("usr_" + uid("s"));
    const sym = {
      id, db: true, group: q("#seGroup").value.trim() || "自作", cat: "db",
      letter: (q("#seLetter").value.trim() || "E").toUpperCase(),
      name, nameEn: q("#seNameEn").value.trim() || name,
      desc: q("#seDesc").value.trim() || "自作シンボル",
      typ: q("#seTyp").value.trim(),
      pins: S.pins.map((p, i) => ({ x: p.x, y: p.y, n: p.n || String(i + 1) })),
      sim: S.funcs.length ? "multi" : sim,
      lw: S.lw,
      funcs: S.funcs.length ? deepCopy(S.funcs) : undefined,
      bounds: symShapesBounds(S.shapes, S.pins),
      body: bodySVG,
      shapes: deepCopy(S.shapes),      // 再編集できるように図形一覧も保存する
      imported: true,                  // localStorage へ保存する対象
      custom: true,                    // 自作 (シンボル作成で描いたもの)
      nonstd: true,                    // 規格記号ではないことを明示
    };
    const at = DB_SYMBOLS.findIndex(s => s.id === id);
    if (at >= 0) DB_SYMBOLS[at] = sym; else DB_SYMBOLS.push(sym);
    SYMBOLS_BY_ID[id] = sym;
    saveImportedSymbols();
    syncProjectSymbols();
    dbSetPinned([...new Set([...dbPinnedList(), id])]);
    UI.buildPalette();
    requestRender();
    m.close();
    UI.setMsg(`シンボル「${name}」を${S.editingId ? "更新" : "登録"}しました (左のライブラリ「データベース」に表示)`);
  });

  draw();
};

/** 自作シンボルの一覧から編集・削除する */
UI.manageCustomSymbols = () => {
  const list = () => DB_SYMBOLS.filter(s => s.custom || s.imported);
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      自作シンボルと DXF から取り込んだシンボルの一覧です。<br>
      編集するとこのブラウザに保存され、図面にも埋め込まれます。
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
          <div class="cs-sub">${escXML(s.desc || "")} — 端子 ${(s.pins || []).length} 点 / ${s.custom ? "自作" : "DXF取り込み"}</div>
        </div>
        <button class="btn-solid cs-edit" data-id="${s.id}">編集</button>
        <button class="btn-solid cs-del" data-id="${s.id}">削除</button>
      </div>`).join("") : '<div class="se-empty" style="padding:18px">まだありません</div>';
    body.querySelectorAll(".cs-edit").forEach(b => b.addEventListener("click", () => {
      m.close(); UI.openSymbolEditor(b.dataset.id);
    }));
    body.querySelectorAll(".cs-del").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.id;
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
