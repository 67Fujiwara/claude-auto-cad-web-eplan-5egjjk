/* 設計完了したら「作業中の図面」から外す。

   出図済みの案件は設計完了履歴に保存されるので、作業中の一覧に残しておく
   意味が薄く、たまって見づらい — 出図と同時に一覧から外す。

   ・gone   : 作業中の枠に入れた案件を設計完了すると、その枠が一覧から
             消え、現在枠も解除される。設計完了履歴には残る。
             出図後は新しい図面 (無題) に切り替わる
   ・others : 別の案件の枠はそのまま残る
   ・master : マスターファイルの枠は設計完了しても消えない (ひな型を守る)
   ・snap   : 消した枠の図面本体 (スナップショット) も削除される */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  window.downloadFile = () => {};        // 出図のファイル保存は横取り
  window.confirm = () => true;
  // ── 別案件の枠を先に作っておく (残ることの確認用) ──
  App.project = newProject("残る別案件"); UI.renumberPages();
  const otherId = await UI.wipSave({ asNew: true });
  // ── 出図する案件を作って作業中へ ──
  App.project = newProject("出図する案件"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  addDevice(pg, "coil", 120, 100, { tag: "-K1" });
  const relId = await UI.wipSave({ asNew: true });
  out.before = { cur: wipCurrent() === relId, n: wipList().length };
  await UI.runRelease({ dxf: false, pdfIn: false, pdfCus: false, json: true,
    pack: "zip", dpi: 150, note: "", rev: "0", by: "", errs: 0, warns: 0,
    devs: 1, wires: 0, seq: 1 });
  await new Promise(r => setTimeout(r, 300));
  const list = wipList();
  out.gone = { inList: list.some(r => r.id === relId), cur: wipCurrent(),
    // 別 id で入り直す退行も拾う — 出図した案件名の枠が 1 つも無いこと
    byName: list.some(r => ((r.project || "") + (r.name || "")).includes("出図する案件")),
    fresh: App.project.name, rel: relList().some(r => r.project === "出図する案件") };
  out.others = list.some(r => r.id === otherId);
  out.snap = { del: !(await relGetSnapshot(relId)) };

  // ── マスターファイルの枠は消えない ──
  App.project = newProject("マスター回路"); UI.renumberPages();
  const masterId = await UI.wipSave({ asNew: true, name: "マスター回路", master: true });
  await UI.runRelease({ dxf: false, pdfIn: false, pdfCus: false, json: true,
    pack: "zip", dpi: 150, note: "", rev: "0", by: "", errs: 0, warns: 0,
    devs: 0, wires: 0, seq: 1 });
  await new Promise(r => setTimeout(r, 300));
  const m = wipList().find(r => r.id === masterId);
  out.master = { kept: !!m, flag: !!(m && m.master), cur: wipCurrent() };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  gone: R.before.cur === true && R.before.n === 2 &&
    R.gone.inList === false && R.gone.byName === false && R.gone.cur === "" &&
    R.gone.fresh === "無題プロジェクト" && R.gone.rel === true,
  others: R.others === true,
  master: R.master.kept === true && R.master.flag === true && R.master.cur === "",
  snap: R.snap.del === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("release-wip OK");
