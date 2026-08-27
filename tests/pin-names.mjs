/* 接点番号 (端子番号) の変更 — プロパティで機器ごとに上書きできる。

   ・defaultAuto : a接点を置くと従来どおり 13/14 の自動採番で表示される
   ・uiShown     : プロパティに「端子番号」欄 (端子ごとの入力・既定値を表示) が出る
   ・override    : 端子1 を 53・端子2 を 54 に上書き → 画面のラベルが 53/54 になる
   ・linkedAuto  : コイルに連動する 2 個目の接点は自動で 23/24。上書きすると
                   その番号になり、空欄に戻すと自動採番 (23) へ戻る
   ・everywhere  : DXF 出力・接続リスト (buildConnectionList) にも上書きが出る
   ・undoBack    : 元に戻す (undo) で上書き前へ戻る
   ・cleanProps  : 全端子を空欄に戻すと props.pinNames 自体が消える (保存を汚さない) */
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
  const symC = allSymbols().find(s => (s.pins || []).map(q => q.n).join(",") === "13,14");
  out.symId = symC && symC.id;
  const pg = newPage("pn", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  applySheet(pg);
  const d1 = addDevice(pg, symC.id, 100, 100, {});
  UI.refresh();
  await new Promise(r => setTimeout(r, 150));
  out.defaultAuto = {
    n0: effectivePinName(d1, 0), n1: effectivePinName(d1, 1),
    drawn: Editor.svg.innerHTML.includes(">13</text>") && Editor.svg.innerHTML.includes(">14</text>"),
  };

  // ── プロパティの端子番号欄 ──
  App.selection.clear(); App.selection.add(d1.id);
  UI.refresh(); UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const inputs = [...document.querySelectorAll(".pPinNm")];
  out.uiShown = { n: inputs.length, ph: inputs.map(el => el.placeholder).join(",") };

  // ── 53/54 へ上書き ──
  const setPin = async (i, v) => {
    const el = document.querySelector(`.pPinNm[data-pi="${i}"]`);
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
  };
  await setPin(0, "53");
  await setPin(1, "54");
  out.override = {
    n0: effectivePinName(d1, 0), n1: effectivePinName(d1, 1),
    props: JSON.stringify(d1.props.pinNames),
    drawn: Editor.svg.innerHTML.includes(">53</text>") && Editor.svg.innerHTML.includes(">54</text>")
      && !Editor.svg.innerHTML.includes(">13</text>"),
  };
  out.everywhere = {
    dxf: pageToDXF(pg).includes("53"),
    conn: JSON.stringify(buildConnectionList()),   // 後で 53 を含むか見る (配線なしなら空でも可)
  };
  // 配線で2端子を結んで接続リストに出す (1端子だけのネットは行にならない)
  const pn0 = devPins(d1)[0], pn1 = devPins(d1)[1];
  addWire(pg, [[pn0.x, pn0.y], [pn0.x, pn0.y - 10], [pn1.x, pn1.y - 10], [pn1.x, pn1.y]], { raw: true }).num = "201";
  out.everywhere.connRows = JSON.stringify(buildConnectionList()).includes(":53");

  // ── 連動接点の自動採番と上書き・空欄で復帰 ──
  const coil = addDevice(pg, "coil", 160, 100, {});
  const c1 = addDevice(pg, symC.id, 200, 100, { linkTo: coil.id });
  const c2 = addDevice(pg, symC.id, 240, 100, { linkTo: coil.id });
  out.linkedAuto = { second: effectivePinName(c2, 0) };          // 2個目 → 23
  c2.props.pinNames = { 0: "31", 1: "32" };
  out.linkedAuto.over = effectivePinName(c2, 0);
  delete c2.props.pinNames;
  out.linkedAuto.back = effectivePinName(c2, 0);

  // ── undo で戻る (undo はプロジェクトを差し替えるので参照を取り直す) ──
  undo();   // pin1=54 の上書きを取り消す
  const d1b = curPage().devices.find(x => x.id === d1.id);
  out.undoBack = effectivePinName(d1b, 1);

  // ── 全部空欄に戻すと props.pinNames が消える ──
  App.selection.clear(); App.selection.add(d1b.id);
  UI.refresh(); UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  await setPin(0, "");
  const d1c = curPage().devices.find(x => x.id === d1.id);
  out.cleanProps = d1c.props.pinNames === undefined && effectivePinName(d1c, 0) === "13";
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  defaultAuto: R.defaultAuto.n0 === "13" && R.defaultAuto.n1 === "14" && R.defaultAuto.drawn,
  uiShown: R.uiShown.n === 2 && R.uiShown.ph === "13,14",
  override: R.override.n0 === "53" && R.override.n1 === "54" && R.override.drawn,
  linkedAuto: R.linkedAuto.second === "23" && R.linkedAuto.over === "31" && R.linkedAuto.back === "23",
  everywhere: R.everywhere.dxf === true && R.everywhere.connRows === true,
  undoBack: R.undoBack === "14",
  cleanProps: R.cleanProps === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("pin-names OK");
