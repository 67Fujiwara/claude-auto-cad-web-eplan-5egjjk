/* マスターファイル (標準回路のひな型) と図面の追加・コピー。

   ・dialogBtns: 一覧に「新しい図面を追加…」「マスターとして保存…」がある
   ・addFile   : 新しい図面を追加すると枠が増えてそれが開く。前の図面は
                 自動で一時保存されて残る
   ・masterSave: 今の図面をマスターとして保存できる (master の印が付く)
   ・masterRow : 一覧でマスターは先頭にまとまり、「マスター」の札と
                 「コピーして開く」が出る。普通の枠には「コピー」が出る
   ・masterCopy: 別のファイルを開いているところからマスターをコピーして
                 新しい案件を始められる。コピーには機器が入っている
   ・masterKeep: コピーしてもマスター本体は変わらない (名前も中身もそのまま)
   ・masterFirst: コピーで新しい枠が増えた後も、一覧はマスターが先頭
   ・chipBadge : マスターを開いている間はヘッダの「作業中」チップに金色の
                 「マスター」札が出る。普通の案件に切り替えると消える */
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
R.dialogBtns = await p.evaluate(async () => {
  UI.openWip();
  await new Promise(r => setTimeout(r, 150));
  const out = { add: !!document.getElementById("wipAddNew"),
    master: !!document.getElementById("wipAddMaster") };
  document.querySelectorAll(".modal-close").forEach(x => x.click());
  return out;
});

// ── 案件Aを作って一時保存 → 「新しい図面を追加」 ──
R.addFile = await p.evaluate(async () => {
  window.confirm = () => true;
  App.project = newProject("案件A"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  addDevice(pg, "coil", 100, 100, { tag: "-RYA" });
  await UI.wipSave({ asNew: true, name: "案件A" });
  const id = await UI.wipNew({ name: "案件C" });
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  return { id, n: list.length, name: App.project.name,
    aKept: list.some(r => r.name === "案件A"),
    empty: App.project.pages.reduce((n2, p2) => n2 + p2.devices.length, 0) === 0,
    cur: localStorage.getItem("electracad.wip.cur") };
});

// ── 標準回路を描いてマスターとして保存 ──
R.masterSave = await p.evaluate(async () => {
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  addDevice(pg, "mcb2", 100, 100, { tag: "-NFB1" });
  addDevice(pg, "coil", 140, 100, { tag: "-RY1" });
  const id = await UI.wipSaveMaster({ name: "標準回路M" });
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const e = list.find(r => r.id === id);
  return { id, master: !!(e && e.master), devices: e && e.devices };
});

// ── 一覧の見た目 (マスターが先頭・札・ボタン) ──
R.masterRow = await p.evaluate(async () => {
  UI.openWip();
  await new Promise(r => setTimeout(r, 150));
  const rows = [...document.querySelectorAll("#wipRows .wip-row")];
  const first = rows[0] ? rows[0].textContent : "";
  const out = {
    firstIsMaster: first.includes("マスター") && first.includes("標準回路M"),
    copyOpen: !!document.querySelector('#wipRows [data-copy]') && first.includes("コピーして開く"),
    normalCopy: rows.slice(1).some(r2 => r2.textContent.includes("コピー") && !r2.textContent.includes("コピーして開く")),
  };
  document.querySelectorAll(".modal-close").forEach(x => x.click());
  return out;
});

// ── 別のファイル (案件A) からマスターをコピーして新案件を始める ──
R.masterCopy = await p.evaluate(async () => {
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const a = list.find(r => r.name === "案件A");
  const master = list.find(r => r.master);
  if (!a || !master) return { nid: null, isNew: false, n: -1, note: "マスターが一覧に無い" };
  await UI.wipOpen(a.id);
  const nid = await UI.wipCopy(master.id, { name: "新案件D" });
  const list2 = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const tags = App.project.pages.flatMap(p2 => p2.devices.map(d => d.tag));
  return { nid, isNew: nid !== master.id, n: list2.length,
    name: App.project.name, cur: localStorage.getItem("electracad.wip.cur"),
    hasNFB: tags.includes("-NFB1"), hasRY: tags.includes("-RY1"), noA: !tags.includes("-RYA") };
});

// ── マスター本体は変わらない ──
R.masterKeep = await p.evaluate(async () => {
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const master = list.find(r => r.master);
  if (!master) return { stillMaster: false, note: "マスターが一覧に無い" };
  const body = await relGetSnapshot(master.id);
  return { stillMaster: !!master.master, name: master.name,
    bodyName: body && body.name,
    devices: body ? body.pages.reduce((n2, p2) => n2 + p2.devices.length, 0) : -1 };
});

// ── コピーで新しい枠が先頭に来ても、一覧ではマスターが先頭にまとまる ──
R.masterFirst = await p.evaluate(async () => {
  UI.openWip();
  await new Promise(r => setTimeout(r, 150));
  const rows = [...document.querySelectorAll("#wipRows .wip-row")];
  const out = { n: rows.length, first: rows[0] ? rows[0].textContent.includes("標準回路M") : false };
  document.querySelectorAll(".modal-close").forEach(x => x.click());
  return out;
});

// ── マスターを開いている間はヘッダに目印 ──
R.chipBadge = await p.evaluate(async () => {
  const chip = () => {
    const el = document.getElementById("btnWip");
    const badge = el.querySelector(".wip-master-badge");
    return { badge: !!badge && !badge.hidden, master: el.classList.contains("master"),
      title: el.title };
  };
  const before = chip();                          // いまは 新案件D (普通の案件)
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const master = list.find(r => r.master);
  if (!master) return { before, note: "マスターが一覧に無い" };
  await UI.wipOpen(master.id);
  const on = chip();
  const a = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]").find(r => r.name === "案件A");
  await UI.wipOpen(a.id);
  const after = chip();
  return { before, on, after };
});

// ── マスターに書いた自動ルール (線番・電線仕様) が新規図面へ引き継がれる ──
R.masterRules = await p.evaluate(async () => {
  const list = JSON.parse(localStorage.getItem("electracad.wip.list") || "[]");
  const master = list.find(r => r.master);
  if (!master) return { note: "マスターが無い" };
  await UI.wipOpen(master.id);
  projectMeta().wireSpecs = { on: true, earth: "IV 3.5sq G/Y", main: "KIV 5.5sq BK",
    dc24: "KIV 0.5sq BL", ctrl: "KIV 0.75sq Y" };
  projectMeta().numFromPins = false;
  await UI.wipSave();
  // 「新しい図面を追加」→ ルールが乗っている
  const idN = await UI.wipNew({ name: "ルール引き継ぎ" });
  const gotNew = { spec: wireSpecRules().main, num: projectMeta().numFromPins };
  // 「新規」ボタン → こちらも乗っている
  window.confirm = () => true;
  await UI.newProject();
  const gotBtn = { spec: wireSpecRules().main, num: projectMeta().numFromPins };
  return { idN: !!idN, gotNew, gotBtn };
});

const checks = {
  noPageErrors: errs.length === 0,
  dialogBtns: R.dialogBtns.add === true && R.dialogBtns.master === true,
  addFile: !!R.addFile.id && R.addFile.n === 2 && R.addFile.name === "案件C"
    && R.addFile.aKept === true && R.addFile.empty === true && R.addFile.cur === R.addFile.id,
  masterSave: !!R.masterSave.id && R.masterSave.master === true && R.masterSave.devices === 2,
  masterRow: R.masterRow.firstIsMaster === true && R.masterRow.copyOpen === true
    && R.masterRow.normalCopy === true,
  masterCopy: R.masterCopy.isNew === true && R.masterCopy.n === 4
    && R.masterCopy.name === "新案件D" && R.masterCopy.cur === R.masterCopy.nid
    && R.masterCopy.hasNFB === true && R.masterCopy.hasRY === true && R.masterCopy.noA === true,
  masterKeep: R.masterKeep.stillMaster === true && R.masterKeep.name === "標準回路M"
    && R.masterKeep.bodyName === "標準回路M" && R.masterKeep.devices === 2,
  masterFirst: R.masterFirst.n === 4 && R.masterFirst.first === true,
  chipBadge: R.chipBadge.before.badge === false && R.chipBadge.before.master === false
    && R.chipBadge.on.badge === true && R.chipBadge.on.master === true
    && /マスターファイル/.test(R.chipBadge.on.title)
    && R.chipBadge.after.badge === false && R.chipBadge.after.master === false,
  masterRules: R.masterRules.idN === true
    && R.masterRules.gotNew.spec === "KIV 5.5sq BK" && R.masterRules.gotNew.num === false
    && R.masterRules.gotBtn.spec === "KIV 5.5sq BK" && R.masterRules.gotBtn.num === false,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wip-master OK");
