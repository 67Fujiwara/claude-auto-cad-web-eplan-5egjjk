/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — 設計完了 (出図) と履歴

   「設計完了」で検図 → DXF (全ページ) と PDF (全ページを1ファイル) を出力し、
   そのときの図面一式を履歴として保存する。履歴からはいつでも同じ図面を
   開き直したり、DXF・JSON を出し直したりできる。
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const REL_KEY = "electracad.releases";       // 履歴のメタ情報 (localStorage)
const REL_DB = "electracad";                 // 図面本体 (IndexedDB)
const REL_STORE = "releases";

/* ── 保存領域 ─────────────────────────────── */
/* file:// で開くと IndexedDB が応答しない環境があるため、必ず時間切れを設けて
   localStorage へ退避できるようにする。どちらも使えなければ図面本体は保存せず、
   履歴の記録だけを残す (履歴側で「開く」等を無効表示にする)。 */
const REL_LS_PREFIX = "electracad.relsnap.";
const REL_TIMEOUT = 1500;
function relWithTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
function relOpenDB() {
  return relWithTimeout(new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    let rq;
    try { rq = indexedDB.open(REL_DB, 2); } catch (e) { return rej(e); }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      if (!db.objectStoreNames.contains(REL_STORE)) db.createObjectStore(REL_STORE);
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
    rq.onblocked = () => rej(new Error("blocked"));
  }), REL_TIMEOUT);
}
async function relPutSnapshot(id, project) {
  const text = JSON.stringify(project);
  try {
    const db = await relOpenDB();
    await relWithTimeout(new Promise((res, rej) => {
      const tx = db.transaction(REL_STORE, "readwrite");
      tx.objectStore(REL_STORE).put(text, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }), REL_TIMEOUT);
    return true;
  } catch (e) { /* localStorage へ退避する */ }
  try {
    localStorage.setItem(REL_LS_PREFIX + id, text);
    return true;
  } catch (e) { return false; }
}
async function relGetSnapshot(id) {
  try {
    const db = await relOpenDB();
    const v = await relWithTimeout(new Promise((res, rej) => {
      const tx = db.transaction(REL_STORE, "readonly");
      const rq = tx.objectStore(REL_STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    }), REL_TIMEOUT);
    if (v) return JSON.parse(v);
  } catch (e) { /* localStorage を見る */ }
  try {
    const v = localStorage.getItem(REL_LS_PREFIX + id);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}
async function relDelSnapshot(id) {
  try {
    const db = await relOpenDB();
    await relWithTimeout(new Promise((res) => {
      const tx = db.transaction(REL_STORE, "readwrite");
      tx.objectStore(REL_STORE).delete(id);
      tx.oncomplete = res; tx.onerror = res;
    }), REL_TIMEOUT);
  } catch (e) { /* 無ければ何もしない */ }
  try { localStorage.removeItem(REL_LS_PREFIX + id); } catch (e) { /* 無視 */ }
}
function relList() {
  try { return JSON.parse(localStorage.getItem(REL_KEY) || "[]"); }
  catch (e) { return []; }
}
function relSaveList(list) {
  try { localStorage.setItem(REL_KEY, JSON.stringify(list)); } catch (e) { /* 容量超過は無視 */ }
}
function relStamp(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── 設計完了 ─────────────────────────────── */
UI.finishDesign = () => {
  if (App.sim.running) { UI.setMsg("シミュレーション中は設計完了できません"); return; }
  syncProjectSymbols();
  const issues = runDRC();
  const errs = issues.filter(i => i.sev === "err");
  const warns = issues.filter(i => i.sev === "warn");
  const meta = projectMeta();
  const pages = App.project.pages;
  const devs = pages.reduce((n, p) => n + p.devices.length, 0);
  const wires = pages.reduce((n, p) => n + condWires(p).length, 0);

  const list = relList();
  const seq = list.filter(r => r.project === App.project.name).length + 1;

  const body = h(`<div>
    <div class="rel-sum">
      <div class="rel-card"><div class="rel-k">ページ</div><div class="rel-v">${pages.length}</div></div>
      <div class="rel-card"><div class="rel-k">機器</div><div class="rel-v">${devs}</div></div>
      <div class="rel-card"><div class="rel-k">配線</div><div class="rel-v">${wires}</div></div>
      <div class="rel-card ${errs.length ? "bad" : "ok"}"><div class="rel-k">検図エラー</div><div class="rel-v">${errs.length}</div></div>
      <div class="rel-card ${warns.length ? "warn" : "ok"}"><div class="rel-k">検図警告</div><div class="rel-v">${warns.length}</div></div>
    </div>
    ${errs.length ? `<div class="rel-alert">検図エラーが ${errs.length} 件あります。出図すると誤結線につながる可能性があります。<br>
      <span class="mono" style="font-size:11px">${errs.slice(0, 4).map(e => escXML(`${e.loc} ${e.msg}`)).join("<br>")}${errs.length > 4 ? `<br>ほか ${errs.length - 4} 件` : ""}</span></div>` : ""}
    <div class="prop-sect">出力するもの</div>
    <div class="prop-row"><label class="chk"><input type="checkbox" id="rlDxf" checked/><span>DXF (AutoCAD互換・ページごとに ${pages.length} ファイル)</span></label></div>
    <div class="prop-row"><label class="chk"><input type="checkbox" id="rlPdf" checked/><span>PDF (全ページを1ファイルにまとめて出力)</span></label></div>
    <div class="prop-row"><label class="chk"><input type="checkbox" id="rlJson" checked/><span>図面データ (JSON・再編集用)</span></label></div>
    <div class="prop-sect">まとめ方</div>
    <div class="prop-row"><label>出力先</label><select id="rlPack">
      ${FS_DIR_API ? `<option value="dir">フォルダにまとめる (保存先を選ぶ)</option>` : ""}
      <option value="zip"${FS_DIR_API ? "" : " selected"}>ZIP 1 ファイルにまとめる</option>
      <option value="each">ファイルごとに保存 (従来)</option>
    </select></div>
    <div class="prop-row"><label>PDF の細かさ</label><select id="rlDpi">
      <option value="150">150 dpi (軽い)</option>
      <option value="200" selected>200 dpi (標準)</option>
      <option value="300">300 dpi (細かい・重い)</option>
    </select></div>
    <div class="prop-sect">出図の記録</div>
    <div class="prop-grid2">
      <div class="prop-row"><label>版数</label><input id="rlRev" class="mono" value="${escAttr(meta.rev || "0")}"/></div>
      <div class="prop-row"><label>出図者</label><input id="rlBy" value="${escAttr(meta.designer || "")}" placeholder="署名"/></div>
    </div>
    <div class="prop-row"><label>備考</label><input id="rlNote" placeholder="変更点・出図先など"/></div>
    <div class="prop-note">出図した図面一式は履歴に保存され、「設計完了履歴」からいつでも開き直せます。</div>
  </div>`);
  const foot = h(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn-solid" id="rlHist">設計完了履歴…</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="rlCancel">キャンセル</button>
    <button class="btn-solid primary" id="rlOk">設計完了して出図</button>
  </div>`);
  const m = UI.openModal({
    title: "設計完了",
    sub: `${App.project.name} — ${relStamp(new Date())} (第 ${seq} 版)`,
    body, foot, wide: true,
  });
  foot.querySelector("#rlCancel").addEventListener("click", m.close);
  foot.querySelector("#rlHist").addEventListener("click", () => { m.close(); UI.openReleaseHistory(); });
  foot.querySelector("#rlOk").addEventListener("click", async () => {
    if (errs.length && !confirm(`検図エラーが ${errs.length} 件あります。このまま設計完了にしますか？`)) return;
    const q = s => body.querySelector(s);
    const wantDxf = q("#rlDxf").checked, wantPdf = q("#rlPdf").checked, wantJson = q("#rlJson").checked;
    const pack = q("#rlPack").value, dpi = +q("#rlDpi").value || 200;
    meta.rev = q("#rlRev").value.trim() || meta.rev || "0";
    if (q("#rlBy").value.trim()) meta.designer = q("#rlBy").value.trim();
    m.close();
    await UI.runRelease({
      dxf: wantDxf, pdf: wantPdf, json: wantJson, pack, dpi,
      note: q("#rlNote").value.trim(), rev: meta.rev, by: meta.designer || "",
      errs: errs.length, warns: warns.length, devs, wires, seq,
    });
  });
};

/** フォルダを選んで書き込めるか (File System Access API) */
const FS_DIR_API = typeof window !== "undefined" && !!window.showDirectoryPicker;

/** 出図の実行 (ファイルを作る → まとめて保存 → 履歴に保存) */
UI.runRelease = async (opt) => {
  const now = new Date();
  const id = "rel_" + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  const safe = t => String(t).replace(/[\\/:*?"<>|]/g, "_");
  const base = safe(App.project.name || "無題") + "_rev" + (opt.rev || "0");
  const folder = `${base}_${relStamp(now).replace(/[^0-9]/g, "").slice(0, 12)}`;
  const pages = App.project.pages;
  const out = [];            // { name, data: string | Uint8Array | Blob }

  if (opt.json) {
    syncProjectSymbols();
    out.push({ name: `${base}.ecad.json`, data: JSON.stringify(App.project, null, 1) });
  }
  if (opt.dxf) {
    pages.forEach(pg => out.push({ name: safe(`${base}_p${pg.no}_${pg.name}.dxf`), data: pageToDXF(pg) }));
    applySheet(curPage());
  }
  if (opt.pdf) {
    UI.setMsg("PDF を作っています… (ページ数が多いと少しかかります)");
    try {
      const blob = await buildPDF(pages, { dpi: opt.dpi || 200,
        onProgress: (i, n) => UI.setMsg(`PDF を作っています… ${i + 1}/${n} ページ`) });
      out.push({ name: `${base}.pdf`, data: blob });
    } catch (e) {
      UI.setMsg("PDF の作成に失敗しました — 他の形式だけ出力します");
    }
  }

  const files = out.map(f => f.name);
  const where = await saveReleaseFiles(out, folder, opt.pack || (FS_DIR_API ? "dir" : "zip"));

  // 履歴に記録 (図面本体の保存は時間がかかるので最後に行う)
  const entry = {
    id, at: now.toISOString(), stamp: relStamp(now),
    project: App.project.name, rev: opt.rev || "0", by: opt.by || "",
    note: opt.note || "", seq: opt.seq || 1,
    pages: pages.length, devices: opt.devs, wires: opt.wires,
    drcErr: opt.errs, drcWarn: opt.warns,
    dwgNos: pages.map(p => pageDwgNo(p)),
    pageNames: pages.map(p => p.name),
    files, folder: where.name || "",
  };
  const list = relList();
  list.unshift(entry);
  while (list.length > 50) { const old2 = list.pop(); relDelSnapshot(old2.id); }
  relSaveList(list);
  UI.updateReleaseBadge();
  UI.setMsg(`設計完了しました — ${files.length} ファイルを${where.how}。履歴に保存しました`);
  const saved = await relPutSnapshot(id, App.project);
  relSaveList(relList().map(r => (r.id === id ? { ...r, saved } : r)));
  if (!saved) UI.setMsg("設計完了しました (図面本体は保存できませんでした。履歴からの再出力はできません)");
};

/** 出図したファイルの保存先。フォルダ / ZIP / 個別 の 3 通り */
async function saveReleaseFiles(out, folder, pack) {
  if (!out.length) return { how: "出力しました", name: "" };
  const toBytes = async d => (d instanceof Blob ? new Uint8Array(await d.arrayBuffer())
    : typeof d === "string" ? new TextEncoder().encode(d) : d);
  if (pack === "dir" && FS_DIR_API) {
    try {
      const root = await window.showDirectoryPicker({ mode: "readwrite" });
      const dir = await root.getDirectoryHandle(folder, { create: true });
      for (const f of out) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f.data instanceof Blob ? f.data : await toBytes(f.data));
        await w.close();
      }
      return { how: `フォルダ「${folder}」にまとめました`, name: folder };
    } catch (e) {
      if (e && e.name === "AbortError") return { how: "保存をやめました (ファイルは出力していません)", name: "" };
      // 権限が無い等はまとめて ZIP に落とす
    }
  }
  if (pack === "each") {
    out.forEach((f, i) => setTimeout(async () => {
      const d = f.data instanceof Blob ? f.data : new Blob([await toBytes(f.data)]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(d); a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, i * 350));
    return { how: "ファイルごとに保存しました", name: "" };
  }
  // ZIP: フォルダと同じ構成 (書庫の中に 1 つフォルダを作る) で 1 ファイルに
  const items = [];
  for (const f of out) items.push({ name: `${folder}/${f.name}`, data: await toBytes(f.data) });
  const zip = buildZIP(items);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zip); a.download = `${folder}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  return { how: `ZIP「${folder}.zip」にまとめました`, name: folder };
}

/* ── 設計完了履歴の画面 ─────────────────────── */
UI.openReleaseHistory = () => {
  const body = h(`<div>
    <div class="prop-note" style="margin-top:0">
      設計完了した図面の記録です。行を選ぶと、そのときの図面をそのまま開き直したり、
      DXF・JSON を出し直したりできます。
    </div>
    <div class="rel-head"><span>出図日時</span><span>プロジェクト / 版</span><span>規模</span><span>検図</span><span>操作</span></div>
    <div id="rlRows" class="rel-rows"></div>
  </div>`);
  const foot = h(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn-solid" id="rlExportAll">履歴を書き出す (JSON)</button>
    <span style="flex:1"></span>
    <button class="btn-solid" id="rlClose">閉じる</button>
  </div>`);
  const m = UI.openModal({ title: "設計完了履歴", sub: "出図した図面の記録と再出力", body, foot, wide: true });

  const render = () => {
    const list = relList();
    const rows = body.querySelector("#rlRows");
    if (!list.length) {
      rows.innerHTML = '<div class="se-empty" style="padding:24px">まだ設計完了した図面はありません</div>';
      return;
    }
    rows.innerHTML = list.map(r => `
      <div class="rel-row" data-id="${r.id}">
        <span class="mono">${escXML(r.stamp)}</span>
        <span><b>${escXML(r.project)}</b><br><span class="rel-dim">Rev ${escXML(r.rev)} / 第 ${r.seq} 版${r.by ? " / " + escXML(r.by) : ""}</span>
          ${r.note ? `<br><span class="rel-dim">${escXML(r.note)}</span>` : ""}</span>
        <span class="rel-dim">${r.pages} ページ / 機器 ${r.devices} / 配線 ${r.wires}<br>
          <span class="mono" style="font-size:10.5px">${escXML((r.dwgNos || []).slice(0, 3).join(", "))}${(r.dwgNos || []).length > 3 ? " …" : ""}</span></span>
        <span class="${r.drcErr ? "rel-bad" : "rel-ok"}">エラー ${r.drcErr}<br><span class="rel-dim">警告 ${r.drcWarn}</span></span>
        <span class="rel-act">
          <button class="btn-solid rl-open" data-id="${r.id}"${r.saved === false ? " disabled" : ""}>開く</button>
          <button class="btn-solid rl-dxf" data-id="${r.id}"${r.saved === false ? " disabled" : ""}>DXF</button>
          <button class="btn-solid rl-json" data-id="${r.id}"${r.saved === false ? " disabled" : ""}>JSON</button>
          <button class="btn-solid rl-del" data-id="${r.id}">削除</button>
        </span>
      </div>`).join("");

    const withSnap = async (id, fn) => {
      const p = await relGetSnapshot(id);
      if (!p) { alert("この履歴の図面データが見つかりません (ブラウザのデータが消去された可能性があります)"); return; }
      fn(p, list.find(r => r.id === id));
    };
    rows.querySelectorAll(".rl-open").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, (p, r) => {
      if (!confirm(`${r.stamp} の図面を開きます。現在の編集内容は失われます (保存していない場合)。\nよろしいですか？`)) return;
      commit();
      App.project = p;
      mergeProjectSymbols();
      App.pageIdx = 0;
      App.selection.clear();
      UI.renumberPages();
      applySheet();
      document.getElementById("projectName").value = App.project.name;
      m.close();
      UI.refresh();
      zoomFit();
      UI.setMsg(`設計完了履歴 (${r.stamp}) の図面を開きました`);
    })));
    rows.querySelectorAll(".rl-dxf").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, (p, r) => {
      // 履歴の図面で一時的に差し替えて DXF を作り、元に戻す
      const keep = App.project, keepIdx = App.pageIdx;
      App.project = p; App.pageIdx = 0;
      const base = `${(r.project || "図面").replace(/[\\/:*?"<>|]/g, "_")}_rev${r.rev}`;
      p.pages.forEach((pg, i) => {
        const text = pageToDXF(pg);
        setTimeout(() => downloadFile(`${base}_p${pg.no}_${pg.name}.dxf`.replace(/[\\/:*?"<>|]/g, "_"), text, "application/dxf"), i * 350);
      });
      App.project = keep; App.pageIdx = keepIdx;
      applySheet(curPage());
      UI.setMsg(`履歴 (${r.stamp}) の DXF を ${p.pages.length} ファイル出力します`);
    })));
    rows.querySelectorAll(".rl-json").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, (p, r) => {
      downloadFile(`${(r.project || "図面").replace(/[\\/:*?"<>|]/g, "_")}_rev${r.rev}.ecad.json`, JSON.stringify(p, null, 1));
    })));
    rows.querySelectorAll(".rl-del").forEach(b => b.addEventListener("click", async () => {
      const r = list.find(x => x.id === b.dataset.id);
      if (!confirm(`${r.stamp} の記録を削除しますか？ (出力済みのファイルは消えません)`)) return;
      relSaveList(relList().filter(x => x.id !== b.dataset.id));
      await relDelSnapshot(b.dataset.id);
      UI.updateReleaseBadge();
      render();
    }));
  };
  render();
  foot.querySelector("#rlExportAll").addEventListener("click", () => {
    downloadFile("設計完了履歴.json", JSON.stringify(relList(), null, 1));
  });
  foot.querySelector("#rlClose").addEventListener("click", m.close);
};

/** 設計完了ボタンに履歴件数を出す */
UI.updateReleaseBadge = () => {
  const el = document.getElementById("relCount");
  if (!el) return;
  const n = relList().length;
  el.textContent = n ? String(n) : "";
  el.style.display = n ? "" : "none";
};
