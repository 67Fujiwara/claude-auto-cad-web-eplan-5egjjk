/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — UI 層
   パレット / メニュー / ページタブ / プロパティ / DRC / BOM / AIウィザード
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const UI = {};

/* ══════════════ 汎用 ══════════════ */
UI.setMsg = (msg) => {
  const el = document.getElementById("stMsg");
  if (el) { el.textContent = msg; clearTimeout(UI._msgT); UI._msgT = setTimeout(() => el.textContent = "", 4000); }
};
UI.toast = (html, ms = 3200) => {
  const el = document.getElementById("hintToast");
  el.innerHTML = html;
  el.classList.remove("hidden");
  clearTimeout(UI._toastT);
  UI._toastT = setTimeout(() => el.classList.add("hidden"), ms);
};

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ══════════════ シンボルパレット ══════════════ */
UI.buildPalette = (filter = "") => {
  const tree = document.getElementById("symTree");
  tree.innerHTML = "";
  const f = filter.trim().toLowerCase();
  const pinned = new Set(dbPinnedList());
  Object.entries(SYM_CATS).forEach(([catId, cat]) => {
    // "データベース" 分類は DB からパレットに追加されたものだけを出す
    const source = catId === "db" ? DB_SYMBOLS.filter(s => pinned.has(s.id)) : SYMBOLS.filter(s => s.cat === catId);
    const syms = source.filter(s =>
      (!f || s.name.toLowerCase().includes(f) || s.nameEn.toLowerCase().includes(f) || (s.desc || "").toLowerCase().includes(f) || (s.jis || "").includes(f)));
    if (!syms.length) return;
    const el = h(`<div class="sym-cat ${f || catId !== "misc" ? "open" : ""}">
      <div class="sym-cat-head">
        <span class="cat-arrow">▶</span>
        <span class="cat-dot" style="background:${cat.color}"></span>
        <span>${cat.name}</span>
        <span class="cat-count">${syms.length}</span>
      </div>
      <div class="sym-cat-body"></div>
    </div>`);
    el.querySelector(".sym-cat-head").addEventListener("click", () => el.classList.toggle("open"));
    const body = el.querySelector(".sym-cat-body");
    syms.forEach(sym => {
      const std = [sym.jis ? `JIS C 0617 / IEC 60617 ${sym.jis}` : "", sym.stdNote || "",
        (!sym.jis && sym.nonstd) ? "規格外 (JIS C 0617 に該当図記号なし)" : ""]
        .filter(Boolean).map(t => `&#10;${t}`).join("");
      const item = h(`<div class="sym-item" title="${sym.name} (${sym.nameEn})&#10;${sym.desc}${std}">
        <div class="sym-thumb">${symThumbSVG(sym)}</div>
        <div class="sym-name">${sym.name}</div>
      </div>`);
      item.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        startGhost(sym.id); // 操作ガイドは startGhost 側で表示
      });
      item.addEventListener("dblclick", () => {
        startGhost(sym.id);
      });
      body.appendChild(item);
    });
    tree.appendChild(el);
  });
};

/* ══════════════ ページタブ ══════════════ */
/** ページ番号を振り直し、ページ固有の図番も並び順に同期する */
UI.renumberPages = () => {
  const meta = projectMeta();
  const base = (meta.dwgNo || "").trim();
  const auto = meta.dwgNoAuto !== false;
  App.project.pages.forEach((p, k) => {
    p.no = k + 1;
    // 図番はページ順に自動採番。書式は「接頭辞-連番」(既定 E-001)
    // 手入力した図番 (dwgNoManual) と、自動採番を切った場合は書き換えない
    if (!auto || p.dwgNoManual) return;
    const m = /^(.*?)(\d+)\s*$/.exec(base);
    p.dwgNo = m ? m[1] + String(parseInt(m[2], 10) + k).padStart(m[2].length, "0")
                : (base ? `${base}-${String(k + 1).padStart(3, "0")}` : "E-" + String(k + 1).padStart(3, "0"));
  });
};
UI.dwgNoOf = pageDwgNo;

/** ページを別の位置へ移す (図番も並び順に振り直す) */
UI.movePage = (from, to) => {
  const pages = App.project.pages;
  if (App.sim.running) { UI.setMsg("シミュレーション中はページを移動できません"); return false; }
  if (from < 0 || from >= pages.length) return false;
  to = Math.max(0, Math.min(pages.length - 1, to));
  if (from === to) return false;
  commit();
  const cur = pages[App.pageIdx];
  const [pg] = pages.splice(from, 1);
  pages.splice(to, 0, pg);
  UI.renumberPages();
  App.pageIdx = Math.max(0, pages.indexOf(cur));   // 表示中のページは変えない
  UI.refresh();
  UI.setMsg(`ページ「${pg.name}」を ${to + 1} ページ目へ移動しました (図番を再採番しました)`);
  return true;
};

/** ページの並べ替え画面 (ドラッグ / ↑↓ で順番を変える) */
UI.reorderPages = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中はページを並べ替えできません"); return; }
  let order = App.project.pages.map((p, i) => i);      // 元のインデックスの並び
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      行をドラッグするか ↑ ↓ で順番を変えます。適用すると図面番号も並び順に振り直されます。<br>
      あとから追加した主回路を前へ持ってくる、といった並べ替えに使います。
    </div>
    <div class="rp-head"><span>順</span><span>ページ名</span><span>図番</span><span>規模</span><span>並べ替え</span></div>
    <div id="rpRows" class="rp-rows"></div>
  </div>`);
  const foot = h(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn-solid" id="rpReset">元に戻す</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="rpCancel">キャンセル</button>
    <button class="btn-solid primary" id="rpOk">適用</button>
  </div>`);
  const m = UI.openModal({ title: "ページの並べ替え", sub: "順番を変えると図面番号も同期します", body, foot, wide: true });
  const rows = body.querySelector("#rpRows");
  const render = () => {
    const pages = App.project.pages;
    const base = (projectMeta().dwgNo || "").trim();
    rows.innerHTML = order.map((oi, k) => {
      const pg = pages[oi];
      // 適用後に印字される図番の見込み (手動固定はそのまま)
      let dwg = pg.dwgNo;
      if (!pg.dwgNoManual && projectMeta().dwgNoAuto !== false) {
        const mm = /^(.*?)(\d+)\s*$/.exec(base);
        dwg = mm ? mm[1] + String(parseInt(mm[2], 10) + k).padStart(mm[2].length, "0")
                 : (base ? `${base}-${String(k + 1).padStart(3, "0")}` : "E-" + String(k + 1).padStart(3, "0"));
      }
      return `<div class="rp-row" draggable="true" data-k="${k}">
        <span class="mono rp-no">${k + 1}</span>
        <span class="rp-name">${escXML(pg.name)}${pg.dwgNoManual ? ' <span class="rp-dim">(図番固定)</span>' : ""}</span>
        <span class="mono rp-dim">${escXML(dwg || "")}</span>
        <span class="rp-dim">機器 ${pg.devices.length} / 配線 ${condWires(pg).length}</span>
        <span class="rp-act">
          <button class="btn-solid rp-up" data-k="${k}"${k === 0 ? " disabled" : ""}>↑</button>
          <button class="btn-solid rp-dn" data-k="${k}"${k === order.length - 1 ? " disabled" : ""}>↓</button>
        </span>
      </div>`;
    }).join("");
    rows.querySelectorAll(".rp-up").forEach(b => b.addEventListener("click", () => {
      const k = +b.dataset.k; if (k <= 0) return;
      [order[k - 1], order[k]] = [order[k], order[k - 1]]; render();
    }));
    rows.querySelectorAll(".rp-dn").forEach(b => b.addEventListener("click", () => {
      const k = +b.dataset.k; if (k >= order.length - 1) return;
      [order[k + 1], order[k]] = [order[k], order[k + 1]]; render();
    }));
    // 行のドラッグ&ドロップ
    let dragK = -1;
    rows.querySelectorAll(".rp-row").forEach(r => {
      r.addEventListener("dragstart", e => { dragK = +r.dataset.k; r.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      r.addEventListener("dragend", () => { r.classList.remove("dragging"); dragK = -1; });
      r.addEventListener("dragover", e => { e.preventDefault(); r.classList.add("over"); });
      r.addEventListener("dragleave", () => r.classList.remove("over"));
      r.addEventListener("drop", e => {
        e.preventDefault(); r.classList.remove("over");
        const to = +r.dataset.k;
        if (dragK < 0 || dragK === to) return;
        const [v] = order.splice(dragK, 1);
        order.splice(to, 0, v);
        render();
      });
    });
  };
  render();
  foot.querySelector("#rpReset").addEventListener("click", () => { order = App.project.pages.map((p, i) => i); render(); });
  foot.querySelector("#rpCancel").addEventListener("click", m.close);
  foot.querySelector("#rpOk").addEventListener("click", () => {
    const same = order.every((v, i) => v === i);
    if (same) { m.close(); return; }
    commit();
    const cur = App.project.pages[App.pageIdx];
    App.project.pages = order.map(i => App.project.pages[i]);
    UI.renumberPages();
    App.pageIdx = Math.max(0, App.project.pages.indexOf(cur));
    App.selection.clear();
    m.close();
    UI.refresh();
    UI.setMsg("ページを並べ替えました (図面番号を再採番しました)");
  });
};

/** 指定位置にページを挿入する (idx 番目の直前) */
UI.insertPageAt = (idx, name) => {
  if (App.sim.running) { UI.setMsg("シミュレーション中はページを追加できません"); return; }
  commit();
  const pg = newPage(name || `ページ ${idx + 1}`, idx + 1);
  App.project.pages.splice(idx, 0, pg);
  UI.renumberPages();
  App.pageIdx = idx;
  App.selection.clear();
  UI.refresh();
  zoomFit(); // 新しいページに切り替わるので全体表示にする
  UI.setMsg(`${idx + 1} ページ目に挿入しました (図番を再採番しました)`);
};

UI.buildPageTabs = () => {
  const wrap = document.getElementById("pageTabs");
  wrap.innerHTML = "";
  App.project.pages.forEach((pg, i) => {
    const el = h(`<div class="ptab ${i === App.pageIdx ? "active" : ""}" draggable="true" title="図番 ${escAttr(pageDwgNo(pg))}&#10;ドラッグして順番を入れ替えられます">
      <span class="ptab-no">${pg.no}</span><span>${pg.name}</span>
      ${App.project.pages.length > 1 ? `<span class="ptab-close" role="button" tabindex="0" aria-label="${escAttr(pg.name)} を削除" title="ページを削除">×</span>` : ""}
    </div>`);
    // × はキーボード (Enter / Space) でも操作できるようにする
    el.querySelectorAll(".ptab-close").forEach(btn => {
      btn.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault(); e.stopPropagation(); btn.click();
      });
    });
    el.addEventListener("click", e => {
      if (e.target.classList.contains("ptab-close")) {
        if (App.sim.running) { UI.setMsg("シミュレーション中はページを削除できません"); return; }
        if (!confirm(`ページ「${pg.name}」を削除しますか？`)) return;
        commit();
        App.project.pages.splice(i, 1);
        UI.renumberPages();
        App.pageIdx = Math.max(0, Math.min(App.pageIdx, App.project.pages.length - 1));
        App.selection.clear();
        UI.refresh();
        zoomFit(); // 表示ページが変わるので全体表示にする
        return;
      }
      if (i === App.pageIdx) return; // 同一タブ再クリックはDOMを保持 (ダブルクリックのリネームを生かす)
      App.pageIdx = i;
      App.selection.clear();
      UI.refresh();
      zoomFit(); // ページを切り替えたら全体表示にする
    });
    // タブをドラッグして順番を入れ替える (図番も再採番される)
    el.addEventListener("dragstart", e => {
      if (App.sim.running) { e.preventDefault(); return; }
      UI._dragPage = i; el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(i)); } catch (err) { /* 一部環境で不要 */ }
    });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); UI._dragPage = -1; wrap.querySelectorAll(".ptab").forEach(t => t.classList.remove("over-l", "over-r")); });
    el.addEventListener("dragover", e => {
      if (UI._dragPage == null || UI._dragPage < 0) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const r = el.getBoundingClientRect();
      const right = e.clientX > r.left + r.width / 2;
      el.classList.toggle("over-l", !right);
      el.classList.toggle("over-r", right);
    });
    el.addEventListener("dragleave", () => el.classList.remove("over-l", "over-r"));
    el.addEventListener("drop", e => {
      e.preventDefault();
      el.classList.remove("over-l", "over-r");
      const from = UI._dragPage;
      UI._dragPage = -1;
      if (from == null || from < 0 || from === i) return;
      const r = el.getBoundingClientRect();
      let to = e.clientX > r.left + r.width / 2 ? i + 1 : i;
      if (from < to) to--;                       // 前から後ろへ動かすぶんを詰める
      UI.movePage(from, to);
    });
    el.addEventListener("dblclick", e => {
      if (e.target.classList.contains("ptab-close")) return;
      if (App.sim.running) return;
      // インラインリネーム (prompt は使わない)
      const span = el.querySelector("span:nth-child(3)");
      const inp = h(`<input value="${pg.name.replace(/"/g, "&quot;")}" style="width:${Math.max(60, pg.name.length * 13)}px;background:var(--bg);border:1px solid var(--accent);border-radius:4px;color:var(--text);font-size:12px;padding:1px 6px;outline:none"/>`);
      span.replaceWith(inp);
      inp.focus(); inp.select();
      let closed = false;
      const done = (save) => {
        if (closed) return;
        closed = true;
        const v = inp.value.trim();
        if (save && v && v !== pg.name) { commit(); pg.name = v; }
        UI.refresh();
      };
      inp.addEventListener("keydown", ev => {
        if (ev.key === "Enter") done(true);
        if (ev.key === "Escape") done(false);
        ev.stopPropagation();
      });
      inp.addEventListener("blur", () => done(true));
      inp.addEventListener("click", ev => ev.stopPropagation());
    });
    wrap.appendChild(el);
  });
};

/* ══════════════ プロパティパネル ══════════════ */
UI.showProps = (focusTag = false) => {
  const pane = document.getElementById("pane-props");
  UI.activateRightTab("props");
  const page = curPage();
  const selDevs = page.devices.filter(d => App.selection.has(d.id));
  const selWires = page.wires.filter(w => App.selection.has(w.id));
  const selTexts = page.texts.filter(t => App.selection.has(t.id));
  const selZones = pageZones(page).filter(z => App.selection.has(z.id));

  const only1 = App.selection.size === 1; // 単体パネルは1点選択時のみ (混在選択は一覧パネル)
  if (selDevs.length === 1 && only1) {
    const dev = selDevs[0];
    const sym = symOf(dev.sym);
    const cat = SYM_CATS[sym.cat];
    const coils = [];
    App.project.pages.forEach(pg => pg.devices.forEach(d => {
      if (symOf(d.sym).mirror) coils.push(d);
    }));
    pane.innerHTML = `
      <div class="prop-head">
        <div class="prop-thumb">${symThumbSVG(sym, 34)}</div>
        <div class="prop-head-txt">
          <div class="t1">${sym.name}</div>
          <div class="t2">${sym.nameEn}<span class="cat-pill" style="background:${cat.color}22;color:${cat.color}">${cat.name}</span></div>
        </div>
      </div>
      <div class="prop-row"><label>デバイスタグ (DT)</label><input id="pTag" class="mono" value="${dev.linkTo ? displayTag(dev) : (dev.tag || "")}" ${dev.linkTo ? "disabled" : ""}/></div>
      <div class="prop-row"><label>機能テキスト</label><input id="pDesc" value="${(dev.desc || "").replace(/"/g, "&quot;")}"/></div>
      <div class="prop-row"><label>型式 (部品表用)</label><input id="pType" class="mono" value="${(dev.typeRef || "").replace(/"/g, "&quot;")}" placeholder="${sym.typ ? "例: " + sym.typ : "型式を入力"}"/></div>
      <div class="prop-grid2">
        <div class="prop-row"><label>X (mm)</label><input id="pX" class="mono" type="number" step="5" value="${dev.x}"/></div>
        <div class="prop-row"><label>Y (mm)</label><input id="pY" class="mono" type="number" step="5" value="${dev.y}"/></div>
      </div>
      ${symOf(dev.sym).linked || sym.sim?.startsWith("contact") ? `
      <div class="prop-row"><label>コイルにリンク (クロスリファレンス)</label>
        <select id="pLink"><option value="">— リンクなし —</option>
        ${coils.map(c => `<option value="${c.id}" ${dev.linkTo === c.id ? "selected" : ""}>${c.tag} (${symOf(c.sym).name})</option>`).join("")}
        </select></div>` : ""}
      ${sym.timer ? `<div class="prop-row"><label>遅延時間 (秒)</label><input id="pDelay" class="mono" type="number" step="0.5" min="0" value="${dev.props.delay || 2}"/></div>` : ""}
      ${symStretchBase(sym) ? (() => {
        const st = symStretchBase(sym).stretch;
        const span = sym.span || st.def;
        // mm で指定する寸法違い (入出力結線図の行ピッチ) は、そのまま mm で見せる
        if (st.unit === "mm") {
          return `<div class="prop-row"><label>${st.label} <span class="rp-dim">(${st.min}〜${st.max}mm・5mm 刻み)</span></label>
            <input id="pSpanMM" class="mono" type="number" step="5" min="${st.min}" max="${st.max}" value="${span}"/></div>`;
        }
        const n = symSpanToCores(span);
        const cable = baseIdOfCable(sym);
        return `<div class="prop-row"><label>${st.label} <span class="rp-dim">(囲みの長さ ${span}mm・5mm ピッチ)</span></label>
          <input id="pSpan" class="mono" type="number" step="1" min="${symSpanToCores(st.min)}" max="${symSpanToCores(st.max)}" value="${n}"/></div>` +
          (cable ? `<div class="prop-row"><label>長さ (m) <span class="rp-dim">(部品表の集計用)</span></label>
          <input id="pLen" class="mono" type="number" step="0.1" min="0" value="${dev.props && dev.props.len !== undefined ? dev.props.len : ""}" placeholder="例: 12.5"/></div>` : "");
      })() : ""}
      ${sym.swapGroup ? (() => {
        /* 同じ仲間の記号への差し替え (機種違いなど)。タグ・機能テキスト・位置は
           そのまま残るので、結線図を描き直さずに機種だけ変えられる */
        const kin = Object.values(SYMBOLS_BY_ID).filter(s2 => s2.swapGroup === sym.swapGroup && !s2.stretchOf)
          .sort((a2, b2) => String(a2.typ || a2.id).localeCompare(String(b2.typ || b2.id)));
        return `<div class="prop-row"><label>機種 <span class="rp-dim">(差し替えると端子構成ごと入れ替わります)</span></label>
          <select id="pSwap">${kin.map(s2 =>
            `<option value="${s2.id}"${s2.id === sym.id ? " selected" : ""}>${escAttr(s2.name || s2.typ)}</option>`).join("")}</select></div>`;
      })() : ""}
      ${sym.ioSheet ? `<div class="prop-row"><label>結線図の下地 <span class="rp-dim">(レールと各行の分岐を実線で引きます)</span></label>
        <button class="btn-solid primary" id="pScaffold" style="padding:3px 10px;font-size:11px">結線図の下地を作る</button></div>` : ""}
      ${(sym.nonstd && sym.stdNote) ? `<div class="prop-row"><label>規格外図記号の凡例 <span class="rp-dim">(JIS C 0617-1: 規格にない図記号は図面上で説明する)</span></label>
        <button class="btn-solid" id="pStdNote" style="padding:3px 10px;font-size:11px">凡例を注記として貼る</button></div>` : ""}
      ${sym.fnRows ? (() => {
        // 機能欄 (行ごとの文言)。1 行 1 端子でまとめて貼り付けられる
        const fn = (dev.props && dev.props.fn) || {};
        const val = (p2, i) => (Array.isArray(fn) ? fn[i] : fn[p2.n]) || "";
        const names = sym.pins.map(p2 => p2.n).join(" / ");
        return `<div class="prop-row"><label>機能欄 <span class="rp-dim">(1 行 = 1 端子: ${escAttr(names)})</span></label>
          <textarea id="pFn" rows="${Math.min(12, sym.fnRows)}" class="mono" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:6px;color:var(--text);font-size:12px;padding:6px 8px;outline:none;resize:vertical">${escAttr(sym.pins.map(val).join("\n"))}</textarea></div>`;
      })() : ""}
      ${sym.sheet ? (() => {
        // 用紙に合わせて作った記号 (入出力結線図)。今の用紙と違えば 1 押しで直せる
        const mm = symSheetMismatch(curPage(), sym);
        return `<div class="prop-row"><label>この記号の用紙 <span class="rp-dim">(結線図は用紙 1 枚 = 記号 1 個)</span></label>
          <div class="mono" style="display:flex;align-items:center;gap:8px">
            <span>${escAttr(sheetLabel(symSheetSpec(sym)))}</span>
            ${mm ? `<button class="btn-solid primary" id="pSheetFix" style="padding:3px 10px;font-size:11px">この用紙にする</button>`
                 : `<span class="rp-dim">✓ このページはこの用紙です</span>`}
          </div></div>`;
      })() : ""}
      ${sym.gotoRef ? (() => {
        // 行き先はページ id を持つ。図番はページの現在の値を描くたびに引くので、
        // ページを並べ替えても図番を振り直しても表示が追従する
        const cur2 = (dev.props && dev.props.toPage) || "";
        const opts2 = App.project.pages.filter(pg => pg !== curPage())
          .map(pg => `<option value="${pg.id}"${pg.id === cur2 ? " selected" : ""}>${escAttr(pageDwgNo(pg))} — ${pg.no}. ${escAttr(pg.name)}</option>`).join("");
        return `<div class="prop-row"><label>行き先 <span class="rp-dim">(図面番号は選んだページのものを表示)</span></label>
          <select id="pGoto"><option value=""${cur2 ? "" : " selected"}>— 未設定 —</option>${opts2}</select></div>`;
      })() : ""}
      ${sym.mirror ? UI.mirrorHTML(dev) : ""}
    `;
    const bind = (id, fn) => {
      const el = pane.querySelector(id);
      if (el) el.addEventListener("change", () => { commit(); fn(el.value); UI.refresh(false); });
    };
    bind("#pTag", v => {
      const nv = v.trim();
      // タグ重複の即時警告 (DRC を待たない)
      let dup = false;
      App.project.pages.forEach(pg => pg.devices.forEach(d => {
        if (d !== dev && !d.linkTo && d.tag === nv && nv) dup = true;
      }));
      if (dup) UI.toast(`⚠ タグ ${nv} は既に使われています (DRCでエラーになります)`, 3800);
      dev.tag = nv;
    });
    bind("#pDesc", v => dev.desc = v.trim());
    bind("#pType", v => dev.typeRef = v.trim());
    const num = (v, old) => { const n = parseFloat(v); return isNaN(n) ? old : snap(n); }; // 0 も入力可
    bind("#pX", v => dev.x = num(v, dev.x));
    bind("#pY", v => dev.y = num(v, dev.y));
    bind("#pLink", v => dev.linkTo = v || null);
    // 「この用紙にする」— ページの用紙を記号に合わせ、図枠の中へ入れ直す
    // 機種の差し替え。位置・タグ・機能テキストは残し、つないである配線は
    // 端子が動いたぶんだけ知らせる (検図の未接続で拾える)
    bind("#pSwap", v => {
      if (!v || v === dev.sym) return;
      const before = symOf(dev.sym), n0 = devPins(dev).length;
      dev.sym = v;
      const after = symOf(v);
      // 型式は差し替えに追従させる (図と部品表が食い違わないように)。
      // 使う人が手で入れた型式は尊重する
      if (!dev.typeRef || dev.typeRef === (before.typ || "")) dev.typeRef = after.typ || "";
      // 機能欄は端子名で持っているので、名前の変わらない端子はそのまま残る
      App.labelRev++;
      UI.toast(`${after.name} に差し替えました (端子 ${n0} → ${after.pins.length})`, 3200);
    });
    // 機能欄: 1 行 1 端子でまとめて入れる
    const fnEl = pane.querySelector("#pFn");
    if (fnEl) fnEl.addEventListener("change", () => {
      commit();
      dev.props = dev.props || {};
      const lines = fnEl.value.split("\n").map(v => v.trim());
      const map = {};
      sym.pins.forEach((p2, i) => { if (lines[i]) map[p2.n] = lines[i]; });
      if (Object.keys(map).length) dev.props.fn = map; else delete dev.props.fn;
      App.labelRev++;
      UI.refresh(false);
    });
    // 結線図の下地 (レール + 各行の分岐) を実線で引く
    const sc = pane.querySelector("#pScaffold");
    if (sc) sc.addEventListener("click", () => {
      commit();
      const n = buildIoScaffold(curPage(), dev);
      UI.refresh();
      UI.toast(n ? `下地を引きました (導体 ${n} 本。隙間に現場機器を置いてください)` : "下地はすでにあります", 3200);
    });
    /* 規格外の図記号は、その図面 (または添付文書) 上で説明するのが
       JIS C 0617-1 / IEC 60617-1 の決まり。プロパティの説明文だけでは
       出図した紙にも DXF にも出ないので、注記として貼れるようにする */
    const sn = pane.querySelector("#pStdNote");
    if (sn) sn.addEventListener("click", () => {
      commit();
      const pg = curPage(), fr = frameRect();
      const text = `【凡例】${sym.name}: ${sym.stdNote}`;
      if (pg.texts.some(t2 => t2.text === text)) { UI.toast("この凡例はすでに貼ってあります", 2600); return; }
      const n = pg.texts.filter(t2 => /^【凡例】/.test(t2.text)).length;
      pg.texts.push({ id: uid("t"), x: fr.x + 5, y: fr.y + fr.h - 5 - n * 5,
        text, size: TEXT_H.small, anchor: "start" });
      UI.refresh();
      UI.toast("凡例を図枠の左下に貼りました (位置は動かせます)", 3200);
    });
    const fix = pane.querySelector("#pSheetFix");
    if (fix) fix.addEventListener("click", () => {
      const want = symSheetSpec(sym);
      if (!want) return;
      commit();
      const page = curPage();
      const frBefore = frameRect();
      page.paper = want.paper; page.orient = want.orient; page.scale = want.scale;
      applySheet(page);
      /* 用紙が変わると図枠の原点も動く。用紙変更の正規の経路 (図枠・表題欄の
         設定) と同じく、このページの図形ぜんぶを原点の移動ぶん平行移動する。
         記号だけ動かすと、描いてある配線や注記だけが図枠に対してずれる */
      shiftProjectGeometry(SHEET.marginLeft - frBefore.x, SHEET.margin - frBefore.y, [page]);
      /* そのうえで、この記号が図枠に収まらなければ中へ入れ直す。
         格子へ丸めるときに図枠の外へ半目こぼれないよう、下限は切り上げ・
         上限は切り捨てで丸める。つないである配線の端点も一緒に動かす
         (置き直しで結線が外れては、用紙を合わせる意味がない) */
      const fr = frameRect(), bb = devBounds(dev);
      const put = (v, lo, hi) => {
        const l = Math.ceil(lo / GRID) * GRID, h2 = Math.floor(hi / GRID) * GRID;
        return Math.min(Math.max(snap(v), l), Math.max(l, h2));
      };
      const nx = put(dev.x, fr.x + (dev.x - bb.x), fr.x + fr.w - (bb.x + bb.w - dev.x));
      const ny = put(dev.y, fr.y + (dev.y - bb.y), fr.y + fr.h - (bb.y + bb.h - dev.y));
      if (nx !== dev.x || ny !== dev.y) moveDeviceWithWires(page, dev, nx - dev.x, ny - dev.y);
      App.labelRev++;
      UI.refresh(); zoomFit();
      UI.toast(`用紙を ${sheetLabel(want)} にしました`, 2600);
    });
    bind("#pGoto", v => {
      dev.props = dev.props || {};
      if (v) dev.props.toPage = v; else delete dev.props.toPage;
      App.labelRev++;
    });
    bind("#pDelay", v => { const n = parseFloat(v); dev.props.delay = isNaN(n) ? 2 : n; });
    // 行ピッチ (mm 指定の寸法違い)。下地を引き直せるよう、古い下地は消して知らせる
    bind("#pSpanMM", v => {
      const base = symStretchBase(symOf(dev.sym));
      if (!base) return;
      const span = symStretchSpan(base, Math.round(parseFloat(v) / GRID) * GRID);
      symStretchVariant(base, span);
      /* 隙間に置いてある現場機器も新しい行の高さへ運び、下地を引き直す。
         記号だけ差し替えると機器が旧位置に残り、全行が外れる */
      const oldSp = symOf(dev.sym).ioSheet;
      dev.sym = `${base.id}@${span}`;
      const moved = oldSp ? moveIoRowDevices(curPage(), dev, oldSp, symOf(dev.sym).ioSheet) : 0;
      const n = symOf(dev.sym).ioSheet ? buildIoScaffold(curPage(), dev) : 0;
      App.labelRev++;
      UI.toast(`行ピッチを ${span}mm にしました` +
        (moved ? ` (現場機器 ${moved} 台と下地を引き直しました)` : n ? " (下地を引き直しました)" : ""), 3600);
    });
    // 伸縮シンボル: 長さを変えると "base@長さ" の寸法違いに差し替える
    bind("#pSpan", v => {
      const base = symStretchBase(symOf(dev.sym));
      if (!base) return;
      const span = symStretchSpan(base, symCoresToSpan(parseFloat(v)));
      symStretchVariant(base, span);      // 定義を用意してから割り当てる
      dev.sym = `${base.id}@${span}`;
      // 心線囲みと遮へいは 1 本のケーブルなので、芯数は必ず両方に効かせる
      // (片方だけ変わると「遮へいと心線囲みの不一致」で検図に出る)
      const mate = cablePartner(curPage(), dev);
      if (mate) {
        const mb = symStretchBase(symOf(mate.sym));
        if (mb) { symStretchVariant(mb, span); mate.sym = `${mb.id}@${span}`; }
      }
      App.labelRev++;
      // 範囲外の入力は丸めた値を欄に書き戻す (打った数字が残ると誤解を招く)
      const el = pane.querySelector("#pSpan");
      if (el) el.value = String(symSpanToCores(span));
    });
    bind("#pLen", v => {
      const n2 = parseFloat(v);
      if (isNaN(n2) || n2 <= 0) delete dev.props.len; else dev.props.len = n2;
      const mate = cablePartner(curPage(), dev);      // 長さも 1 本ぶんとして共有する
      if (mate) { mate.props = mate.props || {}; if (isNaN(n2) || n2 <= 0) delete mate.props.len; else mate.props.len = n2; }
    });
    if (focusTag) { const t = pane.querySelector("#pTag"); if (t && !t.disabled) { t.focus(); t.select(); } }
    pane.querySelectorAll(".xref-item").forEach(el => {
      el.addEventListener("click", () => UI.jumpToDevice(el.dataset.target));
    });
  } else if (selWires.length === 1 && only1) {
    // 配線単体: 線番 + 電線仕様 (複数選択パネルより先に判定すること)
    const w = selWires[0];
    pane.innerHTML = `
      <div class="prop-head"><div class="prop-head-txt"><div class="t1">${isWireConductive(w) ? "配線" : "作図線"}</div><div class="t2">${w.pts.length - 1} セグメント${isWireConductive(w) ? " — ダブルクリックでも線番編集可" : " — 電気的な接続ではありません"}</div></div></div>
      <div class="prop-row"><label>線種</label><select id="pStyle">${
        Object.entries(WIRE_STYLES).map(([k, v]) =>
          `<option value="${k}"${(w.style || "solid") === k ? " selected" : ""}>${v.name}</option>`).join("")
      }</select></div>
      <div class="prop-row"><label class="chk"><input type="checkbox" id="pAux" ${isWireConductive(w) ? "" : "checked"}/>
        作図線にする (電気的に接続しない)</label></div>
      ${isWireConductive(w) ? `
      <div class="prop-row"><label>配線番号 ${w.fixed ? "(手動・自動採番から保護)" : ""}</label><input id="pNum" class="mono" value="${w.num || ""}"/></div>
      <div class="prop-row"><label>電線仕様 (サイズ・色)</label><input id="pSpec" class="mono" value="${(w.spec || "").replace(/"/g, "&quot;")}" placeholder="例: KIV(BL)-1.25sq"/></div>`
      : `<div class="prop-note">作図線です。接続ドット・線番は付かず、ネット解析・
         シミュレーション・検図 (DRC)・端子表・接続リストの対象外です。<br>
         破線のまま回路として扱いたい場合は上のチェックを外してください。</div>`}`;
    /** aux: 作図線にするか。auto=true は線種変更に伴う自動設定 (後で線種を
        実線に戻したときに自動解除できるよう印を付ける) */
    const applyAux = (aux, auto) => {
      if (aux && w.num && !auto &&
          !confirm(`線番 ${w.num} を削除し、この配線を回路から切り離します。よろしいですか？`)) return false;
      commit();
      if (aux) { w.aux = true; if (auto) w.auxAuto = true; else delete w.auxAuto; }
      else if (auto) { delete w.aux; delete w.auxAuto; }   // 実線に戻したときの自動解除
      else { w.aux = false; delete w.auxAuto; }            // 破線のまま回路として扱う (手動指定)
      if (aux) { w.num = null; w.numShow = false; w.fixed = false; delete w.spec; }
      return true;
    };
    pane.querySelector("#pStyle").addEventListener("change", e => {
      const v = e.target.value;
      const wantAux = v !== "solid";
      // 手動指定 (auxAuto なし) は尊重し、自動設定だけを線種に追従させる
      const manual = w.aux !== undefined && !w.auxAuto;
      if (!manual && wantAux !== !isWireConductive(w)) {
        if (!applyAux(wantAux, true)) { e.target.value = w.style || "solid"; return; }
      } else commit();
      if (v === "solid") delete w.style; else w.style = v;
      UI.refresh(false);
      UI.showProps();
    });
    pane.querySelector("#pAux").addEventListener("change", e => {
      if (!applyAux(e.target.checked)) { e.target.checked = !e.target.checked; return; }
      UI.refresh(false);
      UI.showProps();
    });
    if (!isWireConductive(w)) return;
    pane.querySelector("#pNum").addEventListener("change", e => {
      commit();
      const v = e.target.value.trim();
      const n = setWireNumber(page, w, v);   // ネット全体に反映 (1ネット1線番)
      UI.refresh(false);
      UI.setMsg(v ? `線番を ${v} に変更しました (同じネットの配線 ${n} 本に反映・自動採番から保護)`
                  : "線番を自動採番に戻しました");
    });
    pane.querySelector("#pSpec").addEventListener("change", e => {
      commit();
      setWireSpec(page, w, e.target.value.trim());
      UI.refresh(false);
    });
  } else if (selZones.length === 1 && only1) {
    // 破線枠 (盤外エリア / 機器グループ)
    const z = pageZones(page).find(z => App.selection.has(z.id));
    pane.innerHTML = `
      <div class="prop-head"><div class="prop-head-txt"><div class="t1">破線枠</div><div class="t2">盤外エリア / 機器グループの囲み</div></div></div>
      <div class="prop-row"><label>ラベル</label><input id="zLabel" value="${(z.label || "").replace(/"/g, "&quot;")}" placeholder="例: 盤外 / TR1 ターミナルリレー"/></div>
      <div class="prop-grid2">
        <div class="prop-row"><label>X (mm)</label><input id="zX" class="mono" type="number" step="5" value="${z.x}"/></div>
        <div class="prop-row"><label>Y (mm)</label><input id="zY" class="mono" type="number" step="5" value="${z.y}"/></div>
        <div class="prop-row"><label>幅 (mm)</label><input id="zW" class="mono" type="number" step="5" value="${z.w}"/></div>
        <div class="prop-row"><label>高さ (mm)</label><input id="zH" class="mono" type="number" step="5" value="${z.h}"/></div>
      </div>`;
    const zbind = (id, fn) => pane.querySelector(id).addEventListener("change", e => {
      commit(); fn(e.target.value); UI.refresh(false);
    });
    zbind("#zLabel", v => z.label = v.trim());
    const num = (v, old) => { const n = parseFloat(v); return isNaN(n) ? old : snap(n); };
    zbind("#zX", v => z.x = num(v, z.x));
    zbind("#zY", v => z.y = num(v, z.y));
    zbind("#zW", v => z.w = Math.max(20, num(v, z.w)));
    zbind("#zH", v => z.h = Math.max(20, num(v, z.h)));
  } else if (selTexts.length === 1 && only1) {
    // テキスト単体: 内容とサイズ
    const t = selTexts[0];
    pane.innerHTML = `
      <div class="prop-head"><div class="prop-head-txt"><div class="t1">テキスト</div><div class="t2">図面注記</div></div></div>
      <div class="prop-row"><label>内容</label><input id="pTxt" value="${(t.text || "").replace(/"/g, "&quot;")}"/></div>
      <div class="prop-row"><label>文字高 (mm)</label><input id="pTsz" class="mono" type="number" step="0.5" min="2.5" value="${textHeight(t)}"/></div>`;
    pane.querySelector("#pTxt").addEventListener("change", e => { commit(); t.text = e.target.value; UI.refresh(false); });
    pane.querySelector("#pTsz").addEventListener("change", e => { commit(); const n = parseFloat(e.target.value); if (!isNaN(n)) t.size = Math.max(2.5, n); UI.refresh(false); });
  } else if (selDevs.length + selWires.length + selTexts.length + selZones.length > 1) {
    const total = selDevs.length + selWires.length + selTexts.length + selZones.length;
    pane.innerHTML = `
      <div class="prop-empty">
        <div style="font-size:22px;font-weight:700;color:var(--text)">${total}</div>
        個のオブジェクトを選択中<br><br>
        デバイス ${selDevs.length} ・ 配線 ${selWires.length} ・ テキスト ${selTexts.length}${selZones.length ? ` ・ 破線枠 ${selZones.length}` : ""}
      </div>
      ${selWires.length > 1 ? `<div class="prop-row" style="margin-top:14px"><label>選択した配線 ${selWires.length} 本の線種</label><select id="pStyleAll">
        <option value="">— 変更しない —</option>
        ${Object.entries(WIRE_STYLES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("")}
      </select></div>` : ""}`;
    const bulk = pane.querySelector("#pStyleAll");
    if (bulk) bulk.addEventListener("change", e => {
      const v = e.target.value;
      if (!v) return;
      const numbered = selWires.filter(w => w.num).length;
      if (v !== "solid" && numbered &&
          !confirm(`${numbered} 本の配線から線番を削除し、回路から切り離します。よろしいですか？`)) {
        e.target.value = ""; return;
      }
      commit();
      selWires.forEach(w => {
        if (v === "solid") delete w.style; else w.style = v;
        const manual = w.aux !== undefined && !w.auxAuto;
        if (!manual) {
          if (v === "solid") { delete w.aux; delete w.auxAuto; }
          else { w.aux = true; w.auxAuto = true; }
        }
        if (!isWireConductive(w)) { w.num = null; w.numShow = false; w.fixed = false; delete w.spec; }
      });
      UI.refresh(false);
      UI.setMsg(`${selWires.length} 本の線種を「${WIRE_STYLES[v].name}」に変更しました`);
    });
  } else {
    pane.innerHTML = `
      <div class="prop-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l16 8-7 1.5L16 20l-3 1-2.6-6L4 18V4z"/></svg><br>
        オブジェクトを選択すると<br>プロパティが表示されます<br><br>
        <b style="color:var(--text-dim)">F2</b> で AI 自動作図
      </div>`;
  }
};

UI.mirrorHTML = (coilDev) => {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return `<div class="prop-sect">連動接点</div><div style="font-size:11.5px;color:var(--text-faint)">リンクされた接点はありません</div>`;
  return `<div class="prop-sect">連動接点 (${contacts.length})</div>
    <div class="xref-list">
      ${contacts.map(c => `<div class="xref-item" data-target="${c.id}">
        <span class="xr-tag">${symOf(c.sym).name}</span>
        <span class="xr-loc">/${devLocation(c)}</span>
      </div>`).join("")}
    </div>`;
};

UI.jumpToDevice = (devId) => {
  const f = findDevice(devId);
  if (!f) return;
  App.pageIdx = App.project.pages.indexOf(f.page);
  App.selection.clear();
  App.selection.add(devId);
  UI.refresh();
  // ズームしてセンタリング
  const r = Editor.svg.getBoundingClientRect();
  const s = Editor.view.s;
  Editor.view.tx = r.width / 2 - f.dev.x * s;
  Editor.view.ty = r.height / 2 - f.dev.y * s;
  requestRender();
};

UI.activateRightTab = (name) => {
  document.querySelectorAll(".rtab").forEach(t => t.classList.toggle("active", t.dataset.rtab === name));
  document.querySelectorAll(".rpane").forEach(p => p.classList.toggle("active", p.id === "pane-" + name));
};

/* ══════════════ DRC パネル ══════════════ */
UI.runDRC = () => {
  UI.activateRightTab("drc");
  const pane = document.getElementById("pane-drc");
  const issues = runDRC();
  const nPages = App.project.pages.length;
  let html = `<div class="drc-run-row"><button class="btn-solid primary" id="drcRerun">再チェック</button></div>`;
  html += `<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;line-height:1.7">${DRC_RULES.length} ルール × ${nPages} ページを検査<br>`;
  if (!issues.length) {
    html += `<span style="white-space:nowrap">指摘なし</span></div>`;
    html += `<div class="drc-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l3 3 5-6"/></svg><br>問題は見つかりませんでした</div>`;
  } else {
    const errs = issues.filter(i => i.sev === "err").length;
    html += `<span style="white-space:nowrap"><b style="color:var(--err)">エラー ${errs}</b> ・ <b style="color:var(--warn)">警告 ${issues.length - errs}</b></span></div>`;
    issues.forEach((iss, i) => {
      const [pg, col] = String(iss.loc).split(".");
      html += `<div class="drc-item ${iss.sev}" data-i="${i}">
        <span class="drc-ico">${iss.sev === "err"
          ? '<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.6"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1.5L15 14H1L8 1.5z" fill="currentColor"/><path d="M8 6v3.5M8 11.5v1.5" stroke="#3a2b12" stroke-width="1.4"/></svg>'}</span>
        <div><div class="drc-msg">${iss.msg}</div><div class="drc-loc">ページ ${iss.page}${col !== undefined && col !== "-" ? ` ・ 列 ${col}` : ""} — クリックでジャンプ</div></div>
      </div>`;
    });
  }
  const hasGenWarn = App.project.pages.some(p => (p.genWarnings || []).length);
  if (hasGenWarn) {
    html += `<button class="btn-solid" id="drcClearGen" style="width:100%;margin-top:8px">生成時警告を確認済みにする (クリア)</button>`;
  }
  pane.innerHTML = html;
  pane.querySelector("#drcRerun").addEventListener("click", UI.runDRC);
  const clearBtn = pane.querySelector("#drcClearGen");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    commit();
    App.project.pages.forEach(p => { delete p.genWarnings; });
    UI.runDRC();
    UI.setMsg("生成時警告をクリアしました");
  });
  pane.querySelectorAll(".drc-item").forEach(el => {
    el.addEventListener("click", () => {
      const iss = issues[+el.dataset.i];
      if (iss.target) UI.jumpToDevice(iss.target);
    });
  });
  UI.setMsg(issues.length ? `DRC: ${issues.length} 件の指摘` : "DRC: 問題なし");
};

/* ══════════════ BOM パネル ══════════════ */
UI.showBOM = () => {
  UI.activateRightTab("bom");
  const pane = document.getElementById("pane-bom");
  const rows = buildBOM();
  if (!rows.length) {
    pane.innerHTML = `<div class="prop-empty">デバイスを配置すると<br>部品表が自動生成されます</div>`;
    return;
  }
  const plc = buildPLCList();
  const esc = s => String(s).replace(/</g, "&lt;");
  pane.innerHTML = `
    <table class="bom-table">
      <thead><tr><th>デバイスタグ</th><th>名称</th><th>型式</th><th>数</th><th>長さ(m)</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="mono clip" title="${esc(r.tags.join(", "))}">${esc(r.tags.length > 2 ? r.tags.slice(0, 2).join(" ") + "…" : r.tags.join(" "))}</td>
        <td class="clip" title="${esc(r.name)}">${esc(r.name)}</td><td class="mono clip" title="${esc(r.typeRef)}">${esc(r.typeRef)}</td><td>${r.tags.length}</td>
        <td class="mono">${r.cable ? (r.len ? +r.len.toFixed(1) : "—") : ""}</td></tr>`).join("")}</tbody>
    </table>
    ${plc.length ? `
    <div class="prop-sect" style="margin-top:16px">PLC アドレス一覧</div>
    <table class="bom-table">
      <thead><tr><th>アドレス</th><th>種別</th><th>タグ</th><th>位置</th></tr></thead>
      <tbody>${plc.map(r => `<tr><td class="mono">${esc(r.addr)}</td><td>${r.kind}</td><td class="mono">${esc(r.tag)}</td><td class="mono">/${r.loc}</td></tr>`).join("")}</tbody>
    </table>` : ""}
    <div class="bom-actions">
      <button class="btn-solid" id="bomCsv">部品表CSV</button>
      <button class="btn-solid" id="connCsv">接続リストCSV</button>
      <button class="btn-solid" id="termCsv">端子表CSV</button>
    </div>`;
  pane.querySelector("#bomCsv").addEventListener("click", () => {
    downloadFile(App.project.name + "_部品表.csv", bomCSV(), "text/csv");
    UI.setMsg("部品表CSVを出力しました");
  });
  pane.querySelector("#connCsv").addEventListener("click", () => {
    downloadFile(App.project.name + "_接続リスト.csv", connectionCSV(), "text/csv");
    UI.setMsg("接続リストCSVを出力しました");
  });
  pane.querySelector("#termCsv").addEventListener("click", () => {
    downloadFile(App.project.name + "_端子表.csv", terminalCSV(), "text/csv");
    UI.setMsg("端子表CSVを出力しました");
  });
};

/* ══════════════ メニュー ══════════════ */
const MENUS = {
  file: [
    { label: "新規プロジェクト", key: "", fn: () => UI.newProject() },
    { label: "開く (JSON)…", key: "", fn: () => UI.openFile() },
    { sep: true },
    { label: "上書き保存", key: "Ctrl+S", fn: () => UI.saveOver() },
    { label: "名前を付けて保存…", key: "Ctrl+Shift+S", fn: () => UI.saveAs() },
    { label: "エクスポート (JSON)", key: "", fn: () => { syncProjectSymbols(); downloadFile(App.project.name + ".ecad.json", JSON.stringify(App.project, null, 1)); } },
    { label: "エクスポート (SVG・現在ページ)", key: "", fn: () => downloadFile(App.project.name + "_p" + curPage().no + ".svg", exportSheetSVG(), "image/svg+xml") },
    { sep: true },
    { label: "図枠・表題欄の設定…", key: "", fn: () => UI.sheetSetup() },
    { sep: true },
    { label: "DXF取り込み (図面に作図)…", key: "", fn: () => UI.importDXF() },
    { label: "DXF出力 (AutoCAD互換・全ページ)", key: "", fn: () => UI.exportDXF() },
    { label: "PDF出力 (全ページ印刷)…", key: "", fn: () => UI.printAll() },
    { label: "印刷 (現在ページ)…", key: "Ctrl+P", fn: () => UI.print() },
    { sep: true },
    { label: "設計完了 (DXF + PDF を出力)…", key: "", fn: () => UI.finishDesign() },
    { label: "設計完了履歴…", key: "", fn: () => UI.openReleaseHistory() },
  ],
  edit: [
    { label: "シンボルデータベース…", key: "", fn: () => UI.openSymDB() },
    { label: "シンボルを作成…", key: "", fn: () => UI.openSymbolEditor() },
    { label: "自作シンボルの管理…", key: "", fn: () => UI.manageCustomSymbols() },
    { sep: true },
    { label: "元に戻す", key: "Ctrl+Z", fn: () => { if (undo()) UI.refresh(); } },
    { label: "やり直し", key: "Ctrl+Y", fn: () => { if (redo()) UI.refresh(); } },
    { sep: true },
    { label: "コピー", key: "Ctrl+C", fn: copySelection },
    { label: "貼り付け", key: "Ctrl+V", fn: pasteClipboard },
    { label: "削除", key: "Del", fn: deleteSelection },
    { label: "回転", key: "R", fn: rotateSelection },
    { sep: true },
    { label: "すべて選択", key: "Ctrl+A", fn: () => UI.selectAll() },
  ],
  view: [
    { label: "全体表示", key: "F", fn: zoomFit },
    { label: "100%", key: "", fn: () => {
      const r = Editor.svg.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, 2.2 / Editor.view.s);
    } },
    { label: "拡大", key: "+", fn: () => UI.zoomCenter(1.25) },
    { label: "縮小", key: "−", fn: () => UI.zoomCenter(0.8) },
    { sep: true },
    { label: "ズーム速度…", key: "", fn: () => UI.zoomSpeedDialog() },
  ],
  insert: [
    { label: "AI自動作図…", key: "F2", fn: () => UI.openWizard() },
    { sep: true },
    { label: "ページを追加", key: "", fn: () => UI.addPage() },
    { label: "テキスト", key: "T", fn: () => UI.setTool("text") },
    { label: "破線枠 (盤外/グループ)", key: "", fn: () => UI.insertZone() },
  ],
  project: [
    { label: "ページの並べ替え…", key: "", fn: () => UI.reorderPages() },
    { sep: true },
    { label: "設計ルールチェック (DRC)", key: "", fn: () => UI.runDRC() },
    { label: "部品表 (BOM)", key: "", fn: () => UI.showBOM() },
    { label: "配線番号の自動付与", key: "", fn: () => { commit(); autoNumberWires(); UI.refresh(false); UI.setMsg("配線番号を付与しました (手動線番は保護)"); } },
    { label: "線番の編集…", key: "", fn: () => UI.editWireNumbers() },
    { sep: true },
    { label: "部品表CSV を出力", key: "", fn: () => downloadFile(App.project.name + "_部品表.csv", bomCSV(), "text/csv") },
    { label: "接続リストCSV を出力", key: "", fn: () => downloadFile(App.project.name + "_接続リスト.csv", connectionCSV(), "text/csv") },
    { label: "端子表CSV を出力", key: "", fn: () => downloadFile(App.project.name + "_端子表.csv", terminalCSV(), "text/csv") },
    { sep: true },
    { label: "通電シミュレーション", key: "F5", fn: () => UI.toggleSim() },
  ],
  help: [
    { label: "キーボードショートカット", key: "", fn: () => UI.showShortcuts() },
    { label: "クイックスタート", key: "", fn: () => UI.showQuickstart() },
  ],
};

UI.setupMenus = () => {
  document.querySelectorAll("#menubar .menu").forEach(m => {
    m.addEventListener("click", e => {
      e.stopPropagation();
      const wasOpen = UI._openMenu === m; // 同じメニューの再クリックはトグルで閉じる
      UI.closeDropdown();
      if (wasOpen) return;
      const items = MENUS[m.dataset.menu];
      if (!items) return;
      m.classList.add("open");
      const r = m.getBoundingClientRect();
      const dd = h(`<div class="dropdown" style="left:${r.left}px;top:${r.bottom + 4}px"></div>`);
      items.forEach(it => {
        if (it.sep) { dd.appendChild(h('<div class="dd-sep"></div>')); return; }
        const el = h(`<div class="dd-item"><span>${it.label}</span>${it.key ? `<span class="dd-key">${it.key}</span>` : ""}</div>`);
        el.addEventListener("click", () => { UI.closeDropdown(); it.fn(); });
        dd.appendChild(el);
      });
      document.getElementById("overlay-root").appendChild(dd);
      UI._openMenu = m;
    });
  });
  document.addEventListener("click", () => UI.closeDropdown());
};
UI.closeDropdown = () => {
  document.querySelectorAll(".dropdown").forEach(d => d.remove());
  if (UI._openMenu) { UI._openMenu.classList.remove("open"); UI._openMenu = null; }
};

/* ══════════════ ツール切替 ══════════════ */
UI.setTool = (tool) => {
  if (App.sim.running && tool !== "select" && tool !== "pan") {
    UI.setMsg("シミュレーション中は編集ツールを使えません (Escで終了)");
    return;
  }
  App.tool = tool;
  cancelDraft();
  UI.syncToolButtons();
  const modeNames = {
    select: "選択モード",
    wire: "配線モード — ピンをクリックで開始 / クリックで曲げ / ダブルクリックか Enter で確定 / Backspace で1点戻る / Esc でキャンセル",
    pan: "パンモード",
    text: "テキストモード — クリックで文字入力",
  };
  document.getElementById("stMode").textContent = modeNames[tool] || tool;
  const cv = document.getElementById("canvas");
  cv.setAttribute("class", "tool-" + tool + (App.sim.running ? " simmode" : ""));
};
UI.syncToolButtons = () => {
  document.querySelectorAll(".rbtn.tool").forEach(b => b.classList.toggle("active", b.dataset.tool === App.tool));
};

/* ══════════════ シミュレーション ══════════════ */
UI.toggleSim = () => {
  const btn = document.getElementById("btnSim");
  if (App.sim.running) {
    simStop();
    btn.classList.remove("active");
    document.getElementById("simBanner").classList.add("hidden");
    document.getElementById("app").classList.remove("simming");
    clearInterval(UI._simT);
    UI.setTool("select");
    UI.setMsg("シミュレーションを終了しました");
  } else {
    App.selection.clear();
    cancelDraft();
    App.tool = "select";
    UI.syncToolButtons();
    simStart();
    btn.classList.add("active");
    document.getElementById("simBanner").classList.remove("hidden");
    document.getElementById("app").classList.add("simming");
    document.getElementById("canvas").classList.add("simmode");
    UI._simT = setInterval(() => { simSolve(); requestRender(); }, 120);
    UI.setMsg("シミュレーション実行中 — 編集はロックされています");
  }
  btn.blur(); // フォーカスリング残留を防ぐ
  requestRender();
};

/* ══════════════ ページ / プロジェクト操作 ══════════════ */
UI.addPage = () => {
  if (App.sim.running) return;
  commit();
  const pg = newPage("ページ " + (App.project.pages.length + 1), App.project.pages.length + 1);
  App.project.pages.push(pg);
  UI.renumberPages();
  App.pageIdx = App.project.pages.length - 1;
  App.selection.clear();
  UI.refresh();
  zoomFit(); // 追加したページに切り替わるので全体表示にする
};
UI.newProject = () => {
  if (!confirm("現在のプロジェクトを破棄して新規作成しますか？\n(ブラウザ保存済みデータも上書きされます)")) return;
  if (App.sim.running) UI.toggleSim(); // 確定後にのみ停止 (キャンセルは完全な無操作)
  App.project = newProject();
  App.fileHandle = null;
  App.pageIdx = 0;
  App.selection.clear();
  App.undoStack.length = 0;
  App.redoStack.length = 0;
  applySheet();
  UI.updateSaveButton();
  saveLocal();
  UI.refresh();
  zoomFit();
};
/** 端子構成が変わったシンボルを含む旧図面を開いたときの注意喚起。
    配線 (座標) は互換だが、印字される端子番号が変わるので端子台表の再出力を促す。
    once=true (ブラウザ自動保存からの復帰) では1回だけ知らせて毎回のナグを避ける。 */
function noteSymbolMigration(opts = {}) {
  if (!App.project.pages.some(pg => pg.devices.some(d => d.sym === "press_sw"))) return;
  const FLAG = "electracad.note.presssw";
  if (opts.once) {
    try { if (localStorage.getItem(FLAG)) return; localStorage.setItem(FLAG, "1"); } catch (e) { /* 続行 */ }
  }
  UI.setMsg("注意: 圧力スイッチは電子式3線 (P24V=+24V / N24V=0V / OUT=入力信号線) に更新されています — " +
    "端子番号の表示が旧版と変わるため、端子台表・渡り配線表は再出力してください。" +
    "N24V の 0V 配線と、切替接点版で 12 (左上) に配線していた場合のつなぎ直しを確認してください");
}

UI.openFile = async () => {
  // File System Access API があればハンドルを保持し、以後の保存を上書き保存にする
  if (FS_API && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "ElectraCAD プロジェクト", accept: { "application/json": [".json"] } }],
      });
      const text = await (await handle.getFile()).text();
      const p = JSON.parse(text);
      if (!p.pages) throw new Error("bad");
      if (App.sim.running) UI.toggleSim();
      commit();
      App.project = p;
      mergeProjectSymbols();
      saveImportedSymbols();
      App.fileHandle = handle;
      App.pendingHandle = null;
      rememberFileHandle(handle);
      App.pageIdx = 0;
      App.selection.clear();
      UI.renumberPages();      // 読み込んだ図面の図番を現在の設定に同期
      applySheet();
      document.getElementById("projectName").value = p.name;
      UI.updateSaveButton();
      UI.refresh();
      zoomFit();
      UI.setMsg(`読み込みました — ${handle.name} (保存ボタンで上書き保存)`);
      noteSymbolMigration();
    } catch (e) {
      if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return; // キャンセル
      alert("読み込みに失敗しました: 不正なファイル形式です");
    }
    return;
  }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,.ecad.json";
  inp.addEventListener("change", () => {
    const f = inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p.pages) throw new Error("bad");
        if (App.sim.running) UI.toggleSim(); // 読込確定後にのみ停止
        commit();
        App.project = p;
        mergeProjectSymbols();
        saveImportedSymbols();
        App.fileHandle = null; // input[type=file] 経由は上書き先を持てない
        App.pageIdx = 0;
        App.selection.clear();
        UI.renumberPages();      // 読み込んだ図面の図番を現在の設定に同期
        applySheet();
        UI.updateSaveButton();
        document.getElementById("projectName").value = p.name;
        UI.refresh();
        zoomFit();
        UI.setMsg("プロジェクトを読み込みました");
        noteSymbolMigration();
      } catch (e) { alert("読み込みに失敗しました: 不正なファイル形式です"); }
    };
    rd.readAsText(f);
  });
  inp.click();
};
UI.selectAll = () => {
  if (App.sim.running) return;
  const page = curPage();
  App.selection.clear();
  page.devices.forEach(d => App.selection.add(d.id));
  page.wires.forEach(w => App.selection.add(w.id));
  page.texts.forEach(t => App.selection.add(t.id));
  pageZones(page).forEach(z => App.selection.add(z.id));
  UI.showProps();
  requestRender();
};
UI.zoomCenter = (f) => {
  const r = Editor.svg.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
};
UI.print = () => {
  const svg = exportSheetSVG();
  const pm = pageSheetMeta(curPage());
  const paper = pm.paper || "A3";
  const dir = pm.orient === "portrait" ? "portrait" : "landscape";   // 図枠の向きに合わせる
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${App.project.name}</title><style>
    @page { size: ${paper} ${dir}; margin: 0; }
    body { margin: 0 } svg { width: 100vw; height: 100vh }
  </style></head><body>${svg}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
};

/** 全ページを1つの印刷ジョブに (印刷ダイアログで「PDFに保存」を選ぶとPDF出力) */
UI.printAll = () => {
  const pages = App.project.pages.map((pg, i) =>
    `<div class="sheet sheet${i}">${exportSheetSVG(pg)}</div>`).join("");
  // ページごとに用紙が違う場合に備え、名前付き @page で1ページずつ用紙を指定する
  const papers = App.project.pages.map(pg => pageSheetMeta(pg));
  const pageCSS = papers.map((pm, i) =>
    `@page p${i} { size: ${pm.paper || "A3"} ${pm.orient === "portrait" ? "portrait" : "landscape"}; margin: 0 } .sheet${i} { page: p${i} }`).join("\n      ");
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${App.project.name} (全${App.project.pages.length}ページ)</title>
    <style>
      ${pageCSS}
      body { margin: 0; }
      .sheet { width: 100vw; height: 100vh; page-break-after: always; display: flex; align-items: center; justify-content: center; }
      .sheet:last-child { page-break-after: auto; }
      .sheet svg { width: 100%; height: 100%; }
    </style></head><body>${pages}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
  applySheet(curPage());          // 図枠を現在ページに戻す
  UI.setMsg(`印刷ダイアログで「PDFに保存」を選ぶと全ページPDFになります (用紙: ${[...new Set(papers)].join(" / ")}横)`);
};

/** 全ページを DXF (AutoCAD互換) でダウンロード */

/* ══════════════ 線番の編集 ══════════════ */
/** ページ内の線番を一覧で編集する (重複は警告し、空欄は自動採番に戻す) */
UI.editWireNumbers = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中は編集できません"); return; }
  const page = curPage();
  const { wireNet } = computeNets(page, "open");
  // ネット単位でまとめる (同じネットの配線は同じ線番)
  const nets = new Map();
  condWires(page).forEach(w => {
    const net = wireNet.get(w.id);
    if (!net) return;
    if (!nets.has(net)) nets.set(net, { num: w.num || "", wires: [], fixed: !!w.fixed, spec: w.spec || "", specs: new Set(), x: w.pts[0][0], y: w.pts[0][1] });
    const e = nets.get(net);
    e.wires.push(w);
    if (w.num) e.num = w.num;
    if (w.fixed) e.fixed = true;
    if (w.spec) e.spec = w.spec;
    e.specs.add(w.spec || "");
    if (w.pts[0][1] < e.y || (w.pts[0][1] === e.y && w.pts[0][0] < e.x)) { e.x = w.pts[0][0]; e.y = w.pts[0][1]; }
  });
  const rows = [...nets.entries()];
  if (!rows.length) { UI.setMsg("このページに配線がありません"); return; }
  // 他ページで使われている線番 (重複を入力段階で気づけるように)
  const otherNums = new Set();
  App.project.pages.forEach(pg => {
    if (pg === page) return;
    condWires(pg).forEach(w => { if (w.num) otherNums.add(String(w.num)); });
  });
  const otherPagesNote = otherNums.size ? ` / 他ページで使用中の線番 ${otherNums.size} 件` : "";
  // 電位名・電位リンク名 (これらは複数ネットで同名になって正しいので重複警告から外す)
  const potentials = new Set();
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    const sym = symOf(d.sym);
    if (sym.sim === "psu") { potentials.add("+24V"); potentials.add("0V"); }
    if (sym.sim === "link" && d.tag) potentials.add(d.tag.replace(/^-/, ""));
    devPins(d).forEach(pn => { if (pn.name && RE_EARTH.test(pn.name)) potentials.add(pn.name.toUpperCase()); });
  }));
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      ページ ${page.no}「${escAttr(page.name)}」の線番 ${rows.length} 本${otherPagesNote}。<br>
      「手動」に✓の付いた線番だけが自動採番から保護されます。<br>
      線番を書き換えると自動で✓が付き、空欄にすると自動採番に戻ります。<br>
      電線仕様は書き換えた行だけをネット全体に適用します (無変更の行はワイヤ個別の仕様を残します)。
    </div>
    <div class="wnum-head"><span>線番</span><span>手動</span><span>位置</span><span>電線仕様</span><span>接続先</span></div>
    <div id="wnRows" style="max-height:52vh;overflow:auto"></div>
  </div>`);
  const netLabel = (e) => {
    const pins = [];
    page.devices.forEach(d => devPins(d).forEach(p => {
      if (e.wires.some(w => w.pts.some(pt => Math.abs(pt[0] - p.x) < .01 && Math.abs(pt[1] - p.y) < .01))) {
        const nm = `${displayTag(d) || symOf(d.sym).name}:${effectivePinName(d, p.idx) || p.idx + 1}`;
        if (!pins.includes(nm)) pins.push(nm);
      }
    }));
    return pins.slice(0, 3).join(" ⇔ ") + (pins.length > 3 ? ` ほか${pins.length - 3}` : "");
  };
  rows.forEach(([, e]) => { e.num0 = e.num; e.spec0 = e.spec; });   // 表示時の値を控えておく
  body.querySelector("#wnRows").innerHTML = rows.map(([net, e], i) => `
    <div class="wnum-row">
      <input id="wn${i}" class="mono" value="${escAttr(e.num)}" placeholder="自動"/>
      <label class="chk wnum-fix"><input type="checkbox" id="wf${i}" ${e.fixed ? "checked" : ""}/><span></span></label>
      <span class="wnum-loc mono">${page.no}.${sheetCol(e.x)}${sheetRow(e.y)}</span>
      <input id="ws${i}" class="mono" value="${escAttr(e.spec)}" placeholder="${e.specs.size > 1 ? "(ワイヤごとに異なる)" : "例: KIV(BL)-1.25sq"}"/>
      <span class="wnum-conn">${escAttr(netLabel(e)) || "—"}</span>
    </div>`).join("");
  // 線番を書き換えたら自動的に「手動」扱いにする (無変更の行は自動のまま)。
  // 他ページで使用中の線番を入力したらその場で知らせる
  rows.forEach(([, e], i) => {
    const inp = body.querySelector(`#wn${i}`);
    inp.addEventListener("input", ev => {
      const v = ev.target.value.trim();
      body.querySelector(`#wf${i}`).checked = !!v && (v !== e.num0 || e.fixed);
      inp.classList.toggle("dupe", !!v && otherNums.has(v) && v !== e.num0);
      inp.title = inp.classList.contains("dupe") ? `線番 ${v} は他のページでも使われています` : "";
    });
  });
  const foot = h(`<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%">
    <button class="btn-solid" id="wnAuto">すべて自動採番に戻す</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="wnCancel">キャンセル</button>
    <button class="btn-solid primary" id="wnOk">適用</button>
  </div>`);
  const m = UI.openModal({ title: "線番の編集", sub: "ページ内の線番と電線仕様をまとめて編集します", body, foot, wide: true });
  foot.querySelector("#wnCancel").addEventListener("click", m.close);
  foot.querySelector("#wnAuto").addEventListener("click", () => {
    if (!confirm("このページの線番をすべて自動採番に戻しますか？")) return;
    commit();
    rows.forEach(([, e]) => e.wires.forEach(w => { w.num = null; w.fixed = false; w.numShow = false; }));
    autoNumberWires();
    m.close(); UI.refresh(false);
    UI.setMsg("線番を自動採番に戻しました");
  });
  foot.querySelector("#wnOk").addEventListener("click", () => {
    const vals = rows.map((_, i) => body.querySelector(`#wn${i}`).value.trim());
    const fixes = rows.map(([, e], i) => body.querySelector(`#wf${i}`).checked && !!vals[i]);
    // 手動で保護する線番の重複を先に警告する (自動側は採番時に衝突回避される)。
    // 電位名・電位リンク名は複数ネットで同名になって正しいので対象外。
    const fixedVals = vals.filter((v, i) => v && fixes[i] && !potentials.has(v));
    const dupSelf = fixedVals.filter((v, i) => fixedVals.indexOf(v) !== i);
    const dupOther = fixedVals.filter(v => otherNums.has(v));
    const dup = [...new Set([...dupSelf, ...dupOther])];
    if (dup.length && !confirm(
      `線番 ${dup.join(", ")} が他のネット (${dupOther.length ? "他ページを含む" : "このページ内"}) と重複しています。\n` +
      `検図 (DRC) にエラーとして表示されます。このまま適用しますか？`)) return;
    commit();
    rows.forEach(([, e], i) => {
      const v = vals[i], fixed = fixes[i];
      const spec = body.querySelector(`#ws${i}`).value.trim();
      const specChanged = spec !== (e.spec0 || "");
      e.wires.forEach(w => {
        // 自動の行は元の自動番号を残しておく (autoNumberWires が据え置く)
        w.num = fixed ? v : (e.num0 || null);
        w.fixed = fixed;                   // 手動線番だけを自動採番から保護
        w.numShow = false;                 // 表示位置は autoNumberWires が最長区間で決める
        // 電線仕様は書き換えた行だけネット全体へ。無変更ならワイヤ個別の仕様を保つ
        if (specChanged) { if (spec) w.spec = spec; else delete w.spec; }
      });
    });
    autoNumberWires();   // 自動の行を採番し、ネットごとの表示位置を決める
    m.close(); UI.refresh(false);
    const nf = fixes.filter(Boolean).length;
    UI.setMsg(`線番を更新しました (手動 ${nf} 本 / 自動 ${rows.length - nf} 本)`);
  });
};

/* ══════════════ DXF 取り込み ══════════════ */
/** DXF を読み込み、図面に作図するか、シンボルとして登録する */
UI.importDXF = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中は取り込みできません"); return; }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".dxf,.DXF";
  inp.addEventListener("change", () => {
    const file = inp.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      let ents;
      try { ents = parseDXF(rd.result); } catch (e) { alert("DXF の解析に失敗しました: " + e.message); return; }
      if (!ents.length) { alert("作図要素が見つかりませんでした。\n対応: LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / TEXT / MTEXT / SOLID / INSERT (ブロック展開)\nブロックの定義が別ファイルにある場合は、元のCADで EXPLODE してから出力してください。"); return; }
      UI.dxfImportDialog(ents, file.name);
    };
    rd.readAsText(file, "utf-8");
  });
  inp.click();
};

/** 取り込みプレビューと配置方法の選択 */
UI.dxfImportDialog = (ents, fileName) => {
  const b = dxfEntsBounds(ents);
  const counts = {};
  ents.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const unresolved = ents.filter(e => e.unresolved).length;
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      <b>${escAttr(fileName)}</b> から ${ents.length} 要素を読み込みました<br>
      ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" ・ ")}<br>
      原寸 ${b ? `${b.w.toFixed(1)} × ${b.h.toFixed(1)} mm` : "—"}
      ${unresolved ? `<br><b style="color:var(--warn,#e5a03d)">⚠ 定義が見つからないブロックが ${unresolved} 個あります。元のCADで EXPLODE (分解) してから出力してください。</b>` : ""}
    </div>
    <div class="prop-row"><label>拡大縮小</label>
      <select id="dxScale">
        <option value="1">原寸 (1:1)</option>
        <option value="fit20">高さ 20mm に合わせる (シンボル向き)</option>
        <option value="0.5">1/2</option><option value="2">2倍</option>
      </select></div>
    <div class="prop-row"><label>線種 (作図線として配置する場合)</label>
      <select id="dxStyle">
        <option value="solid">実線 (配線として扱う)</option>
        <option value="dash" selected>破線 (作図線・非導通)</option>
        <option value="dashdot">一点鎖線 (作図線・非導通)</option>
      </select></div>
    <div class="prop-row"><label>取り込み方法</label>
      <select id="dxMode">
        <option value="draw">このページに作図線として配置する</option>
      </select></div>
    <div class="prop-note">
      シンボルとして登録する場合は「編集 &gt; シンボルを作成…」を開き、その中の
      「DXF を読み込む…」を使ってください (図形を編集して端子を置けます)。
    </div>
    <div id="dxSymOpts" style="display:none">
      <div class="prop-grid2">
        <div class="prop-row"><label>シンボル名</label><input id="dxName" value="${escAttr(fileName.replace(/\.dxf$/i, ""))}"/></div>
        <div class="prop-row"><label>デバイス文字 (letter)</label><input id="dxLetter" class="mono" value="E" maxlength="2"/></div>
        <div class="prop-row"><label>型式 (部品表用)</label><input id="dxType" class="mono" value="" placeholder="任意"/></div>
      </div>
      <div class="prop-row"><label>端子 (ピン)</label><select id="dxPins">
        <option value="2v">上下2端子 (縦方向・既定)</option>
        <option value="2h">左右2端子 (横方向)</option>
        <option value="0">端子なし (作図用)</option>
      </select></div>
    </div>
    <div class="prop-sect">プレビュー</div>
    <div id="dxPrev" style="background:#f7f8f5;border-radius:8px;padding:10px;text-align:center;min-height:120px"></div>
  </div>`);
  const q = id => body.querySelector(id);
  const scaleOf = () => {
    const v = q("#dxScale").value;
    if (v === "fit20") return b && b.h > 0 ? 20 / b.h : 1;
    return parseFloat(v) || 1;
  };
  const preview = () => {
    const r = dxfEntsToSVG(ents, { scale: scaleOf() });
    const pad = 4;
    q("#dxPrev").innerHTML = r.w > 0
      ? `<svg viewBox="${-pad} ${-pad} ${r.w + pad * 2} ${r.h + pad * 2}" style="max-width:100%;max-height:220px;color:#1b2334">
           <g fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round">${r.body}</g></svg>`
      : "（表示できる要素がありません）";
  };
  q("#dxScale").addEventListener("change", preview);
  q("#dxMode").addEventListener("change", () => {
    q("#dxSymOpts").style.display = q("#dxMode").value === "symbol" ? "" : "none";
  });
  preview();

  const foot = h(`<div style="display:flex;gap:10px;justify-content:flex-end">
    <button class="btn-solid" id="dxCancel">キャンセル</button>
    <button class="btn-solid primary" id="dxOk">取り込む</button>
  </div>`);
  const m = UI.openModal({ title: "DXF を取り込む", sub: "AutoCAD 図面を作図線として配置、またはシンボルに登録します", body, foot });
  foot.querySelector("#dxCancel").addEventListener("click", m.close);
  foot.querySelector("#dxOk").addEventListener("click", () => {
    const k = scaleOf();
    const mode = q("#dxMode").value;
    commit();
    if (mode === "symbol") {
      const name = q("#dxName").value.trim() || "取り込みシンボル";
      const letter = (q("#dxLetter").value.trim() || "E").toUpperCase();
      const r = dxfEntsToSVG(ents, { scale: k });
      const pinMode = q("#dxPins").value;
      // 端子はグリッド (5mm) に乗せ、配線が必ず接続できるようにする
      const gx = snap(r.w / 2), gy = snap(r.h / 2), gw = snap(r.w), gh = snap(r.h);
      const pins = pinMode === "2v" ? [{ x: gx, y: 0, n: "1" }, { x: gx, y: Math.max(GRID, gh), n: "2" }]
        : pinMode === "2h" ? [{ x: 0, y: gy, n: "1" }, { x: Math.max(GRID, gw), y: gy, n: "2" }] : [];
      const sym = {
        id: "imp_" + uid("s"), db: true, group: "取り込み", cat: "db", letter,
        name, nameEn: name, desc: `DXF 取り込み (${fileName})`, typ: (q("#dxType") ? q("#dxType").value.trim() : ""),
        pins, sim: pins.length === 2 ? "passthru" : "none",
        bounds: [-2, -2, r.w + 4, r.h + 4], body: r.body, imported: true,
        lw: LINE_W.thin,      // 取り込み図形は細線 0.25mm (DXF 側の線幅設定に依存させない)
      };
      DB_SYMBOLS.push(sym);
      SYMBOLS_BY_ID[sym.id] = sym;
      saveImportedSymbols();
      syncProjectSymbols();
      dbSetPinned([...new Set([...dbPinnedList(), sym.id])]);
      UI.buildPalette();
      m.close();
      UI.setMsg(`シンボル「${name}」を登録しました (左のライブラリ「データベース」に追加)`);
      return;
    }
    // 作図線として配置: 画面中央に置く
    const rect = Editor.svg.getBoundingClientRect();
    const c = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const r = dxfEntsToSVG(ents, { scale: k });
    const page = curPage();
    const ox = snap(c.x - r.w / 2), oy = snap(c.y - r.h / 2);
    let nWire = 0, nText = 0;
    const bb = dxfEntsBounds(ents);
    const X = x => ox + (x - bb.x0) * k, Y = y => oy + (bb.y1 - y) * k;
    const style = q("#dxStyle").value;                 // 取り込む線の線種
    const addAux = pts => {
      // 取り込み図形はグリッドに丸めない (円弧・斜線の形が崩れるため)
      const w = addWire(page, pts, style === "solid" ? { raw: true } : { style, raw: true });
      if (w) { if (style !== "solid") w.aux = true; nWire++; }
    };
    ents.forEach(e => {
      if (e.type === "INSERT") return;                 // 定義が無いブロックは配置しない
      if (e.type === "LINE" || e.type === "SOLID") {
        if (isFinite(e.x1) && isFinite(e.x2)) addAux([[X(e.x1), Y(e.y1)], [X(e.x2), Y(e.y2)]]);
      } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const pts = (e.pts || []).filter(p => isFinite(p[0]) && isFinite(p[1])).map(p => [X(p[0]), Y(p[1])]);
        if (pts.length >= 2) { if (e.flags & 1) pts.push(pts[0]); addAux(pts); }
      } else if (e.type === "CIRCLE" || e.type === "ARC") {
        // 円・円弧は折線で近似して作図線にする (穴・R が消えないように)
        const a0 = e.type === "CIRCLE" ? 0 : (e.a1 || 0);
        const a1v = e.type === "CIRCLE" ? 360 : ((e.a2 - e.a1 + 360) % 360 || 360) + (e.a1 || 0);
        const n = Math.max(8, Math.ceil(Math.abs(a1v - a0) / 15));
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = (a0 + (a1v - a0) * i / n) * Math.PI / 180;
          pts.push([X(e.x1 + e.r * Math.cos(t)), Y(e.y1 + e.r * Math.sin(t))]);
        }
        addAux(pts);
      } else if (e.type === "TEXT" || e.type === "MTEXT") {
        page.texts.push({ id: uid("t"), x: X(e.x1), y: Y(e.y1), text: e.text || "", size: Math.max(2.5, (e.size || 3.5) * k), anchor: "start" });
        nText++;
      }
    });
    m.close();
    UI.refresh();
    UI.setMsg(`DXF を作図しました (線 ${nWire} 本・文字 ${nText} 点)。円弧を含む図形はシンボル登録をご利用ください`);
  });
};

/* 取り込みシンボルの保存 (localStorage) */
function saveImportedSymbols() {
  try {
    const imported = DB_SYMBOLS.filter(s => s.imported);
    localStorage.setItem("electracad.importedSyms", JSON.stringify(imported));
  } catch (e) { /* 容量超過は無視 */ }
}
function loadImportedSymbols() {
  try {
    const raw = localStorage.getItem("electracad.importedSyms");
    if (!raw) return;
    JSON.parse(raw).forEach(sym => {
      if (SYMBOLS_BY_ID[sym.id]) return;
      DB_SYMBOLS.push(sym);
      SYMBOLS_BY_ID[sym.id] = sym;
    });
  } catch (e) { /* 破損時は読み飛ばす */ }
}

UI.exportDXF = () => {
  const base = App.project.name.replace(/[\\/:*?"<>|]/g, "_");
  App.project.pages.forEach((pg, i) => {
    // 連続ダウンロードのブロックを避けるため少しずつ間隔を空ける
    setTimeout(() => {
      downloadFile(`${base}_p${pg.no}_${pg.name}.dxf`, pageToDXF(pg), "application/dxf");
      applySheet(curPage());      // 図枠を現在ページに戻す
    }, i * 400);
  });
  UI.setMsg(`DXFを ${App.project.pages.length} ファイル出力します (AutoCADでそのまま開けます)`);
};

/* ══════════════ テキスト入力 (キャンバス上) ══════════════ */
UI.openTextInput = (clientX, clientY, wx, wy, existing = null) => {
  const root = document.getElementById("overlay-root");
  const inp = h(`<input style="position:fixed;left:${clientX}px;top:${clientY - 14}px;z-index:300;
    background:var(--panel-2);border:1px solid var(--accent);border-radius:6px;color:var(--text);
    font-size:13px;padding:5px 9px;outline:none;min-width:140px" placeholder="テキストを入力… (Enterで確定)"/>`);
  if (existing) inp.value = existing.text;
  root.appendChild(inp);
  // mousedown 由来のフォーカス競合を避けるため次フレームでフォーカス
  requestAnimationFrame(() => { inp.focus(); inp.select(); });
  let closed = false; // Enter→remove→blur の再入で二重確定・例外になるのを防ぐ
  const done = (save) => {
    if (closed) return;
    closed = true;
    const v = inp.value.trim();
    inp.remove();
    if (save && v && (!existing || v !== existing.text)) {
      commit();
      if (existing) existing.text = v;
      else curPage().texts.push({ id: uid("t"), x: wx, y: wy, text: v, size: TEXT_H.normal });
      UI.refresh(false);
    }
    UI.setTool("select");
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") done(true);
    if (e.key === "Escape") done(false);
    e.stopPropagation();
  });
  inp.addEventListener("blur", () => done(true));
};

/* ══════════════ モーダル ══════════════ */
UI.openModal = ({ title, sub = "", body, foot = "", onclose = null, wide = false, noEsc = false }) => {
  const root = document.getElementById("overlay-root");
  const bk = h(`<div class="modal-backdrop">
    <div class="modal" style="${wide ? "width:min(1020px,96vw)" : ""}">
      <div class="modal-head">
        <div><div class="m-title">${title}</div>${sub ? `<div class="m-sub">${sub}</div>` : ""}</div>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot" style="${foot ? "" : "display:none"}"></div>
    </div>
  </div>`);
  bk.querySelector(".modal-body").append(body);
  if (foot) bk.querySelector(".modal-foot").append(foot);
  const onEsc = (e) => {
    if (e.key !== "Escape") return;
    // 入力欄の変換中や、内側で Esc を使うダイアログを邪魔しない
    if (e.defaultPrevented || e.isComposing) return;
    // 重ねて開いているときは一番手前のものだけ閉じる
    if (root.lastElementChild !== bk) return;
    if (noEsc) return;                      // 画面内で Esc を使うダイアログ
    e.stopPropagation();
    close();
  };
  const close = () => {
    bk.remove();
    document.removeEventListener("keydown", onEsc, true);
    if (onclose) onclose();
  };
  bk.querySelector(".modal-close").addEventListener("click", close);
  bk.addEventListener("mousedown", e => { if (e.target === bk) close(); });
  document.addEventListener("keydown", onEsc, true);
  root.appendChild(bk);
  return { close, el: bk };
};

/** 配線の線番インライン編集 (ダブルクリックから) */
UI.openWireNumInput = (clientX, clientY, wire) => {
  if (App.sim.running) return;
  const root = document.getElementById("overlay-root");
  const inp = h(`<input style="position:fixed;left:${clientX}px;top:${clientY - 14}px;z-index:300;
    background:var(--panel-2);border:1px solid var(--accent);border-radius:6px;color:var(--text);
    font-size:13px;padding:5px 9px;outline:none;width:110px;font-family:var(--mono)" placeholder="線番"/>`);
  inp.value = wire.num || "";
  root.appendChild(inp);
  requestAnimationFrame(() => { inp.focus(); inp.select(); });
  let closed = false;
  const done = (save) => {
    if (closed) return;
    closed = true;
    const v = inp.value.trim();
    inp.remove();
    if (save && v !== (wire.num || "")) {
      commit();
      const n = setWireNumber(curPage(), wire, v);   // ネット全体に反映 (1ネット1線番)
      UI.refresh(false);
      UI.setMsg(v ? `線番を ${v} に変更しました (同じネットの配線 ${n} 本に反映・自動採番から保護)`
                  : "線番を自動採番に戻しました");
    }
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") done(true);
    if (e.key === "Escape") done(false);
    e.stopPropagation();
  });
  inp.addEventListener("blur", () => done(true));
};

/** 破線枠 (盤外エリア / 機器グループ) を挿入 */
UI.insertZone = () => {
  if (App.sim.running) return;
  commit();
  // 画面の中央に置く (固定位置だと既存回路の真上に落ちるため)
  const r = Editor.svg.getBoundingClientRect();
  const c = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  const fr = frameRect();
  const w = 90, h = 70;
  const x = Math.min(Math.max(snap(c.x - w / 2), fr.x + 5), fr.x + fr.w - w - 5);
  const y = Math.min(Math.max(snap(c.y - h / 2), fr.y + 5), fr.y + fr.h - h - 5);
  const z = { id: uid("z"), x, y, w, h, label: "盤外" };
  pageZones(curPage()).push(z);
  App.selection.clear();
  App.selection.add(z.id);
  UI.showProps();
  requestRender();
  UI.setMsg("破線枠を挿入しました — 枠線をドラッグで移動、プロパティでラベル/サイズ変更 (例: 盤外、ターミナルリレーのグループ)");
};

/* ══════════════ シンボルデータベース ══════════════ */
UI.openSymDB = () => {
  let pinned = new Set(dbPinnedList());
  let query = "", group = "";
  const groups = [...new Set(DB_SYMBOLS.map(s => s.group))];
  const body = h(`<div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <div class="side-search" style="margin:0;flex:1;min-width:200px">
        <svg viewBox="0 0 16 16" width="13" height="13"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input id="dbSearch" placeholder="名称・図記号番号で検索…"/>
      </div>
      <div id="dbGroups" style="display:flex;gap:4px;flex-wrap:wrap"></div>
    </div>
    <div id="dbGrid" class="wiz-cards" style="grid-template-columns:repeat(auto-fill,minmax(168px,1fr))"></div>
  </div>`);

  function renderGroups() {
    const gb = body.querySelector("#dbGroups");
    gb.innerHTML = [""].concat(groups).map(g =>
      `<button class="btn-solid" data-g="${g}" style="flex:0 0 auto;padding:5px 11px;font-size:11.5px;${g === group ? "background:var(--accent-dim);border-color:var(--accent);color:var(--accent-2)" : ""}">${g || "すべて"}</button>`).join("");
    gb.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { group = b.dataset.g; renderGroups(); renderGrid(); }));
  }
  function renderGrid() {
    const grid = body.querySelector("#dbGrid");
    const q = query.toLowerCase();
    const list = DB_SYMBOLS.filter(s =>
      (!group || s.group === group) &&
      (!q || s.name.toLowerCase().includes(q) || (s.jis || "").includes(q) || s.nameEn.toLowerCase().includes(q)));
    grid.innerHTML = list.map(s => `
      <div class="wiz-card ${pinned.has(s.id) ? "sel" : ""}" data-id="${s.id}" style="cursor:default">
        <div class="wc-thumb">${symThumbSVG(s, 46)}</div>
        <div class="wc-name">${s.name}</div>
        <div class="wc-desc">${[s.jis ? `JIS C 0617 ${s.jis}` : "", s.stdNote || "",
          (!s.jis && s.nonstd) ? "規格外 (JIS C 0617 に該当図記号なし)" : ""].filter(Boolean).join(" — ") || s.group}</div>
        <button class="btn-solid ${pinned.has(s.id) ? "" : "primary"}" data-pin="${s.id}"
          style="flex:0 0 auto;padding:4px 10px;font-size:11px;margin-top:4px">
          ${pinned.has(s.id) ? "✓ パレットから外す" : "パレットに追加"}</button>
      </div>`).join("");
    grid.querySelectorAll("[data-pin]").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.pin;
      if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
      dbSetPinned([...pinned]);
      UI.buildPalette(document.getElementById("symSearch").value);
      renderGrid();
    }));
  }
  body.querySelector("#dbSearch").addEventListener("input", e => { query = e.target.value; renderGrid(); });
  renderGroups();
  renderGrid();
  UI.openModal({
    title: "シンボルデータベース",
    sub: `JIS C 0617 / IEC 60617 の規格図記号 ${DB_SYMBOLS.length} 種 — 「パレットに追加」で左のライブラリにいつでも引き出せます`,
    body, wide: true,
  });
};

/** ホイール1ノッチあたりのズーム倍率をスライダで調節 */
UI.zoomSpeedDialog = () => {
  const cur = Math.round(Editor.zoomStep * 100);
  const body = h(`<div style="line-height:1.9">
    <div style="display:flex;align-items:center;gap:14px">
      <input id="zsRange" type="range" min="5" max="40" step="1" value="${cur}" style="flex:1"/>
      <span id="zsVal" style="font-family:var(--mono);font-size:15px;font-weight:700;min-width:52px;text-align:right">${cur}%</span>
    </div>
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:10px">
      ホイール1ノッチで拡大/縮小する割合です (段階式・保存されます)。<br>
      目安: 弱 8% ・ 標準 18% ・ 強 30%。Ctrl+ホイールは常にこの 1/3 の微調整になります。
    </div>
  </div>`);
  const range = body.querySelector("#zsRange");
  const val = body.querySelector("#zsVal");
  range.addEventListener("input", () => {
    val.textContent = range.value + "%";
    Editor.zoomStep = range.value / 100;
    localStorage.setItem("electracad.zoomStep", String(Editor.zoomStep));
  });
  UI.openModal({ title: "ズーム速度", sub: "マウスホイールの拡大縮小の強さ", body });
};

/* ══════════════ 図枠・表題欄の設定 ══════════════ */
/** 表題欄の各項目と用紙・尺度を編集する。用紙/尺度を変えると作図領域
    (図枠) が 用紙サイズ × 尺度 に張り替えられる。 */
UI.sheetSetup = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中は図枠を変更できません"); return; }
  const meta = projectMeta();
  const page = curPage();
  const cur = pageSheetMeta(page);        // このページに効いている用紙・尺度
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label || v}</option>`;
  const body = h(`<div>
    <div class="prop-sect">表題欄</div>
    <div class="prop-grid2">
      <div class="prop-row"><label>プロジェクト</label><input id="tbProj" value="${escAttr(App.project.name)}"/></div>
      <div class="prop-row"><label>ページ名</label><input id="tbPage" value="${escAttr(page.name)}"/></div>
      <div class="prop-row"><label>図番 (先頭ページ)</label><input id="tbDwg" class="mono" value="${escAttr(meta.dwgNo || "")}" placeholder="E-001"/></div>
      <div class="prop-row"><label>このページの図番</label><input id="tbDwgPage" class="mono" value="${page.dwgNoManual ? escAttr(page.dwgNo || "") : ""}" placeholder="${escAttr(pageDwgNo(page))} (自動)"/></div>
      <div class="prop-row"><label class="chk"><input type="checkbox" id="tbDwgFix" ${page.dwgNoManual ? "checked" : ""}/><span>このページの図番を固定する</span></label></div>
      <div class="prop-row"><label>改訂</label><input id="tbRev" class="mono" value="${escAttr(meta.rev || "0")}"/></div>
      <div class="prop-row"><label>設計</label><input id="tbDes" value="${escAttr(meta.designer || "")}" placeholder="—"/></div>
      <div class="prop-row"><label>検図</label><input id="tbChk" value="${escAttr(meta.checker || "")}" placeholder="—"/></div>
      <div class="prop-row"><label>日付</label><input id="tbDate" class="mono" value="${escAttr(meta.date || todayStr())}" placeholder="2026-01-31"/></div>
      <div class="prop-row"><label>企業 (団体) 名</label><input id="tbAuth" value="${escAttr(meta.author || "")}" placeholder="社名を入力"/></div>
      <div class="prop-row"><label>投影法</label><select id="tbProjMethod">
        ${["第三角法", "第一角法", "該当なし (回路図)"].map(v => opt(v, meta.proj || "第三角法")).join("")}
      </select></div>
    </div>
    <div class="prop-note">
      図番はページ順に自動採番されます (例 <span class="mono">TK-2026-010</span> → 010, 011, 012…)。<br>
      「このページの図番」に直接入力すると、そのページだけ自動採番から保護されます (空欄で自動に戻る)。
    </div>
    <div class="prop-row"><label class="chk"><input type="checkbox" id="tbDwgAuto" ${meta.dwgNoAuto === false ? "" : "checked"}/><span>図番をページ順に自動採番する</span></label></div>
    <div class="prop-sect">用紙・向きと尺度</div>
    <div class="prop-grid2">
      <div class="prop-row"><label>用紙</label><select id="tbPaper">
        ${Object.entries(PAPERS).map(([k, [pw, ph]]) => opt(k, cur.paper, `${k} (${pw}×${ph} mm)`)).join("")}
      </select></div>
      <div class="prop-row"><label>向き</label><select id="tbOrient">
        ${opt("landscape", cur.orient, "横置き (長辺が左右)")}${opt("portrait", cur.orient, "縦置き (長辺が上下)")}
      </select></div>
      <div class="prop-row"><label>尺度</label><select id="tbScale">
        ${SCALES.map(s => opt(s, cur.scale)).join("")}
      </select></div>
      <div class="prop-row"><label>適用範囲</label><select id="tbScope">
        <option value="page"${page.paper || page.scale || page.orient ? " selected" : ""}>このページのみ (${page.no}. ${escAttr(page.name)})</option>
        <option value="all"${page.paper || page.scale || page.orient ? "" : " selected"}>全ページ (既定)</option>
      </select></div>
    </div>
    <div class="prop-note" id="tbInfo"></div>
    <div class="prop-sect">改訂履歴 (表題欄の上に表示)</div>
    <div id="tbRevs"></div>
  </div>`);
  // 改訂履歴 (行数可変。既存の改訂は1件も切り捨てない)
  const revRows = (meta.revs || []).map(r => ({ ...r }));
  if (!revRows.length) revRows.push({ rev: "", date: "", desc: "", appr: "" });
  const revHost = body.querySelector("#tbRevs");
  const renderRevs = () => {
    revHost.innerHTML = revRows.map((r, i) => `
      <div class="rev-row">
        <input id="rv${i}a" class="mono" value="${escAttr(r.rev)}" placeholder="A" title="改訂記号"/>
        <input id="rv${i}b" class="mono" value="${escAttr(r.date)}" placeholder="2026-01-31" title="日付"/>
        <input id="rv${i}c" value="${escAttr(r.desc)}" placeholder="改訂内容" title="内容"/>
        <input id="rv${i}d" value="${escAttr(r.appr)}" placeholder="承認" title="承認"/>
      </div>`).join("") +
      `<button class="btn-solid" id="revAdd" style="margin-top:2px">＋ 行を追加</button>
       <div style="font-size:11px;color:var(--text-faint);margin-top:6px">図面には新しい方から最大 ${REV_TABLE.maxRows} 行を表示します (記録はすべて保持)。</div>`;
    revHost.querySelector("#revAdd").addEventListener("click", () => {
      collectRevs();
      revRows.push({ rev: "", date: "", desc: "", appr: "" });
      renderRevs();
    });
  };
  const collectRevs = () => {
    revRows.forEach((r, i) => {
      const g = k => (revHost.querySelector(`#rv${i}${k}`) || {}).value || "";
      r.rev = g("a").trim(); r.date = g("b").trim(); r.desc = g("c").trim(); r.appr = g("d").trim();
    });
  };
  renderRevs();

  const q = id => body.querySelector(id);
  const info = () => {
    const [pw, ph] = paperSize(q("#tbPaper").value, q("#tbOrient").value);
    const sc = q("#tbScale").value;
    const f = scaleFactor(sc);
    const over = countOverflow(q("#tbPaper").value, sc, q("#tbOrient").value);
    q("#tbInfo").innerHTML = `作図領域は <b>${Math.round(pw * f)} × ${Math.round(ph * f)} mm</b> になります` +
      (sc === "NS" ? " (非尺度)。" : f === 1 ? " (現尺)。"
        : `。用紙 ${pw}×${ph} mm に ${sc} で印刷される想定で、実物の${f > 1 ? `${f} 倍の範囲を1枚に収められます` : `${1 / f} 倍に拡大して描けます`}。`) +
      `<br>図記号・文字・線の太さは尺度によらず常に 1:1 です。尺度を上げると図枠 (作図領域) だけが広がり、1枚に多くの回路を収められます。` +
      (f !== 1 ? `<br>用紙に印刷すると図記号・文字は ${f > 1 ? `1/${f}` : `${1 / f} 倍`} の大きさになります (${f > 1 ? "文字が小さくなるため検図で警告します" : "拡大されます"})。` : "") +
      (over.total
        ? `<br><b style="color:var(--warn,#e5a03d)">⚠ この用紙では機器 ${over.devs} 点・配線 ${over.wires} 本が図枠外または表題欄に重なります。</b>`
        : `<br>現在の図形はすべて新しい図枠に収まります。`);
  };
  /** 指定の用紙・尺度に切り替えた場合のはみ出し数を試算する (SHEET は元に戻す) */
  function countOverflow(paper, scale, orient) {
    const save = { paper: meta.paper, scale: meta.scale, orient: meta.orient };
    const saveP = { p: page.paper, s: page.scale, o: page.orient };
    page.paper = paper; page.scale = scale; page.orient = orient; applySheet(page);
    const fr2 = frameRect(), blocks = titleBlocksRects();
    const hit = (b) => b.x < fr2.x || b.y < fr2.y || b.x + b.w > fr2.x + fr2.w || b.y + b.h > fr2.y + fr2.h ||
      blocks.some(r => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y);
    let devs = 0, wires = 0;
    App.project.pages.forEach(pg => {
      pg.devices.forEach(d => { if (hit(devBounds(d))) devs++; });
      pg.texts.forEach(t => { if (hit(textBounds(t))) devs++; });
      pageZones(pg).forEach(z => { if (hit({ x: z.x, y: z.y, w: z.w, h: z.h })) devs++; });
      pg.wires.forEach(w => {
        const outside = w.pts.some(p => p[0] < fr2.x || p[1] < fr2.y || p[0] > fr2.x + fr2.w || p[1] > fr2.y + fr2.h);
        const onBlk = w.pts.some((p, i) => i < w.pts.length - 1 && blocks.some(r => segCrossesRect(p, w.pts[i + 1], r)));
        if (outside || onBlk) wires++;
      });
    });
    page.paper = saveP.p; page.scale = saveP.s; page.orient = saveP.o;
    if (!saveP.p) delete page.paper;
    if (!saveP.s) delete page.scale;
    if (!saveP.o) delete page.orient;
    meta.paper = save.paper; meta.scale = save.scale; meta.orient = save.orient; applySheet(page);
    return { devs, wires, total: devs + wires };
  }
  q("#tbPaper").addEventListener("change", info);
  q("#tbOrient").addEventListener("change", info);
  q("#tbScale").addEventListener("change", info);
  info();

  const foot = h(`<div style="display:flex;gap:10px;justify-content:flex-end">
    <button class="btn-solid" id="tbCancel">キャンセル</button>
    <button class="btn-solid primary" id="tbOk">適用</button>
  </div>`);
  const m = UI.openModal({ title: "図枠・表題欄の設定", sub: "表題欄の記入項目と用紙サイズ・向き・尺度", body, foot });
  foot.querySelector("#tbCancel").addEventListener("click", m.close);
  foot.querySelector("#tbOk").addEventListener("click", () => {
    const orientName = v => v === "portrait" ? "縦置き" : "横置き";
    const paperChanging = cur.paper !== q("#tbPaper").value || cur.scale !== q("#tbScale").value
      || cur.orient !== q("#tbOrient").value;
    if (paperChanging) {
      const over = countOverflow(q("#tbPaper").value, q("#tbScale").value, q("#tbOrient").value);
      if (over.total && !confirm(
        `新しい図枠 ${q("#tbPaper").value} ${orientName(q("#tbOrient").value)} / ${q("#tbScale").value} では、機器 ${over.devs} 点・配線 ${over.wires} 本が` +
        `図枠外にはみ出すか表題欄に重なります。\n(検図 (DRC) にエラーとして表示されます)\n\n続けますか？`)) return;
    }
    commit();
    App.project.name = q("#tbProj").value.trim() || App.project.name;
    page.name = q("#tbPage").value.trim() || page.name;
    meta.dwgNo = q("#tbDwg").value.trim();
    meta.dwgNoAuto = q("#tbDwgAuto").checked;
    {   // ページ固有の図番。すでに固定していたページは、開いて適用しただけで
      //   解除されないように「固定する」チェックの状態を尊重する
      const pv = q("#tbDwgPage").value.trim();
      const keep = q("#tbDwgFix").checked;
      if (pv && (keep || pv !== pageDwgNo(page))) { page.dwgNo = pv; page.dwgNoManual = true; }
      else { delete page.dwgNoManual; }
    }
    meta.rev = q("#tbRev").value.trim() || "0";
    meta.designer = q("#tbDes").value.trim();
    meta.checker = q("#tbChk").value.trim();
    meta.date = q("#tbDate").value.trim();
    meta.author = q("#tbAuth").value.trim();
    meta.proj = q("#tbProjMethod").value;
    collectRevs();
    meta.revs = revRows.filter(r => r.rev || r.date || r.desc || r.appr);
    // 表題欄の改訂記号は履歴の最新行に合わせる (管理図面の整合)
    const lastRev = [...meta.revs].reverse().find(r => r.rev);
    if (lastRev && meta.rev !== lastRev.rev) meta.rev = lastRev.rev;

    const paperChanged = paperChanging;
    const scope = q("#tbScope").value;
    // 図枠の原点 (とじ代・輪郭線) が動くぶんだけ中身を平行移動し、
    // 尺度を変えた瞬間に図面が枠から出ないようにする
    const frBefore = { x: SHEET.marginLeft, y: SHEET.margin };
    if (paperChanging) {                          // 用紙・尺度を変えたときだけ反映する
      if (scope === "page") {
        page.paper = q("#tbPaper").value;
        page.scale = q("#tbScale").value;
        page.orient = q("#tbOrient").value;
      } else {
        const indiv = App.project.pages.filter(pg => pg.paper || pg.scale || pg.orient);
        if (indiv.length && !confirm(
          `${indiv.length} ページに個別の用紙・向き・尺度が設定されています。\n全ページを ${q("#tbPaper").value} ${orientName(q("#tbOrient").value)} / ${q("#tbScale").value} に統一しますか？`)) return;
        meta.paper = q("#tbPaper").value;
        meta.scale = q("#tbScale").value;
        meta.orient = q("#tbOrient").value;
        App.project.pages.forEach(pg => { delete pg.paper; delete pg.scale; delete pg.orient; });
      }
    }
    UI.renumberPages();          // 図番の接頭辞・自動採番設定を全ページへ即反映
    applySheet(page);
    if (paperChanging) {
      const dx = SHEET.marginLeft - frBefore.x, dy = SHEET.margin - frBefore.y;
      shiftProjectGeometry(dx, dy, scope === "page" ? [page] : null);
    }
    const nameInput = document.getElementById("projectName");
    if (nameInput) nameInput.value = App.project.name;
    m.close();
    UI.refresh();
    if (paperChanged) { zoomFit(); UI.setMsg(`用紙 ${paperLabel(pageSheetMeta(page))} / 尺度 ${pageSheetMeta(page).scale} — 作図領域 ${SHEET.w}×${SHEET.h} mm に変更しました`); }
    else UI.setMsg("表題欄を更新しました");
    // 図枠確定後に干渉を判定して知らせる
    const revHits = runDRC().filter(d => /改訂履歴欄/.test(d.msg)).length;
    if (revHits) UI.toast(`⚠ 改訂履歴欄が回路と ${revHits} 箇所で重なっています (検図に表示)`, 5000);
  });
};
function escAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

/* ══════════════ 保存 (上書き / 名前を付けて) ══════════════ */
const FS_API = typeof window !== "undefined" && !!window.showSaveFilePicker;
function projectJSON() { return JSON.stringify(App.project, null, 1); }
function defaultFileName() { return (App.project.name || "無題プロジェクト") + ".ecad.json"; }

/* 保存先ファイルハンドルの記憶 (IndexedDB)。次回起動時も同じファイルへ
   上書きできるようにする (再許可が必要な場合はボタンで再接続)。 */
function idbHandleStore(mode = "readonly") {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    const rq = indexedDB.open("electracad", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("handles");
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => res(rq.result.transaction("handles", mode).objectStore("handles"));
  });
}
async function rememberFileHandle(handle) {
  try {
    const st = await idbHandleStore("readwrite");
    st.put(handle, "project");
  } catch (e) { /* 非対応ブラウザでは記憶しないだけ */ }
}
async function restoreFileHandle() {
  try {
    const st = await idbHandleStore();
    const handle = await new Promise((res, rej) => {
      const rq = st.get("project");
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") { App.fileHandle = handle; UI.updateSaveButton(); return; }
    App.pendingHandle = handle;   // 権限の再取得はユーザー操作が要るので保存時に要求する
    UI.updateSaveButton();
  } catch (e) { /* 記憶が無い/壊れている場合は何もしない */ }
}

/** 右上の保存ボタン / Ctrl+S: 開いた (または名前を付けて保存した) ファイルへ上書き保存 */
UI.saveOver = async () => {
  saveLocal(); // ブラウザ保存は常に更新 (次回起動時の復元用)
  // 前回の保存先が残っていれば、ユーザー操作の流れで書き込み権限を再取得する
  if (!App.fileHandle && App.pendingHandle) {
    try {
      const perm = await App.pendingHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") { App.fileHandle = App.pendingHandle; App.pendingHandle = null; UI.updateSaveButton(); }
    } catch (e) { /* 拒否されたら通常の保存フローへ */ }
  }
  if (App.fileHandle) {
    try {
      const ws = await App.fileHandle.createWritable();
      await ws.write(projectJSON());
      await ws.close();
      App.dirty = false;
      UI.updateSaveButton();
      UI.setMsg(`上書き保存しました — ${App.fileHandle.name}`);
      return;
    } catch (e) {
      UI.updateSaveButton();
      UI.setMsg("上書き保存に失敗しました: " + (e && e.message ? e.message : e));
      return;
    }
  }
  if (FS_API) { await UI.saveAs(); return; }
  // File System Access API 非対応 (Firefox/Safari 等) はダウンロード保存にフォールバック
  downloadFile(defaultFileName(), projectJSON());
  UI.setMsg("ファイルを書き出しました (このブラウザは上書き保存に未対応です)");
};

/** 名前を付けて保存 — 以後この保存ボタンは同じファイルへ上書きする */
UI.saveAs = async () => {
  saveLocal();
  if (!FS_API) {
    downloadFile(defaultFileName(), projectJSON());
    UI.setMsg("ファイルを書き出しました (このブラウザは上書き保存に未対応です)");
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: defaultFileName(),
      types: [{ description: "ElectraCAD プロジェクト", accept: { "application/json": [".json"] } }],
    });
    const ws = await handle.createWritable();
    await ws.write(projectJSON());
    await ws.close();
    App.fileHandle = handle;
    App.pendingHandle = null;
    App.dirty = false;
    rememberFileHandle(handle);
    UI.updateSaveButton();
    UI.setMsg(`保存しました — ${handle.name} (以後は保存ボタンで上書き)`);
  } catch (e) {
    if (e && e.name === "AbortError") return;   // ユーザーがキャンセル
    UI.setMsg("保存できませんでした: " + (e && e.message ? e.message : e));
  }
};

/** 保存ボタンに上書き先ファイル名と未保存マークを出す */
UI.updateSaveButton = () => {
  const btn = document.getElementById("btnSave");
  if (!btn) return;
  const name = App.fileHandle ? App.fileHandle.name : (App.pendingHandle ? App.pendingHandle.name : null);
  btn.title = !name ? "上書き保存 (Ctrl+S) — 保存先ファイルを選びます"
    : App.fileHandle ? `上書き保存 (Ctrl+S) — ${name}${App.dirty ? " (未保存の変更あり)" : ""}`
    : `上書き保存 (Ctrl+S) — 前回の ${name} に再接続します`;
  const label = btn.querySelector(".save-label") || btn;
  const txt = (App.dirty ? "● " : "") + "保存" + (name ? ` — ${name.replace(/\.ecad\.json$|\.json$/, "")}` : "");
  if (label !== btn) label.textContent = txt;
  else if (btn.lastChild && btn.lastChild.nodeType === 3) btn.lastChild.textContent = " " + txt;
  btn.classList.toggle("dirty", !!App.dirty);
};

UI.showShortcuts = () => {
  const rows = [
    ["V / Esc", "選択ツール"], ["W", "配線ツール"], ["H / Space", "パン"], ["T", "テキスト"],
    ["R", "回転 (配置プレビュー中も可)"], ["Del", "削除"], ["F", "全体表示"], ["+ / −", "ズーム"],
    ["Ctrl+Z / Y", "元に戻す / やり直し"], ["Ctrl+C / V", "コピー / カーソル位置に貼り付け"],
    ["Ctrl+A", "すべて選択"], ["Ctrl+S", "上書き保存"], ["Ctrl+Shift+S", "名前を付けて保存"],
    ["F2", "AI自動作図"], ["F5", "シミュレーション"],
    ["矢印キー", "選択を5mm移動"], ["ホイール", "ズーム"], ["中ボタンドラッグ", "パン"],
    ["Enter / ダブルクリック", "配線を確定"], ["Backspace", "配線作図中: 1頂点戻る"],
    ["右→左ドラッグ", "交差選択 (触れたものを選択)"], ["左→右ドラッグ", "窓選択 (完全に囲んだものを選択)"],
  ];
  const body = h(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 26px">
    ${rows.map(([k, d]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)">
      <span style="color:var(--text-dim)">${d}</span><kbd style="font-family:var(--mono);font-size:11px;background:var(--panel-3);border:1px solid var(--line);border-radius:4px;padding:2px 7px">${k}</kbd></div>`).join("")}
  </div>`);
  UI.openModal({ title: "キーボードショートカット", body });
};

UI.showQuickstart = () => {
  const body = h(`<div style="line-height:1.9;font-size:13px">
    <p><b style="color:var(--accent)">① AI自動作図 (推奨)</b><br>
    右上の「AI自動作図」から <b>インプット機器 → ロジック機器 → アウトプット機器</b> を選ぶだけで、電気設計のセオリーに則った回路が自動生成されます。</p>
    <p><b style="color:var(--accent)">② 手動作図</b><br>
    左のライブラリからシンボルをクリック → キャンバスに配置。<kbd>W</kbd> で配線モードにして赤いピン同士を接続します。</p>
    <p><b style="color:var(--accent)">③ シミュレーション</b><br>
    <kbd>F5</kbd> で通電シミュレーション。ボタンやスイッチをクリックすると、通電経路が緑色で表示され、リレーやランプが動作します。</p>
    <p><b style="color:var(--accent)">④ 検図・出力</b><br>
    DRCで設計ミスを自動検出。部品表CSV・SVG図面を出力できます。</p>
  </div>`);
  UI.openModal({ title: "クイックスタート", sub: "3分でわかる ElectraCAD Studio", body });
};

/* ══════════════ AI 自動作図ウィザード ══════════════ */
UI.openWizard = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中はAI自動作図を実行できません (Escで終了)"); return; }
  const state = {
    step: 0,
    inputs: new Map(), logics: new Map(), outputs: new Map(),
    opts: { selfHold: true, lampFb: false, autoNum: true, terminals: true },
  };
  const stepsDef = [
    { key: "inputs", title: "インプット機器", sub: "操作スイッチ・センサなど、回路の入力となる機器を選択", cat: "input" },
    { key: "logics", title: "ロジック機器", sub: "リレー・タイマ・PLCなど、制御の中枢となる機器を選択 (省略可)", cat: "logic" },
    { key: "outputs", title: "アウトプット機器", sub: "モータ・ランプ・バルブなど、動作させたい機器を選択", cat: "output" },
    { key: "confirm", title: "AI 生成", sub: "選択内容を確認して回路を自動生成" },
  ];
  // ウィザードに出すシンボル (ロジックはコイル系のみ)
  const wizSyms = {
    input: SYMBOLS.filter(s => s.cat === "input"),
    logic: SYMBOLS.filter(s => ["coil", "cont_coil", "timer_on", "timer_off", "safety_relay", "plc_di"].includes(s.id))
      .map(s => s.id === "plc_di" ? { ...s, name: "PLC制御", desc: "入出力をPLCに割付け" } : s),
    output: SYMBOLS.filter(s => s.cat === "output" && s.id !== "main_cont"),
  };

  const body = h(`<div style="min-height:430px"></div>`);
  const foot = h(`<div style="display:flex;gap:10px;width:100%;align-items:center">
    <button class="btn-solid" id="wzBack" style="flex:0 0 auto;padding:8px 18px">← 戻る</button>
    <span id="wzWarn" style="flex:1;font-size:12px;color:var(--warn)"></span>
    <button class="btn-solid" id="wzSkip" style="flex:0 0 auto;padding:8px 18px;background:none;border-color:transparent;color:var(--text-dim)">スキップ</button>
    <button class="btn-solid primary" id="wzNext" style="flex:0 0 auto;min-width:150px">次へ →</button>
  </div>`);
  const modal = UI.openModal({
    title: `<svg width="17" height="17" viewBox="0 0 16 16" style="vertical-align:-2px;margin-right:6px"><path d="M8 1l1.8 4.2L14 7l-4.2 1.8L8 13 6.2 8.8 2 7l4.2-1.8L8 1zm5 9l.9 2.1L16 13l-2.1.9L13 16l-.9-2.1L10 13l2.1-.9L13 10z" fill="#4da3ff"/></svg>AI 自動作図`,
    sub: "機器を選ぶだけで、電気設計のセオリーに基づいた回路図を自動生成します",
    body, foot, wide: true,
  });

  function stepsHTML() {
    return `<div class="wiz-steps">${stepsDef.map((s, i) => `
      <div class="wiz-step ${i === state.step ? "active" : ""} ${i < state.step ? "done" : ""}">
        <div class="ws-dot">${i < state.step ? "✓" : i + 1}</div>
        <div class="ws-label">${s.title}</div>
      </div>`).join("")}</div>`;
  }

  function cardsHTML(catKey, selMap) {
    return `<div class="wiz-cards">${wizSyms[catKey].map(sym => {
      const qty = selMap.get(sym.id) || 0;
      return `<div class="wiz-card ${qty ? "sel" : ""}" data-id="${sym.id}">
        <span class="wc-qty">${qty}</span>
        <div class="wc-thumb">${symThumbSVG(sym, 52)}</div>
        <div class="wc-name">${sym.name}</div>
        <div class="wc-desc">${sym.desc}</div>
        <div class="wiz-qtyrow"><button data-q="-1">−</button><button data-q="1">＋</button></div>
      </div>`;
    }).join("")}</div>`;
  }

  function render() {
    const def = stepsDef[state.step];
    let inner = stepsHTML();
    inner += `<div style="margin-bottom:12px"><div style="font-size:14px;font-weight:700">${def.title}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${def.sub}</div></div>`;
    if (def.key === "confirm") {
      const sum = (map, label) => {
        const items = [...map.entries()].filter(([, q]) => q > 0);
        if (!items.length) return `<div class="wiz-sum-row"><span style="font-size:11.5px;color:var(--text-faint)">${label}: なし</span></div>`;
        return `<div class="wiz-sum-row">${items.map(([id, q]) =>
          `<span class="wiz-pill">${SYMBOLS_BY_ID[id] ? SYMBOLS_BY_ID[id].name : id} <b>×${q}</b></span>`).join("")}</div>`;
      };
      inner += `<div class="wiz-summary">
        <h4>選択内容</h4>
        ${sum(state.inputs, "インプット")}${sum(state.logics, "ロジック")}${sum(state.outputs, "アウトプット")}
      </div>
      <div class="wiz-ai-note">
        <svg viewBox="0 0 16 16"><path d="M8 1l1.8 4.2L14 7l-4.2 1.8L8 13 6.2 8.8 2 7l4.2-1.8L8 1z" fill="currentColor"/></svg>
        <div>AIが以下のセオリーを適用します: 非常停止・保護機器は<b>電源直下の安全チェーン</b>に直列配置 /
        起動入力は<b>並列</b>・停止入力は<b>直列</b> / 三相モータには<b>主回路ページ・遮断器・接触器を自動追加</b> /
        デバイスタグ・配線番号・クロスリファレンスを自動採番。</div>
      </div>
      <div class="wiz-opts">
        <div class="wiz-opt ${state.opts.selfHold ? "sel" : ""}" data-opt="selfHold"><span class="wo-check"></span><span class="wo-txt"><span class="t">自己保持回路</span><br><span class="d">押しボタン起動を保持 (3ワイヤ制御)</span></span></div>
        <div class="wiz-opt ${state.opts.terminals ? "sel" : ""}" data-opt="terminals"><span class="wo-check"></span><span class="wo-txt"><span class="t">端子台を自動挿入</span><br><span class="d">現場機器との境界に -X1:n を配置</span></span></div>
        <div class="wiz-opt ${state.opts.lampFb ? "sel" : ""}" data-opt="lampFb"><span class="wo-check"></span><span class="wo-txt"><span class="t">動作表示灯を追加</span><br><span class="d">各コイルの動作をランプ表示</span></span></div>
        <div class="wiz-opt ${state.opts.autoNum ? "sel" : ""}" data-opt="autoNum"><span class="wo-check"></span><span class="wo-txt"><span class="t">配線番号の自動付与</span><br><span class="d">ネット単位で線番を採番</span></span></div>
      </div>`;
    } else {
      inner += cardsHTML(def.cat, state[def.key]);
    }
    body.innerHTML = inner;

    // カードイベント
    body.querySelectorAll(".wiz-card").forEach(card => {
      const id = card.dataset.id;
      const map = state[stepsDef[state.step].key];
      card.addEventListener("click", e => {
        const qbtn = e.target.closest("[data-q]");
        if (qbtn) {
          const nq = Math.max(0, Math.min(9, (map.get(id) || 0) + parseInt(qbtn.dataset.q)));
          if (nq === 0) map.delete(id); else map.set(id, nq);
        } else {
          if (map.has(id)) map.delete(id); else map.set(id, 1);
        }
        render();
      });
    });
    body.querySelectorAll(".wiz-opt").forEach(opt => {
      opt.addEventListener("click", () => {
        state.opts[opt.dataset.opt] = !state.opts[opt.dataset.opt];
        render();
      });
    });
    // フッター
    foot.querySelector("#wzBack").style.visibility = state.step === 0 ? "hidden" : "visible";
    foot.querySelector("#wzSkip").style.display = stepsDef[state.step].key === "logics" ? "" : "none";
    foot.querySelector("#wzNext").textContent = state.step === stepsDef.length - 1 ? "⚡ 回路を生成" : "次へ →";
  }

  const warn = msg => { const el = foot.querySelector("#wzWarn"); el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3500); };
  foot.querySelector("#wzBack").addEventListener("click", () => { if (state.step > 0) { state.step--; render(); } });
  foot.querySelector("#wzSkip").addEventListener("click", () => { state.step++; render(); });
  foot.querySelector("#wzNext").addEventListener("click", () => {
    if (state.step < stepsDef.length - 1) {
      // 入力チェック (モーダル内に表示 — 背面トーストは見えない)
      if (stepsDef[state.step].key === "inputs" && ![...state.inputs.values()].some(v => v > 0)) {
        warn("⚠ インプット機器を1つ以上選択してください");
        return;
      }
      if (stepsDef[state.step].key === "outputs" && ![...state.outputs.values()].some(v => v > 0)) {
        warn("⚠ アウトプット機器を1つ以上選択してください");
        return;
      }
      state.step++;
      render();
    } else {
      // 生成実行
      body.innerHTML = `${stepsHTML()}<div class="wiz-generating">
        <div class="gen-ring"></div>
        <div class="gen-msg">AI が回路を設計しています…</div>
        <div class="gen-sub" id="genSub">回路トポロジを解析中</div>
      </div>`;
      foot.style.visibility = "hidden";
      const msgs = ["回路トポロジを解析中", "安全チェーンを構成中", "ラング配置を最適化中", "デバイスタグを採番中", "配線番号を付与中", "クロスリファレンスを生成中"];
      let mi = 0;
      const msgT = setInterval(() => {
        const el = body.querySelector("#genSub");
        if (el && mi < msgs.length) el.textContent = msgs[mi++];
      }, 260);
      setTimeout(() => {
        clearInterval(msgT);
        commit();
        const sel = {
          inputs: [...state.inputs.entries()].map(([id, qty]) => ({ id, qty })),
          logics: [...state.logics.entries()].map(([id, qty]) => ({ id, qty })),
          outputs: [...state.outputs.entries()].map(([id, qty]) => ({ id, qty })),
          opts: state.opts,
        };
        let result;
        try {
          result = aiGenerate(sel);
        } catch (err) {
          console.error(err);
          modal.close();
          UI.toast("⚠ 生成中にエラーが発生しました: " + err.message, 5000);
          return;
        }
        App.pageIdx = result.pageIdxs[0];
        App.selection.clear();
        modal.close();
        UI.refresh();
        zoomFit();
        UI.toast(`✨ AI回路生成が完了しました — ${result.report[result.report.length - 1]}`, 4500);
        // レポートモーダル
        const rbody = h(`<div style="line-height:1.9;font-size:12.5px">
          <div style="font-weight:700;margin-bottom:8px;color:var(--ok)">✓ 生成完了</div>
          <ul style="padding-left:18px;color:var(--text-dim)">${result.report.map(r => `<li>${r}</li>`).join("")}</ul>
          <div style="margin-top:12px;padding:10px 13px;background:var(--panel-2);border-radius:8px;font-size:12px">
            💡 <b>F5</b> で通電シミュレーションを実行して動作を確認できます。DRC で検図も可能です。
          </div></div>`);
        UI.openModal({ title: "AI 設計レポート", body: rbody });
      }, 1700);
    }
  });

  render();
};

/* ══════════════ キーボード ══════════════ */
UI.setupKeys = () => {
  window.addEventListener("keydown", e => {
    const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; // CapsLock 対策
    // ブラウザ既定動作を奪うキーは入力中でも先に処理 (F5リロード・保存ダイアログ防止)
    if (e.key === "F5") { e.preventDefault(); if (!inInput) UI.toggleSim(); return; }
    if (ctrl && k === "s") { e.preventDefault(); if (e.shiftKey) UI.saveAs(); else UI.saveOver(); return; }
    if (ctrl && k === "p") { e.preventDefault(); if (!inInput) UI.print(); return; }
    if (inInput) return;
    if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); if (undo()) { UI.refresh(); UI.setMsg("元に戻しました"); } return; }
    if (ctrl && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); if (redo()) { UI.refresh(); UI.setMsg("やり直しました"); } return; }
    if (ctrl && k === "c") { copySelection(); return; }
    if (ctrl && k === "v") { pasteClipboard(); return; }
    if (ctrl && k === "a") { e.preventDefault(); UI.selectAll(); return; }
    switch (e.key) {
      case "Backspace":
        if (wireDraftBack()) return; // 配線作図中は1頂点戻る
        deleteSelection();
        return;
      case "Delete": deleteSelection(); return;
      case "Enter":
        if (Editor.wireDraft && Editor.wireDraft.pts.length >= 2) { finishWireDraft(); return; }
        break;
      case "Escape":
        if (document.querySelector(".dropdown")) { UI.closeDropdown(); return; } // メニューだけ閉じる (sim中でも)
        if (App.sim.running) { UI.toggleSim(); return; }
        if (Editor.wireDraft) { cancelDraft(); return; } // 1段階目: 作図キャンセル (ツール維持)
        if (Editor.ghost) { cancelDraft(); UI.setTool("select"); return; }
        App.selection.clear(); UI.showProps(); requestRender();
        UI.setTool("select");
        return;
      case "F2": e.preventDefault(); UI.openWizard(); return;
      case "ArrowLeft": if (App.selection.size) { e.preventDefault(); nudgeSelection(-GRID, 0); } return;
      case "ArrowRight": if (App.selection.size) { e.preventDefault(); nudgeSelection(GRID, 0); } return;
      case "ArrowUp": if (App.selection.size) { e.preventDefault(); nudgeSelection(0, -GRID); } return;
      case "ArrowDown": if (App.selection.size) { e.preventDefault(); nudgeSelection(0, GRID); } return;
      case " ":
        if (!Editor.spaceHeld) { Editor.spaceHeld = true; document.getElementById("canvas").style.cursor = "grab"; }
        e.preventDefault();
        return;
    }
    switch (k) {
      case "v": UI.setTool("select"); break;
      case "w": UI.setTool("wire"); break;
      case "h": UI.setTool("pan"); break;
      case "t": UI.setTool("text"); break;
      case "r": rotateSelection(); break;
      case "f": zoomFit(); break;
      case "+": case "=": UI.zoomCenter(1.25); break;
      case "-": UI.zoomCenter(0.8); break;
    }
  });
  window.addEventListener("keyup", e => {
    if (e.key === " ") { Editor.spaceHeld = false; document.getElementById("canvas").style.cursor = ""; }
  });
};

/* ══════════════ リフレッシュ / ブート ══════════════ */
UI.refresh = (rebuildTabs = true) => {
  App.labelRev++;          // ラベル配置キャッシュを無効化
  if (rebuildTabs !== false) UI.buildPageTabs();
  UI.showProps();
  requestRender();
};

function boot() {
  App.project = loadLocal() || demoProject();
  mergeProjectSymbols();
  UI.renumberPages();   // ページ番号と図番を現在の設定に同期
  applySheet(); // 保存された用紙・尺度で作図領域を張る
  noteSymbolMigration({ once: true }); // 自動保存からの復帰でも端子番号変更を1回だけ知らせる
  document.getElementById("projectName").value = App.project.name;
  const pn = document.getElementById("projectName");
  pn.addEventListener("change", e => {
    App.project.name = e.target.value.trim() || "無題プロジェクト";
    saveLocal();
    requestRender();
  });
  pn.addEventListener("keydown", e => { if (e.key === "Enter") pn.blur(); });

  loadImportedSymbols();
  restoreFileHandle();
  window.addEventListener("beforeunload", e => {
    if (!App.dirty) return;
    e.preventDefault();
    e.returnValue = "";   // 未保存の変更がある場合は離脱を確認する
  });

  setupEditor();
  UI.buildPalette();
  UI.buildPageTabs();
  UI.setupMenus();
  UI.setupKeys();
  UI.showProps();

  document.getElementById("symSearch").addEventListener("input", e => UI.buildPalette(e.target.value));
  document.querySelectorAll(".rbtn.tool").forEach(b => b.addEventListener("click", () => UI.setTool(b.dataset.tool)));
  document.getElementById("btnUndo").addEventListener("click", () => { if (undo()) UI.refresh(); });
  document.getElementById("btnRedo").addEventListener("click", () => { if (redo()) UI.refresh(); });
  document.getElementById("btnRotate").addEventListener("click", rotateSelection);
  document.getElementById("btnDelete").addEventListener("click", deleteSelection);
  document.getElementById("btnWireNum").addEventListener("click", () => {
    if (App.sim.running) return;
    commit(); autoNumberWires(); UI.refresh(false); UI.setMsg("配線番号を付与しました (手動線番は保護)");
  });
  document.getElementById("btnDRC").addEventListener("click", UI.runDRC);
  document.getElementById("btnBOM").addEventListener("click", UI.showBOM);
  document.getElementById("btnSim").addEventListener("click", UI.toggleSim);
  document.getElementById("btnSave").addEventListener("click", () => UI.saveOver());
  UI.updateSaveButton();
  document.getElementById("btnAIWizard").addEventListener("click", UI.openWizard);
  document.getElementById("btnRelease").addEventListener("click", () => UI.finishDesign());
  UI.updateReleaseBadge();
  document.getElementById("btnZoomIn").addEventListener("click", () => UI.zoomCenter(1.25));
  document.getElementById("btnZoomOut").addEventListener("click", () => UI.zoomCenter(0.8));
  document.getElementById("btnZoomFit").addEventListener("click", zoomFit);
  document.getElementById("zoomLabel").addEventListener("click", () => {
    // 視点中心を保ったまま 100% へ
    const r = Editor.svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 2.2 / Editor.view.s);
  });
  document.getElementById("btnAddPage").addEventListener("click", UI.addPage);
  document.querySelectorAll(".rtab").forEach(t => t.addEventListener("click", () => {
    if (t.dataset.rtab === "drc") UI.runDRC();
    else if (t.dataset.rtab === "bom") UI.showBOM();
    else UI.activateRightTab("props");
  }));

  UI.setTool("select");
  zoomFit();

  // 初回のみクイックスタートのヒント (図面を隠さないようステータスバーに)
  if (!localStorage.getItem("electracad.seen")) {
    localStorage.setItem("electracad.seen", "1");
    setTimeout(() => UI.setMsg("ようこそ！ 右上の「AI自動作図」(F2) で回路を自動生成できます"), 600);
  }
}

/** 初回起動用のデモプロジェクト (AI生成のサンプル) */
function demoProject() {
  App.project = newProject("サンプル — コンベア制御盤");
  try {
    // 空の初期ページは aiGenerate が自動除去する
    aiGenerate({
      inputs: [{ id: "estop", qty: 1 }, { id: "pb_no", qty: 1 }, { id: "pb_nc", qty: 1 }, { id: "prox", qty: 1 }],
      logics: [{ id: "coil", qty: 1 }, { id: "cont_coil", qty: 1 }],
      outputs: [{ id: "lamp", qty: 1 }, { id: "motor3", qty: 1 }],
      opts: { selfHold: true, lampFb: false, autoNum: true },
    });
  } catch (e) {
    console.error("demo generation failed", e);
  }
  App.pageIdx = 0;
  return App.project;
}

window.addEventListener("DOMContentLoaded", boot);
