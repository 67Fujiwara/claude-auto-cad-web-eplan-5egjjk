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
   ・旗の寸法が図形 (body) と計算用の値で一致し、寸法モジュール M=2.5mm の
     整数倍・全長は格子 5mm の整数倍であること (JIS C 0617-1)
   ・旗の輪郭が細線 0.25mm で白抜きであること (JIS Z 8312: 太線は導体と外形)
   ・図番が指し先ページの pageDwgNo と一致し、画面 (SVG) にもその文字が出ること
   ・図番の文字列を保存データに持たないこと
   ・並べ替え・接頭辞の変更・ページ個別図番・ページ追加のどれでも追従すること
   ・プルダウン (#pGoto) が実際の操作で効き、自ページは選べず、
     並べ替え後は選択肢の表示も新しい図番になること
   ・図番の文字が旗の平行部の中央にあり、五角形の 5 辺から 0.7mm 以上あくこと。
     縦置きでは 90° 倒れること (文字は下辺から/右辺から読む: JIS Z 8317-1)
   ・和文の図番は最小呼び 3.5mm へ上がり (JIS Z 8313-10)、外接矩形も実寸で返すこと
   ・相手の葉から指し返す対ができたら、図番に区分 (列) まで書くこと。
     対が 2 つあって定まらないときは図番だけに戻ること (嘘の位置を書かない)
   ・検図: 未設定=エラー (紙に「?」が刷られるため) / 自己参照=エラー /
     指し先が削除済み=エラー / 対が無い=警告 / 旗どうしが近すぎる=警告 /
     図番が旗に入らない=警告 / 電位リンクが無い・相手が食い違う=警告とエラー。
     正しく描いた図では 0 件
   ・DXF にも同じ文字が同じ位置・同じ角度で、専用レイヤ (XREF) に出ること。
     中央寄せは揃え記号 (72/11/21) でも渡すこと */
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
  out.flagDef = JSON.stringify(sym.gotoRef);
  // 旗の輪郭は電気的な意味を持たない参照枠なので細線 0.25mm (JIS Z 8312)
  out.thin = /L30,0[^"]*"[^>]*stroke-width="0\.25"/.test(sym.body) ||
    /<path d="M5,-2\.5[^"]*"[^>]*stroke-width="0\.25"/.test(sym.body);
  out.filled = /fill="#fff"/.test(sym.body);
  // 寸法モジュール M=2.5mm の整数倍で、全長は格子 5mm の整数倍か
  const M = 2.5, G = 5;
  const g0 = sym.gotoRef;
  out.module = [g0.lead, g0.x0, g0.x1, g0.tip, g0.h].every(v => Math.abs(v / M - Math.round(v / M)) < 1e-9) &&
    Math.abs(g0.tip / G - Math.round(g0.tip / G)) < 1e-9;

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
  // 実際に描く図形と、engine が計算に使う寸法が一致していること
  out.bodyMatchesDef = flag.x0 === g0.x0 && flag.x1 === g0.tip &&
    flag.y0 === -g0.h && flag.y1 === g0.h;

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

  /* ⑨ 文字の位置: 旗の平行部の中央にあり、五角形の内側に判読できるあき
     (0.7mm) を残して収まる。外接矩形ではなく五角形の 5 辺で見るので、
     先端の斜辺への食い込みも捕まえる */
  const d3 = App.project.pages[0].devices.find(x => symOf(x.sym).gotoRef);
  // 五角形の頂点 (記号ローカル)。辺への距離で判定する
  const poly = [[g0.x0, -g0.h], [g0.x1, -g0.h], [g0.tip, 0], [g0.x1, g0.h], [g0.x0, g0.h]];
  const distToEdges = (px, py) => {
    let min = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
      min = Math.min(min, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)));
    }
    return min;
  };
  /* 検図が「入る」と言い切る幅 (gotoTextRoom) いっぱいの図番を、実際に置いたときに
     五角形からあきが取れるか。検図の閾値と図形が食い違っていたらここで落ちる */
  {
    const room = gotoTextRoom(sym), hh = TEXT_H.small / 2, cx = (g0.x0 + g0.x1) / 2;
    out.roomFits = Math.min(...[[-room / 2, -hh], [room / 2, -hh], [room / 2, hh], [-room / 2, hh]]
      .map(([dx, dy]) => distToEdges(cx + dx, dy))).toFixed(3);
    // 和文 (3.5mm) でも上下のあきが取れるか
    const hj = 3.5 / 2;
    out.roomFitsCJK = Math.min(...[[-room / 2, -hj], [room / 2, -hj], [room / 2, hj], [-room / 2, hj]]
      .map(([dx, dy]) => distToEdges(cx + dx, dy))).toFixed(3);
  }
  out.place = {};
  [0, 90, 180, 270].forEach(rot => {
    d3.rot = rot;
    const xr = deviceXrefBox(App.project.pages[0], d3);
    const c = { x: xr.box.x + xr.box.w / 2, y: xr.box.y + xr.box.h / 2 };
    const want = pinAbs(d3, { x: (g0.x0 + g0.x1) / 2, y: 0 });     // 平行部の中央
    // 文字の 4 隅を記号ローカルへ戻し、五角形の辺までのあきを測る
    const hw = (rot === 90 || rot === 270 ? xr.box.h : xr.box.w) / 2;
    const hh = (rot === 90 || rot === 270 ? xr.box.w : xr.box.h) / 2;
    const cx = (g0.x0 + g0.x1) / 2;
    const gaps = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
      .map(([dx, dy]) => distToEdges(cx + dx, dy));
    out.place[rot] = {
      off: Math.hypot(c.x - want.x, c.y - want.y).toFixed(3),
      gap: Math.min(...gaps).toFixed(3),      // 文字と旗の輪郭のあき
      angle: xr.angle,      // 旗の長手に沿う (文字は下辺から/右辺から読む: JIS Z 8317-1)
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
  const ent = t.split("\n0\nTEXT\n").find(s => s.startsWith("8\nXREF") && s.includes("\n1\n" + xr0.text + "\n"));
  if (ent) {
    const gx = parseFloat((/\n10\n(-?[\d.]+)/.exec(ent) || [])[1]);
    const gy = parseFloat((/\n20\n(-?[\d.]+)/.exec(ent) || [])[1]);
    // DXF は左寄せしか持たないので、中央寄せは基点をずらして表す。
    // 画面の外接矩形の左端と一致していれば、両方で同じ位置に見える
    out.dxf.dx = Math.abs(gx - xr0.box.x).toFixed(3);
    out.dxf.dy = Math.abs((SHEET.h - gy) - xr0.y).toFixed(3);
    /* 受け側 CAD が別の書体に置き換えても中心がずれないよう、中央寄せは
       72 (位置合わせ) + 11/21 (位置合わせ点) でも渡しているか */
    out.dxf.align = (/\n72\n1\n/.test(ent)) &&
      Math.abs(parseFloat((/\n11\n(-?[\d.]+)/.exec(ent) || [])[1]) - xr0.x) < 0.01 &&
      Math.abs((SHEET.h - parseFloat((/\n21\n(-?[\d.]+)/.exec(ent) || [])[1])) - xr0.y) < 0.01;
  }

  // ⑩b 縦置きの行き先は DXF でも 90° で出る
  d3.rot = 90;
  const xr9 = deviceXrefBox(App.project.pages[0], d3);
  const t9 = pageToDXF(App.project.pages[0]);
  const e9 = t9.split("\n0\nTEXT\n").find(s2 => s2.startsWith("8\nXREF") && s2.includes("\n1\n" + xr9.text + "\n"));
  out.dxfRot = e9 ? {
    ang: (/\n50\n(-?[\d.]+)/.exec(e9) || [])[1],
    // 90° なので基点は文字列の下端。画面の外接矩形の下辺と一致するはず
    dx: Math.abs(parseFloat((/\n10\n(-?[\d.]+)/.exec(e9) || [])[1]) - xr9.x).toFixed(3),
    dy: Math.abs((SHEET.h - parseFloat((/\n20\n(-?[\d.]+)/.exec(e9) || [])[1])) - (xr9.box.y + xr9.box.h)).toFixed(3),
  } : null;
  d3.rot = 0;

  const drc2 = (rule) => runDRC().filter(i => i.target === d3.id && (!rule || i.rule === rule))
    .map(i => `${i.sev}:${i.rule}:${i.msg}`);

  /* ⑪ 片道だけの相互参照は追えない。相手の葉から指し返して初めて対になる
     (IEC 61082-1)。対ができると図番に相手の区分 (列) が付く */
  out.oneWay = drc2();                     // 「対が無い」と「電位リンクが無い」の 2 件
  const home = App.project.pages[0];
  const to = App.project.pages.find(pg => pg.id === d3.props.toPage);
  const third = App.project.pages.find(pg => pg !== home && pg !== to);
  const mate = addDevice(to, "goto_ref", 150, 80, { tag: "" });
  mate.props = { toPage: home.id };
  addWire(to, [[135, 80], [150, 80]]);
  /* 電気的な継続は電位リンクが担う。行き先だけでは通電しないので、
     同じネットにリンクが無ければ検図が知らせる */
  const lk1 = addDevice(home, "link", 85, 60, { tag: "-W101" });
  const lk2 = addDevice(to, "link", 135, 80, { tag: "-W101" });
  out.paired = { drc: drc2(), shown: deviceXrefBox(home, d3).text,
    want: `${pageDwgNo(to)}/${sheetCol(mate.x)}` };
  // リンクの相手が別の葉だと、絵と回路が食い違う
  lk2.tag = "-W999";
  const lk3 = addDevice(third, "link", 60, 60, { tag: "-W101" });
  out.linkMismatch = drc2("行き先とリンクの不一致");
  third.devices.splice(third.devices.indexOf(lk3), 1);
  lk2.tag = "-W101";
  out.linkOk = drc2("行き先とリンクの不一致");
  // 対が 2 つあると区分が定まらないので図番だけに戻る (嘘の位置を書かない)
  const mate2 = addDevice(to, "goto_ref", 150, 100, { tag: "" });
  mate2.props = { toPage: App.project.pages[0].id };
  out.ambiguous = deviceXrefBox(App.project.pages[0], d3).text;
  to.devices.splice(to.devices.indexOf(mate2), 1);

  // ⑫ 行き先どうしが近すぎる (5mm ピッチで並べると旗が接する)
  const near = addDevice(to, "goto_ref", 150, 85, { tag: "" });
  near.props = { toPage: App.project.pages[0].id };
  out.tooNear = runDRC().filter(i => i.rule === "行き先どうしの重なり").length;
  to.devices.splice(to.devices.indexOf(near), 1);
  // 10mm 離せば出ない
  const far = addDevice(to, "goto_ref", 150, 95, { tag: "" });
  far.props = { toPage: App.project.pages[0].id };
  out.farOk = runDRC().filter(i => i.rule === "行き先どうしの重なり").length;
  to.devices.splice(to.devices.indexOf(far), 1);

  // ⑬ 自分のページを指したらエラー (貼り付けで起こりうる)
  const back0 = d3.props.toPage;
  d3.props.toPage = App.project.pages[0].id;
  out.selfRef = drc2();
  d3.props.toPage = back0;

  // ⑭ 指し先が消えたら (ページ削除) エラー
  const ti = App.project.pages.findIndex(pg => pg.id === d3.props.toPage);
  const keep = App.project.pages[ti];
  App.project.pages.splice(ti, 1); UI.renumberPages();
  out.deleted = { shown: deviceXrefBox(App.project.pages[0], d3).text, drc: drc2() };
  App.project.pages.splice(ti, 0, keep); UI.renumberPages();

  // ⑮ 図番が旗に入りきらない (判定は旗の実寸から計算する)
  out.room = gotoTextRoom(symOf(d3.sym));
  projectMeta().dwgNo = "PROJECT-2026-VERYLONG-0010"; UI.renumberPages();
  out.tooWide = drc2("行き先の図番が入らない");
  projectMeta().dwgNo = ""; UI.renumberPages();
  // ⑯ 和文の図番は最小呼び 3.5mm へ上がる。外接矩形も実際の高さで返すこと
  const pgTo = App.project.pages.find(pg => pg.id === d3.props.toPage);
  pgTo.dwgNo = "制御盤一次"; pgTo.dwgNoManual = true;
  const xrJ = deviceXrefBox(App.project.pages[0], d3);
  out.cjk = { size: xrJ.size, h: +xrJ.box.h.toFixed(2),
    fits: xrJ.box.h + 0.7 * 2 <= symOf(d3.sym).gotoRef.h * 2 + 0.001 };
  delete pgTo.dwgNoManual; UI.renumberPages();

  out.finalDrc = drc2();
  // 操作経路の検査に入る前に、対の行き先を片づけて 1 個だけの状態に戻す
  App.project.pages.forEach(pg => {
    pg.devices = pg.devices.filter(d => !symOf(d.sym).gotoRef || d === d3);
  });
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
  // 行き先そのものへの指摘は別途見る。ここは「他の機器の検図が変わらないこと」
  const otherDrc = (id) => runDRC().filter(i => i.target !== id).map(i => i.msg).join("|");
  o.drcBefore = otherDrc(null);
  o.bomBefore = JSON.stringify(buildBOM().rows ? buildBOM().rows : buildBOM());
  o.termBefore = JSON.stringify(buildTerminalList());
  // 生きている線に 行き先 をぶら下げる
  const g = addDevice(pg, "goto_ref", 65, 80, { tag: "" }); g.props = { toPage: p2.id };
  addWire(pg, [[50, 80], [65, 80]]);
  o.after = snap();
  o.same = o.before === o.after;
  o.coilStillOn = !!App.sim.states[co.id];
  o.drcSame = o.drcBefore === otherDrc(g.id);
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
  symIsGoto: !!R.sym.gotoRef && R.sym.pins === 1,
  // 図形と、計算に使う寸法が一致していること
  flagDefMatchesBody: R.bodyMatchesDef === true,
  // 寸法モジュール M=2.5mm の整数倍・全長は格子 5mm の整数倍 (JIS C 0617-1)
  flagOnModule: R.module === true,
  // 旗は参照枠なので細線 0.25mm (JIS Z 8312)、白抜きで下の導体を隠す
  flagThinAndFilled: R.thin === true && R.filled === true,
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
  // 五角形の 5 辺すべてから 0.7mm 以上あく (先端の斜辺への食い込みも見る)
  insideFlag: Object.values(R.place).every(v => parseFloat(v.gap) >= 0.7 - 0.001),
  // 検図が許す最大幅の図番を入れても、五角形から 0.7mm あくこと (和文 3.5mm も)
  roomMatchesFlag: parseFloat(R.roomFits) >= 0.7 - 0.001 && parseFloat(R.roomFitsCJK) >= 0.7 - 0.001,
  // 横置きは水平、縦置きは 90° (読む向きは 2 通りだけ)。画面の文字も同じ角度
  textAngle: R.place[0].angle === 0 && R.place[180].angle === 0 &&
    R.place[90].angle === 90 && R.place[270].angle === 90 &&
    R.place[90].svg === true && R.place[0].svg === false,
  // 検図 (紙に「?」が刷られてしまうので未設定はエラー)
  drcUnset: R.unset.drc.length === 1 && R.unset.drc[0].startsWith("err:") &&
    /選ばれていません/.test(R.unset.drc[0]),
  drcOk: R.paired.drc.length === 0 && R.finalDrc.length === 0,
  drcDeleted: R.deleted.drc.length === 1 && R.deleted.drc[0].startsWith("err:行き先の指し先が無い") &&
    R.deleted.shown === "?",
  drcSelfRef: R.selfRef.length === 1 && R.selfRef[0].startsWith("err:行き先の自己参照"),
  drcOneWay: R.oneWay.length === 2 &&
    R.oneWay.some(m => m.startsWith("warn:行き先の対が無い")) &&
    R.oneWay.some(m => m.startsWith("warn:行き先とリンクの不一致") && /電位リンクがありません/.test(m)),
  // 行き先の指す葉と、電位リンクの相手の葉が食い違ったらエラー
  drcLinkMismatch: R.linkMismatch.length === 1 && R.linkMismatch[0].startsWith("err:") &&
    R.linkOk.length === 0,
  drcTooNear: R.tooNear === 1 && R.farOk === 0,
  drcTooWide: R.tooWide.length === 1 && /入りきりません/.test(R.tooWide[0]),
  // 対ができたら区分 (列) まで書く / 対が 2 つで定まらなければ図番だけ
  zoneWhenPaired: R.paired.shown === R.paired.want && /\/\d+$/.test(R.paired.shown),
  zoneOnlyWhenUnique: !/\//.test(R.ambiguous),
  // 和文の図番は 3.5mm に上がる。外接矩形も実寸で返し、旗にも収まる
  cjkHeight: R.cjk.size === 3.5 && R.cjk.h === 3.5 && R.cjk.fits === true,
  // DXF
  dxfText: R.dxf.has === true,
  dxfPos: parseFloat(R.dxf.dx) < 0.01 && parseFloat(R.dxf.dy) < 0.01,
  // 中央寄せは揃え記号でも渡す (受け側の書体が変わっても中心がずれない)
  dxfAlign: R.dxf.align === true,
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
