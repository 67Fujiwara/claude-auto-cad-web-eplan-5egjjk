/* 図枠・表題欄の設定の「適用範囲」。

   既定は「このページのみ」。ページごとに用紙・向き・尺度を変える使い方が
   ふつうなので、開いた直後に適用すると他のページまで巻き込む状態にしない。

   ・defaultPage : 初期値が「このページのみ」(個別設定が無いページでも)
   ・keepsOther  : このページのみで用紙を変えても、他のページは元のまま
   ・allStillOK  : 「全ページ」を選べば従来どおり全ページへ反映され、
                   ページ個別の設定は消える
   ・optionOrder : 選択肢は「このページのみ」→「全ページ」の順で、
                   全ページ側に (既定) と書かれていない */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  const wait = () => new Promise(r => setTimeout(r, 80));
  // 用紙を変えると「はみ出す機器があるが続けるか」を聞かれるので通す
  const oldConfirm = window.confirm; window.confirm = () => true;
  // 2 ページ用意 (どちらもページ個別の用紙設定は持たない)
  const pg2 = newPage("scope2", App.project.pages.length + 1);
  App.project.pages.push(pg2);
  App.pageIdx = App.project.pages.length - 1;
  const cur = curPage();

  // ── 初期値 ──
  UI.sheetSetup();
  await wait();
  const sel = document.querySelector("#tbScope");
  out.defaultValue = sel.value;
  out.options = [...sel.options].map(o => ({ v: o.value, t: o.textContent.trim() }));

  // ── このページのみで用紙を A4 縦へ ──
  const before = { paper: projectMeta().paper, orient: projectMeta().orient };
  document.querySelector("#tbPaper").value = "A4";
  document.querySelector("#tbPaper").dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#tbOrient").value = "portrait";
  document.querySelector("#tbOrient").dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#tbOk").click();
  await wait();
  out.thisPage = { paper: cur.paper, orient: cur.orient };
  out.otherPage = { paper: App.project.pages[0].paper, orient: App.project.pages[0].orient };
  out.metaAfter = { paper: projectMeta().paper, orient: projectMeta().orient };
  out.metaUnchanged = out.metaAfter.paper === before.paper && out.metaAfter.orient === before.orient;

  // ── 「全ページ」を選べば従来どおり ──
  UI.sheetSetup();
  await wait();
  document.querySelector("#tbScope").value = "all";
  document.querySelector("#tbPaper").value = "A2";
  document.querySelector("#tbPaper").dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#tbOk").click();
  await wait();
  out.allMeta = projectMeta().paper;
  out.perPageCleared = App.project.pages.every(pg => !pg.paper && !pg.scale && !pg.orient);
  window.confirm = oldConfirm;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  defaultPage: R.defaultValue === "page",
  optionOrder: R.options.length === 2 && R.options[0].v === "page" && R.options[1].v === "all" &&
    R.options[0].t.startsWith("このページのみ") && R.options[1].t === "全ページ",
  keepsOther: R.thisPage.paper === "A4" && R.thisPage.orient === "portrait" &&
    !R.otherPage.paper && !R.otherPage.orient && R.metaUnchanged,
  allStillOK: R.allMeta === "A2" && R.perPageCleared === true,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
await b.close();
process.exit(fail ? 1 : 0);
