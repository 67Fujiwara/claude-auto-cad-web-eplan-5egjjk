"use strict";
/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — 作業中の図面 (一時保存)

   案件をいくつも並行して進めるための仕組み。図面をブラウザの中に
   「作業中の図面」として何本でも置いておき、いつでも切り替えられる。
   ・一時保存   … 今の図面を作業中へ入れる (2 回目からは上書き)
   ・切り替え   … 別の案件を開く。開く前に今の図面は自動で一時保存する
   ・本体の保存 … 図面のデータは設計完了履歴と同じ入れ物 (IndexedDB、
                  使えなければ localStorage) に置く。一覧だけ localStorage
   ここに入れた図面はブラウザの中だけにある。人に渡す・長く残す図面は
   「保存 (JSON)」や「設計完了」でファイルに出すこと — その旨は画面にも出す。
   ═══════════════════════════════════════════════════════════════ */

const WIP_LIST_KEY = "electracad.wip.list";
const WIP_CUR_KEY = "electracad.wip.cur";

function wipList() {
  try {
    const v = JSON.parse(localStorage.getItem(WIP_LIST_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function wipSaveList(list) {
  try { localStorage.setItem(WIP_LIST_KEY, JSON.stringify(list)); } catch (e) { /* 容量超過は無視 */ }
}
/** 今開いている作業中の図面の id (無ければ "") */
function wipCurrent() {
  try { return localStorage.getItem(WIP_CUR_KEY) || ""; } catch (e) { return ""; }
}
function wipSetCurrent(id) {
  try { if (id) localStorage.setItem(WIP_CUR_KEY, id); else localStorage.removeItem(WIP_CUR_KEY); } catch (e) { }
  UI.updateWipChip();
}
/** 図面の中身の要約 (一覧に出す) */
function wipStats(project) {
  const pages = project.pages || [];
  return {
    pages: pages.length,
    devices: pages.reduce((n, p) => n + (p.devices || []).length, 0),
    wires: pages.reduce((n, p) => n + (p.wires || []).length, 0),
  };
}

/** 今の図面を作業中へ入れる。id を渡すとその枠へ上書き。返り値は id (失敗は null) */
UI.wipSave = async (opts = {}) => {
  syncProjectSymbols();
  const list = wipList();
  let id = opts.id || (opts.asNew ? "" : wipCurrent());
  let entry = list.find(r => r.id === id);
  if (!entry) {
    const name = (opts.name || App.project.name || "無題プロジェクト").trim();
    id = "wip_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    entry = { id, name };
    list.unshift(entry);
  }
  const st = wipStats(App.project);
  Object.assign(entry, { at: new Date().toISOString(), project: App.project.name, ...st });
  const ok = await relPutSnapshot(id, App.project);
  if (!ok) {
    UI.setMsg("一時保存できませんでした (ブラウザの保存領域がいっぱいの可能性があります) — ファイルに保存してください");
    return null;
  }
  entry.saved = true;
  wipSaveList(list);
  wipSetCurrent(id);
  App.dirty = false;
  return id;
};

/** 作業中の図面を開く。開く前に今の図面を一時保存する (取りこぼさない) */
UI.wipOpen = async (id) => {
  const list = wipList();
  const entry = list.find(r => r.id === id);
  if (!entry) { UI.setMsg("その図面は見つかりませんでした"); return false; }
  if (wipCurrent() && wipCurrent() !== id) await UI.wipSave();     // 今の続きを取っておく
  else if (!wipCurrent() && App.dirty &&
    confirm("今の図面はまだ作業中に入っていません。先に一時保存しますか？")) await UI.wipSave({ asNew: true });
  const p = await relGetSnapshot(id);
  if (!p || !p.pages) { UI.setMsg("図面の中身を読み出せませんでした"); return false; }
  if (App.sim.running) UI.toggleSim();
  App.project = p;
  App.fileHandle = null;
  mergeProjectSymbols();
  UI.renumberPages();
  App.pageIdx = Math.max(0, App.project.pages.findIndex(isDrawingPage));
  App.selection.clear();
  App.undoStack.length = 0;
  App.redoStack.length = 0;
  applySheet();
  document.getElementById("projectName").value = App.project.name;
  UI.updateSaveButton();
  wipSetCurrent(id);
  saveLocal();
  UI.refresh();
  zoomFit();
  UI.setMsg(`作業中の図面「${entry.name}」を開きました`);
  return true;
};

/** ヘッダの「作業中」チップに、今の案件名を出す */
UI.updateWipChip = () => {
  const el = document.getElementById("btnWip");
  if (!el) return;
  const cur = wipList().find(r => r.id === wipCurrent());
  const lab = el.querySelector(".wip-label");
  if (lab) lab.textContent = cur ? cur.name : "作業中";
  el.title = cur
    ? `作業中: ${cur.name} — クリックで一覧 (ほかの案件に切り替え)`
    : "作業中の図面 (一時保存) — 案件をいくつも並行して進められます";
  el.classList.toggle("active", !!cur);
};

/* ── 作業中の図面の一覧 ───────────────────────── */
UI.openWip = () => {
  const body = h(`<div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn-solid primary" id="wipSaveNow">今の図面を一時保存</button>
      <button class="btn-solid" id="wipSaveNew">別枠として保存…</button>
      <span style="flex:1"></span>
      <span class="rp-dim" id="wipCount" style="font-size:11.5px"></span>
    </div>
    <div id="wipRows"></div>
    <div class="prop-note" style="margin-top:10px">
      作業中の図面はこのブラウザの中に置かれます (別の PC では開けません)。
      人に渡す図面・長く残す図面は「保存 (JSON)」か「設計完了」でファイルに出してください。
    </div>
  </div>`);
  const rows = body.querySelector("#wipRows");

  function render() {
    const list = wipList();
    const cur = wipCurrent();
    body.querySelector("#wipCount").textContent = list.length ? `${list.length} 件` : "";
    if (!list.length) {
      rows.innerHTML = '<div class="se-empty" style="padding:24px">まだ一時保存した図面はありません — 「今の図面を一時保存」で入れておくと、いつでも切り替えられます</div>';
      return;
    }
    rows.innerHTML = list.map(r => {
      const on = r.id === cur;
      const when = r.at ? relStamp(new Date(r.at)) : "";
      return `<div class="wip-row" style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid ${on ? "var(--accent)" : "var(--line)"};border-radius:8px;margin-bottom:6px;background:${on ? "var(--accent-dim)" : "transparent"}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${escXML(r.name)}${on ? ' <span class="rp-dim" style="font-weight:400">(いま開いています)</span>' : ""}</div>
          <div class="rp-dim" style="font-size:11.5px">${escXML(when)} — ページ ${r.pages || 0} ・ 機器 ${r.devices || 0} ・ 配線 ${r.wires || 0}</div>
        </div>
        ${on ? `<button class="btn-solid primary" data-ov="${r.id}" style="padding:5px 10px;font-size:11.5px">上書き保存</button>`
             : `<button class="btn-solid primary" data-open="${r.id}" style="padding:5px 10px;font-size:11.5px">開く</button>`}
        <button class="btn-solid" data-ren="${r.id}" style="padding:5px 9px;font-size:11.5px">名前</button>
        <button class="btn-solid" data-del="${r.id}" style="padding:5px 9px;font-size:11.5px">削除</button>
      </div>`;
    }).join("");
    rows.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", async () => {
      const ok = await UI.wipOpen(b.dataset.open);
      if (ok) m.close();
    }));
    rows.querySelectorAll("[data-ov]").forEach(b => b.addEventListener("click", async () => {
      await UI.wipSave({ id: b.dataset.ov });
      render();
      UI.setMsg("作業中の図面を上書きしました");
    }));
    rows.querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", () => {
      const list2 = wipList();
      const e2 = list2.find(r => r.id === b.dataset.ren);
      const nm = prompt("作業中の図面の名前", e2 ? e2.name : "");
      if (nm === null || !nm.trim()) return;
      e2.name = nm.trim();
      wipSaveList(list2);
      UI.updateWipChip();
      render();
    }));
    rows.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const list2 = wipList();
      const e2 = list2.find(r => r.id === b.dataset.del);
      if (!confirm(`作業中の図面「${e2.name}」を消します。元に戻せません。よろしいですか？`)) return;
      // 先に一覧から外して画面を返す (中身の削除は保存領域が遅いと待たされるため)
      wipSaveList(list2.filter(r => r.id !== e2.id));
      if (wipCurrent() === e2.id) wipSetCurrent("");
      render();
      await relDelSnapshot(e2.id);
      UI.setMsg(`作業中の図面「${e2.name}」を消しました`);
    }));
  }
  render();

  body.querySelector("#wipSaveNow").addEventListener("click", async () => {
    const id = await UI.wipSave();
    if (id) { render(); UI.setMsg("一時保存しました (「作業中」から開き直せます)"); }
  });
  body.querySelector("#wipSaveNew").addEventListener("click", async () => {
    const nm = prompt("別枠の名前 (案件名など)", App.project.name || "");
    if (nm === null || !nm.trim()) return;
    const id = await UI.wipSave({ asNew: true, name: nm });
    if (id) { render(); UI.setMsg(`「${nm.trim()}」として一時保存しました`); }
  });

  const m = UI.openModal({
    title: "作業中の図面 (一時保存)",
    sub: "案件をいくつも並行して進められます — 開く前に今の図面は自動で一時保存します",
    body, wide: true,
  });
};
