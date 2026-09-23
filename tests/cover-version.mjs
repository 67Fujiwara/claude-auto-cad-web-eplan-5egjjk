/* 表紙のタイトル横の版数表示 (V0・V1 …)。

   ・v0     : 新規プロジェクトの表紙は タイトル (装置名) の横に V0
   ・beside : V はタイトル文字の右端より右に置かれる (重ならない)
   ・follow : 設計完了の「版数」(meta.rev) に追従する (3 → V3)
   ・noDec  : 小数点以下は書かない (1.5 → V1)
   ・print  : 印刷・PDF 用の SVG にも出る
   ・noTitle: タイトルが無い表紙には V だけを出さない */
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
  App.project = newProject("版数表示"); UI.renumberPages();
  const cover = App.project.pages[0];
  cover.cover = { customer: "○○株式会社", title: "○○装置 電気図面" };
  App.pageIdx = 0; applySheet(cover);
  const svg0 = kindSVG(cover);
  out.v0 = svg0.includes(">V0<");
  const vx = (svg, t) => {
    const m = svg.match(new RegExp(`<text x="([\\d.]+)"[^>]*>${t}<`));
    return m ? +m[1] : null;
  };
  const bi = sheetInner(), cx = bi.x + bi.w / 2;
  const tw = textWidthMM("○○装置 電気図面", 7);
  out.beside = { vx: vx(svg0, "V0"), min: cx + tw / 2 + 1 };
  projectMeta().rev = "3";
  out.v3 = kindSVG(cover).includes(">V3<");
  projectMeta().rev = "1.5";
  const s15 = kindSVG(cover);
  out.noDec = s15.includes(">V1<") && !s15.includes("V1.5");
  projectMeta().rev = "2";
  const prn = exportSheetSVG(cover);
  out.print = prn.includes(">V2<");
  cover.cover = { customer: "", title: "" };
  App.project.name = "";
  out.noTitle = !kindSVG(cover).includes(">V");
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  v0: R.v0 === true,
  beside: R.beside.vx !== null && R.beside.vx > R.beside.min,
  follow: R.v3 === true,
  noDec: R.noDec === true,
  print: R.print === true,
  noTitle: R.noTitle === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("cover-version OK");
