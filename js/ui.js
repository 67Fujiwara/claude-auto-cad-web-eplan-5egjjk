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
      const item = h(`<div class="sym-item" title="${sym.name} (${sym.nameEn})&#10;${sym.desc}">
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
UI.buildPageTabs = () => {
  const wrap = document.getElementById("pageTabs");
  wrap.innerHTML = "";
  App.project.pages.forEach((pg, i) => {
    const el = h(`<div class="ptab ${i === App.pageIdx ? "active" : ""}">
      <span class="ptab-no">${pg.no}</span><span>${pg.name}</span>
      ${App.project.pages.length > 1 ? '<span class="ptab-close" title="ページを削除">×</span>' : ""}
    </div>`);
    el.addEventListener("click", e => {
      if (e.target.classList.contains("ptab-close")) {
        if (App.sim.running) { UI.setMsg("シミュレーション中はページを削除できません"); return; }
        if (!confirm(`ページ「${pg.name}」を削除しますか？`)) return;
        commit();
        App.project.pages.splice(i, 1);
        App.project.pages.forEach((p, k) => p.no = k + 1);
        App.pageIdx = Math.max(0, Math.min(App.pageIdx, App.project.pages.length - 1));
        App.selection.clear();
        UI.refresh();
        return;
      }
      if (i === App.pageIdx) return; // 同一タブ再クリックはDOMを保持 (ダブルクリックのリネームを生かす)
      App.pageIdx = i;
      App.selection.clear();
      UI.refresh();
    });
    el.addEventListener("dblclick", e => {
      if (e.target.classList.contains("ptab-close")) return;
      if (App.sim.running) return;
      // インラインリネーム (prompt は使わない)
      const span = el.querySelector("span:nth-child(2)");
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
    const sym = SYMBOLS_BY_ID[dev.sym];
    const cat = SYM_CATS[sym.cat];
    const coils = [];
    App.project.pages.forEach(pg => pg.devices.forEach(d => {
      if (SYMBOLS_BY_ID[d.sym].mirror) coils.push(d);
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
      ${SYMBOLS_BY_ID[dev.sym].linked || sym.sim?.startsWith("contact") ? `
      <div class="prop-row"><label>コイルにリンク (クロスリファレンス)</label>
        <select id="pLink"><option value="">— リンクなし —</option>
        ${coils.map(c => `<option value="${c.id}" ${dev.linkTo === c.id ? "selected" : ""}>${c.tag} (${SYMBOLS_BY_ID[c.sym].name})</option>`).join("")}
        </select></div>` : ""}
      ${sym.timer ? `<div class="prop-row"><label>遅延時間 (秒)</label><input id="pDelay" class="mono" type="number" step="0.5" min="0" value="${dev.props.delay || 2}"/></div>` : ""}
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
    bind("#pDelay", v => { const n = parseFloat(v); dev.props.delay = isNaN(n) ? 2 : n; });
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
      w.num = v || null;
      w.fixed = !!v; // 手動線番は自動付与で上書きしない
      w.numShow = !!v;
      UI.refresh(false);
    });
    pane.querySelector("#pSpec").addEventListener("change", e => {
      commit();
      w.spec = e.target.value.trim() || undefined;
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
        <span class="xr-tag">${SYMBOLS_BY_ID[c.sym].name}</span>
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
      <thead><tr><th>デバイスタグ</th><th>名称</th><th>型式</th><th>数</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="mono clip" title="${esc(r.tags.join(", "))}">${esc(r.tags.length > 2 ? r.tags.slice(0, 2).join(" ") + "…" : r.tags.join(" "))}</td>
        <td class="clip" title="${esc(r.name)}">${esc(r.name)}</td><td class="mono clip" title="${esc(r.typeRef)}">${esc(r.typeRef)}</td><td>${r.tags.length}</td></tr>`).join("")}</tbody>
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
    { label: "エクスポート (JSON)", key: "", fn: () => downloadFile(App.project.name + ".ecad.json", JSON.stringify(App.project, null, 1)) },
    { label: "エクスポート (SVG・現在ページ)", key: "", fn: () => downloadFile(App.project.name + "_p" + curPage().no + ".svg", exportSheetSVG(), "image/svg+xml") },
    { sep: true },
    { label: "図枠・表題欄の設定…", key: "", fn: () => UI.sheetSetup() },
    { sep: true },
    { label: "DXF出力 (AutoCAD互換・全ページ)", key: "", fn: () => UI.exportDXF() },
    { label: "PDF出力 (全ページ印刷)…", key: "", fn: () => UI.printAll() },
    { label: "印刷 (現在ページ)…", key: "Ctrl+P", fn: () => UI.print() },
  ],
  edit: [
    { label: "シンボルデータベース…", key: "", fn: () => UI.openSymDB() },
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
    { label: "設計ルールチェック (DRC)", key: "", fn: () => UI.runDRC() },
    { label: "部品表 (BOM)", key: "", fn: () => UI.showBOM() },
    { label: "配線番号の自動付与", key: "", fn: () => { commit(); autoNumberWires(); UI.refresh(false); UI.setMsg("配線番号を付与しました (手動線番は保護)"); } },
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
  App.pageIdx = App.project.pages.length - 1;
  App.selection.clear();
  UI.refresh();
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
      App.fileHandle = handle;
      App.pendingHandle = null;
      rememberFileHandle(handle);
      App.pageIdx = 0;
      App.selection.clear();
      applySheet();
      document.getElementById("projectName").value = p.name;
      UI.updateSaveButton();
      UI.refresh();
      zoomFit();
      UI.setMsg(`読み込みました — ${handle.name} (保存ボタンで上書き保存)`);
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
        App.fileHandle = null; // input[type=file] 経由は上書き先を持てない
        App.pageIdx = 0;
        App.selection.clear();
        applySheet();
        UI.updateSaveButton();
        document.getElementById("projectName").value = p.name;
        UI.refresh();
        zoomFit();
        UI.setMsg("プロジェクトを読み込みました");
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
  const paper = projectMeta().paper || "A3";
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${App.project.name}</title><style>
    @page { size: ${paper} landscape; margin: 0; }
    body { margin: 0 } svg { width: 100vw; height: 100vh }
  </style></head><body>${svg}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
};

/** 全ページを1つの印刷ジョブに (印刷ダイアログで「PDFに保存」を選ぶとPDF出力) */
UI.printAll = () => {
  const pages = App.project.pages.map(pg =>
    `<div class="sheet">${exportSheetSVG(pg)}</div>`).join("");
  const paper = projectMeta().paper || "A3";
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${App.project.name} (全${App.project.pages.length}ページ)</title>
    <style>
      @page { size: ${paper} landscape; margin: 0; }
      body { margin: 0; }
      .sheet { width: 100vw; height: 100vh; page-break-after: always; display: flex; align-items: center; justify-content: center; }
      .sheet:last-child { page-break-after: auto; }
      .sheet svg { width: 100%; height: 100%; }
    </style></head><body>${pages}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
  UI.setMsg(`印刷ダイアログで「PDFに保存」を選ぶと全ページPDFになります (用紙: ${paper}横 / 尺度 ${projectMeta().scale})`);
};

/** 全ページを DXF (AutoCAD互換) でダウンロード */
UI.exportDXF = () => {
  const base = App.project.name.replace(/[\\/:*?"<>|]/g, "_");
  App.project.pages.forEach((pg, i) => {
    // 連続ダウンロードのブロックを避けるため少しずつ間隔を空ける
    setTimeout(() => {
      downloadFile(`${base}_p${pg.no}_${pg.name}.dxf`, pageToDXF(pg), "application/dxf");
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
UI.openModal = ({ title, sub = "", body, foot = "", onclose = null, wide = false }) => {
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
  const close = () => { bk.remove(); if (onclose) onclose(); };
  bk.querySelector(".modal-close").addEventListener("click", close);
  bk.addEventListener("mousedown", e => { if (e.target === bk) close(); });
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
      wire.num = v || null;
      wire.fixed = !!v;
      wire.numShow = !!v;
      UI.refresh(false);
      UI.setMsg(v ? `線番を ${v} に変更しました (自動採番から保護)` : "線番を削除しました");
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
        <div class="wc-desc">${s.jis ? `JIS C 0617 ${s.jis}` : s.group}</div>
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
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label || v}</option>`;
  const body = h(`<div>
    <div class="prop-sect">表題欄</div>
    <div class="prop-grid2">
      <div class="prop-row"><label>プロジェクト</label><input id="tbProj" value="${escAttr(App.project.name)}"/></div>
      <div class="prop-row"><label>ページ名</label><input id="tbPage" value="${escAttr(page.name)}"/></div>
      <div class="prop-row"><label>図番</label><input id="tbDwg" class="mono" value="${escAttr(meta.dwgNo || "")}" placeholder="E-${String(page.no).padStart(3, "0")}"/></div>
      <div class="prop-row"><label>改訂</label><input id="tbRev" class="mono" value="${escAttr(meta.rev || "0")}"/></div>
      <div class="prop-row"><label>設計</label><input id="tbDes" value="${escAttr(meta.designer || "")}" placeholder="—"/></div>
      <div class="prop-row"><label>検図</label><input id="tbChk" value="${escAttr(meta.checker || "")}" placeholder="—"/></div>
      <div class="prop-row"><label>日付</label><input id="tbDate" class="mono" value="${escAttr(meta.date || todayStr())}" placeholder="2026-01-31"/></div>
      <div class="prop-row"><label>企業 (団体) 名</label><input id="tbAuth" value="${escAttr(meta.author || "")}" placeholder="社名を入力"/></div>
      <div class="prop-row"><label>投影法</label><select id="tbProjMethod">
        ${["第三角法", "第一角法", "該当なし (回路図)"].map(v => opt(v, meta.proj || "第三角法")).join("")}
      </select></div>
    </div>
    <div class="prop-sect">用紙と尺度</div>
    <div class="prop-grid2">
      <div class="prop-row"><label>用紙 (横置き)</label><select id="tbPaper">
        ${Object.entries(PAPERS).map(([k, [pw, ph]]) => opt(k, meta.paper, `${k} (${pw}×${ph} mm)`)).join("")}
      </select></div>
      <div class="prop-row"><label>尺度</label><select id="tbScale">
        ${SCALES.map(s => opt(s, meta.scale)).join("")}
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
    const [pw, ph] = PAPERS[q("#tbPaper").value] || PAPERS.A3;
    const sc = q("#tbScale").value;
    const f = scaleFactor(sc);
    const over = countOverflow(q("#tbPaper").value, sc);
    q("#tbInfo").innerHTML = `作図領域は <b>${Math.round(pw * f)} × ${Math.round(ph * f)} mm</b> になります` +
      (sc === "NS" ? " (非尺度)。" : f === 1 ? " (現尺)。"
        : `。用紙 ${pw}×${ph} mm に ${sc} で印刷される想定で、実物の${f > 1 ? `${f} 倍の範囲を1枚に収められます` : `${1 / f} 倍に拡大して描けます`}。`) +
      `<br>線の太さ・文字の高さ・線種は尺度に追従し、用紙上では常に同じ大きさで印刷されます。` +
      (f !== 1 ? `<br><b>図記号 (シンボル) は実寸のまま</b>なので、用紙上では ${f > 1 ? `1/${f}` : `${1 / f} 倍`} の大きさになります。回路図は NS または 1:1、実寸で描く配置図などに縮尺をお使いください。` : "") +
      (over.total
        ? `<br><b style="color:var(--warn,#e5a03d)">⚠ この用紙では機器 ${over.devs} 点・配線 ${over.wires} 本が図枠外または表題欄に重なります。</b>`
        : `<br>現在の図形はすべて新しい図枠に収まります。`);
  };
  /** 指定の用紙・尺度に切り替えた場合のはみ出し数を試算する (SHEET は元に戻す) */
  function countOverflow(paper, scale) {
    const save = { paper: meta.paper, scale: meta.scale };
    meta.paper = paper; meta.scale = scale; applySheet();
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
    meta.paper = save.paper; meta.scale = save.scale; applySheet();
    return { devs, wires, total: devs + wires };
  }
  q("#tbPaper").addEventListener("change", info);
  q("#tbScale").addEventListener("change", info);
  info();

  const foot = h(`<div style="display:flex;gap:10px;justify-content:flex-end">
    <button class="btn-solid" id="tbCancel">キャンセル</button>
    <button class="btn-solid primary" id="tbOk">適用</button>
  </div>`);
  const m = UI.openModal({ title: "図枠・表題欄の設定", sub: "表題欄の記入項目と用紙サイズ・尺度", body, foot });
  foot.querySelector("#tbCancel").addEventListener("click", m.close);
  foot.querySelector("#tbOk").addEventListener("click", () => {
    const paperChanging = meta.paper !== q("#tbPaper").value || meta.scale !== q("#tbScale").value;
    if (paperChanging) {
      const over = countOverflow(q("#tbPaper").value, q("#tbScale").value);
      if (over.total && !confirm(
        `新しい図枠 ${q("#tbPaper").value} / ${q("#tbScale").value} では、機器 ${over.devs} 点・配線 ${over.wires} 本が` +
        `図枠外にはみ出すか表題欄に重なります。\n(検図 (DRC) にエラーとして表示されます)\n\n続けますか？`)) return;
    }
    commit();
    App.project.name = q("#tbProj").value.trim() || App.project.name;
    page.name = q("#tbPage").value.trim() || page.name;
    meta.dwgNo = q("#tbDwg").value.trim();
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
    // 改訂履歴欄は表題欄の上に伸びるため、回路と重なる場合は知らせる
    const revHits = runDRC().filter(d => /改訂履歴欄/.test(d.msg)).length;
    if (revHits) UI.toast(`⚠ 改訂履歴欄が回路と ${revHits} 箇所で重なっています (検図に表示)`, 5000);
    const paperChanged = paperChanging;
    meta.paper = q("#tbPaper").value;
    meta.scale = q("#tbScale").value;
    applySheet();
    const nameInput = document.getElementById("projectName");
    if (nameInput) nameInput.value = App.project.name;
    m.close();
    UI.refresh();
    if (paperChanged) { zoomFit(); UI.setMsg(`用紙 ${meta.paper} / 尺度 ${meta.scale} — 作図領域 ${SHEET.w}×${SHEET.h} mm に変更しました`); }
    else UI.setMsg("表題欄を更新しました");
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
  if (rebuildTabs !== false) UI.buildPageTabs();
  UI.showProps();
  requestRender();
};

function boot() {
  App.project = loadLocal() || demoProject();
  applySheet(); // 保存された用紙・尺度で作図領域を張る
  document.getElementById("projectName").value = App.project.name;
  const pn = document.getElementById("projectName");
  pn.addEventListener("change", e => {
    App.project.name = e.target.value.trim() || "無題プロジェクト";
    saveLocal();
    requestRender();
  });
  pn.addEventListener("keydown", e => { if (e.key === "Enter") pn.blur(); });

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
