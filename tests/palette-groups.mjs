/* パレットの棚 (分類) を自分で追加できること。

   ・addCat    : 「＋ 棚を追加」で棚が増え、保存 (localStorage) される
   ・inPalette : 記号をその棚へ移すと、左のパレットにその棚が出る
   ・selectNew : データベースの分類プルダウンから「新しい棚をつくる」で
                 棚を作ってそのまま移せる
   ・renameCat : 棚の名前を変えられる (標準の棚は変えられない)
   ・delCat    : 棚を消すと、中の記号は元の棚へ戻る
   ・persist   : 再読み込みしても棚と割り当てが残る
   ・dupName   : 同じ名前の棚は作れない */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = {};
R.addCat = await p.evaluate(() => {
  const before = Object.keys(allCats()).length;
  const id = addUserCat("空圧機器", "#5ccfe6");
  const stored = JSON.parse(localStorage.getItem("electracad.userCats") || "{}");
  return { id, grew: Object.keys(allCats()).length === before + 1,
    name: allCats()[id] && allCats()[id].name, stored: !!stored[id], isUser: isUserCat(id) };
});

R.inPalette = await p.evaluate((cid) => {
  setSymCat("pb_no", cid);
  UI.buildPalette("");
  const heads = [...document.querySelectorAll("#symTree .sym-cat-head")].map(e => e.textContent.replace(/\s+/g, " ").trim());
  const shelf = heads.find(t => t.includes("空圧機器"));
  return { shelf: shelf || "", cat: symCatOf(symOf("pb_no")),
    moved: !heads.some(t => t.includes("インプット機器") && t.includes("押しボタン")) };
}, R.addCat.id);

// ── データベースの分類プルダウンから棚を作る ──
R.selectNew = await p.evaluate(async () => {
  window.prompt = () => "自社標準";
  UI.openSymDB();
  await new Promise(r => setTimeout(r, 250));
  const sel = document.querySelector('[data-cat="coil"]');
  sel.value = "__new__";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const cid = symCatOf(symOf("coil"));
  const out = { name: (allCats()[cid] || {}).name, user: isUserCat(cid) };
  UI.closeModal && UI.closeModal();
  document.querySelectorAll(".modal-close, .mod-x").forEach(x => x.click());
  return out;
});

R.dupName = await p.evaluate(() => ({ same: addUserCat("空圧機器"), empty: addUserCat("   ") }));

R.renameCat = await p.evaluate((cid) => {
  const ok = renameUserCat(cid, "空圧・油圧", "#ffb454");
  const bad = renameUserCat("input", "だめ");         // 標準の棚は変えられない
  UI.buildPalette("");
  const heads = [...document.querySelectorAll("#symTree .sym-cat-head")].map(e => e.textContent);
  return { ok, bad, shown: heads.some(t => t.includes("空圧・油圧")), name: allCats()[cid].name };
}, R.addCat.id);

// ── 再読み込みしても残る ──
await p.reload();
await p.waitForTimeout(900);
R.persist = await p.evaluate((cid) => ({
  cat: allCats()[cid] ? allCats()[cid].name : "",
  sym: symCatOf(symOf("pb_no")) === cid,
}), R.addCat.id);

R.delCat = await p.evaluate((cid) => {
  setSymCat("pb_nc", cid);                     // 2 点入れてから消す (件数が固定値でないこと)
  const moved = deleteUserCat(cid);
  UI.buildPalette("");
  const heads = [...document.querySelectorAll("#symTree .sym-cat-head")].map(e => e.textContent);
  const stored = JSON.parse(localStorage.getItem("electracad.symCats") || "{}");
  return { moved, gone: !allCats()[cid], back: symCatOf(symOf("pb_no")),
    // 消した棚を指す割り当てが保存に残っていないこと
    dangling: Object.values(stored).filter(v => v === cid).length,
    shelfGone: !heads.some(t => t.includes("空圧")) };
}, R.addCat.id);

const checks = {
  noPageErrors: errs.length === 0,
  addCat: !!R.addCat.id && R.addCat.grew && R.addCat.name === "空圧機器" && R.addCat.stored && R.addCat.isUser,
  inPalette: R.inPalette.cat === R.addCat.id && R.inPalette.shelf.includes("空圧機器"),
  selectNew: R.selectNew.name === "自社標準" && R.selectNew.user === true,
  dupName: R.dupName.same === null && R.dupName.empty === null,
  renameCat: R.renameCat.ok === true && R.renameCat.bad === false && R.renameCat.shown === true,
  persist: R.persist.cat === "空圧・油圧" && R.persist.sym === true,
  delCat: R.delCat.moved === 2 && R.delCat.gone === true && R.delCat.back === "input"
    && R.delCat.dangling === 0 && R.delCat.shelfGone === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("palette-groups OK");
