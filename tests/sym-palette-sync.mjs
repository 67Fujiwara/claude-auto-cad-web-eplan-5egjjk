/* 自作シンボルのパレット自動反映。

   図面に埋め込まれた自作シンボルは案件を開いたときに取り込まれるが、
   以前はピンを打った場合しかパレットを描き直さず、棚 (分類) を割り当てた
   記号は「パレットに出ない・データベースで外す→追加すると出る」だった。

   ・setup   : エディタの実 UI で登録 → パレットに出る。ユーザー棚へ移せる
   ・stale   : ブラウザ保存 (importedSyms) が失われた状態で案件を開くと、
              埋め込みシンボルが取り込まれ、その場でパレットの棚に出る
   ・persist : 取り込んだシンボルはブラウザへ保存し直され、埋め込みの無い
              別案件へ切り替えて開き直してもパレットに残る
   ・master  : マスター呼び出し (insertMasterPages) でもパレットに出る
   ・boot    : ブラウザ保存の版と、自動保存の図面に埋め込まれた別の絵の
              同 id が衝突したら、ブラウザ保存の絵が勝ち、図面側は別版に
              付け替わる (編集した最新の絵が起動で消えない)
   ・quota   : ブラウザへ保存できないときは黙って失わず、一度だけ知らせる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
const url = `file://${new URL("../index.html", import.meta.url).pathname}`;
const boot = async () => { await p.goto(url); await p.waitForTimeout(900); };
await boot();

const palHas = () => p.evaluate(() =>
  [...document.querySelectorAll("#symTree .sym-name")].some(el => el.textContent === "パレット確認機"));
const shelfHas = () => p.evaluate(() =>
  [...document.querySelectorAll("#symTree .sym-cat")].some(c =>
    c.textContent.includes("CADてすと") && c.textContent.includes("パレット確認機")));

/* ── setup: 実 UI で登録 → ユーザー棚へ。図面に置いて JSON へ埋め込む ── */
const A = await p.evaluate(async () => {
  App.project = newProject("シンボル持ち案件"); UI.renumberPages();
  UI.openSymbolEditor();
  SymEdit.shapes.push({ t: "rect", x: -10, y: -10, w: 20, h: 20 });
  document.getElementById("seName").value = "パレット確認機";
  window.confirm = () => true;
  document.getElementById("seOk").click();
  await new Promise(r => setTimeout(r, 200));
  const sym = [...DB_SYMBOLS].reverse().find(s => s.name === "パレット確認機");
  const inPal = [...document.querySelectorAll("#symTree .sym-name")].some(el => el.textContent === "パレット確認機");
  const cid = addUserCat("CADてすと");
  setSymCat(sym.id, cid);
  UI.buildPalette();
  const pg = App.project.pages.find(isDrawingPage);
  addDevice(pg, sym.id, 100, 100, {});
  syncProjectSymbols();
  const json = JSON.stringify(App.project);
  // 自動保存は「シンボルの無い空の案件」にして、ブラウザ保存も失わせる
  // (別の PC で開いた・保存容量あふれ、を再現)
  App.project = newProject("空の案件"); flushAutosave();
  localStorage.removeItem("electracad.importedSyms");
  window.__json = json;
  sessionStorage.setItem("t.json", json);
  return { id: sym.id, inPal, embedded: JSON.parse(json).symbols.some(s => s.id === sym.id) };
});

/* ── stale: 開き直し → パレットに無い → 案件を開くとその場で棚に出る ── */
await boot();
const B1 = { gone: !(await palHas()), inDb: await p.evaluate(id => !!SYMBOLS_BY_ID[id], A.id) };
const B2 = await p.evaluate(() => {
  wipShowProject(JSON.parse(sessionStorage.getItem("t.json")));
  let saved = false;
  try { saved = (localStorage.getItem("electracad.importedSyms") || "").includes("パレット確認機"); } catch (e) { }
  return { saved };
});
const B = { ...B1, ...B2, inPal: await palHas(), inShelf: await shelfHas() };

/* ── persist: 埋め込みの無い案件に替えて開き直しても残る ── */
await p.evaluate(() => { App.project = newProject("別の空案件"); flushAutosave(); });
await boot();
const C = { inPal: await palHas(), inShelf: await shelfHas() };

/* ── master: ブラウザ保存を失わせて開き直し → マスター呼び出しで出る ── */
await p.evaluate(() => { localStorage.removeItem("electracad.importedSyms"); });
await boot();
const D0 = { gone: !(await palHas()) };
const D = await p.evaluate(() => {
  const master = JSON.parse(sessionStorage.getItem("t.json"));
  const di = master.pages.findIndex(pg => (pg.devices || []).some(d => String(d.sym).startsWith("usr_")));
  insertMasterPages(master, [di], App.project.pages.length);
  return { gone0: true,
    inPal: [...document.querySelectorAll("#symTree .sym-name")].some(el => el.textContent === "パレット確認機") };
});
D.gone0 = D0.gone;

/* ── boot: ブラウザ保存の絵 (rect) と、自動保存の埋め込みの別の絵 (circle)
      が同じ id → 起動後はブラウザ保存の絵が勝ち、図面側は別版へ ── */
const E0 = await p.evaluate(id => {
  const mine = SYMBOLS_BY_ID[id];                       // rect の版 (ブラウザ保存済み)
  saveImportedSymbols();
  const proj = JSON.parse(sessionStorage.getItem("t.json"));
  const other = { ...JSON.parse(JSON.stringify(mine)),  // 同 id・別の絵
    body: '<circle cx="0" cy="0" r="8"/>', shapes: [{ t: "circle", cx: 0, cy: 0, r: 8 }] };
  proj.symbols = [other];
  localStorage.setItem(LS_KEY, JSON.stringify(proj));
  localStorage.setItem(LS_KEY + ".ok", "1");
  // ページを離れるときの自動保存で、今作った「衝突する自動保存」を
  // 上書きしないよう黙らせる (このテストの仕掛けを守るためだけ)
  flushAutosave = () => { };
  _writeAutosave = () => { };
  return { body0: mine.body };
}, A.id);
await boot();
const E = await p.evaluate(({ id, body0 }) => {
  const dev = App.project.pages.flatMap(pg => pg.devices || []).find(d => symBaseIdOf(d.sym) === id);
  return { keep: SYMBOLS_BY_ID[id] && SYMBOLS_BY_ID[id].body === body0,
    remapped: dev && dev.sym !== id,
    devCircle: dev && (SYMBOLS_BY_ID[dev.sym].body || "").includes("circle") };
}, { id: A.id, body0: E0.body0 });

/* ── quota: 保存できないときは一度だけ知らせる ── */
const F = await p.evaluate(() => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === "electracad.importedSyms") throw new Error("QuotaExceededError");
    return orig.apply(this, arguments);
  };
  saveImportedSymbols();
  const msg = document.getElementById("stMsg").textContent;
  document.getElementById("stMsg").textContent = "";
  saveImportedSymbols();                          // 2 回目は繰り返さない
  const again = document.getElementById("stMsg").textContent;
  Storage.prototype.setItem = orig;
  return { warned: /保存できません/.test(msg), once: again === "" };
});

const checks = {
  noPageErrors: errs.length === 0,
  setup: A.inPal === true && A.embedded === true,
  stale: B.gone === true && B.inDb === false && B.inPal === true && B.inShelf === true,
  persist: B.saved === true && C.inPal === true && C.inShelf === true,
  master: D.gone0 === true && D.inPal === true,
  boot: E.keep === true && E.remapped === true && E.devCircle === true,
  quota: F.warned === true && F.once === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, A, B, C, D, E, F, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("sym-palette-sync OK");
