/* 大きな図面の軽量化 — シンボル分離直列化と undo スナップショット。

   ・roundTrip : serializeProject → parse で元の図面と同値 (ページ・メタ・
                 シンボルとも欠けや化けが無い)
   ・share     : 重いシンボル入りで 2 回 commit しても、1MB 超の再直列化
                 (JSON.stringify) が走らない (直列化文字列の使い回し)
   ・undoBack  : commit → 変更 → undo で元に戻り、シンボルも使える
   ・retireInv : シンボルの退役 (中身の直書き換え) で直列化の使い回しが
                 破棄され、退役印が控えに反映される
   ・debounce  : saveLocal は即書きしない (まとめ書き)。flushAutosave で
                 即書きされ、localStorage に最新が入る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("軽量化"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  // 自作シンボル (同梱される) と機器・配線
  const sym1 = { id: "usr_perf1", db: true, group: "自作", cat: "db", letter: "U",
    name: "軽量化試験", nameEn: "perf", desc: "", pins: [{ x: 0, y: 0, n: "1" }],
    sim: "none", bounds: [-5, -2, 10, 8], body: '<rect x="-4" y="0" width="8" height="5"/>',
    imported: true, custom: true, nonstd: true };
  DB_SYMBOLS.push(sym1); SYMBOLS_BY_ID[sym1.id] = sym1;
  addDevice(pg, "usr_perf1", 100, 100, { tag: "-U1" });
  addDevice(pg, "coil", 140, 100, { tag: "-RY1" });
  syncProjectSymbols();

  // ── 往復一致 ──
  const back = JSON.parse(serializeProject());
  const norm = o => JSON.stringify({ ...o, symbols: undefined });
  const bs = back.symbols || [], ps = App.project.symbols || [];
  out.roundTrip = {
    rest: norm(back) === norm(App.project),
    symIds: JSON.stringify(bs.map(s2 => s2.id)) === JSON.stringify(ps.map(s2 => s2.id)),
    symBody: ps.length > 0 && (bs[0] || {}).body === (ps[0] || {}).body,
  };

  // ── undo 控えのシンボル共有 (重いシンボルを 2 回 commit しても再直列化しない) ──
  const big = { ...sym1, id: "usr_perf_big", name: "重い試験",
    body: '<path d="' + "M0 0 L1 1 ".repeat(140000) + '"/>' };
  DB_SYMBOLS.push(big); SYMBOLS_BY_ID[big.id] = big;
  addDevice(pg, "usr_perf_big", 60, 140, { tag: "-U2" });
  syncProjectSymbols();
  serializeProject();                       // 直列化を温めておく
  const origStringify = JSON.stringify; let bigCalls = 0;
  JSON.stringify = function (...a) {
    const r = origStringify.apply(JSON, a);
    if (typeof r === "string" && r.length > 1e6) bigCalls++;
    return r;
  };
  commit();
  addDevice(pg, "lamp", 180, 100, { tag: "-PL1" });
  commit();
  JSON.stringify = origStringify;
  const st = App.undoStack;
  out.share = { n: st.length, bigCalls,
    restSmall: st[st.length - 1].rest.length < 200000 };

  // ── undo で元へ ──
  addDevice(pg, "lamp", 200, 100, { tag: "-PL2" });
  const beforeUndo = pg.devices.length;
  undo();
  const pg2 = curPage();
  out.undoBack = { removed: pg2.devices.length === beforeUndo - 1,
    symWorks: !symOf("usr_perf1").missing && pg2.devices.some(d => d.sym === "usr_perf1") };

  // ── 退役 (中身の直書き換え) でキャッシュが外れる ──
  const before = serializeSymbols(App.project.symbols).includes('"retired":true');
  App.project.symbols[0].retired = true;
  symSerTouch();
  const after = serializeSymbols(App.project.symbols).includes('"retired":true');
  delete App.project.symbols[0].retired;
  symSerTouch();
  out.retireInv = { before, after };

  // ── まとめ書きと flush ──
  localStorage.removeItem("electracad.project.v1");
  App.project.name = "軽量化F";
  saveLocal();
  out.debounce = { immediate: localStorage.getItem("electracad.project.v1") === null };
  flushAutosave();
  const saved = JSON.parse(localStorage.getItem("electracad.project.v1") || "{}");
  out.debounce.flushed = saved.name === "軽量化F";
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  roundTrip: R.roundTrip.rest === true && R.roundTrip.symIds === true && R.roundTrip.symBody === true,
  share: R.share.bigCalls === 0 && R.share.restSmall === true,
  undoBack: R.undoBack.removed === true && R.undoBack.symWorks === true,
  retireInv: R.retireInv.before === false && R.retireInv.after === true,
  debounce: R.debounce.immediate === true && R.debounce.flushed === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("perf-serialize OK");
