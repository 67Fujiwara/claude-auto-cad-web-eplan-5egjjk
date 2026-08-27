/* 丸のみの端子 (term_dot) と、円の中の導体を抜く描画。

   ・symExists  : 「端子 (丸のみ)」がライブラリにあり、body は円 1 つだけ・
                  端子は中心 1 点・wireMask (抜く円) を持つ
   ・masked     : 導体の上に置くと、円の内側の線が描かれない
                  (画面の path が円の手前と先で 2 本に分かれる)
   ・connected  : 抜くのは描画だけ — 回路はつながったまま (同じネット) で、
                  検図も未接続を出さない
   ・moveBack   : 端子を動かすと、抜けていた線がもとどおり 1 本に戻る
   ・hitKept    : 当たり判定の線は元の経路のまま (円の中でも導体を選べる)
   ・dxfCut     : DXF 出力も円の内側を抜いた線で出る
   ・endTrim    : 導体の端点に重ねたときは、円の縁で線が止まる
   ・otherKept  : 丸端子の無いページの導体は 1 本のまま (従来どおり)
   ・noDot      : 円の中にはジャンクションドットを打たない (端子の丸が
                  接続を表すので二重にすると黒点で潰れる)。円の外の
                  分岐点には従来どおり打つ */
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
  const sym = SYMBOLS_BY_ID["term_dot"];
  out.symExists = !!sym && {
    circles: (sym.body.match(/<circle /g) || []).length,
    others: /<(path|rect|text)/.test(sym.body),
    pins: sym.pins.length, pin0: sym.pins[0] && [sym.pins[0].x, sym.pins[0].y],
    mask: sym.wireMask && sym.wireMask.length === 1 && sym.wireMask[0].r > 0,
    inPalette: allSymbols().some(s => s.id === "term_dot"),
  };
  const pg = newPage("td", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  // 横に伸びる導体の途中へ丸端子を落とす
  const wr = addWire(pg, [[60, 100], [160, 100]], { raw: true });
  wr.num = "101";
  const d = addDevice(pg, "term_dot", 100, 100, { tag: "-X12" });
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const pathOf = () => {
    const el = document.querySelector(`path.wire[data-id="${wr.id}"]`);
    return el ? el.getAttribute("d") : "";
  };
  const hitOf = () => {
    const el = document.querySelector(`path.wire-hit[data-id="${wr.id}"]`);
    return el ? el.getAttribute("d") : "";
  };
  const rr = sym.wireMask[0].r;
  out.masked = {
    d: pathOf(),
    pieces: (pathOf().match(/M/g) || []).length,
    // 抜けた区間の端が円の縁になっているか
    cutL: pathOf().includes(`${100 - rr},100`), cutR: pathOf().includes(`${100 + rr},100`),
  };
  out.hitKept = { d: hitOf(), pieces: (hitOf().match(/M/g) || []).length };
  // 電気的なつながり (同じネット) と検図
  const nets = computeNets(pg, "closed");
  out.connected = {
    sameNet: nets.pinNet(d, 0) === nets.wireNet.get(wr.id),
    drcOpen: runDRC().filter(i => i.page === pg.no && /未接続|つながって/.test(i.msg)).length,
  };
  /* 分岐を足して、丸端子の中にドットが出ないことを見る。
     比較のため、端子から離れた位置にも 3 本目の分岐点を作る */
  addWire(pg, [[100, 100], [100, 130]], { raw: true });    // 丸端子の中心から下へ
  addWire(pg, [[140, 100], [140, 130]], { raw: true });    // 端子の無い分岐点
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  {
    const dots = [...Editor.svg.querySelectorAll("circle")].map(c => [+c.getAttribute("cx"), +c.getAttribute("cy"), +c.getAttribute("r")]);
    const small = dots.filter(c => c[2] < 1);              // ジャンクションドット (r≒0.75)
    out.noDot = {
      inCircle: small.some(c => Math.hypot(c[0] - 100, c[1] - 100) < 2.2),
      outside: small.some(c => Math.abs(c[0] - 140) < 0.01 && Math.abs(c[1] - 100) < 0.01),
      dxfInCircle: pageToDXF(pg).split("\n").length > 0,
    };
  }
  out.dxfCut = (() => {
    const dxf = pageToDXF(pg);
    // 円の縁 (97.8 / 102.2) で切れた線が出ていること
    return dxf.includes((100 - rr).toFixed(3)) && dxf.includes((100 + rr).toFixed(3));
  })();

  // 端子を動かすと線は戻る
  d.x = 100; d.y = 130;
  App.labelRev++;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.moveBack = { pieces: (pathOf().match(/M/g) || []).length, d: pathOf() };

  // 導体の端点に重ねる → 円の縁で止まる
  d.x = 160; d.y = 100;
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.endTrim = { d: pathOf(), stops: pathOf().includes(`${160 - rr},100`) && !pathOf().includes("160,100") };

  // 丸端子の無いページ
  const pg2 = newPage("td2", App.project.pages.length + 1);
  App.project.pages.push(pg2); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg2);
  const wr2 = addWire(pg2, [[60, 100], [160, 100]], { raw: true });
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const el2 = document.querySelector(`path.wire[data-id="${wr2.id}"]`);
  out.otherKept = el2 && (el2.getAttribute("d").match(/M/g) || []).length === 1;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  symExists: R.symExists && R.symExists.circles === 1 && !R.symExists.others
    && R.symExists.pins === 1 && JSON.stringify(R.symExists.pin0) === "[0,0]"
    && R.symExists.mask && R.symExists.inPalette,
  masked: R.masked.pieces === 2 && R.masked.cutL && R.masked.cutR,
  connected: R.connected.sameNet === true && R.connected.drcOpen === 0,
  hitKept: R.hitKept.pieces === 1 && R.hitKept.d === "M60,100 L160,100",
  dxfCut: R.dxfCut === true,
  moveBack: R.moveBack.pieces === 1 && R.moveBack.d === "M60,100 L160,100",
  endTrim: R.endTrim.stops === true,
  otherKept: R.otherKept === true,
  noDot: R.noDot.inCircle === false && R.noDot.outside === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("term-dot OK");
