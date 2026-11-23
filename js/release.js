/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — 設計完了 (出図) と履歴

   「設計完了」で検図 → DXF (全ページ) と PDF を出力し、そのときの図面一式を
   履歴として保存する。履歴からはいつでも同じ図面を開き直したり、DXF・JSON を
   出し直したりできる。
   PDF は 2 通り作る:
   ・社内保存用 … すべての図面 (表紙・目次・仕様・回路図)
   ・顧客提出用 … 仕様のページを外したもの
   どちらも図番はそのまま。用紙の右下の「n / N」と目次だけ、その版に
   載るページで数え直す。
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
  // 直列化済みの文字列を渡せる (大きな図面を毎回 stringify し直さないため)
  const text = typeof project === "string" ? project : JSON.stringify(project);
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
  const nDrop = pages.length - releasePages("customer", pages).length;   // 仕様 + 加工穴のみ
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
    <div class="prop-row"><label class="chk"><input type="checkbox" id="rlPdfIn" checked/><span>PDF 社内保存用 (すべての図面 ${pages.length} ページを1ファイルに)</span></label></div>
    <div class="prop-row"><label class="chk"><input type="checkbox" id="rlPdfCus" checked/><span>PDF 顧客提出用 (仕様・加工穴のみ${nDrop ? ` ${nDrop} ページ` : ""}を外した ${pages.length - nDrop} ページ)${nDrop ? "" : " — 外すページはありません"}</span></label></div>
    <div class="prop-note" style="margin:4px 0 0">図枠: ${projectMeta().outPlain ? "顧客提出用 PDF と DXF はシンプル図枠 (改訂欄 + 管理番号・頁の帯)・社内保存用 PDF は JIS" : "標準 (JIS)"} — 「図枠・表題欄の設定」の様式で切り替えられます</div>
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
      <div class="prop-row"><label>検図者</label><input id="rlChk" value="${escAttr(meta.checker || "")}" placeholder="署名 — 全ページの表題欄の検図欄に入ります"/></div>
      ${projectMeta().outPlain ? `<div class="prop-row"><label>管理番号</label><input id="rlCtrl" class="mono" value="${escAttr(meta.ctrlNo || "")}" placeholder="シンプル図枠の帯に表示 (空欄なら図番)"/></div>` : ""}
    </div>
    <div class="prop-row"><label>備考</label><input id="rlNote" placeholder="変更点・出図先など"/></div>
    <div class="prop-note">PDF は社内保存用と顧客提出用の 2 通りを出します。図番は両方とも同じで、
      用紙右下の「n / N」と目次だけ、その版に載るページで数え直します。<br>
      出図した図面一式は履歴に保存され、「設計完了履歴」からいつでも開き直せます。</div>
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
    const wantDxf = q("#rlDxf").checked, wantJson = q("#rlJson").checked;
    const wantPdfIn = q("#rlPdfIn").checked, wantPdfCus = q("#rlPdfCus").checked;
    const pack = q("#rlPack").value, dpi = +q("#rlDpi").value || 200;
    meta.rev = q("#rlRev").value.trim() || meta.rev || "0";
    if (q("#rlBy").value.trim()) meta.designer = q("#rlBy").value.trim();
    // 検図者は表題欄の検図 (署名) — 図面全体のメタなので全ページに入る
    if (q("#rlChk").value.trim()) meta.checker = q("#rlChk").value.trim();
    // 管理番号 (シンプル図枠の帯)。欄は出力時シンプルのときだけ出る
    const rlCtrl = q("#rlCtrl");
    if (rlCtrl) meta.ctrlNo = rlCtrl.value.trim();
    m.close();
    await UI.runRelease({
      dxf: wantDxf, pdfIn: wantPdfIn, pdfCus: wantPdfCus, json: wantJson, pack, dpi,
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
  const pdfKinds = [];
  if (opt.pdfIn !== undefined ? opt.pdfIn : opt.pdf) pdfKinds.push("internal");
  if (opt.pdfCus !== undefined ? opt.pdfCus : opt.pdf) pdfKinds.push("customer");
  /* DXF と顧客提出用 PDF は「図枠スタイル」の設定どおり — 出力時シンプル図枠
     (meta.outPlain) なら描いている間だけ様式を差し替える。
     社内保存用 PDF は常に JIS 標準図枠のまま残す (シンプルは提出物だけ)。
     ページ構成も様式も同じになるとき (仕様のページが無い・シンプル切替なし)
     は 1 回だけ作って使い回す */
  const pdfMade = new Map();
  const buildKind = async (kind) => {
    const label = releaseKindLabel(kind);
    const list = releasePages(kind, pages);
    const name = safe(`${pdfBaseName(now)}_${label}.pdf`);   // 日付_顧客名_装置名_版
    const key = list.map(pg => pages.indexOf(pg)).join(",") + "|" + frameStyle();
    if (pdfMade.has(key)) { out.push({ name, data: pdfMade.get(key) }); return; }
    if (!list.length) { UI.setMsg(`PDF (${label}) に載せるページがありません`); return; }
    UI.setMsg(`PDF (${label}) を作っています… (ページ数が多いと少しかかります)`);
    try {
      const blob = await withReleaseProject(kind, pgs => buildPDF(pgs, { dpi: opt.dpi || 200,
        onProgress: (i, n) => UI.setMsg(`PDF (${label}) を作っています… ${i + 1}/${n} ページ`) }));
      out.push({ name, data: blob });
      pdfMade.set(key, blob);
    } catch (e) {
      UI.setMsg(`PDF (${label}) の作成に失敗しました — 他の形式だけ出力します`);
    }
  };
  if (opt.dxf) {
    await withOutputFrame(async () => {
      pages.forEach(pg => out.push({ name: safe(`${base}_p${pg.no}_${pg.name}.dxf`), data: dxfBytes(pageToDXF(pg)) }));
    });
  }
  if (pdfKinds.includes("internal")) await buildKind("internal");   // JIS のまま
  if (pdfKinds.includes("customer")) await withOutputFrame(() => buildKind("customer"));
  if (opt.dxf || pdfKinds.length) applySheet(curPage());   // 図枠を画面用 (JIS) に戻す

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
  /* 出図が済んだ案件は「作業中」の一覧から外す — 図面は設計完了履歴に
     保存済みで、「設計完了履歴 → 開く」からいつでも戻せる。
     マスターファイルの枠 (標準回路のひな型) は消さない */
  const wid = wipCurrent();
  const wEntry = wipList().find(r => r.id === wid);
  if (wEntry && !wEntry.master) {
    wipSaveList(wipList().filter(r => r.id !== wid));
    wipSetCurrent("");
    relDelSnapshot(wid);                 // 中身の削除は待たない
  } else if (wEntry) {
    wipSetCurrent("");
  }
  await UI.newProject({ fromRelease: true });
  UI.toast(`出図した「${entry.project}」は設計完了履歴に保存し、作業中の一覧からは外しました — 新しい図面から始められます`, 6000);
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
    /* 今の図面を作業中へ退避してから開く — 開いた図面は新しい作業中の
       枠として登録する。登録しないと、ヘッダの作業中名が前の図面のまま
       になり、次の一時保存が前の図面の枠を上書きしてしまう (relActOpen) */
    rows.querySelectorAll(".rl-open").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, async (p, r) => {
      if (await relActOpen(p, r)) m.close();
    })));
    // 履歴の図面で一時的に差し替えて DXF を作り、元に戻す (様式もその図面の設定どおり)
    rows.querySelectorAll(".rl-dxf").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, (p, r) => relActDxf(p, r))));
    rows.querySelectorAll(".rl-json").forEach(b => b.addEventListener("click", () => withSnap(b.dataset.id, (p, r) => relActJson(p, r))));
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

/* ── 設計完了ページ (閲覧専用) ─────────────────────────────
   設計完了した図面を、今の作業を離れずに見るだけのページ。図面は履歴の写し
   (スナップショット) を画面用 SVG に描く — 編集はできない (作業中へ開くのは
   履歴の「開く」と同じ) */
/** 履歴の図面 1 ページを画面用 SVG にする。描いている間だけ App.project を差し替える */
function relPageSVG(project, idx) {
  const keep = App.project, keepIdx = App.pageIdx;
  App.project = project; App.pageIdx = Math.max(0, Math.min(idx, project.pages.length - 1));
  try {
    mergeProjectSymbols();                       // 図面に同梱の自作記号を辞書へ
    App.labelRev++;
    return exportSheetSVG(project.pages[App.pageIdx]);
  } finally {
    App.project = keep; App.pageIdx = keepIdx;
    App.labelRev++;
    applySheet(curPage());
  }
}
UI.openReleasePage = () => {
  if (document.getElementById("relView")) return;
  let listOpen = true;
  try { listOpen = localStorage.getItem("electracad.relViewList") !== "0"; } catch (e) { /* 既定は開く */ }
  const el = h(`<div id="relView" class="rel-view${listOpen ? "" : " nolist"}">
    <div class="rel-view-head">
      <button class="btn-solid" id="rvToggle" title="一覧を出す / しまう">☰ 一覧</button>
      <button class="btn-solid" id="rvBack">← 編集画面に戻る</button>
      <div class="rel-view-title">設計完了した図面 <span class="rel-dim" style="font-weight:400">— 閲覧専用</span></div>
      <span style="flex:1"></span>
      <button class="btn-solid" id="rvHist">履歴の管理…</button>
    </div>
    <div class="rel-view-body">
      <div class="rel-view-list" id="rvList"></div>
      <div class="rel-view-main" id="rvMain"><div class="se-empty" style="padding:24px">左の一覧から図面を選んでください</div></div>
    </div></div>`);
  document.body.append(el);
  const st = { id: null, p: null, r: null, idx: 0, zoom: 0, fit: "page" };   // zoom 0 = 自動 (fit: "page" 全体 / "width" 幅)
  // 一覧 (サイドバー) の出し入れ。しまった状態は次回も覚えておく
  el.querySelector("#rvToggle").addEventListener("click", () => {
    el.classList.toggle("nolist");
    try { localStorage.setItem("electracad.relViewList", el.classList.contains("nolist") ? "0" : "1"); } catch (e) { /* 無視 */ }
    if (st.p && !st.zoom) renderPage();           // 幅に合わせているときは描き直す
  });
  const renderList = () => {
    const list = relList();
    const box = el.querySelector("#rvList");
    if (!list.length) { box.innerHTML = '<div class="se-empty" style="padding:24px">まだ設計完了した図面はありません</div>'; return; }
    box.innerHTML = list.map(r => `<div class="rel-view-item${r.id === st.id ? " on" : ""}" data-id="${r.id}">
      <div><b>${escXML(r.project)}</b> <span class="rel-dim">Rev ${escXML(r.rev)} / 第 ${r.seq} 版</span></div>
      <div class="mono rel-dim">${escXML(r.stamp)}${r.by ? " / " + escXML(r.by) : ""}</div>
      <div class="rel-dim">${r.pages} ページ / 機器 ${r.devices} / 配線 ${r.wires}${r.saved === false ? ' / <span class="rel-bad">図面データなし</span>' : ""}</div>
      ${r.note ? `<div class="rel-dim">${escXML(r.note)}</div>` : ""}</div>`).join("");
    box.querySelectorAll(".rel-view-item").forEach(it => it.addEventListener("click", () => open(it.dataset.id)));
  };
  /* 図面の表示。ツールバーとページのタブは高さを固定し (1 行・折り返さない)、
     ページを替えても図面の左上の位置とスクロール位置が動かないようにする */
  const renderPage = () => {
    if (!st.p) return;
    const pg = st.p.pages[st.idx];
    const svg = relPageSVG(st.p, st.idx);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const W = vb ? +vb[1] : 420, H = vb ? +vb[2] : 297;
    const prevSheet = el.querySelector("#rvSheet");
    /* 自動の倍率: 「全体」は用紙全体が画面に収まる倍率 (縦横の小さいほう)。尺度 1:1.5 の
       ページは作図領域が広く用紙の縦横比も違うので、幅だけで合わせると下が切れる。
       「幅」は横幅いっぱい (縦にスクロールして読む)。初めて描くときは画面の寸法を
       ツールバー・タブの高さを引いて見積もる */
    const main = el.querySelector("#rvMain");
    const sheetW = (prevSheet ? prevSheet.clientWidth : main.clientWidth) - 32;
    const sheetH = (prevSheet ? prevSheet.clientHeight : main.clientHeight - 74) - 32;
    const scroll = prevSheet ? { x: prevSheet.scrollLeft, y: prevSheet.scrollTop } : { x: 0, y: 0 };
    const kFit = st.fit === "width" ? sheetW / W : Math.min(sheetW / W, sheetH / H);
    const k = st.zoom || Math.max(0.05, kFit);
    const px = Math.round(W * k), py = Math.round(H * k);
    const svg2 = svg.replace(/^<\?xml[^>]*>\s*/, "").replace(/width="[^"]*" height="[^"]*"/, `width="${px}" height="${py}"`);
    const n = st.p.pages.length;
    main.innerHTML = `
      <div class="rel-view-bar">
        <span class="rel-view-name" title="${escAttr(st.r.project)} Rev ${escAttr(st.r.rev)} / ${escAttr(st.r.stamp)}"><b>${escXML(st.r.project)}</b> <span class="rel-dim">Rev ${escXML(st.r.rev)} / ${escXML(st.r.stamp)}</span></span>
        <span class="rel-view-nav">
          <button class="btn-solid" id="rvPrev" title="前のページ (←)" ${st.idx === 0 ? "disabled" : ""}>◀</button>
          <span class="mono">${st.idx + 1} / ${n}</span>
          <button class="btn-solid" id="rvNext" title="次のページ (→)" ${st.idx >= n - 1 ? "disabled" : ""}>▶</button>
          <span class="mono rel-view-pgname">${escXML(pageDwgNoOf(st.p, pg))} ${escXML(pg.name || "")}</span>
        </span>
        <span style="flex:1"></span>
        <button class="btn-solid" id="rvZoomOut" title="縮小">−</button><button class="btn-solid${!st.zoom && st.fit === "page" ? " on" : ""}" id="rvZoomPage" title="用紙全体を画面に収める (尺度が違っても同じ)">全体</button><button class="btn-solid${!st.zoom && st.fit === "width" ? " on" : ""}" id="rvZoomFit" title="幅に合わせる">幅</button><button class="btn-solid" id="rvZoomIn" title="拡大">＋</button>
        <span style="width:10px"></span>
        <button class="btn-solid" id="rvDxf" title="この図面の DXF を出し直す">DXF</button><button class="btn-solid" id="rvJson" title="この図面の JSON を書き出す">JSON</button><button class="btn-solid" id="rvEdit" title="作業中に開いて編集する (確認が出ます)">編集…</button>
      </div>
      <div class="rel-view-tabs" id="rvPages">${st.p.pages.map((q, i) => `<div class="ptab${i === st.idx ? " active" : ""}" data-i="${i}" title="図番 ${escAttr(pageDwgNoOf(st.p, q))}"><span class="ptab-no">${i + 1}</span><span>${escXML(q.name || "")}</span></div>`).join("")}</div>
      <div class="rel-view-sheet" id="rvSheet"><div class="rel-view-center">${svg2}</div></div>`;
    const sheet = main.querySelector("#rvSheet");
    sheet.scrollLeft = scroll.x; sheet.scrollTop = scroll.y;       // ページを替えても同じ場所を見続ける
    const act = main.querySelector("#rvPages .ptab.active");
    if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest", inline: "nearest" });
    main.querySelector("#rvPrev").addEventListener("click", () => { st.idx = Math.max(0, st.idx - 1); renderPage(); });
    main.querySelector("#rvNext").addEventListener("click", () => { st.idx = Math.min(st.p.pages.length - 1, st.idx + 1); renderPage(); });
    main.querySelectorAll("#rvPages .ptab").forEach(b => b.addEventListener("click", () => { st.idx = +b.dataset.i; renderPage(); }));
    main.querySelector("#rvZoomIn").addEventListener("click", () => { st.zoom = (st.zoom || k) * 1.25; renderPage(); });
    main.querySelector("#rvZoomOut").addEventListener("click", () => { st.zoom = Math.max(0.1, (st.zoom || k) / 1.25); renderPage(); });
    main.querySelector("#rvZoomFit").addEventListener("click", () => { st.zoom = 0; st.fit = "width"; renderPage(); });
    main.querySelector("#rvZoomPage").addEventListener("click", () => { st.zoom = 0; st.fit = "page"; renderPage(); });
    main.querySelector("#rvDxf").addEventListener("click", () => relActDxf(st.p, st.r));
    main.querySelector("#rvJson").addEventListener("click", () => relActJson(st.p, st.r));
    main.querySelector("#rvEdit").addEventListener("click", async () => { if (await relActOpen(st.p, st.r)) close(); });
  };
  const open = async (id) => {
    const r = relList().find(x => x.id === id);
    if (!r) return;
    const p = await relGetSnapshot(id);
    if (!p) { alert("この履歴の図面データが見つかりません (ブラウザのデータが消去された可能性があります)"); return; }
    st.id = id; st.p = p; st.r = r; st.idx = 0; st.zoom = 0;
    renderList(); renderPage();
  };
  const onKey = (e) => {
    if (document.getElementById("overlay-root").children.length) return;   // 上にダイアログがあれば譲る
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight" && st.p) { st.idx = Math.min(st.p.pages.length - 1, st.idx + 1); renderPage(); }
    else if (e.key === "ArrowLeft" && st.p) { st.idx = Math.max(0, st.idx - 1); renderPage(); }
  };
  // 画面の大きさが変わったら、自動の倍率のときは描き直す
  const onResize = () => { if (st.p && !st.zoom) renderPage(); };
  const close = () => { document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", onResize); el.remove(); };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  el.querySelector("#rvBack").addEventListener("click", close);
  el.querySelector("#rvHist").addEventListener("click", () => UI.openReleaseHistory());
  renderList();
  // 1 件しか無ければそれを開いておく
  const list = relList();
  if (list.length === 1) open(list[0].id);
  return { open, close, state: st };
};
/** 履歴の図面のページの図番 (写しの図面に対して引く — 表題欄と同じ値) */
function pageDwgNoOf(project, pg) {
  const keep = App.project; App.project = project;
  try { return pageDwgNo(pg); } finally { App.project = keep; }
}
/** 履歴の図面を「作業中」に開く (履歴ダイアログの「開く」と同じ)。開いたら true */
async function relActOpen(p, r) {
  if (!confirm(`${r.stamp} の図面を開いて「作業中」に追加します。\n今の図面は作業中へ退避します。よろしいですか？`)) return false;
  await wipStashCurrent();
  commit();
  App.project = p;
  mergeProjectSymbols(); migrateFrameStyle();
  App.pageIdx = 0;
  App.selection.clear();
  UI.renumberPages();
  applySheet();
  document.getElementById("projectName").value = App.project.name;
  await UI.wipSave({ asNew: true });
  UI.refresh();
  zoomFit();
  UI.setMsg(`設計完了履歴 (${r.stamp}) の図面を開き、作業中に追加しました`);
  return true;
}
/** 履歴の図面の DXF を出し直す (様式はその図面の設定どおり) */
async function relActDxf(p, r) {
  const keep = App.project, keepIdx = App.pageIdx;
  App.project = p; App.pageIdx = 0;
  const base = `${(r.project || "図面").replace(/[\\/:*?"<>|]/g, "_")}_rev${r.rev}`;
  const files = await withOutputFrame(() => p.pages.map(pg =>
    ({ name: `${base}_p${pg.no}_${pg.name}.dxf`.replace(/[\\/:*?"<>|]/g, "_"), data: dxfBytes(pageToDXF(pg)) })));
  App.project = keep; App.pageIdx = keepIdx;
  applySheet(curPage());
  files.forEach((f, i) => setTimeout(() => downloadFile(f.name, f.data, "application/dxf"), i * 350));
  UI.setMsg(`履歴 (${r.stamp}) の DXF を ${p.pages.length} ファイル出力します`);
}
function relActJson(p, r) {
  downloadFile(`${(r.project || "図面").replace(/[\\/:*?"<>|]/g, "_")}_rev${r.rev}.ecad.json`, JSON.stringify(p, null, 1));
}

/** 設計完了ボタンに履歴件数を出す */
UI.updateReleaseBadge = () => {
  const el = document.getElementById("relCount");
  if (!el) return;
  const n = relList().length;
  el.textContent = n ? String(n) : "";
  el.style.display = n ? "" : "none";
};
