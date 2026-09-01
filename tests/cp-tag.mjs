/* サーキットプロテクタ (CP) のデバイスタグ。

   ・cpLetter : cp1 / cp2 の文字記号が CP (品名どおり)
   ・cpSeq    : 置くたびに -CP1, -CP2 … と連番になる (1P/2P 混在でも通し)
   ・cpNext   : 手で -CP5 を付けた後に置くと -CP6 (既存の続きから)
   ・cpShown  : 図面のシンボルの横に同じタグ (-CP1) が出る (画面の描画。
                既定の「出力時非表示」の運用はそのまま)
   ・others   : CP 以外も現場の呼びどおりのタグになる
                (NFB / PB / RY / MS / PL / EMS / TB / M / F など) */
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
  App.project = newProject("CPタグ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;

  out.cpLetter = { cp1: symOf("cp1").letter, cp2: symOf("cp2").letter };

  const a = addDevice(pg, "cp2", 100, 100);
  const c = addDevice(pg, "cp1", 140, 100);     // 1P/2P 混在でも通しの連番
  out.cpSeq = { first: a.tag, second: c.tag };

  // 手で付けた番号の続きから採番される
  c.tag = "-CP5";
  const d2 = addDevice(pg, "cp2", 180, 100);
  out.cpNext = { tag: d2.tag };

  // 図面のシンボルの横に同じタグが出る (画面の描画)
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));
  const svg = devicesSVG(pg, {});
  out.cpShown = { p1: svg.includes(">-CP1<"), p6: svg.includes(">-CP6<") };

  // CP 以外も現場の呼びどおりのタグになる
  const pick = ["mcb2", "pb_no", "coil", "ms_no", "lamp", "estop", "terminal", "motor3", "fuse"];
  out.others = pick.map((sid, i) => addDevice(pg, sid, 220 + i * 20, 100).tag);
  out.othersLetters = { timer: symOf("timer_on").letter, thr: symOf("ol3").letter,
    mc: symOf("cont_coil").letter, elb: symOf("elb3").letter, ss: symOf("sel_sw").letter };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  cpLetter: R.cpLetter.cp1 === "CP" && R.cpLetter.cp2 === "CP",
  cpSeq: R.cpSeq.first === "-CP1" && R.cpSeq.second === "-CP2",
  cpNext: R.cpNext.tag === "-CP6",
  cpShown: R.cpShown.p1 === true && R.cpShown.p6 === true,
  others: JSON.stringify(R.others) === JSON.stringify(
    ["-NFB1", "-PB1", "-RY1", "-MS1", "-PL1", "-EMS1", "-TB1", "-M1", "-F1"])
    && R.othersLetters.timer === "T" && R.othersLetters.thr === "THR"
    && R.othersLetters.mc === "MC" && R.othersLetters.elb === "ELB" && R.othersLetters.ss === "SS",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("cp-tag OK");
