/* ヘッダ (メニュー・プロジェクト名・ボタン) が画面幅に収まる。モニターやブラウザの拡大率が
   変わって幅が狭くなっても、メニューが縦に折り返したり右のボタンが画面外へ出たりしない。

   ・wide    : 1920px ではボタンの文字 (新規・保存・設計完了・完了図面・AI自動作図) が見える
   ・fit     : 1920 / 1500 / 1280 / 1100 / 960 px のどの幅でも、メニュー 6 個・ボタン 6 個の
              右端が画面内にあり、文字が折り返していない (高さ 1 行分)。ヘッダの高さも 1 行
   ・narrow  : 1500px 以下ではボタンがアイコンだけになり (文字は title で読める)、AI ボタンは
              「AI」の短い表示。1000px 以下ではプロジェクト名の欄が隠れる
   ・wip     : 作業中の長い名前 (バッジつき) でも同じく収まる */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1920, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
await p.evaluate(() => {
  // 作業中の長い名前 + マスターのバッジ (実運用でいちばん幅をとる姿)
  const lb = document.querySelector("#btnWip .wip-label"); lb.textContent = "A009728_ちゃんぽん具材外観検査装置 (長い名前)";
  document.querySelector("#btnWip .wip-master-badge").hidden = false;
  document.querySelector("#projectName").value = "A009728_ちゃんぽん具材外観検査装置";
  document.querySelector("#relCount").style.display = ""; document.querySelector("#relCount").textContent = "6";
});
const measure = () => p.evaluate(() => {
  const W = window.innerWidth;
  const els = [...document.querySelectorAll("#menubar .menu, .titlebar-right .tb-chip")];
  const bad = els.filter(e => { const r = e.getBoundingClientRect(); return r.right > W + 0.5 || r.left < -0.5 || r.height > 34; }).map(e => e.textContent.trim().slice(0, 8) + ":" + Math.round(e.getBoundingClientRect().right) + "/" + Math.round(e.getBoundingClientRect().height));
  const tb = document.querySelector("#titlebar").getBoundingClientRect();
  const lbl = getComputedStyle(document.querySelector("#btnSave .save-label")).display;
  const ai = getComputedStyle(document.querySelector("#btnAIWizard .ai-short")).display;
  const pn = getComputedStyle(document.querySelector(".titlebar-center")).display;
  return { W, bad, tbH: Math.round(tb.height), labels: lbl !== "none", aiShort: ai !== "none", nameShown: pn !== "none", n: els.length };
});
const R = {};
for (const w of [1920, 1500, 1280, 1100, 960]) {
  await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(150);
  R[w] = await measure();
}

const checks = {
  noPageErrors: errs.length === 0,
  wide: R[1920].labels && !R[1920].aiShort && R[1920].nameShown,
  fit: Object.values(R).every(r => r.n === 12 && r.bad.length === 0 && r.tbH <= 44),
  narrow: !R[1500].labels && R[1500].aiShort && R[1500].nameShown && R[1100].nameShown && !R[960].nameShown,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("header-fit OK");
