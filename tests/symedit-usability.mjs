/* シンボル編集の操作改善 5 件。

   ・palAll     : どの分類の記号もデータベースで「外す/追加」でき、パレットの
                  棚から消える / 戻る (localStorage electracad.symHidden)
   ・connGroup  : コネクタは塊 (グループ) で配置され、クリックで丸ごと選ばれる
   ・connEdit   : 「コネクタ編集」で設定 (極数など) を読み込んで作り直せる。
                  1P のコネクタも配置・再編集できる
   ・ungroup    : 「分解」でグループがほどけ、個々の図形を選べるようになる
   ・explode    : グループの無い 3 点以上の折れ線は「分解」で線分に分かれる
                  (一部の線だけ回転できるように)
   ・escSelect  : 作画中でない Esc は選択ツールへ戻る (作画中は先に作画を中止)
   ・pinSnap    : 端子ツールは線・図の先端 (2.5mm 以内) に吸着する。
                  先端から離れた場所は従来どおり 5mm グリッド (強制ではない) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = {};

// ── 全記号のパレット追加・外す ──
R.palAll = await p.evaluate(() => {
  const inPal = () => [...document.querySelectorAll("#symTree .sym-name")].some(x => x.textContent === "リレーコイル");
  const before = inPal();
  UI.openSymDB();
  document.querySelector('[data-pal="coil"]').click();     // ロジック機器の記号を「外す」
  const off = inPal();
  const stored = localStorage.getItem("electracad.symHidden");
  document.querySelector('[data-pal="coil"]').click();     // 「追加」で戻す
  const back = inPal();
  document.querySelector(".modal-close").click();
  return { before, off, stored, back, cleared: localStorage.getItem("electracad.symHidden") === "[]" };
});

// ── コネクタのグループ配置 → 塊選択 → 編集 → 分解 ──
await p.evaluate(() => { UI.openSymbolEditor(); SymEdit.tool = "conn"; });
{
  const bb = await (await p.$("#seCanvas")).boundingBox();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
}
await p.waitForTimeout(120);
R.connGroup = await p.evaluate(async () => {
  document.querySelector("#cnN").value = "2";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 60));
  const S = SymEdit;
  const gids = new Set(S.shapes.map(sh => sh.grp).filter(Boolean));
  const gid = [...gids][0];
  // 選択ツールでコネクタの図形をクリック → 塊で選ばれる
  S.tool = "select"; S.msel = { shapes: [], pins: [] }; S.sel = -1;
  const first = S.shapes.find(sh => sh.grp === gid && sh.k === "line");
  const ev = { };  // クリックはハンドラ相当を直接呼べないので、mousedown のグループ選択を確かめる
  return {
    grouped: S.shapes.every(sh => sh.grp === gid) && S.pins.every(pn => pn.grp === gid),
    nPins: S.pins.length, meta: S.connMeta[gid] && S.connMeta[gid].n,
  };
});
// クリックで塊選択 (実マウス)
{
  const bb = await (await p.$("#seCanvas")).boundingBox();
  // コネクタの1番ピン = 中央。ピンの少し左の引出線上をクリック
  await p.mouse.click(bb.x + bb.width / 2 + 1, bb.y + bb.height / 2);
}
R.groupSelect = await p.evaluate(() => {
  const S = SymEdit;
  return { msel: S.msel.shapes.length + S.msel.pins.length, total: S.shapes.length + S.pins.length };
});
// コネクタ編集: 2P → 3P に作り直し (1P も通す)
R.connEdit = await p.evaluate(async () => {
  document.querySelector("#seConnEd").click();
  await new Promise(r => setTimeout(r, 60));
  const pref = document.querySelector("#cnN") && document.querySelector("#cnN").value;
  document.querySelector("#cnN").value = "3";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 60));
  const S = SymEdit;
  const n3 = S.pins.length;
  // 1P への作り直しも通る
  S.msel = { shapes: [0], pins: [] };
  document.querySelector("#seConnEd").click();
  await new Promise(r => setTimeout(r, 60));
  document.querySelector("#cnN").value = "1";
  document.querySelector("#cnOk").click();
  await new Promise(r => setTimeout(r, 60));
  return { pref, n3, n1: S.pins.length, metaN: Object.values(S.connMeta)[0] && Object.values(S.connMeta)[0].n };
});
// 分解 (グループ解除) → 個々を選べる
R.ungroup = await p.evaluate(() => {
  const S = SymEdit;
  S.msel = { shapes: [0], pins: [] };            // グループの一員を選択
  document.querySelector("#seUngrp").click();
  return { noGrp: S.shapes.every(sh => !sh.grp) && S.pins.every(pn => !pn.grp), metaGone: Object.keys(S.connMeta).length === 0 };
});
// 折れ線の分解 (線分ごと)
R.explode = await p.evaluate(() => {
  const S = SymEdit;
  S.shapes = [{ k: "line", pts: [[0, 0], [10, 0], [10, 10]], style: "solid" }];
  S.pins = []; S.msel = { shapes: [0], pins: [] }; S.sel = -1;
  document.querySelector("#seUngrp").click();
  return { n: S.shapes.length, allSeg: S.shapes.every(sh => sh.k === "line" && sh.pts.length === 2) };
});

// ── Esc → 選択ツール (作画中はまず作画を中止) ──
{
  const bb = await (await p.$("#seCanvas")).boundingBox();
  await p.evaluate(() => {
    SymEdit.tool = "line";
    document.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === "line"));
  });
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);   // 作画開始 (draft)
  await p.keyboard.press("Escape");                                  // 1回目: 作画を中止
  R.escDraft = await p.evaluate(() => ({ draft: !!SymEdit.draft, tool: SymEdit.tool }));
  await p.keyboard.press("Escape");                                  // 2回目: 選択ツールへ
  R.escSelect = await p.evaluate(() => ({
    tool: SymEdit.tool,
    btnOn: document.querySelector('.se-tool[data-t="select"]').classList.contains("on"),
  }));
}

// ── 端子の先端吸着 ──
{
  await p.evaluate(() => {
    const S = SymEdit;
    S.shapes = [{ k: "line", pts: [[-18.7, -12.3], [10, 10]], style: "solid" }];
    S.pins = []; S.msel = { shapes: [], pins: [] }; S.sel = -1;
    S.tool = "pin";
    document.querySelectorAll(".se-tool").forEach(x => x.classList.toggle("on", x.dataset.t === "pin"));
  });
  const bb = await (await p.$("#seCanvas")).boundingBox();
  const box = await p.evaluate(() => SymEdit.W);
  const mm = bb.height / box;
  const px = (wx, wy) => [bb.x + bb.width / 2 + wx * mm, bb.y + bb.height / 2 + wy * mm];
  // 先端 (-18.7,-12.3) から 1mm ずれた位置 → 吸着して先端に乗る
  let [ax, ay] = px(-18, -12);
  await p.mouse.click(ax, ay);
  // 先端から遠い場所 (グリッド近く) → 従来どおり 5mm グリッド
  [ax, ay] = px(20.6, -19.7);
  await p.mouse.click(ax, ay);
  R.pinSnap = await p.evaluate(() => ({
    pins: SymEdit.pins.map(q => [q.x, q.y]),
    cursor: (() => { const c = document.querySelector("#seCursor .cv"); return +c.getAttribute("x1"); })(),
  }));
  await p.evaluate(() => { document.querySelector("#seCancel").click(); });
}

const checks = {
  noPageErrors: errs.length === 0,
  palAll: R.palAll.before && !R.palAll.off && R.palAll.stored === '["coil"]' && R.palAll.back && R.palAll.cleared,
  connGroup: R.connGroup.grouped && R.connGroup.nPins === 2 && R.connGroup.meta === 2,
  groupSelect: R.groupSelect.msel === R.groupSelect.total && R.groupSelect.total > 3,
  connEdit: R.connEdit.pref === "2" && R.connEdit.n3 === 3 && R.connEdit.n1 === 1 && R.connEdit.metaN === 1,
  ungroup: R.ungroup.noGrp && R.ungroup.metaGone,
  explode: R.explode.n === 2 && R.explode.allSeg,
  escDraft: R.escDraft.draft === false && R.escDraft.tool === "line",
  escSelect: R.escSelect.tool === "select" && R.escSelect.btnOn,
  pinSnap: R.pinSnap.pins.length === 2 &&
    Math.abs(R.pinSnap.pins[0][0] - -18.7) < 0.01 && Math.abs(R.pinSnap.pins[0][1] - -12.3) < 0.01 &&
    R.pinSnap.pins[1][0] % 5 === 0 && R.pinSnap.pins[1][1] % 5 === 0,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
