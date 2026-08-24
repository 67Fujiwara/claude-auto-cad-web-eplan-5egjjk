/* 重なりの中の選択と、囲み記号のタグ重複。

   1. 機器の外形箱の中を通る導体をクリックで選べる (今までは箱に食われて
      選べなかった — 端子を貫く線・PLCユニット上の線など)
   2. 破線枠 (盤外/グループ) の枠線も、機器の外形箱と重なった場所で選べる
   3. 囲み記号 (多芯ケーブル・シールド) は輪郭の近傍だけで拾い、囲んだ
      導体は中で普通に選べる。内側の空白は空クリック (枠選択が始まる)
   4. 選択中のものは重なりの中でも優先して拾う (選択済み機器を、上に重なる
      導体ごしにつまんでドラッグできる)
   5. 多芯ケーブル・シールドは機器ではなく導体への注記なので、同じ呼び
      (例 -sq1.25) を何個置いてもデバイスタグ重複にしない。普通の機器の
      タグ重複は従来どおりエラー */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  const pg = newPage("hit", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  App.selection.clear();
  const hit = (x, y) => { const h = hitTest(x, y); return h ? { type: h.type, id: h.obj.id } : null; };

  // 端子 (円の中心を導体が貫く) — 中心=ローカル(0,10)
  const term = addDevice(pg, "terminal", 100, 60, { tag: "-X1" });
  addWire(pg, [[100, 40], [100, 140]]);
  const wire1 = pg.wires[pg.wires.length - 1];
  out.wireOverDevice = hit(100, 70);                    // 円の中心 = 導体の上 → 導体
  out.deviceStill = hit(103, 70);                       // 導体から 3mm 外れた円周上 → 端子

  // 破線枠の左枠線がコイルの外形箱を貫く
  pg.zones = [{ id: "z1", x: 90, y: 30, w: 120, h: 100, label: "盤外" }];
  const coil = addDevice(pg, "coil", 90, 80, { tag: "-K1" });
  out.zoneOverDevice = hit(90, 85);                     // 枠線上 (コイルの箱の中) → 枠
  out.coilStill = hit(94, 88);                          // 枠線から離れたコイルの体 → コイル

  // 多芯ケーブル (長円 R=5・芯 (0,0)〜(0,15)) が導体を囲む
  const cab = addDevice(pg, "cable_core@25", 200, 60, { tag: "-sq1.25" });
  addWire(pg, [[180, 65], [220, 65]]);
  const wire2 = pg.wires[pg.wires.length - 1];
  out.enclWire = hit(200, 65);                          // 長円の中の導体 → 導体
  out.enclEmpty = hit(200, 62.5);                       // 長円の中の空白 → 空クリック
  out.enclOutline = hit(205, 67);                       // 長円の輪郭 → ケーブル
  // 回転 (rot 90) でも輪郭で拾える
  const cab2 = addDevice(pg, "cable_core@25", 250, 100, { rot: 90, tag: "-sq1.25" });
  const s0 = pinAbs(cab2, { x: 0, y: 0 }), s1 = pinAbs(cab2, { x: 0, y: 15 });
  const mx = (s0.x + s1.x) / 2, my = (s0.y + s1.y) / 2;         // 芯の中点
  const nx = Math.abs(s1.y - s0.y) > 0.01 ? 5 : 0, ny = nx ? 0 : 5; // 芯と直交方向へ半幅 5
  out.enclRot = hit(mx + nx, my + ny);

  // 選択中は重なりの中でも優先
  App.selection.clear(); App.selection.add(term.id);
  out.selectedWins = hit(100, 70);                      // 導体の上でも選択中の端子
  App.selection.clear();

  // タグ重複: ケーブルは同じ呼びでも良い / 普通の機器は従来どおりエラー
  const dupOf = tag => runDRC().filter(i => /タグ.*重複/.test(i.msg) && i.msg.includes(tag)).length;
  out.cableDup = dupOf("-sq1.25");                      // cab / cab2 が同タグ → 0 のはず
  addDevice(pg, "coil", 140, 80, { tag: "-K1" });       // -K1 を故意に重複
  out.coilDup = dupOf("-K1");
  out.ids = { term: term.id, wire1: wire1.id, wire2: wire2.id, cab: cab.id, cab2: cab2.id, coil: coil.id, z: "z1" };
  return out;
});

const is = (r, type, key) => r && r.type === type && r.id === R.ids[key];
const checks = {
  noPageErrors: errs.length === 0,
  wireOverDevice: is(R.wireOverDevice, "wire", "wire1"),
  deviceStill: is(R.deviceStill, "device", "term"),
  zoneOverDevice: is(R.zoneOverDevice, "zone", "z"),
  coilStill: is(R.coilStill, "device", "coil"),
  enclWire: is(R.enclWire, "wire", "wire2"),
  enclEmpty: R.enclEmpty === null,
  enclOutline: is(R.enclOutline, "device", "cab"),
  enclRot: is(R.enclRot, "device", "cab2"),
  selectedWins: is(R.selectedWins, "device", "term"),
  cableDupOk: R.cableDup === 0,
  coilDupErr: R.coilDup >= 1,
};
console.log(JSON.stringify(R, null, 1));
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); if (!v) fail++; }
if (errs.length) console.log("ERRORS", errs);
await b.close();
process.exit(fail ? 1 : 0);
