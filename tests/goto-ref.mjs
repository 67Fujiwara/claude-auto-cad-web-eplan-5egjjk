/* 「行き先 (継続先)」記号が、図面の続きを追える形で働くことを確かめる。

   要求は 3 つ。
   ・行き先は図面番号を表示すること
   ・図面番号はプルダウンで変更できること
   ・ページ番号を変更しても図面番号も連動すること

   3 つ目が肝で、図番の文字列を記号に持たせてしまうと、ページを入れ替えた瞬間に
   図面じゅうの行き先が嘘になる。そこで記号が持つのはページの id だけにして、
   図番は描くたびに指し先のページから引く。このテストは「文字列を焼き付けて
   いない」ことまで見る (保存データに図番が現れないこと・並べ替え/採番変更/
   ページ個別の図番のどれでも追従すること)。

   判定
   ・記号が 1 極 (線 1 本) で、図番を旗の中に表示すること
   ・図番が指し先ページの pageDwgNo と一致し、画面 (SVG) にもその文字が出ること
   ・図番の文字列を保存データに持たないこと
   ・並べ替え・接頭辞の変更・ページ個別図番・ページ追加のどれでも追従すること
   ・プルダウン (#pGoto) が実際の操作で効き、自ページは選べず、
     並べ替え後は選択肢の表示も新しい図番になること
   ・未設定は警告、指し先が削除済みならエラー、正しく指していれば 0 件
   ・図番が旗 (24mm) に入りきらなければ警告
   ・図番の文字が旗の中央にあり、機器を 0/90/180/270 回しても旗から出ないこと
   ・DXF にも同じ文字が同じ位置で出ること */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(() => {
  const out = {};
  const mk = (name) => {
    const pg = newPage(name, App.project.pages.length + 1);
    App.project.pages.push(pg); UI.renumberPages(); return pg;
  };
  App.project = newProject("行き先テスト");     // 既定のページ構成に左右されないように
  const p1 = App.project.pages[0];
  p1.name = "制御回路"; UI.renumberPages();
  const p2 = mk("主回路"), p3 = mk("動力回路");
  App.pageIdx = 0;
  const dev = addDevice(p1, "goto_ref", 100, 60, { tag: "" });
  addWire(p1, [[85, 60], [100, 60]]);          // 行き先は線の終端に置く記号

  const sym = symOf("goto_ref");
  out.sym = { gotoRef: !!sym.gotoRef, pins: sym.pins.length, cat: sym.cat, name: sym.name };

  /* 旗 (2 本目の path = 矢羽根の輪郭) の範囲を body から直に読む。文字の位置は
     図形そのものを基準に見るので、旗の形を変えれば必ずここで落ちる */
  const walk = (d) => {
    const xs = [], ys = [];
    let x = 0, y = 0;
    const tk = d.match(/[MLHVZ]|-?\d+(?:\.\d+)?/gi) || [];
    for (let i = 0; i < tk.length; i++) {
      const c = tk[i].toUpperCase();
      if (c === "M" || c === "L") { x = +tk[++i]; y = +tk[++i]; }
      else if (c === "H") x = +tk[++i];
      else if (c === "V") y = +tk[++i];
      else if (c === "Z") continue;
      else continue;
      xs.push(x); ys.push(y);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const flag = walk((sym.body.match(/<path d="([^"]+)"/g) || [])[1].match(/d="([^"]+)"/)[1]);
  out.flag = flag;

  const shown = () => { const xr = deviceXrefBox(p1, dev); return xr ? xr.text : "(なし)"; };
  const drawnText = () => {                     // 実際に紙へ出る文字 (この記号のぶんだけ)
    const svg = devLabelsSVG(dev, symOf(dev.sym), p1);
    const m = svg.match(/<text[^>]*fill="#7a4ec2"[^>]*>([^<]*)<\/text>/);
    return m ? m[1] : "(なし)";
  };
  const drc = () => runDRC().filter(i => i.target === dev.id).map(i => `${i.sev}:${i.msg}`);

  // ① 未設定
  out.unset = { shown: shown(), drc: drc() };

  // ② 2 ページ目を指す (図番はそのページのもの)
  dev.props = dev.props || {}; dev.props.toPage = p2.id;
  out.set = { shown: shown(), drawn: drawnText(), want: pageDwgNo(p2), drc: drc() };

  // ③ 図番の文字列を持っていないこと (持っていたら並べ替えで嘘になる)
  out.storedProps = JSON.stringify(dev.props);
  out.storedHasNumber = JSON.stringify(App.project).includes(`"${pageDwgNo(p2)}"`) &&
    JSON.stringify(dev).includes(pageDwgNo(p2));

  // ④ 並べ替えに追従 (2 ページ目を先頭へ)
  UI.movePage(1, 0);
  out.moved = { shown: shown(), want: pageDwgNo(App.project.pages.find(pg => pg.id === p2.id)), order: App.project.pages.map(pg => pg.no + ":" + pg.name).join(",") };
  UI.movePage(0, 1);   // 戻す

  // ⑤ 図番の接頭辞を変えると追従
  projectMeta().dwgNo = "TK-2026-010"; UI.renumberPages();
  out.prefix = { shown: shown(), want: pageDwgNo(p2) };

  // ⑥ そのページだけ手入力の図番にしても追従
  p2.dwgNo = "SPECIAL-77"; p2.dwgNoManual = true; UI.renumberPages();
  out.manual = shown();
  delete p2.dwgNoManual; UI.renumberPages();

  // ⑦ 前にページを足して番号がずれても追従
  const p0 = mk("表紙");
  App.project.pages.pop(); App.project.pages.unshift(p0); UI.renumberPages();
  out.inserted = { shown: shown(), want: pageDwgNo(p2), pageNo: p2.no };
  App.project.pages.shift(); UI.renumberPages();
  projectMeta().dwgNo = ""; UI.renumberPages();

  // ⑧ 保存 → 読込 のあとも追従が続く (id を保存しているので)
  const json = JSON.stringify(App.project);
  App.project = JSON.parse(json); App.pageIdx = 0;
  const dev2 = App.project.pages[0].devices.find(d => symOf(d.sym).gotoRef);
  const q2 = App.project.pages[1];
  out.reload = { shown: deviceXrefBox(App.project.pages[0], dev2).text, want: pageDwgNo(q2) };
  UI.movePage(1, 2);   // 読み込んだ側でも並べ替えに追従するか
  out.reloadMoved = { shown: deviceXrefBox(App.project.pages[0], dev2).text, want: pageDwgNo(App.project.pages.find(pg => pg.id === q2.id)) };
  UI.movePage(2, 1);

  // ⑨ 文字の位置: 旗の中央にあり、旗の内側に収まる (回しても同じ)
  const d3 = App.project.pages[0].devices.find(x => symOf(x.sym).gotoRef);
  out.place = {};
  [0, 90, 180, 270].forEach(rot => {
    d3.rot = rot;
    const xr = deviceXrefBox(App.project.pages[0], d3);
    const c = { x: xr.box.x + xr.box.w / 2, y: xr.box.y + xr.box.h / 2 };
    const want = pinAbs(d3, { x: (flag.x0 + flag.x1) / 2, y: (flag.y0 + flag.y1) / 2 });
    // 旗の四隅 (回した後) の内側にあるか
    const corners = [[flag.x0, flag.y0], [flag.x1, flag.y0], [flag.x1, flag.y1], [flag.x0, flag.y1]]
      .map(([x, y]) => pinAbs(d3, { x, y }));
    const fx0 = Math.min(...corners.map(v => v.x)), fx1 = Math.max(...corners.map(v => v.x));
    const fy0 = Math.min(...corners.map(v => v.y)), fy1 = Math.max(...corners.map(v => v.y));
    out.place[rot] = {
      off: Math.hypot(c.x - want.x, c.y - want.y).toFixed(3),
      inside: xr.box.x >= fx0 - 0.01 && xr.box.x + xr.box.w <= fx1 + 0.01 &&
              xr.box.y >= fy0 - 0.01 && xr.box.y + xr.box.h <= fy1 + 0.01,
      angle: xr.angle,                   // 旗の長手に沿う (JIS Z 8313-0 の読む向き)
      // 画面 (SVG) の文字も同じ角度で出ているか
      svg: /transform="rotate\(-90 /.test(devLabelsSVG(d3, symOf(d3.sym), App.project.pages[0])),
    };
  });
  d3.rot = 0;

  // ⑩ DXF に同じ文字が同じ位置で出る
  const xr0 = deviceXrefBox(App.project.pages[0], d3);
  const t = pageToDXF(App.project.pages[0]);
  const re = new RegExp(`\\n1\\n${xr0.text}\\n`);
  out.dxf = { has: re.test(t), text: xr0.text };
  // TEXT エンティティを拾って画面と同じ位置か見る (DXF は Y 反転)
  const ent = t.split("\n0\nTEXT\n").find(s => s.startsWith("8\nWIRENUM") && s.includes("\n1\n" + xr0.text + "\n"));
  if (ent) {
    const gx = parseFloat((/\n10\n(-?[\d.]+)/.exec(ent) || [])[1]);
    const gy = parseFloat((/\n20\n(-?[\d.]+)/.exec(ent) || [])[1]);
    // DXF は左寄せしか持たないので、中央寄せは基点をずらして表す。
    // 画面の外接矩形の左端と一致していれば、両方で同じ位置に見える
    out.dxf.dx = Math.abs(gx - xr0.box.x).toFixed(3);
    out.dxf.dy = Math.abs((SHEET.h - gy) - xr0.y).toFixed(3);
  }

  // ⑩b 縦置きの行き先は DXF でも 90° で出る
  d3.rot = 90;
  const xr9 = deviceXrefBox(App.project.pages[0], d3);
  const t9 = pageToDXF(App.project.pages[0]);
  const e9 = t9.split("\n0\nTEXT\n").find(s2 => s2.startsWith("8\nWIRENUM") && s2.includes("\n1\n" + xr9.text + "\n"));
  out.dxfRot = e9 ? {
    ang: (/\n50\n(-?[\d.]+)/.exec(e9) || [])[1],
    // 90° なので基点は文字列の下端。画面の外接矩形の下辺と一致するはず
    dx: Math.abs(parseFloat((/\n10\n(-?[\d.]+)/.exec(e9) || [])[1]) - xr9.x).toFixed(3),
    dy: Math.abs((SHEET.h - parseFloat((/\n20\n(-?[\d.]+)/.exec(e9) || [])[1])) - (xr9.box.y + xr9.box.h)).toFixed(3),
  } : null;
  d3.rot = 0;

  // ⑪ 指し先が消えたら (ページ削除) エラー
  const drc2 = (rule) => runDRC().filter(i => i.target === d3.id && (!rule || i.rule === rule))
    .map(i => `${i.sev}:${i.msg}`);
  out.okDrc = drc2();
  const ti = App.project.pages.findIndex(pg => pg.id === d3.props.toPage);
  const keep = App.project.pages[ti];
  App.project.pages.splice(ti, 1); UI.renumberPages();
  out.deleted = { shown: deviceXrefBox(App.project.pages[0], d3).text, drc: drc2() };
  App.project.pages.splice(ti, 0, keep); UI.renumberPages();

  // ⑫ 図番が旗 (24mm) に入りきらない
  projectMeta().dwgNo = "PROJECT-2026-VERYLONG-0010"; UI.renumberPages();
  out.tooWide = drc2("行き先未設定");
  projectMeta().dwgNo = ""; UI.renumberPages();
  out.finalDrc = drc2();
  return out;
});
console.log(JSON.stringify(R, null, 1));

/* ここからは実際の操作経路。プルダウンで選べなければ要求を満たさない */
await p.evaluate(() => {
  const dev = App.project.pages[0].devices.find(d => symOf(d.sym).gotoRef);
  dev.props = {};                     // 未設定に戻してから操作で選ぶ
  App.pageIdx = 0; App.selection.clear(); App.selection.add(dev.id);
  UI.showProps();
});
await p.waitForSelector("#pGoto");
const U = {};
U.options = await p.$$eval("#pGoto option", els => els.map(e => e.textContent));
U.pageCount = await p.evaluate(() => App.project.pages.length);
U.self = await p.evaluate(() => {
  const cur = curPage();
  return [...document.querySelectorAll("#pGoto option")].every(o => o.value !== cur.id);
});
const target = await p.evaluate(() => App.project.pages[2].id);
await p.selectOption("#pGoto", target);
await p.waitForTimeout(300);
U.afterSelect = await p.evaluate(() => {
  const dev = App.project.pages[0].devices.find(d => symOf(d.sym).gotoRef);
  return { shown: deviceXrefBox(App.project.pages[0], dev).text, want: pageDwgNo(App.project.pages[2]),
    stored: JSON.stringify(dev.props) };
});
// 並べ替えたあと、プルダウンの表示も新しい図番になっているか
await p.evaluate(() => { UI.movePage(2, 0); UI.showProps(); });
await p.waitForSelector("#pGoto");
U.afterMove = await p.evaluate(() => {
  const dev = App.project.pages.flatMap(pg => pg.devices).find(d => symOf(d.sym).gotoRef);
  const f = App.project.pages.find(pg => pg.devices.includes(dev));
  const sel = document.querySelector("#pGoto");
  const tp = App.project.pages.find(pg => pg.id === (dev.props || {}).toPage);
  return { shown: deviceXrefBox(f, dev).text,
    want: tp ? pageDwgNo(tp) : "(行き先が入っていない)",
    label: sel.options[sel.selectedIndex].textContent };
});
// 「— 未設定 —」に戻せること
await p.evaluate(() => { App.pageIdx = App.project.pages.findIndex(pg => pg.devices.some(d => symOf(d.sym).gotoRef)); UI.showProps(); });
await p.waitForSelector("#pGoto");
await p.selectOption("#pGoto", "");
await p.waitForTimeout(200);
U.cleared = await p.evaluate(() => {
  const f = App.project.pages.find(pg => pg.devices.some(d => symOf(d.sym).gotoRef));
  const dev = f.devices.find(d => symOf(d.sym).gotoRef);
  return { shown: deviceXrefBox(f, dev).text, stored: JSON.stringify(dev.props) };
});
console.log("操作:", JSON.stringify(U, null, 1));

/* シミュレーションに影響しないこと。行き先は「図面の続きはこの図番へ」という
   注記であって電気部品ではない。通電もしないし、指した先のページへ電位を
   渡しもしない (それをするのは電位リンク)。検図・部品表・端子表も変えない */
const S = await p.evaluate(() => {
  const o = {};
  App.project = newProject("シミュレーション影響なし");
  const pg = App.project.pages[0];
  const p2 = newPage("次葉", 2); App.project.pages.push(p2); UI.renumberPages(); App.pageIdx = 0;
  addDevice(pg, "psu24", 60, 40, { tag: "-G1" });
  const co = addDevice(pg, "coil", 50, 90, { tag: "-K1" });
  addWire(pg, [[50, 70], [50, 90]]); addWire(pg, [[70, 70], [70, 110], [50, 110]]);
  const snap = () => { simSolve(); const e = App.sim.energized;
    return JSON.stringify({ st: App.sim.states, p: [...e.pNets].sort(), n: [...e.nNets].sort() }); };
  simStart();
  o.before = snap();
  o.drcBefore = runDRC().map(i => i.msg).join("|");
  o.bomBefore = JSON.stringify(buildBOM().rows ? buildBOM().rows : buildBOM());
  o.termBefore = JSON.stringify(buildTerminalList());
  // 生きている線に 行き先 をぶら下げる
  const g = addDevice(pg, "goto_ref", 65, 80, { tag: "" }); g.props = { toPage: p2.id };
  addWire(pg, [[50, 80], [65, 80]]);
  o.after = snap();
  o.same = o.before === o.after;
  o.coilStillOn = !!App.sim.states[co.id];
  o.drcSame = o.drcBefore === runDRC().map(i => i.msg).join("|");
  o.bomSame = o.bomBefore === JSON.stringify(buildBOM().rows ? buildBOM().rows : buildBOM());
  o.termSame = o.termBefore === JSON.stringify(buildTerminalList());
  // どの状態でも導通しない (閉/開/分離/実行中/切替の各モード)
  o.pairs = ["closed", "open", "split", "sim", "closedA", "closedB"].map(m => conductivePairs(g, m).length);
  o.visual = JSON.stringify(simDevVisual(g, symOf(g.sym)));   // 通電色もつかない
  o.stateUndefined = App.sim.states[g.id] === undefined;
  // 指した先のページへ電位は渡らない (電位リンクとの違い)
  const co2 = addDevice(p2, "coil", 45, 60, { tag: "-K2" });
  const g2 = addDevice(p2, "goto_ref", 60, 60, { tag: "" }); g2.props = { toPage: pg.id };
  addWire(p2, [[45, 60], [60, 60]]);
  simSolve();
  o.crossPage = !!App.sim.states[co2.id];
  simStop();
  o.stoppedClean = App.sim.running === false;
  return o;
});
console.log("シミュレーション:", JSON.stringify(S, null, 1));

const checks = {
  // 記号そのもの
  symIsGoto: R.sym.gotoRef === true && R.sym.pins === 1,
  // 図番の表示 (要求①)
  showsDwgNo: R.set.shown === R.set.want && R.set.want !== "?" ,
  drawnOnSheet: R.set.drawn === R.set.want,
  unsetShowsQ: R.unset.shown === "?",
  // 文字列を焼き付けていない (要求③の前提)
  noBakedNumber: R.storedHasNumber === false && /^\{"toPage":"[^"]+"\}$/.test(R.storedProps),
  // ページ番号の変更に連動 (要求③)
  followsMove: R.moved.shown === R.moved.want && R.moved.shown !== R.set.shown,
  followsPrefix: R.prefix.shown === R.prefix.want && /^TK-2026-0/.test(R.prefix.shown),
  followsManual: R.manual === "SPECIAL-77",
  followsInsert: R.inserted.shown === R.inserted.want && R.inserted.pageNo === 3,
  followsAfterReload: R.reload.shown === R.reload.want &&
    R.reloadMoved.shown === R.reloadMoved.want && R.reloadMoved.shown !== R.reload.shown,
  // 置き方
  centered: Object.values(R.place).every(v => parseFloat(v.off) < 0.01),
  insideFlag: Object.values(R.place).every(v => v.inside),
  // 横置きは水平、縦置きは 90° (読む向きは 2 通りだけ)。画面の文字も同じ角度
  textAngle: R.place[0].angle === 0 && R.place[180].angle === 0 &&
    R.place[90].angle === 90 && R.place[270].angle === 90 &&
    R.place[90].svg === true && R.place[0].svg === false,
  // 検図
  drcUnset: R.unset.drc.length === 1 && R.unset.drc[0].startsWith("warn:"),
  drcOk: R.okDrc.length === 0 && R.finalDrc.length === 0,
  drcDeleted: R.deleted.drc.length === 1 && R.deleted.drc[0].startsWith("err:") && R.deleted.shown === "?",
  drcTooWide: R.tooWide.length === 1 && /入りきりません/.test(R.tooWide[0]),
  // DXF
  dxfText: R.dxf.has === true,
  dxfPos: parseFloat(R.dxf.dx) < 0.01 && parseFloat(R.dxf.dy) < 0.01,
  dxfRotated: R.dxfRot && parseFloat(R.dxfRot.ang) === 90 &&
    parseFloat(R.dxfRot.dx) < 0.01 && parseFloat(R.dxfRot.dy) < 0.01,
  // プルダウン (要求②)
  // 「— 未設定 —」+ 自分以外の全ページ
  optionsListPages: U.options.length === U.pageCount && U.options[0] === "— 未設定 —" &&
    U.options.slice(1).every(t => /^\S+ — \d+\. /.test(t)),
  optionsExcludeSelf: U.self === true,
  selectApplies: U.afterSelect.shown === U.afterSelect.want && /"toPage"/.test(U.afterSelect.stored),
  optionLabelFollows: U.afterMove.shown === U.afterMove.want &&
    U.afterMove.label.startsWith(U.afterMove.want + " — "),
  canClear: U.cleared.shown === "?" && !/toPage/.test(U.cleared.stored),
  // シミュレーションに影響しない
  simUnchanged: S.same === true && S.coilStillOn === true,
  simNoConduct: S.pairs.every(n => n === 0) && S.visual === "{}" && S.stateUndefined === true,
  simNoCrossPage: S.crossPage === false,
  simStops: S.stoppedClean === true,
  listsUnchanged: S.drcSame === true && S.bomSame === true && S.termSame === true,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
