/* 作業中の図面 (一時保存) — 案件を並行して進められること。

   ・chip      : ヘッダに「作業中」ボタンがあり、押すと一覧が出る
   ・saveSlot  : 今の図面を一時保存すると一覧に載る (ページ数などの要約つき)
   ・switch    : 別の案件を開くと図面が入れ替わる。開く前に今の図面は
                 自動で一時保存されるので、戻ると続きから描ける
   ・overwrite : 開いている枠へ上書きできる (枠が増えない)
   ・rename    : 名前を変えられる
   ・del       : 消せる (中身も消える)
   ・reload    : 再読み込みしても一覧と中身が残る
   ・newKeeps  : 「新規」で作り直しても、作業中に入れた図面は残っている */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
await p.evaluate(() => {
  localStorage.removeItem("electracad.wip.list");
  localStorage.removeItem("electracad.wip.cur");
});

const R = {};
R.chip = await p.evaluate(() => {
  const el = document.getElementById("btnWip");
  return { exists: !!el, label: el && el.textContent.trim() };
});

// ── 案件 A を作って一時保存 ──
R.saveSlot = await p.evaluate(async () => {
  App.project = newProject("案件A"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  addDevice(pg, "coil", 100, 100, { tag: "-KA" });
  const id = await UI.wipSave();
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  return { id, n: list.length, name: list[0] && list[0].name, pages: list[0] && list[0].pages,
    devices: list[0] && list[0].devices, cur: localStorage.getItem("electracad.wip.cur"),
    chip: ((document.getElementById("btnWip") || {}).textContent || "").trim() };
});

// ── 案件 B へ (新規 → 別枠で一時保存) → 案件 A に戻る ──
R.switch = await p.evaluate(async () => {
  window.confirm = () => true;
  await UI.newProject();
  App.project.name = "案件B"; UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  addDevice(pg, "lamp", 140, 100, { tag: "-PB" });
  addDevice(pg, "lamp", 160, 100, { tag: "-PB2" });
  const idB = await UI.wipSave({ asNew: true, name: "案件B" });
  // 保存した後の続き (一時保存していない変更)。切り替えで取りこぼさないこと
  addDevice(pg, "lamp", 200, 100, { tag: "-PB4" });
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const a0 = list.find(r => r.name === "案件A");
  if (!a0) return { ok: false, n: list.length, note: "案件A が一覧に無い" };
  const idA = a0.id;
  // 案件 A へ切り替え
  const ok = await UI.wipOpen(idA);
  const aTags = App.project.pages.flatMap(p2 => p2.devices.map(d => d.tag));
  // もう一度 B へ
  await UI.wipOpen(idB);
  const bTags = App.project.pages.flatMap(p2 => p2.devices.map(d => d.tag));
  return { ok, idA, idB, aHasKA: aTags.includes("-KA"), aHasPB: aTags.includes("-PB"),
    bHasPB: bTags.includes("-PB"), bHasKA: bTags.includes("-KA"),
    bKeptEdit: bTags.includes("-PB4"),      // 保存後の続きが残っている
    n: list.length, name: App.project.name };
});

// ── 上書き (枠は増えない) ──
R.overwrite = await p.evaluate(async () => {
  const pg = App.project.pages.find(isDrawingPage);
  addDevice(pg, "lamp", 180, 100, { tag: "-PB3" });
  const before = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]").length;
  await UI.wipSave();
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const cur = list.find(r => r.id === localStorage.getItem("electracad.wip.cur"));
  return { same: list.length === before, devices: cur ? cur.devices : -1 };
});

// ── 名前を変える (一覧の画面から) ──
R.rename = await p.evaluate(async () => {
  window.prompt = () => "案件A (改)";
  UI.openWip();
  await new Promise(r => setTimeout(r, 200));
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const e = list.find(r => r.name === "案件A");
  const btn = e && document.querySelector(`[data-ren="${e.id}"]`);
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 200));
  const after = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  document.querySelectorAll(".modal-x, .mod-close").forEach(x => x.click());
  UI.closeModal && UI.closeModal();
  return { clicked: !!btn, names: after.map(r => r.name).sort() };
});

// ── 再読み込みしても残る ──
await p.reload();
await p.waitForTimeout(900);
R.reload = await p.evaluate(async () => {
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const a = list.find(r => r.name === "案件A (改)");
  if (!a) return { n: list.length, ok: false, hasKA: false, chip: "" };
  const ok = await UI.wipOpen(a.id);
  const tags = App.project.pages.flatMap(p2 => p2.devices.map(d => d.tag));
  return { n: list.length, ok, hasKA: tags.includes("-KA"),
    chip: ((document.getElementById("btnWip") || {}).textContent || "").trim() };
});

// ── 「新規」で作り直しても作業中は残る ──
R.newKeeps = await p.evaluate(async () => {
  window.confirm = () => true;
  await UI.newProject();
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  return { n: list.length, cur: localStorage.getItem("electracad.wip.cur") || "",
    chip: ((document.getElementById("btnWip") || {}).textContent || "").trim() };
});

// ── 消す (一覧の画面から) ──
R.del = await p.evaluate(async () => {
  window.confirm = () => true;
  UI.openWip();
  await new Promise(r => setTimeout(r, 200));
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const a = list.find(r => r.name === "案件A (改)");
  const btn = a && document.querySelector(`[data-del="${a.id}"]`);
  if (btn) btn.click();
  // 中身の削除は保存領域の応答待ちがあるので、少し長めに待つ
  for (let i = 0; i < 20; i++) {
    const now = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
    if (now.length < list.length) break;
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 400));
  const after = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const body = a ? await relGetSnapshot(a.id) : null;
  return { clicked: !!btn, n: after.length, body: body ? "残っている" : "消えた" };
});

const checks = {
  noPageErrors: errs.length === 0,
  chip: R.chip.exists === true && /作業中/.test(R.chip.label || ""),
  saveSlot: !!R.saveSlot.id && R.saveSlot.n === 1 && R.saveSlot.name === "案件A"
    && R.saveSlot.pages >= 4 && R.saveSlot.devices === 1 && R.saveSlot.cur === R.saveSlot.id
    && R.saveSlot.chip.includes("案件A"),
  switch: R.switch.ok === true && R.switch.n === 2
    && R.switch.aHasKA === true && R.switch.aHasPB === false
    && R.switch.bHasPB === true && R.switch.bHasKA === false
    && R.switch.bKeptEdit === true && R.switch.name === "案件B",
  overwrite: R.overwrite.same === true && R.overwrite.devices === 4,
  rename: R.rename.clicked === true && JSON.stringify(R.rename.names) === JSON.stringify(["案件A (改)", "案件B"]),
  reload: R.reload.n === 2 && R.reload.ok === true && R.reload.hasKA === true
    && R.reload.chip.includes("案件A (改)"),
  newKeeps: R.newKeeps.n === 2 && R.newKeeps.cur === "" && R.newKeeps.chip.includes("作業中"),
  del: R.del.clicked === true && R.del.n === 1 && R.del.body === "消えた",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wip-slots OK");
