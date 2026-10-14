/* プルアップ抵抗と類似部品 (受動部品)。

   ・have   : プルアップ/プルダウン抵抗・バリスタ・サーミスタ・CRユニットが
             ライブラリに居る (棚=受動部品、絵が描ける)
   ・palette: 既定でパレットの「データベース」棚に出る (既存の抵抗器・
             コンデンサ・ダイオードなども一緒に)
   ・migrate: 旧版 (ver7) のピン一覧を持つ利用者にも新記号が追い足される
   ・value  : 値 (10kΩ 1/4W など) はプロパティの「値・定格」に手入力でき、
             図面・印刷 SVG・DXF に出る。型式は部品表に出る
   ・label  : プロパティの欄名は受動部品では「値・定格」、他の機器では
             従来の「機能テキスト」のまま */
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
  const IDS = ["resistor_pullup", "resistor_pulldown", "varistor", "thermistor", "cr_unit",
    "resistor_z", "resistor_pullup_z", "resistor_pulldown_z"];
  out.have = IDS.every(id => {
    const s = SYMBOLS_BY_ID[id];
    return s && s.group === "受動部品" && s.pins.length === 2 && symThumbSVG(s).includes("<path");
  });
  out.letters = ["resistor_pullup", "varistor", "thermistor", "cr_unit"]
    .map(id => SYMBOLS_BY_ID[id].letter).join(",");
  // パレット (データベース棚) に既定で出る
  UI.buildPalette();
  const palNames = [...document.querySelectorAll("#symTree .sym-name")].map(e2 => e2.textContent);
  out.palette = ["プルアップ抵抗", "プルダウン抵抗", "バリスタ", "サーミスタ", "CRユニット (サージキラー)",
    "抵抗器", "コンデンサ", "ダイオード",
    "抵抗器 (ジグザグ形)", "プルアップ抵抗 (ジグザグ形)", "プルダウン抵抗 (ジグザグ形)"].every(n => palNames.includes(n));
  // ジグザグ形は山形の折れ線 (L が 7 回) で描かれる
  out.zigzag = (SYMBOLS_BY_ID.resistor_z.body.match(/L/g) || []).length >= 7 &&
    !SYMBOLS_BY_ID.resistor_z.body.includes("<rect");
  // 旧版のピン一覧からの追い足し (DB_PINNED_VER の移行)
  localStorage.setItem("electracad.dbPinned", JSON.stringify(["cable_core"]));
  localStorage.setItem("electracad.dbPinnedVer", "7");
  const merged = dbPinnedList();
  out.migrate = merged.includes("resistor_pullup") && merged.includes("varistor") &&
    merged.includes("resistor_pullup_z") && merged.includes("cable_core");
  // すでに ver8 (箱形の追い足し済み) の利用者にも、ジグザグ形が追い足される
  localStorage.setItem("electracad.dbPinned", JSON.stringify(["cable_core", "resistor_pullup"]));
  localStorage.setItem("electracad.dbPinnedVer", "8");
  out.migrate8 = dbPinnedList().includes("resistor_pullup_z");

  // ── 値の手入力 → 図面・印刷・DXF に出る ──
  App.project = newProject("プルアップ"); UI.renumberPages();
  const pg = App.project.pages.find(isDrawingPage);
  App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
  pg.devices.length = 0; pg.wires.length = 0;
  const r1v = addDevice(pg, "resistor_pullup", 120, 100, { tag: "-R1" });
  App.selection.clear(); App.selection.add(r1v.id); UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const pane = document.getElementById("pane-props");
  out.label = { val: pane.innerHTML.includes("値・定格 (図面に表示)"),
    ph: !!pane.querySelector('#pDesc[placeholder*="10kΩ"]') };
  const inp = pane.querySelector("#pDesc");
  inp.value = "10kΩ 1/4W";
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  const typ = pane.querySelector("#pType");
  typ.value = "RD25S 10K";
  typ.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  App.labelRev++;
  const svg = exportSheetSVG(pg);
  applySheet(pg);
  const dxf = pageToDXF(pg);
  out.value = { desc: r1v.desc === "10kΩ 1/4W",
    svg: svg.includes("10kΩ 1/4W"), dxf: dxf.includes("10kΩ 1/4W") };
  // 部品表に型式が出る
  out.bom = JSON.stringify(buildBOM()).includes("RD25S 10K");
  // 受動部品でない機器 (コイル) は従来の「機能テキスト」のまま
  const k1 = addDevice(pg, "coil", 200, 100, { tag: "-K1" });
  App.selection.clear(); App.selection.add(k1.id); UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  out.label.coil = document.getElementById("pane-props").innerHTML.includes("機能テキスト");
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  have: R.have === true && R.letters === "R,Z,TH,CR" && R.zigzag === true,
  palette: R.palette === true,
  migrate: R.migrate === true && R.migrate8 === true,
  value: R.value.desc === true && R.value.svg === true && R.value.dxf === true &&
    R.bom === true,
  label: R.label.val === true && R.label.ph === true && R.label.coil === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("passive-parts OK");
