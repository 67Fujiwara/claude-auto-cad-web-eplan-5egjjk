/* 起動時に前回の図面を自動で開く — 毎回「開く (JSON)」しなくてよい。

   ・lsRestore : 普通の図面は localStorage から復元される (再読み込みで続きから)
   ・quotaFlag : localStorage に入り切らなかったら、その印 (.ok=0) が残り、
                 IndexedDB へ自動保存される
   ・idbRestore: その状態で再読み込みしても、IndexedDB 側から最新の図面が開く
                 (localStorage の古い写しは使わない) */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

// ── 普通の復元 (localStorage) ──
await p.evaluate(() => {
  App.project = newProject("自動復元"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  addDevice(pg, "coil", 100, 100, { tag: "-RESTA" });
  saveLocal();
});
await p.waitForTimeout(1200);          // IndexedDB への遅延書き込みぶん待つ
await p.reload();
await p.waitForTimeout(900);
const R = {};
R.lsRestore = await p.evaluate(() => ({
  name: App.project.name,
  hasA: App.project.pages.some(pg => pg.devices.some(d => d.tag === "-RESTA")),
  ok: localStorage.getItem("electracad.project.v1.ok"),
}));

// ── localStorage に入り切らない図面 (setItem を容量超過に見せる) ──
R.quotaFlag = await p.evaluate(async () => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === "electracad.project.v1") throw new Error("QuotaExceededError (テスト)");
    return orig.apply(this, arguments);
  };
  App.project.name = "自動復元大";
  const pg = App.project.pages.find(isDrawingPage);
  addDevice(pg, "lamp", 140, 100, { tag: "-RESTB" });
  saveLocal();
  await new Promise(r => setTimeout(r, 1200));   // IndexedDB への遅延書き込み
  Storage.prototype.setItem = orig;
  const idb = await relGetSnapshot("autosave");
  return { ok: localStorage.getItem("electracad.project.v1.ok"),
    lsName: (JSON.parse(localStorage.getItem("electracad.project.v1") || "{}") || {}).name,
    idbName: idb && idb.name };
});

// ── 再読み込み → IndexedDB 側から最新が開く ──
await p.reload();
await p.waitForTimeout(900);
R.idbRestore = await p.evaluate(() => ({
  name: App.project.name,
  hasB: App.project.pages.some(pg => pg.devices.some(d => d.tag === "-RESTB")),
}));
await p.evaluate(async () => {         // 後片付け
  await relDelSnapshot("autosave");
  localStorage.removeItem("electracad.project.v1.ok");
});

const checks = {
  noPageErrors: errs.length === 0,
  lsRestore: R.lsRestore.name === "自動復元" && R.lsRestore.hasA === true && R.lsRestore.ok === "1",
  quotaFlag: R.quotaFlag.ok === "0" && R.quotaFlag.lsName === "自動復元"
    && R.quotaFlag.idbName === "自動復元大",
  idbRestore: R.idbRestore.name === "自動復元大" && R.idbRestore.hasB === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("boot-restore OK");
