/* 電磁開閉器 (MS) の一体シンボル (主接点 + サーマルリレー)。

   ・have   : 3極 (ms3)・2極 (ms2) がライブラリに居る。文字記号 MS、
             端子は上下 40mm 幅 (接点 20 + 熱動 20)、極ピッチ 10mm
   ・draw   : 絵は 接触器主接点 (小円弧) + 熱動素子 (コの字) + 破線の囲い。
             パレットのアウトプット機器の棚に出る
   ・link   : コイルにリンクでき、コイルの接点ミラー表に載る (contact3_no)
   ・thermal: サーマル接点 (95-96) を MS 本体へリンクできる (mirror) —
             MS の下に接点ミラー表が出る
   ・out    : 配置した図面の印刷 SVG・DXF に出る */
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
  const m3 = SYMBOLS_BY_ID.ms3, m2 = SYMBOLS_BY_ID.ms2;
  out.have = {
    both: !!m3 && !!m2,
    letter: m3 && m3.letter, sim3: m3 && m3.sim, sim2: m2 && m2.sim,
    span: m3 && m3.pins.every(q => q.y === 0 || q.y === 40) && m3.pins.length === 6 &&
      m2.pins.length === 4,
    pitch: m3 && m3.pins[2].x === 10 && m3.pins[4].x === 20,
    linked: m3 && m3.linked === true, mirror: m3 && m3.mirror === true,
  };
  out.draw = {
    arc: (m3.body.match(/A1\.8,1\.8/g) || []).length === 3,     // 接触器の半円 ×3 極
    // 半円は JIS 07-13-02 の形: 導体の線が半円の下端 (0,8.6) まで通り、
    // 膨らみは可動刃と反対側 (右) — 規格書の「d」形
    half: (m3.body.match(/M0,5 A1\.8,1\.8 0 0 0 0,8\.6/g) || []).length === 3 &&
      (m3.body.match(/M0,0 V8\.6/g) || []).length === 3,
    ol: (m3.body.match(/H-3 V/g) || []).length === 3,           // 熱動素子のコの字 ×3 極
    dash: m3.body.includes("stroke-dasharray"),
  };
  UI.buildPalette();
  const cats = [...document.querySelectorAll("#symTree .sym-cat")];
  out.palette = cats.some(c => c.textContent.includes("アウトプット機器") &&
    c.textContent.includes("電磁開閉器 (MS) 3極") && c.textContent.includes("電磁開閉器 (MS) 2極"));
  // 電磁接触器 (MC): コイル + 主接点がその名前で検索に掛かる
  out.mc = {
    n3: SYMBOLS_BY_ID.main_cont.name, n2: SYMBOLS_BY_ID.main_cont2.name,
    found: (() => {
      UI.buildPalette("電磁接触器");
      const names = [...document.querySelectorAll("#symTree .sym-name")].map(e2 => e2.textContent);
      UI.buildPalette();
      return ["電磁接触器コイル", "電磁接触器 (MC) 主接点 3極", "電磁接触器 (MC) 主接点 2極"]
        .every(n => names.includes(n));
    })(),
  };

  // ── コイルへのリンクと、サーマル接点から MS へのリンク ──
  App.project = newProject("MS確認"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const k1 = addDevice(pg, "cont_coil", 60, 120, { tag: "-MS1" });
  const ms = addDevice(pg, "ms3", 140, 60, { tag: "-MS1" });
  ms.linkTo = k1.id;
  const nc = addDevice(pg, "ol_nc", 100, 120, { tag: "-MS1" });
  nc.linkTo = ms.id;
  App.labelRev++;
  out.link = { inCoil: linkedContacts(k1).some(d => d.id === ms.id),
    inMs: linkedContacts(ms).some(d => d.id === nc.id),
    msMirror: mirrorSVG(ms).includes("95") };
  const svg = exportSheetSVG(pg);
  applySheet(pg);
  const dxf = pageToDXF(pg);
  out.out = { svg: svg.includes("-MS1") && /A1\.8,1\.8/.test(svg),
    dxf: dxf.includes("-MS1") };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  have: R.have.both === true && R.have.letter === "MS" && R.have.sim3 === "contact3_no" &&
    R.have.sim2 === "contact2_no" && R.have.span === true && R.have.pitch === true &&
    R.have.linked === true && R.have.mirror === true,
  draw: R.draw.arc === true && R.draw.half === true && R.draw.ol === true && R.draw.dash === true,
  palette: R.palette === true,
  mc: R.mc.n3 === "電磁接触器 (MC) 主接点 3極" && R.mc.n2 === "電磁接触器 (MC) 主接点 2極" &&
    R.mc.found === true,
  link: R.link.inCoil === true && R.link.inMs === true && R.link.msMirror === true,
  out: R.out.svg === true && R.out.dxf === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("ms-symbol OK");
