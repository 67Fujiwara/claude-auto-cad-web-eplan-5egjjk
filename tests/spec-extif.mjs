/* 仕様 (2) 外部 I/F の詳細と施工範囲。

   ・noPh    : 「(クリックして追記)」の空き行を出さない — 書いた行だけ。
              行が無い I/F は「・上流:」の空行 1 つ (＋だけ)
   ・pm      : 画面では行の右端に薄い ＋/− が出る。印刷 (exportSheetSVG) と
              DXF には出ない
   ・addBtn  : ＋ をクリック → 記入ダイアログ → その I/F の末尾へ 1 行入る
   ・delBtn  : − をクリック → 文字が入っていれば確認。キャンセルなら残り、
              OK なら消えて後ろの行が詰まる
   ・work    : 外部 I/F に「施工範囲」(端子台準備 / ケーブル準備 (接続は
              顧客対応) / すべて弊社対応) が入り、選べる。端末処理の記入欄が
              あり、書くと図面に出る
   ・hub     : 「HUB 通信速度」(1Gbps 以下 / 2.5Gbps / 10Gbps / 営業準備) が
              あり、クリックで選べる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  App.project = newProject("外部IF"); UI.renumberPages();
  const specs = App.project.pages.filter(pg => pg.kind === "spec");
  const pg = specs[1];                       // 仕様 (2) = 冷却・外部接続
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.spec = pg.spec || defaultSpec();
  pg.spec.sel.extif = [0, 1];                // 上流・下流にチェック
  pg.spec.memo.extif_0 = "運転許可信号";
  pg.spec.memo.extif_0_1 = "非常停止の連絡";
  UI.refresh(); zoomFit();
  const screen = specSVG(pg);                 // 画面 (record あり)
  const boxes = Editor.specBoxes.slice();
  const print = exportSheetSVG(pg);           // 印刷・PDF
  applySheet(pg); specSVG(pg);                // クリック枠を画面用に戻す
  const dxf = pageToDXF(pg);
  out.noPh = { screen: !screen.includes("クリックして追記"),
    print: !print.includes("クリックして追記"),
    rows0: (screen.match(/・上流: /g) || []).length,
    rows1: (screen.match(/・下流: /g) || []).length };
  out.pm = { screen: screen.includes(">＋<") && screen.includes(">−<"),
    print: !print.includes(">＋<") && !print.includes(">−<"),
    dxf: !dxf.includes("＋") && !dxf.includes("−") };
  out.boxes = { add: boxes.filter(b2 => b2.bulletAdd).length,
    del: boxes.filter(b2 => b2.bulletDel).length };
  out.work = { screen: ["施工範囲", "端子台準備", "ケーブル準備 (接続は顧客対応)", "すべて弊社対応", "端末処理"]
      .every(t => screen.includes(t)),
    grp: specGroups().some(g => g.k === "extwork" && !g.multi) };
  out.hub = { screen: ["HUB 通信速度", "1Gbps 以下", "2.5Gbps", "10Gbps", "営業準備"]
      .every(t => screen.includes(t)),
    grp: specGroups().some(g => g.k === "hubspd" && !g.multi) };
  // 端末処理の記入 → 図面に出る
  pg.spec.memo.extwork_term = "圧着端子 R2-4 で処理";
  const s2 = specSVG(pg);
  out.work.note = s2.includes("端末処理: 圧着端子 R2-4 で処理");
  // クリック用の座標 (上流 1 行目の ＋ / −、施工範囲の 2 番)
  const a = screenToWorld(0, 0), bx = screenToWorld(100, 0), by = screenToWorld(0, 100);
  const kx = 100 / (bx.x - a.x), ky = 100 / (by.y - a.y);
  const W2C = (o) => ({ x: (o.x + o.w / 2 - a.x) * kx, y: (o.y + o.h / 2 - a.y) * ky });
  const boxes2 = Editor.specBoxes;
  const addUp = boxes2.find(b2 => b2.bulletAdd && /上流/.test(b2.bulletAdd.label));
  const delUp = boxes2.find(b2 => b2.bulletDel && b2.bulletDel.val === "運転許可信号");
  const wk1 = boxes2.find(b2 => b2.k === "extwork" && b2.i === 1);
  const hub2 = boxes2.find(b2 => b2.k === "hubspd" && b2.i === 2);
  out.pts = { add: addUp && W2C(addUp), del: delUp && W2C(delUp), wk1: wk1 && W2C(wk1),
    hub2: hub2 && W2C(hub2) };
  return out;
});

// ＋ で追記 (prompt を横取り)
await p.evaluate(() => { window.prompt = () => "扉インターロック"; });
await p.mouse.click(R.pts.add.x, R.pts.add.y);
await p.waitForTimeout(120);
const ADD = await p.evaluate(() => {
  const pg = curPage();
  return { v: pg.spec.memo.extif_0_2, n: specBullets(pg.spec, "extif", 0).length };
});

// − で削除: キャンセル → 残る、OK → 消えて詰まる。
// 行が増えると用紙いっぱいに広げる倍率が変わって位置がずれるので、
// クリックのたびに − の座標を取り直す
const delPt = () => p.evaluate(() => {
  const a = screenToWorld(0, 0), bx = screenToWorld(100, 0), by = screenToWorld(0, 100);
  const kx = 100 / (bx.x - a.x), ky = 100 / (by.y - a.y);
  const d = Editor.specBoxes.find(b2 => b2.bulletDel && b2.bulletDel.val === "運転許可信号");
  return d && { x: (d.x + d.w / 2 - a.x) * kx, y: (d.y + d.h / 2 - a.y) * ky };
});
await p.evaluate(() => { window.confirm = () => false; });
let dp = await delPt();
await p.mouse.click(dp.x, dp.y);
await p.waitForTimeout(120);
const KEEP = await p.evaluate(() => curPage().spec.memo.extif_0);
await p.evaluate(() => { window.confirm = () => true; });
dp = await delPt();
await p.mouse.click(dp.x, dp.y);
await p.waitForTimeout(120);
const DEL = await p.evaluate(() => {
  const pg = curPage();
  return { vals: specBullets(pg.spec, "extif", 0).join("|"), first: pg.spec.memo.extif_0 };
});

// 施工範囲の 2 番 (ケーブル準備) をクリックで選ぶ
await p.mouse.click(R.pts.wk1.x, R.pts.wk1.y);
await p.waitForTimeout(120);
const WK = await p.evaluate(() => curPage().spec.sel.extwork);

// HUB 通信速度の 3 番 (10Gbps) をクリックで選ぶ
await p.mouse.click(R.pts.hub2.x, R.pts.hub2.y);
await p.waitForTimeout(120);
const HB = await p.evaluate(() => curPage().spec.sel.hubspd);

const checks = {
  noPageErrors: errs.length === 0,
  /* 空きの追記行なし。上流 = 書いた 2 行だけ、下流 = 空の 1 行 (ラベルだけ) */
  noPh: R.noPh.screen === true && R.noPh.print === true &&
    R.noPh.rows0 === 2 && R.noPh.rows1 === 1,
  pm: R.pm.screen === true && R.pm.print === true && R.pm.dxf === true &&
    R.boxes.add === 3 && R.boxes.del === 2,
  addBtn: ADD.v === "扉インターロック" && ADD.n === 3,
  delBtn: KEEP === "運転許可信号" &&
    DEL.vals === "非常停止の連絡|扉インターロック" && DEL.first === "非常停止の連絡",
  work: R.work.screen === true && R.work.grp === true && R.work.note === true && WK === 1,
  hub: R.hub.screen === true && R.hub.grp === true && HB === 2,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R: { ...R, pts: 0 }, ADD, KEEP, DEL, WK, HB, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("spec-extif OK");
