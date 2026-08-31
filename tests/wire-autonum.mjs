/* 線番の自動採番 — 手入力なしで「図番 × 100 + 連番」が付き、
   機器 (接点・コイル) を跨ぐと区間が変わる (周辺の記号と図番で破断)。

   ・pagePrefix : 図番 E-003 のページは 301, 302 … / E-004 のページは 401 …
                  (図面のタイトルで番号体系が破断する)
   ・deviceBreak: 接点の左右で番号が変わる (機器で破断)
   ・drawAssign : 配線ツールで引いた瞬間に番号が付いて表示される (入力不要)
   ・joinNet    : 既存の線へ突き当てると同じ番号になる (新番号を増やさない)
   ・manualKeep : 手で入れた線番は自動採番から保護される
   ・potentials : 電源 (+24V/0V)・電位リンク・接地 (PE) は連番でなく電位名のまま
   ・alwaysShow : 線番を持っているのにどこにも出ていないネットは、次の採番で
                  必ず 1 箇所に出す (「入力したのに表示されない」を作らない)。
                  古い図面を開いたときも開いた時点で直る
   ・numOff     : 線番を空欄にすると、その配線には線番を出さない
                  (自動採番も付けない)。「自動採番に戻す」で元どおり
   ・stable     : もう一度実行しても番号が変わらない (据え置き)
   ・unique     : 全ページを通して同じ番号が 2 つ印字されない */
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
  App.project = newProject("線番テスト");
  UI.renumberPages();
  const p1 = App.project.pages.find(isDrawingPage);       // E-004 (頭3枚の後)
  const p2 = newPage("次葉", App.project.pages.length + 1);
  App.project.pages.push(p2);
  UI.renumberPages();
  out.dwg = [pageDwgNo(p1), pageDwgNo(p2)];
  App.pageIdx = App.project.pages.indexOf(p1); applySheet(p1);

  // 接点を挟んだ 2 区間 + もう 1 本
  const d = addDevice(p1, "pb_no", 100, 100, {});
  const pins = devPins(d);
  addWire(p1, [[60, pins[0].y], [pins[0].x, pins[0].y]], { raw: true });
  addWire(p1, [[pins[1].x, pins[1].y], [pins[1].x, pins[1].y + 30]], { raw: true });
  // どのピンにも触れない線 (配置図の作画など) — 線番は付かない
  addWire(p1, [[60, 160], [140, 160]], { raw: true });
  // 次葉にも機器つきで 1 本
  const d2 = addDevice(p2, "pb_no", 100, 100, {});
  const pins2 = devPins(d2);
  addWire(p2, [[60, pins2[0].y], [pins2[0].x, pins2[0].y]], { raw: true });
  autoNumberWires();
  const base1 = parseInt(/(\d+)\s*$/.exec(pageDwgNo(p1))[1], 10) * 100;
  const base2 = parseInt(/(\d+)\s*$/.exec(pageDwgNo(p2))[1], 10) * 100;
  out.nums1 = p1.wires.map(w => w.num);
  out.nums2 = p2.wires.map(w => w.num);
  out.base = [base1, base2];
  const numbered1 = p1.wires.filter(w => w.num != null);
  out.pagePrefix = numbered1.length === 2 && numbered1.every(w => +w.num > base1 && +w.num < base1 + 100)
    && p2.wires.every(w => +w.num > base2 && +w.num < base2 + 100);
  out.deviceBreak = p1.wires[0].num !== p1.wires[1].num;
  out.bareSkip = p1.wires[2].num == null && p1.wires[2].numShow !== true;

  // ── 実際に配線ツールで引く → その場で番号が付く ──
  UI.setTool("wire");
  UI.refresh(); zoomFit();
  await new Promise(r => setTimeout(r, 200));
  const bb = Editor.svg.getBoundingClientRect();
  const S = (x, y) => [bb.left + Editor.view.tx + x * Editor.view.s, bb.top + Editor.view.ty + y * Editor.view.s];
  const click = (x, y) => {
    const [cx, cy] = S(x, y);
    ["mousedown", "mouseup", "click"].forEach(t =>
      Editor.svg.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: cx, clientY: cy })));
  };
  // 機器のピンへ向けて引く → その場で番号が付く (ピンに触れない線は対象外)
  const d3 = addDevice(p1, "pb_no", 100, 200, {});
  const pins3 = devPins(d3);
  click(60, pins3[0].y); click(pins3[0].x, pins3[0].y);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const drawn = p1.wires[p1.wires.length - 1];
  out.drawAssign = { num: drawn.num, shown: Editor.layers.wires.innerHTML.includes(`>${drawn.num}</text>`) };

  // 既存の線へ突き当てる → 同じ番号 (ネットに合流)
  const before = p1.wires.length;
  click(80, pins3[0].y - 20); click(80, pins3[0].y);
  await new Promise(r => setTimeout(r, 200));
  const joined = p1.wires[p1.wires.length - 1];
  out.joinNet = { grew: p1.wires.length === before + 1, num: joined.num, same: joined.num === drawn.num };
  UI.setTool("select");

  // ── 手動線番の保護 ──
  //    (ピンに触れない線でも、手で入れた線番はそのまま残り・表示される)
  setWireNumber(p1, p1.wires[2], "L99");
  autoNumberWires();
  out.manualKeep = p1.wires[2].num === "L99" && p1.wires[2].fixed === true
    && p1.wires[2].numShow === true;

  /* ── 線番があるのに表示フラグが落ちている状態を直す ── */
  {
    const pg = curPage();
    const w3 = condWires(pg).find(q => q.num) || pg.wires[0];
    w3.num = "Z9";                       // 番号はあるが
    condWires(pg).forEach(q => { q.numShow = false; });   // どこにも出ていない
    UI.refresh();
    await new Promise(r => setTimeout(r, 120));
    const before = Editor.layers.wires.innerHTML.includes(">Z9<");
    autoNumberWires();                   // 次の採番で拾われる
    UI.refresh();
    await new Promise(r => setTimeout(r, 120));
    out.alwaysShow = { before, after: Editor.layers.wires.innerHTML.includes(">Z9<"), num: w3.num };
    // 図面を開き直したとき (保存データが古い版) も直る。
    // 元の図面は後の検査で使うので、複製で試して必ず戻す
    const orig = App.project;
    const snap = JSON.parse(JSON.stringify(App.project));
    snap.pages.forEach(p2 => (p2.wires || []).forEach(q => { q.numShow = false; }));
    App.project = snap;
    normalizeWireNumbers();
    App.labelRev++;
    UI.refresh();
    await new Promise(r => setTimeout(r, 120));
    out.alwaysShow.onLoad = Editor.layers.wires.innerHTML.includes(">Z9<");
    App.project = orig;
    App.labelRev++;
    UI.refresh();
    await new Promise(r => setTimeout(r, 120));
  }

  /* ── 空欄 = 線番を出さない ── */
  {
    const w2 = p1.wires.find(q => q.num && !q.fixed) || p1.wires[1];
    const had = w2.num;
    setWireNumber(p1, w2, "");           // 空欄にする
    autoNumberWires();
    UI.refresh();
    await new Promise(r => setTimeout(r, 150));
    const shownNow = Editor.layers.wires.innerHTML;
    out.numOff = {
      had, num: w2.num, off: !!w2.numOff,
      // 同じネットの他の配線にも出ていないこと
      netQuiet: (() => {
        const { wireNet } = computeNets(p1, "open");
        const net = wireNet.get(w2.id);
        return condWires(p1).filter(q => wireNet.get(q.id) === net).every(q => !q.num);
      })(),
      drawn: had ? shownNow.includes(`>${had}</text>`) : false,
    };
    setWireNumber(p1, w2, "", { auto: true });   // 自動採番に戻す
    autoNumberWires();
    out.numOff.back = !!w2.num && !w2.numOff;
  }

  // ── 電位名 (電源・リンク・接地) ──
  const p3 = newPage("電位", App.project.pages.length + 1);
  App.project.pages.push(p3); UI.renumberPages();
  const lk = addDevice(p3, "link", 100, 60, { tag: "-W205" });
  addWire(p3, [[100, 60], [100, 90]], { raw: true });
  // PE と刻印された端子 (モータの PE ピン) につながるネットは電位名 PE になる
  const mt = addDevice(p3, "motor3", 200, 120, {});
  const pep = devPins(mt).find(q => q.name === "PE");
  addWire(p3, [[pep.x, pep.y - 20], [pep.x, pep.y]], { raw: true });
  autoNumberWires();
  out.potentials = { link: p3.wires[0].num, earth: p3.wires[1].num };

  // ── 据え置き: 線を 1 本消して再実行しても、残りの番号がずれない ──
  //    (同じ順序での再実行は据え置きが無くても同じ結果になるので、
  //     消してから再実行して初めて据え置きの有無が分かる)
  const victim = p1.wires[0];
  const keepIds = p1.wires.filter(w => w !== victim).map(w => w.id);
  const keepBefore = keepIds.map(id => p1.wires.find(w => w.id === id).num);
  p1.wires.splice(p1.wires.indexOf(victim), 1);
  autoNumberWires();
  const keepAfter = keepIds.map(id => p1.wires.find(w => w.id === id).num);
  out.stable = JSON.stringify(keepBefore) === JSON.stringify(keepAfter);
  const shown = [];
  App.project.pages.forEach(pg => condWires(pg).forEach(w => { if (w.num && w.numShow !== false) shown.push(w.num); }));
  out.unique = shown.length === new Set(shown).size;
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  pagePrefix: R.pagePrefix === true,
  deviceBreak: R.deviceBreak === true,
  drawAssign: !!R.drawAssign.num && R.drawAssign.shown === true,
  bareSkip: R.bareSkip === true,
  joinNet: R.joinNet.grew && R.joinNet.same === true,
  manualKeep: R.manualKeep === true,
  alwaysShow: R.alwaysShow.before === false && R.alwaysShow.after === true
    && R.alwaysShow.onLoad === true,
  numOff: !!R.numOff.had && R.numOff.num === null && R.numOff.off === true
    && R.numOff.netQuiet === true && R.numOff.drawn === false && R.numOff.back === true,
  potentials: R.potentials.link === "W205" && R.potentials.earth === "PE",
  stable: R.stable === true,
  unique: R.unique === true,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("wire-autonum OK");
