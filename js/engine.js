/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — コアエンジン
   データモデル / ネットリスト解析 / 通電シミュレーション / DRC / 部品表
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const GRID = 5;              // スナップグリッド 5mm
/* 微調整の刻み。端子の張り出しが 5mm の倍数でない記号 (M12 コネクタなど) を
   配線と真横に合わせるための逃げ。Shift+矢印キーで使う */
const FINE = 0.5;
/* 作図領域。margin = 輪郭線の幅 c (JIS Z 8311)、marginLeft = とじ代側 (20mm) */
const SHEET = { w: 420, h: 297, margin: 10, marginLeft: 20, cols: 10, rows: 6, f: 1, paper: "A3", orient: "landscape", scale: "1:1" };

/* 線の太さ (JIS Z 8312 の太さ系列。細線:太線 = 1:2) — 用紙上の mm */
const LINE_W = { thick: 0.5, thin: 0.25, extra: 0.7 };
/* 文字高さ (JIS Z 8313-1 の標準列) — 用紙上の mm */
/* 機能欄の割付は記号が ioSheet.fnTextX / fnRoom で持つ。
   ここは古い記号のための控え (箱 30 + あき 5 の 1mm 内側 / 下線 100mm) */
const KV_FN_TEXT_X = 36, KV_FN_ROOM = 99;
const TEXT_H = { small: 2.5, normal: 3.5, large: 5 };
/* 格子参照の行記号。JIS Z 8311 により I と O は使用しない */
const SHEET_ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
/* 格子参照の区分数 [列, 行] (JIS Z 8311 表2) */
const SHEET_DIVISIONS = { A0: [24, 16], A1: [16, 12], A2: [12, 8], A3: [8, 6], A4: [6, 4] };

/* 用紙 (横置き実寸 mm) と尺度。図面の作図領域は 用紙 × 尺度分母/分子 になる。
   例: A3 (420×297) を 1:2 で描くと作図領域は 840×594 となり、実物の
   2倍の範囲を1枚に収められる (印刷時は用紙サイズに縮小される)。 */
const PAPERS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
};
/* 投影法の既定。回路図・結線図は図記号で描く図であって正投影図ではないので、
   投影法を持たない (JIS Z 8316 / ISO 5456-2 の図示記号も刷らない)。
   機械図を取り込んだページなど、必要なページでは表題欄の設定で変えられる */
const PROJ_DEFAULT = "該当なし (回路図)";
/* NS = 非尺度 (制御回路図の標準)。尺度は JIS Z 8314 の推奨尺度列。
   1:1.25 / 1:1.5 は ISO 5455 で必要な場合に認められる中間尺度 —
   1:1 で収まらないが 1:2 (半分) では小さすぎるときの「少しだけ縮める」用。
   1:1.25 なら標準の文字 3.5mm が用紙上 2.8mm で JIS Z 8313 の下限 2.5mm を
   保てる (2.5mm の文字・線番は下回るので、検図「尺度と用紙上の寸法」が知らせる) */
const SCALES = ["NS", "2:1", "1:1", "1:1.25", "1:1.5", "1:2", "1:5", "1:10", "1:20", "1:50", "1:100"];
function scaleFactor(scale) {
  if (scale === "NS") return 1;
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(scale || "1:1"));
  if (!m) return 1;
  const num = parseFloat(m[1]), den = parseFloat(m[2]);
  if (!(num > 0) || !(den > 0)) return 1;
  return den / num;
}
function projectMeta() {
  if (!App.project.meta) App.project.meta = {};
  const m = App.project.meta;
  if (!m.paper) m.paper = "A3";
  if (!m.scale) m.scale = "1:1";
  return m;
}
/** 用紙の寸法 (mm)。PAPERS は横置き (長辺が左右) で持っているので、
    縦置き (portrait) では長短を入れ替える */
function paperSize(paper, orient) {
  const [a, b] = PAPERS[paper] || PAPERS.A3;
  return orient === "portrait" ? [b, a] : [a, b];
}
/** 表題欄の用紙欄の表記 (A3 / A3 縦)。画面・DXF で同じ文字を使う */
function paperLabel(pm) { return pm.paper + (pm.orient === "portrait" ? " 縦" : ""); }
/** ページに適用される用紙・向き・尺度 (ページ固有の設定があればそれを優先) */
function pageSheetMeta(page) {
  const m = projectMeta();
  const pg = page || (App.project.pages && App.project.pages[App.pageIdx]) || {};
  return {
    paper: pg.paper || m.paper,
    orient: pg.orient || m.orient || "landscape",
    scale: pg.scale || m.scale,
  };
}
/** meta (用紙・尺度) から作図領域 SHEET を再計算する (JIS Z 8311)。
    輪郭線の幅 c は A0・A1 = 20mm / A2〜A4 = 10mm、とじ代側 (左) は 20mm。
    格子参照の区分数は偶数とし、1区分が 25〜75mm に収まるようにする。 */
function applySheet(page) {
  const m = pageSheetMeta(page);
  const [pw, ph] = paperSize(m.paper, m.orient);
  const f = scaleFactor(m.scale);
  const c = (m.paper === "A0" || m.paper === "A1") ? 20 : 10;
  SHEET.paper = m.paper; SHEET.orient = m.orient; SHEET.scale = m.scale; SHEET.f = f;
  SHEET.w = pw * f;
  SHEET.h = ph * f;
  SHEET.margin = c * f;
  SHEET.marginLeft = Math.max(20, c) * f;      // とじ代 20mm
  const div = SHEET_DIVISIONS[m.paper];
  if (div) {
    const [dc, dr] = m.orient === "portrait" ? [div[1], div[0]] : div;
    SHEET.cols = dc; SHEET.rows = dr;
  }
  else {                                       // 表にない用紙は 25〜75mm の偶数個に分ける
    const evenDiv = (len, target) => {
      let n = 2 * Math.max(1, Math.round(len / target / 2));
      while (n > 2 && len / n < 25) n -= 2;
      while (len / n > 75) n += 2;
      return n;
    };
    SHEET.cols = evenDiv(pw - c - Math.max(20, c), 50);
    SHEET.rows = evenDiv(ph - c * 2, 50);
  }
  return SHEET;
}
/** すべての図形座標を k 倍する (尺度変更で図面の見た目を保つため) */
function scaleProjectGeometry(k) {
  if (!(k > 0) || k === 1) return;
  const r = v => Math.round(v * k * 100) / 100;
  App.project.pages.forEach(pg => {
    pg.devices.forEach(d => { d.x = r(d.x); d.y = r(d.y); });
    pg.wires.forEach(w => { w.pts = w.pts.map(p => [r(p[0]), r(p[1])]); });
    pg.texts.forEach(t => { t.x = r(t.x); t.y = r(t.y); });
    pageZones(pg).forEach(z => { z.x = r(z.x); z.y = r(z.y); z.w = r(z.w); z.h = r(z.h); });
  });
}

/** 図面の中身を平行移動する (用紙・尺度の変更で図枠の原点が動いたときに追従させる) */
/* 機器を動かすとき、その端子につながっている配線の端点も一緒に動かす。
   ドラッグ移動と同じ挙動を、ドラッグ以外の経路 (用紙合わせなど) でも使う */
function moveDeviceWithWires(page, dev, dx, dy) {
  if (!dx && !dy) return;
  const pins = devPins(dev);
  const hits = [];
  // この機器のために引いた下地 (レール・分岐) は、機器と一体で動かす
  const gen = page.wires.filter(w => w.gen === dev.id);
  gen.forEach(w => { w.pts = w.pts.map(p => [p[0] + dx, p[1] + dy]); });
  page.devices.forEach(d => { if (d.gen === dev.id) { d.x += dx; d.y += dy; } });
  page.wires.forEach(w => {
    if (w.gen === dev.id) return;                      // 上でまとめて動かした
    w.pts.forEach((p, i) => {
      if (i !== 0 && i !== w.pts.length - 1) return;
      if (pins.some(pn => Math.abs(pn.x - p[0]) < 0.01 && Math.abs(pn.y - p[1]) < 0.01)) hits.push([w, i]);
    });
  });
  dev.x += dx; dev.y += dy;
  hits.forEach(([w, i]) => { w.pts[i] = [w.pts[i][0] + dx, w.pts[i][1] + dy]; });
}

/* 入出力結線図の下地を実際の導体で引く。
   ・現場側にレールを 2 本。外側がコモン側 (入力=+24V / 出力=0V)、内側が各行の
     分岐もと (入力=0V / 出力=+24V)。シンク形の入出力では、入力は 0V →接点→
     入力端子、出力は +24V →負荷→出力端子と、電流の向きが逆になるので、
     どちらの紙でも「外側=コモン側・内側=分岐側」で位置をそろえる。
     こうすれば行の引出しがもう 1 本のレールをまたがない。
   ・各行は内側のレールから引き出し、機器を落とす隙間を空けて端子へ入る。
   ・3 線式センサ (BN/BK/BU・P24V/OUT/N24V) が隙間に置いてあれば、ただの
     直列ではなく、電源線を左右のレールへ正しく引き分ける。素直に直列へ
     つなぐと茶線が 0V に載り、そのまま結線するとセンサを壊す。
   ・コモンは外側のレールへ自動で結ぶ (極性は機種の形式から決まっている)。
     ユニット電源 (L/N/PE) は供給元が図面ごとに違うので引かない。
   ・引いた導体には印 (w.gen = 機器 id) を付ける。行ピッチを変えたり記号を
     動かしたりしたときに、古い下地を残さず引き直せるようにするため。
   記号の中に線を描くのではなく導体で引くので、検図もシミュレーションも
   絵のとおりに通る */
/* レール 2 本の間隔と隙間までの引出しは記号が持つ (symdb.js の KV_RAIL_SEP /
   KV_RAIL_LEAD)。古い記号のための控えの値だけここに置く */
const IO_RAIL_SEP_FALLBACK = 25, IO_RAIL_LEAD_FALLBACK = 10;
/** 3 線式の直流検出器か。そうなら 電源(+)・出力・0V のピン番号を返す */
function threeWirePins(sym) {
  if (!sym || !Array.isArray(sym.pins) || sym.pins.length !== 3) return null;
  const n = sym.pins.map(p => p.n);
  const sup = n.findIndex(x => x === "BN" || x === "P24V");
  const zero = n.findIndex(x => x === "BU" || x === "N24V");
  if (sup < 0 || zero < 0) return null;
  const out = [0, 1, 2].find(i => i !== sup && i !== zero);
  return { sup, out, zero };
}
function ioScaffoldParts(page, dev) {
  return {
    wires: page.wires.filter(w => w.gen === dev.id),
    devs: page.devices.filter(d => d.gen === dev.id),
  };
}
function clearIoScaffold(page, dev) {
  const { wires, devs } = ioScaffoldParts(page, dev);
  wires.forEach(w => page.wires.splice(page.wires.indexOf(w), 1));
  devs.forEach(d => page.devices.splice(page.devices.indexOf(d), 1));
  return wires.length + devs.length;
}
/** 行ピッチや機種を変えたとき、行の高さに合わせて描いてある現場機器と
    配線を新しい行へ運ぶ。配線は利用者が自分で引く方式なので、行の y に
    水平に載っている配線 (レール↔機器↔端子) を丸ごと平行移動し、
    その行に乗っている機器も一緒に動かす。行番号で対応づけるので、
    行数が同じかぎり必ず合う */
function moveIoRowDevices(page, dev, oldSp, newSp) {
  if (!oldSp || !newSp || oldSp.rows.length !== newSp.rows.length) return 0;
  // 現場側の区画 (レールから端子まで)。この中のものだけ運ぶ
  const lo = oldSp.side === "right" ? dev.x - 1 : dev.x - oldSp.rail - 1;
  const hi = oldSp.side === "right" ? dev.x + oldSp.rail + 1 : dev.x + 1;
  let n = 0;
  const plan = [];
  oldSp.rows.forEach((r, i) => {
    const dy = newSp.rows[i].y - r.y;
    if (!dy) return;
    const oldY = dev.y + r.y;
    plan.push([oldY, dy]);
  });
  // 下の行から動かす (上から動かすと、まだ動いていない下の行と一時的に重なる)
  plan.sort((a2, b2) => b2[1] - a2[1]);
  const movedWires = new Set(), movedDevs = new Set();
  plan.forEach(([oldY, dy]) => {
    page.wires.forEach(w => {
      if (w.gen === dev.id || movedWires.has(w.id)) return;
      const onRow = w.pts.every(pt2 => Math.abs(pt2[1] - oldY) < 0.01 &&
        pt2[0] >= lo && pt2[0] <= hi);
      if (!onRow) return;
      w.pts.forEach(pt2 => { pt2[1] = Math.round((pt2[1] + dy) * 100) / 100; });
      movedWires.add(w.id);
      n++;
    });
    page.devices.forEach(d2 => {
      if (d2 === dev || d2.gen === dev.id || movedDevs.has(d2.id)) return;
      const ps = devPins(d2);
      if (!ps.length) return;
      const inRow = ps.some(q => Math.abs(q.y - oldY) < 0.01 && q.x >= lo && q.x <= hi);
      if (!inRow) return;
      /* 機器は残りの配線 (行の外へ出る縦線など) ごと動かす。行の水平線は
         上で動かしてあるので、二重に動かさないよう端点一致だけ追従させる */
      d2.y = Math.round((d2.y + dy) * 100) / 100;
      movedDevs.add(d2.id);
      n++;
    });
  });
  return n;
}


function buildIoScaffold(page, dev) {
  const sym = symOf(dev.sym);
  const sp = sym && sym.ioSheet;
  if (!sp) return 0;
  /* 引き直す前に、旧レールの x を覚えておく。行ピッチや機種を変えると用紙が
     変わってレールの位置も動く — 利用者がレールへ引いた配線の端点は、
     新しいレールへ付け替える (置き去りにすると全部宙に浮く) */
  const oldRails = ioScaffoldParts(page, dev).wires
    .filter(w => w.pts.length === 2 && Math.abs(w.pts[0][0] - w.pts[1][0]) < 0.01)
    .map(w => w.pts[0][0]);
  clearIoScaffold(page, dev);                           // 古い下地は残さない
  const all = sp.rows.map((r, i) => pinAbs(dev, sym.pins[i] || { x: 0, y: r.y }));
  const io = all.filter((_, i) => sp.rows[i].io);
  if (!io.length) return 0;
  const sep = sp.sep || IO_RAIL_SEP_FALLBACK;
  /* 現場側がどちらか。入力は左 (レール → 機器 → 端子)、出力は右
     (端子 → 負荷 → レール)。外側 = コモン側、内側 = 分岐側は共通 */
  const sd = sp.side === "right" ? 1 : -1;
  const comX = snap(dev.x + sd * sp.rail), branchX = comX - sd * sep;
  /* レール頭は 1 行目の 5mm 上。10mm 上げると、電位リンクの三角 (8mm) と
     その上の電位名が、図枠の左上へ寄せて置いたときに輪郭線の外へ出る */
  const y1 = io[0].y - 5;
  const yIo = io[io.length - 1].y;                      // 入出力行の下端 (分岐レール)
  const yAll = all[all.length - 1].y;                   // 補助行まで (コモン側レール)
  let n = 0;
  const line = (pts) => {
    const w = addWire(page, pts);
    if (w) { w.gen = dev.id; n++; }
    return w;
  };
  const rail = (x, tag, y2) => {
    line([[x, y1], [x, y2]]);
    // 両端に電位リンク。長いレールの片端だけだと、下の行から電位が読めない
    [[y1, 180], [y2, 0]].forEach(([y, rot]) => {
      const d = addDevice(page, "link", x, y, { tag, rot });
      if (!d) return;
      d.gen = dev.id;
      /* 電位名は自分のレールに寄せる。既定の配置規則に任せると、25mm 隣の
         もう 1 本のレールのほうが近い位置に落ち、P24V と N24V が入れ替わって読める。
         電位リンクの三角は挿入点から 8mm 伸びるので、文字はその外側 —
         上端は三角のすぐ上、下端は三角のすぐ下 — に中心合わせで置く */
      d.tagAt = { dy: rot === 180 ? -8.5 : 12.5 };
    });
  };
  const tags = sp.railTags || { branch: "N24V", supply: "P24V" };
  /* レール 2 本とコモンの結線だけを引く。行ごとの配線 (端子↔機器↔レール) は
     利用者が自分で引く — 下地が行ごとのスタブを引いていた頃は、未使用の行にも
     宙に浮いた導体が印刷され、機器の入れ替えのたびに引き直しが要った。
     コモン側だけ最終行まで下ろし、分岐レールは io 行の下端で止める。
     分割コモンの中間の群 (C1, C2, …) の結線は分岐レールを横切るが、
     接続点 (黒丸) の無い交差として描かれ、電気的にも別ネットのまま */
  rail(comX, tags.supply, yAll);                        // 外側 = コモン側
  rail(branchX, tags.branch, yIo);                      // 内側 = 各行の分岐もと
  /* コモンは外側のレールへ。極性は機種の形式から決まっている。
     コモンの刻印は機種で COM / C0 / C1… と分かれる (分割コモンは全部結ぶ) */
  sp.rows.forEach((r0, i) => {
    if (r0.io || !/^(COM|C\d+)$/.test((sym.pins[i] || {}).n || "")) return;
    line([[comX, all[i].y], [all[i].x, all[i].y]]);
  });
  /* 利用者の配線の端点を旧レールから新レールへ付け替える。
     旧レールが 2 本なら、外側どうし・内側どうしで対応づける */
  if (oldRails.length) {
    const uniq = [...new Set(oldRails.map(v => Math.round(v * 100) / 100))]
      .sort((a2, b2) => Math.abs(b2 - dev.x) - Math.abs(a2 - dev.x));   // 外側が先
    const map = new Map();
    if (uniq[0] !== undefined) map.set(uniq[0], comX);
    if (uniq[1] !== undefined) map.set(uniq[1], branchX);
    page.wires.forEach(w => {
      if (w.gen === dev.id) return;
      w.pts.forEach(pt2 => { if (map.has(pt2[0]) && map.get(pt2[0]) !== pt2[0]) pt2[0] = map.get(pt2[0]); });
    });
  }
  App.labelRev++;
  return n;
}


/* 規格外の図記号の凡例を注記として貼る (JIS C 0617-1 / IEC 60617-1: 規格に
   ない図記号は図面上で説明する)。1 行で貼ると作図領域より長くなって表題欄を
   貫くので、作図領域の幅で折り返し、表題欄・改訂履歴欄を避けて上へ積む。
   戻り値は貼った行数 (すでに貼ってあれば 0) */
function pasteStdNote(page, sym) {
  const head = `【凡例】${sym.name}: `;
  const body = String(sym.stdNote || "");
  if (!body) return 0;
  if (page.texts.some(t => t.text.indexOf(head) === 0)) return 0;
  const fr = frameRect(), h = TEXT_H.small, lineH = h * 1.8;
  const blocks = titleBlocksRects();
  /* 1 行に入る幅。左下から積むので、表題欄の帯に掛かる高さでは幅を狭める…
     のではなく、帯より上へ逃がす方が読みやすい。まず全幅で折り返す */
  /* 幅は右下の帯 (表題欄と改訂履歴欄) の左まで。図面の注記は左下に段で置くのが
     作法で、全幅で 1 行に伸ばすと帯を貫くか、逃がした先で回路に掛かる */
  const leftmost = blocks.length ? Math.min(...blocks.map(r => r.x)) : fr.x + fr.w;
  const room = Math.max(60, Math.min(fr.w - 10, leftmost - (fr.x + 5) - 5));
  /* 折り返しは句読点・かっこ・空白を優先し、そこで切れないほど長い塊は
     1 字ずつ詰める (和文は分かち書きしないので、区切りが無い文が普通にある) */
  const lines = [];
  let cur = "";
  const flush = () => { if (cur) { lines.push(cur); cur = ""; } };
  (head + body).split(/(?<=[、。・）)\]】])|(?<=\s)/).forEach(w => {
    if (cur && textWidthMM(cur + w, h) > room) flush();
    for (const ch of w) {
      if (cur && textWidthMM(cur + ch, h) > room) flush();
      cur += ch;
    }
  });
  flush();
  // 表題欄・改訂履歴欄に掛からない、いちばん下の基線を探す
  const clear = (y) => {
    const b = { x: fr.x + 5, y: y - h, w: room, h: h * 1.3 };
    return !blocks.some(r => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y);
  };
  let bottom = fr.y + fr.h - 5;
  const already = page.texts.filter(t => /^【凡例】/.test(t.text)).length;
  bottom -= already * lineH;
  while (bottom > fr.y + lineH * lines.length && !clear(bottom)) bottom -= lineH;
  lines.forEach((tx, i) => {
    page.texts.push({ id: uid("t"), x: fr.x + 5, y: bottom - (lines.length - 1 - i) * lineH,
      text: tx, size: h, anchor: "start" });
  });
  App.labelRev++;
  return lines.length;
}

function shiftProjectGeometry(dx, dy, pages) {
  if (!dx && !dy) return;
  const r = v => Math.round(v * 100) / 100;
  (pages || App.project.pages).forEach(pg => {
    pg.devices.forEach(d => { d.x = r(d.x + dx); d.y = r(d.y + dy); });
    pg.wires.forEach(w => { w.pts = w.pts.map(p => [r(p[0] + dx), r(p[1] + dy)]); });
    pg.texts.forEach(t => { t.x = r(t.x + dx); t.y = r(t.y + dy); });
    pageZones(pg).forEach(z => { z.x = r(z.x + dx); z.y = r(z.y + dy); });
  });
}

/** いま張られている図枠の尺度倍率 (図枠・表題欄のみに掛ける) */
function sheetScale() { return SHEET.f || 1; }
/** 図記号・文字・線幅の倍率。ユーザー指定によりシンボルは常に 1:1 */
function contentScale() { return 1; }

/* 表題欄の割付 (用紙上 mm)。画面・DXF で必ず同じものを使う */
const TITLE_BLOCK = { w: 160, h: 30, rowH: 10, cols: [58, 42, 32, 28] };
const REV_TABLE = { rowH: 6, maxRows: 4, w: 120, cols: [16, 26, 0, 22] }; // cols[2]=残り

/** 表題欄の矩形 (作図領域座標)。図枠描画・DXF・DRC で共有する */
function titleBlockRect() {
  const f = sheetScale();
  const w = TITLE_BLOCK.w * f, h = TITLE_BLOCK.h * f;
  return { x: SHEET.w - SHEET.margin - w, y: SHEET.h - SHEET.margin - h, w, h };
}
/** 改訂履歴欄の矩形 (無ければ null)。
    表題欄の左隣 (同じ下段の帯) に置き、回路の作図領域を侵さないようにする。
    左に余地が無い小さな用紙では従来どおり表題欄の直上に積む。 */
function revisionRect() {
  const revs = revisionRows();
  if (!revs.length) return null;
  const f = sheetScale(), tb = titleBlockRect();
  const h = REV_TABLE.rowH * f * (revs.length + 1);
  const space = tb.x - SHEET.marginLeft;
  const w = Math.min(REV_TABLE.w * f, space);
  if (w >= 60 * f) return { x: tb.x - w, y: tb.y + tb.h - h, w, h, side: true };
  return { x: tb.x, y: tb.y - h, w: tb.w, h, side: false };
}
/** 表題欄と改訂履歴欄の矩形 (検図・試算で共有) */
function titleBlocksRects() {
  const out = [Object.assign(titleBlockRect(), { kind: "title" })];
  const rev = revisionRect();
  if (rev) out.push(Object.assign(rev, { kind: "rev" }));
  return out;
}
/** 線番ラベルの位置。最長区間の中点を基本とし、機器の図記号に重なる場合は
    同じ区間内で空いている位置へずらす (画面・DXF・検図で共有)。 */
/** 線番ラベルの外接矩形 (mx,my は wireLabelPos の戻り値) */
function wireNumBox(w, mx, my, horiz) {
  const f = contentScale(), h = TEXT_H.small * f;
  const wd = textWidthMM(String(w.num || ""), h, false, true);
  return horiz ? { x: mx - wd / 2, y: my - h, w: wd, h }
               : { x: mx - h, y: my - wd / 2, w: h, h: wd };
}
/** 電線仕様ラベルを打つ位置 (線番の反対側で、配線からのすき間は線番と同じ)。
    pos = wireLabelPos の戻り値 [mx, my, horiz, gap, side]。
    線番の位置から「配線そのものの座標」を戻して、そこを基準に反対側へ置く。
    my からの相対で足すと、線番が配線の下/右に置かれた回で仕様だけが
    2(g+h) ぶん外へ飛び、隣の心線の上に乗る */
function wireSpecAnchor(mx, my, horiz, gap, side) {
  const f = contentScale(), h = TEXT_H.small * f;
  const g = (gap === undefined ? WIRE_LABEL_GAP * f : gap);
  const sd = (side === undefined ? 1 : side);
  const lv = horiz ? my : mx;                       // 線番の基準線 (箱の配線側の縁)
  const wv = sd > 0 ? lv + g : lv - g - h;          // 配線そのものの座標
  const sv = sd > 0 ? wv + g + h : wv - g;          // 仕様の基準線 (反対側)
  return horiz ? [mx, sv] : [sv, my];
}
/** 電線仕様ラベルの外接矩形 (線番の反対側)。spec が無ければ null */
function wireSpecBox(w, mx, my, horiz, gap, side) {
  if (!w.spec || w.numShow === false) return null;
  const f = contentScale(), h = TEXT_H.small * f;
  const wd = textWidthMM(String(w.spec), h, false, true);
  const [sx, sy] = wireSpecAnchor(mx, my, horiz, gap, side);
  return horiz ? { x: sx - wd / 2, y: sy - h, w: wd, h }
               : { x: sx - h, y: sy - wd / 2, w: h, h: wd };
}
/** 線番と電線仕様の確定矩形。pos は wireLabelPos の戻り値をそのまま渡す。
    画面・DXF・検図・配置器がどれも同じ矩形を見るための唯一の入口 —
    引数を1つ渡し忘れただけで検図と描画が別の場所を見る、という事故を防ぐ */
function wireLabelBoxes(w, pos) {
  const [mx, my, horiz, gap, side] = pos;
  return { num: wireNumBox(w, mx, my, horiz), spec: wireSpecBox(w, mx, my, horiz, gap, side) };
}
/** 配線から線番の文字までのすき間 (mm)。並走する導体が 5mm 以内にあるときは
    WIRE_LABEL_GAP_TIGHT まで詰める — そうしないと文字が自分の線より隣の線に
    近くなり、どの線の番号か読めなくなる (文字高 2.5mm・心線ピッチ 5mm) */
const WIRE_LABEL_GAP = 1.4;
/* 並走する導体があるときは、そこまでの距離 d から
      g = (d − 文字高 − 1.0) / 2
   で詰める。「自分の線までが隣の線まで(d − g − 文字高)より 1.0mm 近い」を
   満たす最大の g で、心線ピッチ 5mm・文字高 2.5mm なら g = 0.75mm になる
   (このとき文字のインクは導体から 0.5mm = 線幅ぶん離れる)。
   5mm ちょうどで段階的に切り替えると、5.5mm ピッチで隣差 0.2mm という
   元より悪い図になるので、距離の連続関数にしてある */
const WIRE_LABEL_GAP_MIN = 0.6;
/** 並走する導体を「隣」とみなす間隔 (多芯ケーブルの心線ピッチ) */
const WIRE_NEIGHBOR_PITCH = 5;

const _wireLabelCache = new WeakMap();
/** ページ内の線番ラベルを順に確定させる (先に決まったラベルを次の障害物にする) */
function wireLabelMap(page) {
  const c = _wireLabelCache.get(page);
  if (c && c.rev === App.labelRev) return c.map;
  const map = new Map();
  const placed = [];
  const wires = condWires(page)
    .filter(w => w.num && w.numShow !== false)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  wires.forEach(w => {
    const res = wireLabelPosCalc(w, page, placed);
    map.set(w.id, res);
    const { num, spec } = wireLabelBoxes(w, res);
    placed.push(num);
    if (spec) placed.push(spec);
  });
  _wireLabelCache.set(page, { rev: App.labelRev, map });
  return map;
}
function wireLabelPos(w, page) {
  if (page && w.num && w.numShow !== false) {
    const hit = wireLabelMap(page).get(w.id);
    if (hit) return hit;
  }
  return wireLabelPosCalc(w, page, []);
}
function wireLabelPosCalc(w, page, placed) {
  const f = contentScale();
  const segs = [];
  for (let i = 0; i < w.pts.length - 1; i++) {
    const a = w.pts[i], b = w.pts[i + 1];
    segs.push({ a, b, len: Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) });
  }
  segs.sort((x, y) => y.len - x.len);
  const devs = page ? page.devices : [];
  const notes = page ? page.texts : [];
  // 障害物: 機器の図記号・注記・デバイスタグ/機能テキスト (線番が図記号に被らないように)
  const obst = page ? pinLabelBoxes(page) : [];
  devs.forEach(d => {
    const soft = !!symOf(d.sym).enclosure;   // 囲み記号 = 最後の手段では上に載せてよい
    deviceObstacleBoxes(d, OBST_INSET.wireNum * f).forEach(b => obst.push(soft ? { ...b, soft: true } : b));
    if (page) {
      deviceLabelBoxes(page, d).forEach(o => obst.push(o.box));
      mirrorLabelBoxes(d).forEach(b => obst.push(b));
    }
  });
  (notes || []).forEach(t => obst.push(textBounds(t)));
  (placed || []).forEach(b => obst.push(b));      // すでに確定した他の線番ラベル
  // 導体そのものも障害物にする。梯子図では線番の脇を別の配線が横切るので、
  // それを見ないと交差する導体の上に線番が乗る (自分の線は除く — 線番は
  // 自分の線の脇に置くのが目的なので)
  const HALFW = LINE_W.thick / 2 * f;
  (page ? condWires(page) : []).forEach(o => {
    if (o.id === w.id) return;
    for (let i = 0; i < o.pts.length - 1; i++) {
      const a = o.pts[i], b2 = o.pts[i + 1];
      obst.push({
        x: Math.min(a[0], b2[0]) - HALFW, y: Math.min(a[1], b2[1]) - HALFW,
        w: Math.abs(b2[0] - a[0]) + HALFW * 2, h: Math.abs(b2[1] - a[1]) + HALFW * 2, cond: true,
      });
    }
  });
  // この区間のすぐ隣 (心線ピッチ以内) を並走している導体があるか。多芯ケーブルの
  // ように線が詰まって並ぶ図では、線番を自分の線へ十分寄せないと、隣の線の
  // 番号に見えてしまう
  const parallelNear = (sg, horiz) => {
    const v = horiz ? sg.a[1] : sg.a[0];
    const lo = horiz ? Math.min(sg.a[0], sg.b[0]) : Math.min(sg.a[1], sg.b[1]);
    const hi = horiz ? Math.max(sg.a[0], sg.b[0]) : Math.max(sg.a[1], sg.b[1]);
    const P = WIRE_NEIGHBOR_PITCH * f;
    let best = Infinity;
    (page ? condWires(page) : []).forEach(o => {
      if (o.id === w.id) return;
      for (let i = 0; i < o.pts.length - 1; i++) {
        const a = o.pts[i], b2 = o.pts[i + 1];
        if ((Math.abs(b2[1] - a[1]) < 0.01) !== horiz) continue;
        const d = Math.abs((horiz ? a[1] : a[0]) - v);
        if (d < 0.01 || d > P + 0.01) continue;
        const ol = horiz ? Math.min(a[0], b2[0]) : Math.min(a[1], b2[1]);
        const oh = horiz ? Math.max(a[0], b2[0]) : Math.max(a[1], b2[1]);
        if (Math.min(hi, oh) - Math.max(lo, ol) > 0.5) best = Math.min(best, d);
      }
    });
    return best;
  };
  /** 並走導体までの距離から、配線から文字までのすき間を決める */
  const gapFor = (sg, horiz) => Math.min(WIRE_LABEL_GAP * f,
    Math.max(WIRE_LABEL_GAP_MIN * f, (parallelNear(sg, horiz) - th - 1 * f) / 2));
  // 実際に印字される位置 → その文字の外接矩形 (画面・DXF・検図で同じ式を使う)。
  // side=+1 は配線の左/上、-1 は右/下に置く。
  // 縦区間の文字は rotate(-90)・text-anchor=middle で描くので、pt がそのまま
  // 文字の中心になる。線に沿った方向へ余分にずらすと、候補の計算 (はみ出し・
  // 区間内判定) と実際の箱の位置がずれるので、ずらさない。
  // 配線からのすき間 gap は表裏で同じにする (片側だけ広いと、線番が自分の線より
  // 隣の線に近くなる)
  const th = TEXT_H.small * f;
  const posOf = (pt, horiz, side = 1, extra = 0, gap = WIRE_LABEL_GAP * f) => {
    const d = gap + extra * f;
    const o = side > 0 ? -d : d + th;
    // 4・5 番目に「配線からのすき間」と「どちら側に置いたか」を返す — 電線仕様を
    // 線番と同じ間隔で反対側へ置くために、画面・DXF・検図がこれを使う
    return horiz ? [pt[0], pt[1] + o, horiz, gap, side] : [pt[0] + o, pt[1], horiz, gap, side];
  };
  const boxOf = (pos) => {
    const { num: b, spec: sp } = wireLabelBoxes(w, pos);
    if (!sp) return b;
    const x0 = Math.min(b.x, sp.x), y0 = Math.min(b.y, sp.y);
    return { x: x0, y: y0, w: Math.max(b.x + b.w, sp.x + sp.w) - x0, h: Math.max(b.y + b.h, sp.y + sp.h) - y0 };
  };
  let best = null;
  const TS = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85];
  const consider = (pt, horiz, extras = [0, 3, 6], sides = [1, -1], gap) => {
    // 配線の両側 × 法線方向のオフセットを試す (短い区間でも逃げ場を作る)
    for (const extra of extras) {
      for (const side of sides) {
        const res = posOf(pt, horiz, side, extra, gap);
        const bx = boxOf(res);
        let sc = 0;
        for (const r of obst) sc += overlapArea(bx, padRect(r, LABEL_CLEAR / 2));
        if (sc === 0) return res;
        if (!best || sc < best.sc) best = { sc, res };
      }
    }
    return null;
  };
  // 空いている候補のうち、まわりに余裕のある場所ほどよい。桁数で線番の幅が
  // 変わっても (9 → 10 など) 同じケーブルの心線が同じ場所を選び、列が割れない
  const clearOf = (bx, sg, horiz) => {
    let m = Infinity;
    for (const r of obst) m = Math.min(m, rectGap(bx, padRect(r, LABEL_CLEAR / 2)));
    const lo = horiz ? Math.min(sg.a[0], sg.b[0]) : Math.min(sg.a[1], sg.b[1]);
    const hi = horiz ? Math.max(sg.a[0], sg.b[0]) : Math.max(sg.a[1], sg.b[1]);
    const b0 = horiz ? bx.x : bx.y, b1 = horiz ? bx.x + bx.w : bx.y + bx.h;
    return Math.min(m, b0 - lo, hi - b1);
  };
  // すぐ隣を走る線 (多芯ケーブルの心線) に付いた線番と、区間方向の位置が
  // 揃っているか。揃っていれば 0 に近い
  const alignedTo = (bx, horiz) => {
    let m = Infinity;
    (placed || []).forEach(r => {
      const perp = horiz ? Math.abs((r.y + r.h / 2) - (bx.y + bx.h / 2))
                         : Math.abs((r.x + r.w / 2) - (bx.x + bx.w / 2));
      if (perp > 12) return;                       // 離れた線番とは揃えない
      const c = horiz ? bx.x + bx.w / 2 : bx.y + bx.h / 2;
      const rc = horiz ? r.x + r.w / 2 : r.y + r.h / 2;
      m = Math.min(m, Math.abs(c - rc));
    });
    return m;
  };
  /** 線に沿った候補から 1つ選ぶ: 隣の心線と揃う → 余裕が大きい → 区間の中央寄り */
  const pickAlong = (list, horiz) => {
    list.sort((p1, p2) => ((alignedTo(p1.bx, horiz) <= 0.6 ? 0 : 1) - (alignedTo(p2.bx, horiz) <= 0.6 ? 0 : 1))
      || (Math.round(p2.clr * 2) - Math.round(p1.clr * 2)) || (p1.i - p2.i));
    return list[0].res;
  };
  /** 区間 sg の TS 位置のうち、何にも当たらないものを集める */
  const alongFree = (sg, horiz, at, side, gap) => {
    const out = [];
    TS.forEach((t, i) => {
      const res = posOf(at(t), horiz, side, 0, gap);
      const bx = boxOf(res);
      let sc = 0;
      for (const r of obst) sc += overlapArea(bx, padRect(r, LABEL_CLEAR / 2));
      if (sc === 0) out.push({ res, bx, i, clr: clearOf(bx, sg, horiz) });
      else if (!best || sc < best.sc) best = { sc, res };
    });
    return out;
  };
  // 長い区間から順に、機器・注記・デバイスタグに当たらない位置を探す。
  // まず線に沿って場所を変え (線番は自分の線のすぐ脇にあるのが読みやすい)、
  // それでも空きが無いときにだけ法線方向へ逃がす — 逃がしを先に試すと、
  // 同じ線上に空きがあるのに線から離れた位置を選んでしまう
  for (const sg of segs) {
    const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
    const at = t => [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
    // まず線の片側 (上/左) で場所を探し、それから反対側。側を変えるより
    // 同じ側で線に沿って動かすほうがよい — 多芯ケーブルのように線が 5mm 間隔で
    // 並ぶ図では、反対側へ回すと隣の線のほうが近くなってどの線の番号か読めなくなる
    // 並走する導体があるときは、線番を自分の線へ十分に寄せる
    const lgap = gapFor(sg, horiz);
    const para = lgap < WIRE_LABEL_GAP * f - 0.001;
    // 隣を並走する心線に既に線番が付いていれば、まず「その列」に置いてみる。
    // ケーブルの中で列が割れると、どの心線の番号か読めなくなる — 囲みに少し
    // 重なってでも列をそろえるほうが図面としては読める (重なりは検図が知らせる)
    if (para) {
      const lo = horiz ? Math.min(sg.a[0], sg.b[0]) : Math.min(sg.a[1], sg.b[1]);
      const hi = horiz ? Math.max(sg.a[0], sg.b[0]) : Math.max(sg.a[1], sg.b[1]);
      let col = null, near0 = Infinity;
      (placed || []).forEach(r => {
        const perp = horiz ? Math.abs((r.y + r.h / 2) - sg.a[1]) : Math.abs((r.x + r.w / 2) - sg.a[0]);
        if (perp > 12 || perp < 0.01) return;
        if (perp < near0) { near0 = perp; col = horiz ? r.x + r.w / 2 : r.y + r.h / 2; }
      });
      if (col !== null && col > lo - 0.01 && col < hi + 0.01) {
        const hard = obst.filter(r => !r.soft);
        for (const side of [1, -1]) {
          const res = posOf(horiz ? [col, sg.a[1]] : [sg.a[0], col], horiz, side, 0, lgap);
          const bx = boxOf(res);
          if (hard.every(r => overlapArea(bx, padRect(r, LABEL_CLEAR / 2)) === 0)) return res;
        }
      }
    }
    const along = alongFree(sg, horiz, at, 1, lgap);
    if (along.length) return pickAlong(along, horiz);
    // 線上に収まらない場合は、じゃまをしている物 (囲みなど) の外側へ寄せて
    // 同じ線の上に置く。線から離すより「自分の線の続き」に置くほうが読みやすい
    const mid = at(0.5);
    const box0 = boxOf(posOf(mid, horiz, 1, 0, lgap));
    const size = horiz ? box0.w : box0.h;
    let cands = [];
    for (const r of obst) {
      const cg = LABEL_CLEAR + 0.4;                              // じゃま物との読みやすさの隙間
      if (horiz) {
        if (r.y - cg < mid[1] && r.y + r.h + cg > mid[1]) {
          cands.push([r.x - cg - size / 2, mid[1]]);             // じゃま物の左へ
          cands.push([r.x + r.w + cg + size / 2, mid[1]]);       // じゃま物の右へ
        }
      } else if (r.x - cg < mid[0] && r.x + r.w + cg > mid[0]) {
        cands.push([mid[0], r.y - cg - size / 2]);
        cands.push([mid[0], r.y + r.h + cg + size / 2]);
      }
    }
    // 候補は自分の線 (この区間) の上に限る。線からはみ出すと、導体の無い
    // ところに線番が浮いてしまう
    const lo0 = Math.min(sg.a[0], sg.b[0]), hi0 = Math.max(sg.a[0], sg.b[0]);
    const lo1 = Math.min(sg.a[1], sg.b[1]), hi1 = Math.max(sg.a[1], sg.b[1]);
    // 候補は「線番の箱が線の中に収まる」ものを優先し、収まらなければ
    // 「中心が線の上にある」ものまで許す (短い線では端が少しはみ出す)
    const inSeg = c => horiz
      ? (c[0] - size / 2 >= lo0 - 0.01 && c[0] + size / 2 <= hi0 + 0.01)
      : (c[1] - size / 2 >= lo1 - 0.01 && c[1] + size / 2 <= hi1 + 0.01);
    const onSeg = c => horiz
      ? (c[0] >= lo0 - 0.01 && c[0] <= hi0 + 0.01)
      : (c[1] >= lo1 - 0.01 && c[1] <= hi1 + 0.01);
    // 自分の線の近くにある候補から順に。同じ距離なら左 (縦線なら上) を選び、
    // 並んだ心線の線番が左右にばらけないようにする
    const near = (p1, p2) => (Math.hypot(p1[0] - mid[0], p1[1] - mid[1]) - Math.hypot(p2[0] - mid[0], p2[1] - mid[1]))
      || (horiz ? p1[0] - p2[0] : p1[1] - p2[1]);
    // 線番が空いている導体に収まらないときは、はみ出しが最小になるところまで
    // 線の端へ寄せる (はみ出し = 線番の幅 − 空いている導体の長さ、が下限)。
    // 中心は必ず自分の線の上に残す
    const shift = (c) => {
      const v = horiz ? c[0] : c[1], lo = horiz ? lo0 : lo1, hi = horiz ? hi0 : hi1;
      let nv = v;
      if (v - size / 2 < lo) nv = Math.min(hi, v + Math.min(lo - (v - size / 2), hi - v));
      else if (v + size / 2 > hi) nv = Math.max(lo, v - Math.min((v + size / 2) - hi, v - lo));
      return horiz ? [nv, c[1]] : [c[0], nv];
    };
    const over = (c) => {
      const v = horiz ? c[0] : c[1], lo = horiz ? lo0 : lo1, hi = horiz ? hi0 : hi1;
      return Math.max(0, lo - (v - size / 2)) + Math.max(0, (v + size / 2) - hi);
    };
    // 収まるものが先。収まらないものは、はみ出しの少ない側 (= 導体の長い側) を選ぶ。
    // 同じなら左 (縦線は上) — 並んだ心線で選び方が揺れないように。
    // 空いている導体が線番より短い図 (囲みが大きい・心線が短い) では、線番は
    // 導体の延長上へ出る。線から法線方向へ大きく離すより、線の続きに置いて
    // 全心線で同じ側・同じ位置に揃えるほうが、どの心線の番号か読める
    // 線側へ寄せた版と元の版の両方を候補にする (寄せると囲みに当たる場合があるため)。
    // 自分の線にまったく重ならない位置は使わない — 導体から離れた白紙の上に
    // 線番が浮くくらいなら、後段で囲みの上に載せたほうが読める
    const touches = (c) => {
      const v = horiz ? c[0] : c[1], lo = horiz ? lo0 : lo1, hi = horiz ? hi0 : hi1;
      return Math.min(v + size / 2, hi) - Math.max(v - size / 2, lo) >= 0.5;
    };
    const all = [...cands, ...cands.map(shift)].filter(touches);
    // 逃がし先も「まわりに余裕のある場所」を選ぶ。狭い隙間に入れると、同じ
    // ケーブルの中で幅の広い線番 (桁数の多いもの) だけ入りきらず列が割れる
    const clrAt = (c) => {
      const r0 = posOf(c, horiz, 1, 0, lgap);
      return clearOf(boxOf(r0), sg, horiz);
    };
    const rank = (p1, p2) => (Math.round(over(p1) * 2) - Math.round(over(p2) * 2))
      || (Math.round(clrAt(p2) * 2) - Math.round(clrAt(p1) * 2)) || near(p1, p2);
    // 既に置いた線番 (並んだ心線の線番) と列を揃える。ケーブルの中で線番が
    // ばらけると、どの心線の番号か読めなくなる。逃がし先では線番は囲みの縁に
    // 押し当てられるので、中心ではなく「箱の端」で比べる — 連番の桁数が変わって
    // 幅が混ざっても (12芯の 9→10 など) 縁に沿った 1列になる
    const alignBias = (c) => {
      let best = Infinity;
      (placed || []).forEach(r => {
        const v0 = (horiz ? c[0] : c[1]) - size / 2, v1 = (horiz ? c[0] : c[1]) + size / 2;
        const r0 = horiz ? r.x : r.y, r1 = horiz ? r.x + r.w : r.y + r.h;
        best = Math.min(best, Math.abs(v0 - r0), Math.abs(v1 - r1));
      });
      return best === Infinity ? 0 : best;
    };
    // はみ出しの少なさが先。同程度なら、すでに置いた線番と揃う位置を選ぶ
    const rank2 = (p1, p2) => (Math.round(over(p1) * 2) - Math.round(over(p2) * 2))
      || ((alignBias(p1) <= 0.6 ? 0 : 1) - (alignBias(p2) <= 0.6 ? 0 : 1)) || rank(p1, p2);
    cands = [...all.filter(inSeg).sort(near),
             ...all.filter(c => !inSeg(c) && onSeg(c)).sort(rank2),
             ...all.filter(c => !onSeg(c)).sort(rank2)];
    for (const c of cands) {
      const ok = consider(c, horiz, [0], [1], lgap);
      if (ok) return ok;
    }
    // 同じ側に置けないときだけ反対側へ (線に沿った位置 → 退避先の順)
    const back = alongFree(sg, horiz, at, -1, lgap);
    if (back.length) return pickAlong(back, horiz);
    for (const c of cands) {
      const ok = consider(c, horiz, [0], [-1], lgap);
      if (ok) return ok;
    }
  }
  // 空いている導体が無く、線から大きく外れた位置しか残らない図 (囲みが心線の
  // ほぼ全長を占める) では、線番を囲みの上に載せる。白紙へ飛ばすより、自分の
  // 心線の上にあるほうが読める。重なりは検図が「図記号と重なる」と知らせるので、
  // 使う人は心線を伸ばすなり囲みを縮めるなりを判断できる
  {
    const hard = obst.filter(r => !r.soft);
    const ok = [];
    for (const sg of segs) {
      const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
      const at = t => [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
      const lg = gapFor(sg, horiz);
      for (const t of TS) {
        for (const side of [1, -1]) {
          const res = posOf(at(t), horiz, side, 0, lg);
          const bx = boxOf(res);
          if (hard.every(r => overlapArea(bx, padRect(r, LABEL_CLEAR / 2)) === 0)) ok.push({ res, bx, horiz });
        }
      }
    }
    if (ok.length) {
      // ここでも既に置いた線番と端で揃える (ケーブルの中で列が割れないように)
      const bias = (o) => {
        let best = Infinity;
        (placed || []).forEach(r => {
          const [v0, v1] = o.horiz ? [o.bx.x, o.bx.x + o.bx.w] : [o.bx.y, o.bx.y + o.bx.h];
          const [r0, r1] = o.horiz ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
          best = Math.min(best, Math.abs(v0 - r0), Math.abs(v1 - r1));
        });
        return best === Infinity ? 0 : best;
      };
      ok.sort((a2, b2) => bias(a2) - bias(b2));
      return ok[0].res;
    }
  }

  // それでも空かないときだけ、線から法線方向へ離す
  for (const extra of [3, 6]) {
    for (const sg of segs) {
      const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
      const at = t => [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
      for (const t of TS) {
        const ok = consider(at(t), horiz, [extra]);
        if (ok) return ok;
      }
    }
  }
  // どの区間にも空きが無い場合は、配線から法線方向へ離して逃がす
  const sg = segs[0] || { a: w.pts[0], b: w.pts[w.pts.length - 1] };
  const horiz = Math.abs(sg.b[1] - sg.a[1]) < 0.01;
  const pt = [(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2];
  for (const off of [1.8, 4.5, 7, 9.5, -4.5, -7, -9.5]) {
    const cand = horiz ? [pt[0], pt[1] - (off - 1.8) * f] : [pt[0] - (off - 1.8) * f, pt[1]];
    const ok = consider(cand, horiz);
    if (ok) return ok;
  }
  // 全滅時は重なり面積が最小の候補 (無条件フォールバックはしない)
  return best ? best.res : posOf(pt, horiz, 1, 0);
}

/** ピン番号を表示するか (隣接配線の線番と同名なら二重表示を避ける)。
    PE/FG 等の接地端子も、接地ネットの電位名印字 (RE_EARTH) と同名になった時は
    端子名を意図的に抑止する — 記号脇の接地グリフ+電位名「PE」で機能は一義に読める。
    画面・DXF で同じ判定を使う。 */
function pinLabelVisible(page, dev, pinIdx) {
  const sym = symOf(dev.sym);
  const p = sym.pins[pinIdx];
  // inBody: 端子名を記号の body に描いてある (入出力結線図の枠記号)。
  // 二重に打つと外郭の縁で重なるので、自動ラベルは出さない
  if (!p || p.inBody || symBaseIdOf(dev.sym) === "terminal") return null;
  // 名前の無い端子でも、プロパティで番号を入れれば印字する (入力が正)
  const name = effectivePinName(dev, pinIdx);
  if (!name) return null;
  const abs = pinAbs(dev, p);
  const dup = page.wires.some(wr => wr.num === name &&
    wr.pts.some(pt => Math.abs(pt[0] - abs.x) < .01 && Math.abs(pt[1] - abs.y) < .01));
  return dup ? null : { name, abs, pin: p };
}

/** 機器ラベル (タグ・機能テキスト) の配置。左に置くと隣の機器へ被る場合は
    右側へ寄せる。画面描画と検図で同じ結果を使うためエンジンに置く。 */
/* デバイスタグ・機能テキストの配置
   ─ 他機器・端子番号・配線・確定済みの他ラベルを障害物として、
     機器の左→右→上→下の順に「干渉しなくなるまで機器側へ寄せて」置く。
     どこにも空きがない場合は重なり面積が最小の候補を採る (無条件フォールバック禁止)。
   ─ 配置はページ内で左→上の順に貪欲決定し、確定したラベルを順次障害物へ積む。 */
const _labelCache = new WeakMap();   // page → { rev, map }

/** シンボル body に描かれた箱 (<rect>) の一覧。ラベル配置の障害物に使う。
    外接 bounds と違い実際に線が引かれる場所なので、自機のぶんも避けてよい。 */
const _symRectCache = new Map();
function symBodyRects(sym) {
  if (_symRectCache.has(sym.id)) return _symRectCache.get(sym.id);
  const out = [];
  const re = /<rect\s+x="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"/g;
  let m;
  while ((m = re.exec(sym.body || ""))) out.push([+m[1], +m[2], +m[3], +m[4]]);
  _symRectCache.set(sym.id, out);
  return out;
}

/** 端子番号ラベルの外接矩形 (画面・検図・ラベル配置で共通) */
/* 記号ごとの文字倍率。用紙の尺度に合わせて 2 倍で作った記号 (PLC の入出力
   結線図など) は、端子番号やタグも一緒に大きくしないと紙の上で 1.25mm になる。
   記号が textK を持つときだけ効く (既定は 1 倍) */
function symTextK(sym) { return (sym && sym.textK) || 1; }
/* 機器ごとの描画倍率。尺度の異なるページへ貼り付けたとき、図記号・文字も
   含めて印刷上の大きさを保つために使う (AutoCAD のブロック挿入倍率と同じ)。
   端子位置・外接矩形・ラベルの文字高はすべてこの倍率に追従する */
function objScale(o) { return o && o.scale > 0 ? o.scale : 1; }
function devScale(dev) { return objScale(dev); }
/* PLC 入出力結線図の機能欄 (コメント欄) の横位置オフセット (mm・記号ローカル)。
   コメント欄をドラッグすると付く。0 なら記号の既定位置 (ioSheet.fnX) */
function devFnDx(dev) {
  const v = dev && dev.props && dev.props.fnDx;
  return Number.isFinite(v) ? v : 0;
}

/* 用紙に合わせて作った記号 (PLC の入出力結線図など) が持つ「想定する用紙」。
   記号が {paper, orient, scale} をそのまま持つ (表示用の文字列を読み戻さない) */
function symSheetSpec(sym) {
  const sh = sym && sym.sheet;
  if (!sh || typeof sh !== "object") return null;
  return { paper: sh.paper, orient: sh.orient || "landscape", scale: sh.scale || "1:1" };
}
/** 用紙の表示 ("A3 縦 1:1") */
function sheetLabel(sp) {
  return sp ? `${sp.paper} ${sp.orient === "portrait" ? "縦" : "横"} ${sp.scale}` : "";
}
/** 記号の想定する用紙と、そのページの用紙が食い違っていないか */
function symSheetMismatch(page, sym) {
  const want = symSheetSpec(sym);
  if (!want) return null;
  const now = pageSheetMeta(page);
  const same = now.paper === want.paper && (now.orient || "landscape") === want.orient && now.scale === want.scale;
  return same ? null : { want, now };
}

/* 記号の body に実際に書かれている文字高さ (data-h) と線の太さの最小値。
   記号ごとに一度だけ数える */
const _symMinCache = new Map();
function symDrawnMinima(sym) {
  // シンボルエディタで body を編集したら測り直す (id だけでは古い値が残る)
  const key = sym.id + "#" + String(sym.body || "").length;
  if (_symMinCache.has(key)) return _symMinCache.get(key);
  let h = Infinity, w = Infinity;
  const body = String(sym.body || "");
  body.replace(/data-h="([\d.]+)"/g, (_, v) => { h = Math.min(h, parseFloat(v)); return ""; });
  /* data-h を持たない <text> (取り込んだ図面など) は、font-size から呼び高さを
     見積もる。測れないものを「無い」と見なすと検図がすり抜ける */
  body.replace(/<text\b(?![^>]*data-h)[^>]*font-size="([\d.]+)"/g, (_, v) => {
    h = Math.min(h, parseFloat(v) * TEXT_CAP); return "";
  });
  const hasStroke = /stroke-width="([\d.]+)"/.test(body);
  body.replace(/stroke-width="([\d.]+)"/g, (_, v) => { w = Math.min(w, parseFloat(v)); return ""; });
  // stroke-width を書いていない要素は既定 (図記号線 0.5mm)
  if (!hasStroke || /<(path|rect|circle|line|polyline)(?![^>]*stroke-width)/.test(String(sym.body || ""))) {
    w = Math.min(w, LINE_W.thick);
  }
  const r = { h, w };
  _symMinCache.set(key, r);
  return r;
}
/** そのページに実際に描かれる文字高さ・線の太さの最小値 (作図領域の mm) */
function pageDrawnMinima(page) {
  // w も実際に描かれる線から測る。決め打ちで LINE_W.thick から始めると、
  // 倍率つきで貼った内容だけのページ (すべて太く描かれている) を誤判定する
  let h = Infinity, w = Infinity;
  const f = contentScale();
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    const k = symTextK(sym) * devScale(dev);
    const m = symDrawnMinima(sym);
    if (isFinite(m.h)) h = Math.min(h, m.h * f * devScale(dev));
    w = Math.min(w, m.w * f * devScale(dev));
    // アプリが描くラベル (端子番号・タグ) も記号の倍率で描かれる
    if ((sym.pins || []).some((p, i) => pinLabelVisible(page, dev, i))) h = Math.min(h, TEXT_H.small * f * k);
    if (sym.ioSheet) w = Math.min(w, LINE_W.thin * f * devScale(dev));   // 機能欄の下線 (動的に描く)
    // タグは出力に出るときだけ数える (尺度の検図は「用紙に刷られる寸法」を見る)
    // タグは出力に出るときだけ数える (尺度の検図は「用紙に刷られる寸法」を見る)
    if ((displayTag(dev) && tagShownFor(dev, true)) || dev.desc) h = Math.min(h, TEXT_H.normal * f * k);
  });
  condWires(page).forEach(wr => { if (wr.num || wr.spec) h = Math.min(h, TEXT_H.small * f * objScale(wr)); });
  (page.texts || []).forEach(t => { h = Math.min(h, (t.size || TEXT_H.normal) * f); });
  // アプリが描く線 — 導体は太線、作図線 (破線・一点鎖線) と破線枠は細線。
  // 尺度の違うページから貼った線・枠は倍率つきで描かれるので、その分を掛けて測る
  (page.wires || []).forEach(wr => {
    w = Math.min(w, (wr.style && wr.style !== "solid" ? LINE_W.thin : LINE_W.thick) * f * objScale(wr));
  });
  pageZones(page).forEach(z => {
    w = Math.min(w, LINE_W.thin * f * objScale(z));
    if (z.label) h = Math.min(h, zoneLabelSize(z) * f);
  });
  // 接点ミラー表・相互参照の文字
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.mirror && linkedContacts(dev).length) h = Math.min(h, TEXT_H.small * f);
    if (deviceXrefBox(page, dev)) h = Math.min(h, TEXT_H.small * f * symTextK(sym) * devScale(dev));
    if (deviceRowTexts(page, dev).length) h = Math.min(h, TEXT_H.small * f * symTextK(sym) * devScale(dev));
  });
  if (!isFinite(h)) h = TEXT_H.small * f;
  if (!isFinite(w)) w = LINE_W.thick * f;
  return { h, w };
}

function pinLabelBoxes(page) {
  const f = contentScale();
  const out = [];
  const devBoxes = page.devices.flatMap(d => deviceObstacleBoxes(d, OBST_INSET.label * f));
  // 図記号の箱 (rect) は自機のぶんも障害物にする — 長い端子名 (N24V 等) が
  // 検出器箱・機器ボックスの縁に乗るのを防ぐ (回転配置は bounds 側で概ね足りるため除外)
  const bodyRects = [];
  page.devices.forEach(d => {
    if ((d.rot || 0) % 360 !== 0) return;
    const kd = f * devScale(d);
    symBodyRects(symOf(d.sym)).forEach(([rx, ry, rw, rh]) => {
      bodyRects.push({ x: d.x + rx * kd, y: d.y + ry * kd, w: rw * kd, h: rh * kd });
    });
  });
  /* 導体も障害物にする。端子番号が配線の上に乗ると読めないので、
     線番ラベルと同じ扱いで避ける (避けきれない図は検図が知らせる) */
  const HW = LINE_W.thick / 2 * f;
  const wireBoxes = [];
  condWires(page).forEach(w => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x1, y1] = w.pts[i], [x2, y2] = w.pts[i + 1];
      wireBoxes.push({ x: Math.min(x1, x2) - HW, y: Math.min(y1, y2) - HW,
        w: Math.abs(x2 - x1) + HW * 2, h: Math.abs(y2 - y1) + HW * 2 });
    }
  });
  page.devices.forEach((d2, di) => {
    const s2 = symOf(d2.sym);
    (s2.pins || []).forEach((p, pi) => {
      const vis = pinLabelVisible(page, d2, pi);
      if (!vis) return;
      const h = TEXT_H.small * f * symTextK(s2) * devScale(d2), w2 = textWidthMM(vis.name, h, false, true);
      const rotated = (d2.rot || 0) % 360 !== 0;
      const isTop = !rotated && (p.y <= 0 || (s2.horizontalPins && p.y <= s2.bounds[1] + 2));
      // 端子番号もピンの左右・上下を試して、他の端子番号や図記号を避ける
      const cands = [
        [vis.abs.x + 1 * f, rotated ? vis.abs.y - 1.6 * f : vis.abs.y + (isTop ? 3.4 : -1.6) * f],
        [vis.abs.x - 1 * f - w2, rotated ? vis.abs.y - 1.6 * f : vis.abs.y + (isTop ? 3.4 : -1.6) * f],
        [vis.abs.x + 1 * f, rotated ? vis.abs.y + 3.4 * f : vis.abs.y + (isTop ? -1.6 : 3.4) * f],
        [vis.abs.x - 1 * f - w2, rotated ? vis.abs.y + 3.4 * f : vis.abs.y + (isTop ? -1.6 : 3.4) * f],
      ];
      let best = null;
      for (const [bx, by] of cands) {
        const box = { owner: d2.id, x: bx, y: by - h, w: w2, h };
        let sc = 0;
        out.forEach(o => { sc += overlapArea(box, padRect(o, LABEL_CLEAR / 2)); });
        devBoxes.forEach((r, ri) => { if (ri !== di) sc += overlapArea(box, r); });
        bodyRects.forEach(r => { sc += overlapArea(box, r); });
        // 導体との重なりは重く見る (線の上の文字はいちばん読みにくい)
        wireBoxes.forEach(r => { sc += overlapArea(box, r) * 6; });
        if (sc === 0) { best = box; break; }
        if (!best || sc < best.__sc) { best = box; best.__sc = sc; }
      }
      delete best.__sc;
      out.push(best);
    });
  });
  return out;
}
/** 端子番号ラベルの位置 (描画・検図で共通)。dev.id とピン番号で引く */
function pinLabelPos(page, dev, pinIdx) {
  const key = `${dev.id}#${pinIdx}`;
  const map = pinLabelPosMap(page);
  return map.get(key) || null;
}
const _pinPosCache = new WeakMap();
function pinLabelPosMap(page) {
  const c = _pinPosCache.get(page);
  if (c && c.rev === App.labelRev) return c.map;
  const map = new Map();
  const f = contentScale();
  const boxes = pinLabelBoxes(page);
  let i = 0;
  page.devices.forEach(d2 => {
    const s2 = symOf(d2.sym);
    (s2.pins || []).forEach((p, pi) => {
      if (!pinLabelVisible(page, d2, pi)) return;
      const b = boxes[i++];
      if (b) map.set(`${d2.id}#${pi}`, { x: b.x, y: b.y + b.h, box: b, size: b.h });
    });
  });
  _pinPosCache.set(page, { rev: App.labelRev, map });
  return map;
}

/* 文字を置いてはいけない領域の余白 (mm)。
   検図は「配置器が置いてよいと判断した位置」を咎めてはいけないので、
   検図の余白は配置器のどれよりも大きく (= 障害物としては小さく) 保つ。 */
const OBST_INSET = { label: 1.2, wireNum: 1.5, drc: 1.5 };

/** 機器1台ぶんの「文字を置いてはいけない領域」。
    画面の機器ラベルも線番も検図も同じ規則を使う (定義元を1か所にする)。 */
/* 記号が実際に線を引いている範囲 (複数の箱)。列を並べた記号 (PLC の入出力
   結線図など) は外接矩形の中に大きな空きがあるので、図枠や表題欄との
   重なりを外接矩形で見ると、何も描いていない所で「重なっている」と出る。
   sym.inkBoxes があるときはその箱で見る (回転にも追従させる) */
function devPartBoxes(dev) {
  const sym = symOf(dev.sym);
  if (!sym || !sym.inkBoxes || !sym.inkBoxes.length) return [devBounds(dev)];
  return sym.inkBoxes.map(([px, py, pw, ph]) => {
    const cs = [[px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph]].map(([x, y]) => pinAbs(dev, { x, y }));
    const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
}

/* 記号が実際に線を引いている範囲 (インク) の外接矩形。
   bounds は「つかみやすさ」のための余白つきの枠なので、記号どうしの重なりを
   これで見ると、端子台のように 5mm ピッチで並べた端子が全部「重なり」になる
   (端子の bounds は 8.4mm 幅、インクは丸 4.4mm)。body を読んで実寸で測る。
   inkBoxes を宣言している記号 (入出力結線図の枠など) はそれを使う */
const _symInkCache = new Map();
/* 画面外の SVG に一度だけ描いて getBBox() を取る。正規表現で body を読むやり方は
   <g transform="translate(…)"> を取りこぼし (ライブラリに 19 記号ある)、円弧の
   ふくらみも text-anchor も和文の最小呼びも測れなかった。描いて測れば全部合う。
   取れなかったときだけ、下の読み取り (概算) に落ちる */
let _inkSvg = null;
function symInkByRender(sym) {
  if (typeof document === "undefined" || !document.body) return null;
  try {
    if (!_inkSvg) {
      _inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      _inkSvg.setAttribute("style", "position:absolute;left:-9999px;top:-9999px;width:10px;height:10px;visibility:hidden");
      document.body.appendChild(_inkSvg);
    }
    _inkSvg.innerHTML = symBodySVG(sym);
    const g = _inkSvg.firstElementChild;
    if (!g) return null;
    const bb = g.getBBox();
    if (!isFinite(bb.width) || !isFinite(bb.height)) return null;
    // getBBox は線の中心線で返るので、線の太さの半分を外へ足す
    const hw = symStrokeWidth(sym, SYM_STROKE) / 2;
    return { x: bb.x - hw, y: bb.y - hw, w: bb.width + hw * 2, h: bb.height + hw * 2 };
  } catch (e) { return null; }
}
function symInkBox(sym) {
  if (!sym || !sym.body) return null;
  if (sym.inkBoxes && sym.inkBoxes.length) {
    const xs = sym.inkBoxes.map(b => b[0]), ys = sym.inkBoxes.map(b => b[1]);
    const xe = sym.inkBoxes.map(b => b[0] + b[2]), ye = sym.inkBoxes.map(b => b[1] + b[3]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xe) - Math.min(...xs), h: Math.max(...ye) - Math.min(...ys) };
  }
  // キャッシュの鍵は body そのもの。長さだけだと、同じ長さの書き換えで古い箱が残る
  const key = sym.id + "|" + sym.body;
  if (_symInkCache.has(key)) return _symInkCache.get(key);
  const drawn = symInkByRender(sym);
  if (drawn) { _symInkCache.set(key, drawn); return drawn; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const b = sym.body;
  b.replace(/<rect[^>]*x="(-?[\d.]+)"[^>]*y="(-?[\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g,
    (m, x, y, w, h) => { put(+x, +y); put(+x + +w, +y + +h); return ""; });
  b.replace(/<circle[^>]*cx="(-?[\d.]+)"[^>]*cy="(-?[\d.]+)"[^>]*r="([\d.]+)"/g,
    (m, cx, cy, r) => { put(+cx - +r, +cy - +r); put(+cx + +r, +cy + +r); return ""; });
  b.replace(/<text[^>]*x="(-?[\d.]+)"[^>]*y="(-?[\d.]+)"[^>]*data-h="([\d.]+)"[^>]*>([^<]*)</g,
    (m, x, y, h, t) => { const w = String(t).length * +h * 0.7; put(+x - w / 2, +y - +h); put(+x + w / 2, +y + +h * 0.3); return ""; });
  /* path はコマンドをたどって現在点を追う (円弧はふくらみを見ず端点だけ —
     実寸よりわずかに小さく出るが、重なりを見誤るほどの差にはならない) */
  b.replace(/\bd="([^"]+)"/g, (m, d) => {
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?[\d.]+(?:e-?\d+)?/g) || [];
    let i = 0, cmd = "M";
    const num = () => +toks[i++];
    while (i < toks.length) {
      if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
      if (i >= toks.length && !/[Zz]/.test(cmd)) break;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "M" || C === "L" || C === "T") { const a = num(), c = num(); cx = rel ? cx + a : a; cy = rel ? cy + c : c; if (C === "M") { sx = cx; sy = cy; } put(cx, cy); }
      else if (C === "H") { const a = num(); cx = rel ? cx + a : a; put(cx, cy); }
      else if (C === "V") { const a = num(); cy = rel ? cy + a : a; put(cx, cy); }
      else if (C === "C") { for (let k = 0; k < 2; k++) { const a = num(), c = num(); put(rel ? cx + a : a, rel ? cy + c : c); } const a = num(), c = num(); cx = rel ? cx + a : a; cy = rel ? cy + c : c; put(cx, cy); }
      else if (C === "S" || C === "Q") { const a = num(), c = num(); put(rel ? cx + a : a, rel ? cy + c : c); const e = num(), f = num(); cx = rel ? cx + e : e; cy = rel ? cy + f : f; put(cx, cy); }
      else if (C === "A") { num(); num(); num(); num(); num(); const a = num(), c = num(); cx = rel ? cx + a : a; cy = rel ? cy + c : c; put(cx, cy); }
      else if (C === "Z") { cx = sx; cy = sy; put(cx, cy); }
      else i++;
    }
    return "";
  });
  const out = isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  _symInkCache.set(key, out);
  return out;
}
/** 記号が線を引いている範囲を、帯ごとに (inkBoxes があればそのぶんだけ) */
function symInkBoxes(sym) {
  if (sym && sym.inkBoxes && sym.inkBoxes.length) {
    return sym.inkBoxes.map(([x, y, w, h, tag]) => (tag === "fn" ? { x, y, w, h, fn: 1 } : { x, y, w, h }));
  }
  const b = symInkBox(sym);
  return b ? [b] : [];
}
const _boxAbs = (dev, r) => {
  const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
    .map(([x, y]) => pinAbs(dev, { x, y }));
  const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
/* 導体を「抜く」円 (丸端子など)。記号が wireMask で持ち、置いた位置・回転・
   倍率を反映して図面座標で返す。抜くのは描画だけで、回路のつながりは
   そのまま — 端子を動かせば線はもとどおり描かれる (状態を持たない) */
/** 図面座標 → 機器ローカル座標 (回転・倍率の逆変換)。矩形マスクの判定に使う */
function devLocalPt(dev, wx, wy) {
  const r = (dev.rot || 0) * Math.PI / 180, k = devScale(dev);
  const c = Math.cos(r), sn = Math.sin(r);
  const px = wx - dev.x, py = wy - dev.y;
  return [(px * c + py * sn) / k, (-px * sn + py * c) / k];
}
function pageWireMasks(page) {
  const out = [];
  (page.devices || []).forEach(dev => {
    const k = devScale(dev);
    const wm = symOf(dev.sym).wireMask;
    (wm || []).forEach(c => {
      if (c.r > 0) {               // 円 (丸端子など)
        const a = pinAbs(dev, { x: c.x, y: c.y });
        out.push({ kind: "circle", x: a.x, y: a.y, r: c.r * k, dev });
      } else if (c.w > 0 && c.h > 0) {
        // 矩形 (破断など)。機器ローカルで判定するので回転・倍率に追従する
        out.push({ kind: "rect", dev, x: c.x, y: c.y, w: c.w, h: c.h });
      }
    });
    /* プロパティ「配線の破断」: この記号に重なった配線を、指定の線から下
       (記号ローカルの +y 方向) だけ隠す。青枠 (外接矩形) でなく破断線の
       位置から切るので、波線などの描線に合わせられる */
    if (dev.props && Number.isFinite(dev.props.cutY)) {
      const sym = symOf(dev.sym);
      const [bx, , bw] = sym.bounds;
      out.push({ kind: "rect", dev, x: bx, y: dev.props.cutY, w: bw, h: 1000 });
    }
  });
  return out;
}
/** 線分 (x1,y1)-(x2,y2) のうち、マスク (円・矩形) の外に残る部分を返す */
function segOutsideCircles(x1, y1, x2, y2, circles) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  if (!L2) return [];
  const cuts = [];                     // マスクの内側になる [t0,t1] (0..1)
  circles.forEach(c => {
    if (c.kind === "rect") {
      // 機器ローカルへ写すと軸平行の矩形になる (線分は写しても直線のまま)
      const [lx1, ly1] = devLocalPt(c.dev, x1, y1);
      const [lx2, ly2] = devLocalPt(c.dev, x2, y2);
      const ldx = lx2 - lx1, ldy = ly2 - ly1;
      let t0 = 0, t1 = 1;
      const slab = (p0, d0, lo, hi) => {
        if (Math.abs(d0) < 1e-9) return p0 >= lo && p0 <= hi;   // 平行: 中にあるか
        let a2 = (lo - p0) / d0, b2 = (hi - p0) / d0;
        if (a2 > b2) { const t = a2; a2 = b2; b2 = t; }
        t0 = Math.max(t0, a2); t1 = Math.min(t1, b2);
        return true;
      };
      if (!slab(lx1, ldx, c.x, c.x + c.w)) return;
      if (!slab(ly1, ldy, c.y, c.y + c.h)) return;
      t0 = Math.max(0, t0); t1 = Math.min(1, t1);
      if (t1 > t0 + 1e-9) cuts.push([t0, t1]);
      return;
    }
    // |P(t) - C|^2 = r^2 を解く
    const fx = x1 - c.x, fy = y1 - c.y;
    const b = 2 * (fx * dx + fy * dy);
    const cc = fx * fx + fy * fy - c.r * c.r;
    const disc = b * b - 4 * L2 * cc;
    if (disc <= 0) return;             // 交わらない (接するだけなら抜かない)
    const sq = Math.sqrt(disc);
    let t0 = (-b - sq) / (2 * L2), t1 = (-b + sq) / (2 * L2);
    t0 = Math.max(0, t0); t1 = Math.min(1, t1);
    if (t1 > t0) cuts.push([t0, t1]);
  });
  if (!cuts.length) return [[[x1, y1], [x2, y2]]];
  cuts.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let at = 0;
  // 切り口は 0.01mm に丸める (画面の d 属性・DXF に端数を残さない)
  const r2 = v => Math.round(v * 100) / 100;
  const P = t => [r2(x1 + dx * t), r2(y1 + dy * t)];
  cuts.forEach(([t0, t1]) => {
    if (t0 > at + 1e-6) parts.push([P(at), P(t0)]);
    at = Math.max(at, t1);
  });
  if (at < 1 - 1e-6) parts.push([P(at), P(1)]);
  return parts;
}
/** 折れ線から円の内側を抜いた小片の一覧 (描画・DXF 出力で共通に使う) */
function trimPolyByCircles(pts, circles) {
  if (!circles.length) return [pts];
  const out = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const parts = segOutsideCircles(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], circles);
    parts.forEach((seg, j) => {
      // 続いている小片はつなげて 1 本の折れ線にする (破線の刻みを保つため)
      if (cur && Math.abs(cur[cur.length - 1][0] - seg[0][0]) < 1e-6
        && Math.abs(cur[cur.length - 1][1] - seg[0][1]) < 1e-6) cur.push(seg[1]);
      else { cur = [seg[0], seg[1]]; out.push(cur); }
    });
    if (parts.length === 0 || parts[parts.length - 1][1][0] !== pts[i + 1][0]
      || parts[parts.length - 1][1][1] !== pts[i + 1][1]) cur = null;   // 円の中で切れた
  }
  return out;
}

/** 機器が実際に線を引いている範囲 (図面座標・帯ごと)。回転・位置を反映する */
function devInkBoxes(dev) {
  const bs = symInkBoxes(symOf(dev.sym));
  const fdx = devFnDx(dev);
  // 機能欄の帯はドラッグした位置に追従させる (ラベル・線番の自動配置が避ける)
  return bs.length ? bs.map(r => _boxAbs(dev, r.fn && fdx ? { ...r, x: r.x + fdx } : r)) : [devBounds(dev)];
}
/** 同じものを 1 つの外接矩形で */
function devInkBox(dev) {
  const bs = devInkBoxes(dev);
  const xs = bs.map(r => r.x), ys = bs.map(r => r.y);
  const xe = bs.map(r => r.x + r.w), ye = bs.map(r => r.y + r.h);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xe) - Math.min(...xs), h: Math.max(...ye) - Math.min(...ys) };
}

function deviceObstacleBoxes(dev, inset) {
  // 囲み記号 (多芯ケーブル・シールド) の中は「ケーブルそのもの」なので、
  // 心線の線番は囲みの外 — 囲みと端子の間の導体の上 — に置く (図面の作法)。
  // どの機器も外接矩形ぜんぶを避ける、という同じ規則でよい。
  /* ただし inkBoxes を宣言している記号 (入出力結線図の枠) は帯ごとに避ける。
     出力の枠は「箱 … 現場側の区画 … 名称欄」と外接矩形のまん中が空いていて、
     そこは現場機器とそのラベルの置き場所。外接矩形ぜんぶを塞ぐと、
     ラベルの置き場が無くなって最小重なりの位置 = 名称欄の上に落ちる */
  const sym = symOf(dev.sym);
  if (sym && sym.inkBoxes && sym.inkBoxes.length) {
    /* 従来経路は「実インク + 2mm の余白」へ inset を掛けていた。帯にも同じ
       2mm を足してから掛けないと、障壁が実インクの内側まで下がって、
       ラベルが外郭や下線に 1.5mm 未満まで寄れてしまう */
    return devInkBoxes(dev).map(r => insetRect(r, inset - 2));
  }
  return [insetRect(devBounds(dev), inset)];
}

/** ラベル配置以外の固定障害物 (機器の図記号・端子番号・配線・注記) を集める */
function labelObstacles(page) {
  const f = contentScale();
  const out = pinLabelBoxes(page);
  page.devices.forEach(d2 => {
    deviceObstacleBoxes(d2, OBST_INSET.label * f).forEach(b => out.push({ owner: d2.id, ...b }));
    // 接点ミラー表 (コイル直下のクロスリファレンス表) も避ける
    mirrorLabelBoxes(d2).forEach(b => out.push({ owner: d2.id, ...b }));
  });
  // 配線 (実線=導体のみ)。作図線はラベルを避ける対象にしない
  const wt = 0.6 * f;
  condWires(page).forEach(w => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x1, y1] = w.pts[i], [x2, y2] = w.pts[i + 1];
      out.push({
        owner: null, wire: true,
        x: Math.min(x1, x2) - wt, y: Math.min(y1, y2) - wt,
        w: Math.abs(x2 - x1) + wt * 2, h: Math.abs(y2 - y1) + wt * 2,
      });
    }
  });
  (page.texts || []).forEach(t => {
    const h = (t.size || TEXT_H.normal) * f;
    out.push({ owner: null, x: t.x, y: t.y - h, w: textWidthMM(t.text || "", h), h });
  });
  /* 破線枠のコメントは動かさない (枠の名前は枠に付いていないと意味が変わる) ので、
     機器のタグ・機能テキスト側が避ける障害物として置く */
  pageZones(page).forEach(z => {
    const b = zoneLabelBox(z);
    if (b) out.push({ owner: null, ...b });
  });
  return out;
}

/** 文字どうしの最小あき (JIS Z 8313-0: 線幅の2倍以上)。配置探索でこのぶん膨らませる */
const LABEL_CLEAR = 0.7;
function padRect(r, d) { return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2, owner: r.owner }; }

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.05 && h > 0.05 ? w * h : 0;
}

/** 2つの矩形のすき間 (重なっていれば 0)。線番の「余裕」を測るのに使う */
function rectGap(a, b) {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}

/** 1機器ぶんのラベル配置を決める。obstacles は {x,y,w,h,owner} の配列 */
function placeDeviceLabels(page, dev, obstacles) {
  const sym = symOf(dev.sym);
  const f = contentScale();
  const b = devBounds(dev);
  const tag = displayTag(dev), desc = dev.desc;
  const horizontal = (dev.rot || 0) % 180 !== 0;
  const H = TEXT_H.normal * f * symTextK(sym) * devScale(dev);
  const mk = (text, x, y, anchor, isTag) => {
    const hh = textHeightMM(text, H);
    const o = { text, x, y, w: textWidthMM(text, hh, !!isTag, !!isTag), h: hh, anchor, size: H, isTag: !!isTag };
    o.box = labelBox(o);
    return o;
  };
  const wrap = (arr, side) => { arr.side = side; return arr; };
  if (!tag && !desc) return wrap([], "left");

  /* 用紙 1 枚を占める記号 (入出力結線図) は、タグの居場所を記号側が指定する。
     まわりを探して置く規則をそのまま当てると、外接矩形が紙いっぱいなので
     タグが現場側の配線区画のまん中へ降りてしまい、置いた機器とぶつかる */
  /* 機器ごとの置き場所指定 (下地が置いたレール頭の電位名など)。
     レールが 25mm 間隔で 2 本並ぶ図では、まわりを探して置く規則だと
     電位名が「相手のレールのほうが近い」位置に落ちて、+24V と 0V が
     入れ替わって読める。自分のレールの真上/真下に中心合わせで留める */
  if (dev.tagAt) {
    const out = [];
    const x = dev.x + (dev.tagAt.dx || 0), y = dev.y + (dev.tagAt.dy || 0);
    const anc = dev.tagAt.anchor || "middle";
    if (tag) out.push(mk(tag, x, y, anc, true));
    if (desc) out.push(mk(desc, x, y + (dev.tagAt.dy < 0 ? -4 : 4) * f, anc));
    return wrap(out, "top");
  }
  if (sym.tagAnchor) {
    const a = pinAbs(dev, sym.tagAnchor), anc = sym.tagAnchor.anchor || "end";
    const out = [];
    if (tag) out.push(mk(tag, a.x, a.y, anc, true));
    if (desc) out.push(mk(desc, a.x, a.y + 4 * f, anc));
    return wrap(out, "left");
  }

  // 候補の生成 ─ side ごとに機器へ寄せる段階を持つ
  const sideCand = (side, d, dy = 0) => {
    const out = [];
    if (side === "left" || side === "right") {
      const x = side === "left" ? b.x - d * f : b.x + b.w + d * f;
      const anchor = side === "left" ? "end" : "start";
      const y = b.y + b.h / 2 + dy * f;
      if (tag) out.push(mk(tag, x, y - 0.8 * f, anchor, true));
      if (desc) out.push(mk(desc, x, y + (tag ? 4 : 1) * f, anchor));
    } else if (side === "top" || side === "topL" || side === "topR") {
      const cx = b.x + b.w / 2 + (side === "topL" ? -5 : side === "topR" ? 5 : 0) * f;
      const y = b.y - d * f;
      if (desc) out.push(mk(desc, cx, y - (tag ? 4 * f : 0), "middle"));
      if (tag) out.push(mk(tag, cx, y, "middle", true));
    } else {   // bottom / bottomL / bottomR
      const cx = b.x + b.w / 2 + (side === "bottomL" ? -5 : side === "bottomR" ? 5 : 0) * f;
      const y = b.y + b.h + d * f;
      if (tag) out.push(mk(tag, cx, y, "middle", true));
      if (desc) out.push(mk(desc, cx, y + (tag ? 4 * f : 0), "middle"));
    }
    return wrap(out, side);
  };
  // 探索順: 横向き機器は上下優先、縦向き機器は左右優先。
  // ミラー表を持つコイルは右側を接点ミラーのために空けておき、最後に回す。
  const TOP = [1.6, 5.0, 8.4], BOT = [4.4, 7.8, 11.2];
  const vert = [["top", TOP], ["bottom", BOT], ["topL", TOP], ["topR", TOP], ["bottomL", BOT], ["bottomR", BOT]];
  const order = horizontal
    ? [["top", [2.0, 3.4, 5.4]], ["bottom", [4.4, 6.4, 8.4]], ["left", [2.2, 1.4, 0.8]], ["right", [2.2, 1.4, 0.8]],
       ["topL", [2.0, 3.4]], ["topR", [2.0, 3.4]], ["bottomL", [4.4, 6.4]], ["bottomR", [4.4, 6.4]]]
    : sym.mirror
      ? [["left", [2.2, 1.4, 0.8, 0.3]], ...vert, ["right", [2.2, 1.4]]]
      : [["left", [2.2, 1.4, 0.8, 0.3]], ["right", [2.2, 1.4, 0.8, 0.3]], ...vert];

  // 上下左右のどこも空いていない混んだ図のために、もっと離した候補も持つ。
  // 左右は行をずらした候補も持つ — 同じ位置に重ねた 2 つの記号 (心線囲みと
  // 遮へいなど) のタグは、横へ逃がすより上下に積むほうが図面として読める
  order.push(["left", [2.2, 6, 10, 15, 21, 27], [4.5, -4.5, 9, -9]],
             ["right", [2.2, 6, 10, 15, 21, 27], [4.5, -4.5, 9, -9]],
             ["top", [9, 13]], ["bottom", [11, 15]]);

  const relevant = obstacles.filter(o => o.owner !== dev.id);
  // 図枠 (輪郭線) の外は不可。はみ出し面積も重なりと同じ重みで効かせる
  const fr = frameRect();
  const outArea = (bx) => {
    const dx = Math.max(0, fr.x - bx.x) + Math.max(0, bx.x + bx.w - (fr.x + fr.w));
    const dy = Math.max(0, fr.y - bx.y) + Math.max(0, bx.y + bx.h - (fr.y + fr.h));
    return dx * bx.h + dy * bx.w;
  };
  let best = null;
  for (const [side, gaps, dys] of order) {
    for (const dy of (dys || [0])) for (const d of gaps) {
      const cand = sideCand(side, d, dy);
      let score = 0;
      for (const o of cand) {
        score += outArea(o.box);
        // 導体の上に載るのは、少し離れて置くより悪い (文字も線も読めなくなる)。
        // 面積だけで比べると細い線への重なりが小さく見え、離れた候補に負ける
        for (const r of relevant) score += overlapArea(o.box, padRect(r, LABEL_CLEAR / 2 + 0.05)) * (r.wire ? 6 : 1);
      }
      if (score === 0) return cand;
      if (!best || score < best.score) best = { cand, score };
    }
  }
  return best ? best.cand : sideCand("left", 2.2);   // 全滅時は重なり最小の候補
}

/** ページ内の全ラベルを左→上の順に貪欲配置し、確定ぶんを障害物へ積む */
function computePageLabels(page) {
  const base = labelObstacles(page);
  const placed = [];
  const map = new Map();
  const order = [...page.devices].sort((a, b) =>
    (a.x - b.x) || (a.y - b.y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  order.forEach(dev => {
    const boxes = placeDeviceLabels(page, dev, base.concat(placed));
    map.set(dev.id, boxes);
    boxes.forEach(o => placed.push({ owner: dev.id, ...o.box }));
  });
  return map;
}

/** リンク接点の相互参照 (/ページ.列) の位置と外接矩形。
    端子番号・デバイスタグ・図記号を避け、収まらなければ重なり最小を選ぶ。 */
/** 行き先 (継続先) 記号が指しているページ。未設定・削除済みなら null */
function gotoTargetPage(dev) {
  const id = dev.props && dev.props.toPage;
  if (!id) return null;
  return App.project.pages.find(pg => pg.id === id) || null;
}
/** 行き先の旗の寸法 (mm)。記号定義が持つ値をそのまま使う */
function gotoFlag(sym) {
  const g = (sym && typeof sym.gotoRef === "object") ? sym.gotoRef : {};
  return { lead: g.lead || 5, x0: g.x0 || 5, x1: g.x1 || 30, tip: g.tip || 35, h: g.h || 2.5 };
}
/* 図番と旗の内側とのあき。この図面の判読限界 (0.7mm) に合わせる。
   旗の輪郭は細線 0.25mm を公称線の中心に描くので、インクの内縁までは
   さらに半分 (0.125mm) 内側になる。両方を引いた値で判定する */
const GOTO_TEXT_GAP = 0.7;
const GOTO_EDGE_INK = LINE_W.thin / 2;
/** 旗の中で図番を置ける幅 (平行部から、あきと輪郭のインクを引いた値) */
function gotoTextRoom(sym) {
  const fl = gotoFlag(sym);
  return (fl.x1 - fl.x0) - (GOTO_TEXT_GAP + GOTO_EDGE_INK) * 2;
}
/** 旗の中で図番を置ける高さ (同上) */
function gotoTextRoomH(sym) {
  return gotoFlag(sym).h * 2 - (GOTO_TEXT_GAP + GOTO_EDGE_INK) * 2;
}
/** 行き先の旗の外接矩形 (作図領域座標)。回転にも追従する */
function gotoFlagBox(dev) {
  const fl = gotoFlag(symOf(dev.sym));
  const pts = [[fl.x0, -fl.h], [fl.tip, -fl.h], [fl.tip, fl.h], [fl.x0, fl.h]]
    .map(([x, y]) => pinAbs(dev, { x, y }));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
/** その行き先の線に載っている電位リンクのタグ (葉をまたぐ回路の識別) */
const _gotoNetCache = new Map();
function gotoLinkTags(page, dev) {
  let c = _gotoNetCache.get(page);
  if (!c || c.rev !== App.labelRev) {
    c = { rev: App.labelRev, nets: computeNets(page, "closed") };
    _gotoNetCache.set(page, c);
  }
  const net = c.nets.pinNet(dev, 0);
  if (!net) return [];
  const tags = [];
  page.devices.forEach(d => {
    const s = symOf(d.sym);
    if (s && s.sim === "link" && d.tag && c.nets.pinNet(d, 0) === net) tags.push(d.tag.replace(/^-/, "").toUpperCase());
  });
  return tags;
}
/** こちらを指し返している行き先 (相手の葉にあるもの) */
function gotoBackRefs(page, dev) {
  const to = gotoTargetPage(dev);
  if (!to) return [];
  return to.devices.filter(d => {
    const s = symOf(d.sym);
    return s && s.gotoRef && d.props && d.props.toPage === page.id;
  });
}
/** 行き先の対。ページではなく信号 (同じ電位リンクのタグ) で決める。
    ページだけで決めると、同じ 2 葉の間を別の回路が渡っているときに
    他人の位置を指してしまう。1 つに定まらなければ null (区分は書かない) */
function gotoCounterpart(dev) {
  const to = gotoTargetPage(dev);
  const home = findDevice(dev.id);
  if (!to || !home) return null;
  const mine = new Set(gotoLinkTags(home.page, dev));
  if (!mine.size) return null;                    // 信号が分からなければ位置も書けない
  const hit = gotoBackRefs(home.page, dev).filter(d => gotoLinkTags(to, d).some(t => mine.has(t)));
  return hit.length === 1 ? hit[0] : null;
}
/** 行き先 記号に表示する文字。行き先を選んでいなければ "?"。
    指し先に対の行き先があれば、その位置の区分 (列) まで書く (E-002/7)。
    IEC 61082-1 の相互参照は「どの葉の・どこ」で一意になる */
function gotoRefText(dev) {
  const pg = gotoTargetPage(dev);
  if (!pg) return "?";
  const no = pageDwgNo(pg);
  const mate = gotoCounterpart(dev);
  return mate ? `${no}/${sheetCol(mate.x)}${sheetRow(mate.y)}` : no;
}
/** 機能欄 (コメント) を持つ端子 — 入出力点のみ。
    サービス電源 (0V/24V) とコモンは出力/入力の点ではないので機能欄を持たない */
function symFnPins(sym) {
  const rows = sym && sym.ioSheet && sym.ioSheet.rows;
  if (!rows) return (sym && sym.pins) || [];
  return sym.pins.filter(p => p.row !== undefined && rows[p.row] && rows[p.row].io);
}

/* 入出力結線図の機能欄。行ごとの文言 (dev.props.fn) を下線の上に置く。
   記号の中に文字を焼き込まず機器のプロパティに持つので、同じ記号を何枚
   置いても中身は別々に書ける (端子表 CSV・DXF・検図でも同じ配置を使う) */
function deviceRowTexts(page, dev) {
  const sym = symOf(dev.sym);
  if (!sym || !sym.fnRows) return [];
  const fn = (dev.props && dev.props.fn) || {};
  const s = contentScale(), h = TEXT_H.small * s * symTextK(sym) * devScale(dev);
  const out = [];
  const fnPins = new Set(symFnPins(sym));
  sym.pins.forEach((p, i) => {
    if (!fnPins.has(p)) return;          // 電源・コモンの行に文言は出さない
    /* 文言は端子名で持つ。行番号で持つと、機種を差し替えたとき端子の並びが
       変わって「出力 R507 = AC100V L」のような嘘を刷ってしまう */
    const t = Array.isArray(fn) ? fn[i] : fn[p.n];
    if (!t) return;
    const sp = sym.ioSheet || {};
    const a = pinAbs(dev, { x: (sp.fnTextX === undefined ? KV_FN_TEXT_X : sp.fnTextX) + devFnDx(dev), y: p.y });
    const hh = textHeightMM(String(t), h);
    const w = textWidthMM(String(t), hh, false, false);
    out.push({ text: String(t), x: a.x, y: a.y, size: hh, anchor: "start", row: p.row === undefined ? i : p.row,
      name: p.n, over: w > (sp.fnRoom === undefined ? KV_FN_ROOM : sp.fnRoom),   // 下線からはみ出しているか
      box: { x: a.x, y: a.y - hh, w, h: hh } });
  });
  return out;
}

function deviceXrefBox(page, dev) {
  const sym0 = symOf(dev.sym);
  if (sym0 && sym0.gotoRef) {
    /* 行き先の図番は旗の平行部の中央に、旗の長手方向へ沿わせて置く。図番そのものは
       持たず、選んだページのものを描くたびに引くので、ページを並べ替えても
       図番を振り直しても追従する。
       中心を五角形全体ではなく平行部 (x0〜x1) に合わせるのが肝で、全体の中心に
       置くと長い図番が先端の斜辺に食い込む。
       縦向きに置いた行き先では文字も 90° 倒す (図面の文字は下辺から、やむを
       得なければ右辺から読む向き — JIS Z 8317-1 / IEC 61082-1)。
       高さは textHeightMM を通す。和文の図番は最小呼び 3.5mm へ上がるので
       (JIS Z 8313-10)、2.5mm のままだと外接矩形が実際より 1mm 低くなり、
       図枠はみ出し・文字の重なりの検図が誤判定する */
    const s0 = contentScale();
    const text0 = gotoRefText(dev);
    const h0 = textHeightMM(text0, TEXT_H.small * s0 * devScale(dev));
    const w0 = textWidthMM(text0, h0, false, true);
    /* 上下の中心合わせは実インクで測る。呼び h は基準の字 (H) の高さなので、
       "/" や和文のように基線の下へ出る字は h だけでは測れず、中心から下へ
       ずれて旗の輪郭に接する */
    const ink = textInkMM(text0, h0, true, false);
    const ih = ink.up + ink.down;                       // 実際に紙へ乗る高さ
    const base0 = (ink.up - ink.down) / 2;              // 中心から基線までの距離
    const fl0 = gotoFlag(sym0);
    const c0 = pinAbs(dev, { x: (fl0.x0 + fl0.x1) / 2, y: 0 });   // 平行部の中央 (機器と一緒に回る)
    const rot0 = (((dev.rot || 0) % 360) + 360) % 360;
    const ang0 = (rot0 === 90 || rot0 === 270) ? 90 : 0;
    // 読む向き u と字の下向き v (画面は y 下向き)。基線は中央から v へ base0
    const ca = Math.cos(ang0 * Math.PI / 180), sa = Math.sin(ang0 * Math.PI / 180);
    const vx = sa, vy = ca;
    return { x: c0.x + vx * base0, y: c0.y + vy * base0, text: text0, size: h0,
      anchor: "middle", angle: ang0, ink: true,        // 図番は図面色で刷る (注記ではない)
      box: { x: c0.x - (ang0 ? ih : w0) / 2, y: c0.y - (ang0 ? w0 : ih) / 2,
        w: ang0 ? ih : w0, h: ang0 ? w0 : ih } };
  }
  if (!dev.linkTo) return null;
  const f = findDevice(dev.linkTo);
  if (!f) return null;
  const s = contentScale();
  const b = devBounds(dev);
  const text = "/" + devLocation(f.dev);
  const h = TEXT_H.small * s * devScale(dev), w = textWidthMM(text, h, false, true);
  const obst = pinLabelBoxes(page);
  page.devices.forEach(d2 => {
    deviceObstacleBoxes(d2, OBST_INSET.label * s).forEach(b => obst.push(b));
    deviceLabelBoxes(page, d2).forEach(o => obst.push(o.box));
  });
  const cands = [
    [b.x + b.w + 1.6 * s, b.y + b.h / 2 + 1.2 * s],
    [b.x + b.w + 1.6 * s, b.y + b.h / 2 + 5.2 * s],
    [b.x + b.w + 1.6 * s, b.y + b.h / 2 - 2.8 * s],
    [b.x + b.w + 1.6 * s, b.y + b.h + 3.4 * s],
    [b.x + b.w + 1.6 * s, b.y - 1.4 * s],
    [b.x - 1.6 * s - w, b.y + b.h / 2 + 5.2 * s],
    [b.x - 1.6 * s - w, b.y - 1.4 * s],
  ];
  let best = null;
  for (const [x, y] of cands) {
    const box = { x, y: y - h, w, h };
    let sc = 0;
    for (const r of obst) sc += overlapArea(box, padRect(r, LABEL_CLEAR / 2));
    if (sc === 0) return { x, y, text, box, size: h };
    if (!best || sc < best.sc) best = { sc, res: { x, y, text, box, size: h } };
  }
  return best.res;
}

function deviceLabelBoxes(page, dev) {
  const c = _labelCache.get(page);
  if (c && c.rev === App.labelRev) {
    const hit = c.map.get(dev.id);
    if (hit) return hit;
  }
  const map = computePageLabels(page);
  _labelCache.set(page, { rev: App.labelRev, map });
  return map.get(dev.id) || placeDeviceLabels(page, dev, labelObstacles(page));
}
function labelBox(o) {
  const x = o.anchor === "middle" ? o.x - o.w / 2 : o.anchor === "end" ? o.x - o.w : o.x;
  return { x, y: o.y - o.h, w: o.w, h: o.h };
}
/** 矩形を内側へ縮める (当たり判定の余白ぶんを外して実描画に近づける) */
function insetRect(r, d) {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - d * 2), h: Math.max(0, r.h - d * 2) };
}

/** 面積比 ratio 以上で重なっているか */
function rectsOverlap(a, b, ratio = 0) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return false;
  return !ratio || (ox * oy) > a.w * a.h * ratio;
}

/** 注記テキストの概算 bbox */
/** 自由文字の向き (度・時計回り)。0〜359 に丸めて返す */
function textRot(t) { return ((((t && t.rot) || 0) % 360) + 360) % 360; }
/** 図面座標 → 文字の基点まわりに逆回転した座標 (当たり判定・検図で共用) */
function textLocalPt(t, x, y) {
  const a = textRot(t);
  if (!a) return [x, y];
  const r = -a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const dx = x - t.x, dy = y - t.y;
  return [t.x + dx * cs - dy * sn, t.y + dx * sn + dy * cs];
}
function textBounds(t) {
  // noMin: 取り込んだ図面の文字は和文の最小呼びへ持ち上げない (見た目と一致させる)
  const h = t.noMin ? (t.size || TEXT_H.normal) * contentScale()
    : textHeightMM(t.text || "", (t.size || TEXT_H.normal) * contentScale());
  const w = textWidthMM(t.text || "", h);
  const anchor = t.anchor || "middle";
  const x = anchor === "middle" ? t.x - w / 2 : anchor === "end" ? t.x - w : t.x;
  const box = { x, y: t.y - h, w, h: h * 1.25 };
  const a = textRot(t);
  if (!a) return box;
  /* 回した文字は、回転後の 4 隅を包む外接箱で見る (検図の重なり判定・
     ラベルよけは軸に沿った箱で扱うため)。基点 (t.x,t.y) が回転の中心 */
  const r = a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const xs = [], ys = [];
  [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .forEach(([px, py]) => {
      const dx = px - t.x, dy = py - t.y;
      xs.push(t.x + dx * cs - dy * sn); ys.push(t.y + dx * sn + dy * cs);
    });
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 表示する改訂行 (新しい方から最大 maxRows 行) */
function revisionRows() {
  const revs = (projectMeta().revs || []).filter(r => r && (r.rev || r.date || r.desc || r.appr));
  return revs.slice(-REV_TABLE.maxRows);
}

/* JIS Z 8313 の「文字高 h」は大文字の高さを指すが、SVG の font-size は
   em 寸法なので、そのまま渡すと実際の文字高は h の約 0.7 倍にしかならない。
   図面に印字される文字高を規格値どおりにするため、SVG へ出すときだけ換算する。
   (DXF の TEXT 高さは大文字高そのものなので TEXT_H をそのまま渡してよい) */
/* JIS Z 8313 の「文字高 h」は欧文では大文字高、和文では字面の高さを指すが、
   SVG の font-size は em 寸法なのでそのまま渡すと規格値にならない。
   比率は書体に依存するので、実際に描画に使う書体から canvas で実測する
   (measureText().actualBoundingBox*)。測れない環境では標準的な値を使う。 */
const DRAW_FONT = "sans-serif";        // 図面の既定書体 (画面・印刷・実測で共通)
const DRAW_FONT_MONO = "monospace";
const TEXT_CAP_FALLBACK = { sans: 0.70, mono: 0.73, serif: 0.65, cjk: 0.88,
  "sans+b": 0.71, "mono+b": 0.74, "serif+b": 0.66, "cjk+b": 0.90 };
const __capCache = {};
function capRatio(kind) {
  if (__capCache[kind] !== undefined) return __capCache[kind];
  let r = TEXT_CAP_FALLBACK[kind] || 0.70;
  const g = measureCtx();
  if (g) {
    const bold = kind.endsWith("+b");
    const base = bold ? kind.slice(0, -2) : kind;
    const fam = base === "mono" ? DRAW_FONT_MONO : base === "serif" ? "serif" : DRAW_FONT;
    g.font = `${bold ? "600 " : ""}1000px ${fam}`;
    const m = g.measureText(base === "cjk" ? "国" : "H");
    const h = ((m.actualBoundingBoxAscent || 0) + Math.max(0, m.actualBoundingBoxDescent || 0)) / 1000;
    if (h > 0.3 && h < 1.5) r = h;
  }
  __capCache[kind] = r;
  return r;
}
const TEXT_CAP = 0.70, TEXT_CAP_MONO = 0.73, TEXT_CAP_SERIF = 0.65, TEXT_CAP_CJK = 0.88;  // 実測が使えないときの参考値
/* 和文 (漢字・かな) を含む文字列は JIS Z 8313-10 の呼びに合わせる。
   同規格の和文の呼びは 3.5mm 以上なので、それを下回らないようにする。 */
const TEXT_H_MIN_CJK = 3.5;
const RE_CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\u3040-\u30FF]/;
function hasCJK(s) { return RE_CJK.test(String(s == null ? "" : s)); }
/** 欧文用の SVG font-size (文字高 h → em 寸法) */
function svgFontSize(h, mono, bold) { return +(h / capRatio((mono ? "mono" : "sans") + (bold ? "+b" : ""))).toFixed(3); }
/** 文字列に応じた SVG font-size。図面に出す文字はすべてこれを通す */
function svgFontSizeFor(text, h, mono, opts) {
  const o = typeof opts === "object" && opts ? opts : {};
  const b = o.bold ? "+b" : "";
  // noMin: 取り込んだ図面の注記など、元の寸法に忠実であるべき文字は和文の最小呼びを適用しない
  if (hasCJK(text)) return +((o.noMin ? h : Math.max(h, TEXT_H_MIN_CJK)) / capRatio("cjk" + b)).toFixed(3);
  return +(h / capRatio((o.serif ? "serif" : mono ? "mono" : "sans") + b)).toFixed(3);
}
/** 文字列が実際に占める高さ (mm)。和文は最小呼びに引き上げられる */
function textHeightMM(text, h) { return hasCJK(text) ? Math.max(h, TEXT_H_MIN_CJK) : h; }
/* 実際に紙へ乗るインクの上下 (mm)。呼び h は基準の字 (H・国) の高さなので、
   "/" や仮名のように基線の下へ出る字は h だけでは測れない。枠の中へ文字を
   きっちり収めるときは、この実測を使う (JIS Z 8313-0 の「あき」は実際の
   線と線の間隔のこと) */
const __inkCache = new Map();
function textInkMM(text, h, mono, bold) {
  const key = `${mono ? "m" : "s"}${bold ? "b" : ""}|${h}|${text}`;
  if (__inkCache.has(key)) return __inkCache.get(key);
  let r = { up: h, down: 0 };
  const g = measureCtx();
  if (g) {
    const fs = svgFontSizeFor(String(text), h, mono, { bold });
    const fam = hasCJK(text) ? DRAW_FONT : mono ? DRAW_FONT_MONO : DRAW_FONT;
    g.font = `${bold ? "600 " : ""}${(fs * 100).toFixed(2)}px ${fam}`;
    const m = g.measureText(String(text));
    const up = (m.actualBoundingBoxAscent || 0) / 100, down = Math.max(0, m.actualBoundingBoxDescent || 0) / 100;
    if (up > 0 && up + down < h * 3) r = { up, down };
  }
  if (__inkCache.size > 500) __inkCache.clear();
  __inkCache.set(key, r);
  return r;
}

/* 文字幅は canvas の実測を使う (推定式では表題欄の切り詰め判定や中央寄せが
   数十%ずれる)。描画に使う font-size と同じ条件で測るので、画面・DXF・検図で
   同じ値になる。canvas が使えない環境では従来の概算にフォールバックする。 */
let __measCtx;
function measureCtx() {
  if (__measCtx !== undefined) return __measCtx;
  try { __measCtx = document.createElement("canvas").getContext("2d") || false; }
  catch (e) { __measCtx = false; }
  return __measCtx;
}
const __twCache = new Map();
function isWideChar(c) {
  return (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
    (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) ||
    (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) ||
    (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x20000 && c <= 0x3FFFD);
}
/** 文字列の描画幅 (mm)。size は JIS の文字高 h。mono=等幅書体で描く文字列 */
function textWidthMM(s, size, bold = false, mono = false) {
  const str = String(s == null ? "" : s);
  if (!str) return 0;
  const fs = svgFontSizeFor(str, size, mono, { bold });
  const key = `${mono ? 1 : 0}|${bold ? 1 : 0}|${fs}|${str}`;
  const hit = __twCache.get(key);
  if (hit !== undefined) return hit;
  let w;
  const g = measureCtx();
  if (g) {
    g.font = `${bold ? "600 " : ""}${fs * 100}px ${mono ? "monospace" : "sans-serif"}`;
    w = g.measureText(str).width / 100;
  } else {
    let n = 0;
    for (const ch of str) n += isWideChar(ch.codePointAt(0)) ? 1 : 0.55;
    w = n * fs * (bold ? 1.05 : 1);
  }
  if (__twCache.size > 4000) __twCache.clear();
  __twCache.set(key, w);
  return w;
}
/** JIS Z 8313 の文字高の標準列 (この値以外は使わない) */
const TEXT_H_SERIES = [2.5, 3.5, 5, 7, 10, 14, 20];
function fitTextSize(value, cellW, startSize, bold = false) {
  // 標準列を大きい方から順に試し、欄に収まる最大の標準文字高を返す
  const cand = TEXT_H_SERIES.filter(v => v <= startSize + 1e-6).sort((a, b) => b - a);
  for (const size of cand) if (textWidthMM(value, size, bold) <= cellW) return size;
  return TEXT_H.small;   // 最小 2.5mm。収まらない分は truncateToWidth が切り詰める
}
/** 欄に収まらない文字列を末尾「…」で切り詰める (クリップできない DXF 用) */
function truncateToWidth(value, cellW, size, bold = false) {
  const s = String(value);
  if (textWidthMM(s, size, bold) <= cellW) return s;
  let out = s;
  while (out.length > 1 && textWidthMM(out + "…", size, bold) > cellW) out = out.slice(0, -1);
  return out + "…";
}
/** 線分 a-b が矩形 r と交差する (端点が内側の場合を含む) か。直交配線前提の簡易判定 */
/* 直交配線 (このアプリの配線はすべて水平・垂直) を前提に、線分と矩形の
   重なりを外接矩形どうしで判定する。斜め線では余分に当たることがある。 */
function segCrossesRect(a, b, r) {
  const inside = p => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x0 <= r.x + r.w && x1 >= r.x && y0 <= r.y + r.h && y1 >= r.y;
}

/** 輪郭線の内側 (作図してよい範囲) */
function frameRect() {
  return { x: SHEET.marginLeft, y: SHEET.margin, w: SHEET.w - SHEET.marginLeft - SHEET.margin, h: SHEET.h - SHEET.margin * 2 };
}

const App = {
  project: null,
  pageIdx: 0,
  selection: new Set(),      // device/wire/text の id
  tool: "select",
  undoStack: [],
  redoStack: [],
  sim: { running: false, states: {}, energized: null, timers: {} },
  clipboard: null,
  labelRev: 0,               // ラベル配置キャッシュの世代 (commit / refresh で更新)
};

/* ══════════════ ユーティリティ ══════════════ */
let __uid = 1;
function uid(prefix = "e") { return prefix + (Date.now() % 1e7).toString(36) + (__uid++).toString(36); }
function snap(v) { return Math.round(v / GRID) * GRID; }
function ptKey(x, y) { return Math.round(x * 10) + "," + Math.round(y * 10); }
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

/* ══════════════ プロジェクト / ページ ══════════════ */
function newProject(name = "無題プロジェクト") {
  return {
    name,
    symbols: [],        // この図面が使う取り込みシンボルの定義 (自己完結させる)
    meta: {
      paper: "A3", scale: "1:1", dwgNo: "", rev: "0",
      designer: "", checker: "", date: todayStr(), author: "ElectraCAD Studio",
    },
    /* 図面集の頭 4 枚 (表紙・目次・仕様 2 枚) を標準で付ける。
       いずれも要らなければページのタブから消せる */
    pages: [newPage("表紙", 1, "cover"), newPage("目次", 2, "toc"),
            newPage("仕様", 3, "spec"), newPage("仕様 (2)", 4, "spec"),
            newPage("メイン回路", 5)],
  };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function newPage(name, no, kind) {
  const pg = { id: uid("p"), no, name, devices: [], wires: [], texts: [], zones: [] };
  if (kind) pg.kind = kind;                 // "cover" 表紙 / "toc" 目次 / "spec" 仕様
  if (kind === "spec") pg.spec = defaultSpec();
  return pg;
}
/** 図面ページ (回路を描くページ) か。表紙・目次・仕様は作図の対象外 */
function isDrawingPage(page) { return !page || !page.kind; }

/* ══════════════ 標準の頭 3 枚 (表紙・目次・仕様) ══════════════
   実務の図面集の作法にそろえる:
   ・表紙 … 客先名と装置名。図枠は他ページと同じものを使う
   ・目次 … ページ名と図番の一覧。ページを足すたびに自動で作り直す
   ・仕様 … 制御盤の仕様書。選ぶだけ (チェック) で決まる — 数値の
            入力欄は「その他」を選んだときだけ書き込む */

/* 仕様シートの様式。紙の仕様書 (制御盤筐体仕様 / 制御盤配線仕様) をそのまま
   写した表組み。番号を押すと ◯ が移る — 記入は「その他・指定」の欄だけ。
   ブロックの種類:
     optsMemo … 選択肢の表 + 右に記入欄 (使用環境 + 特記事項)
     grid2    … 番号を 2 列に折り返す表 (保護等級 1〜4 / 5〜8)
     pair     … 見出し 2 列。左右が別々の選択肢 (材質: 鉄 / ステンレス)
     compare  … 当社標準 / 御社指定方法 の対比表 (記入が無い欄には斜線)
     wire     … 単線の表 (回路・用途・線色 1〜3・定格)
     small    … 小さな 2 択の表 (チューブ長・取付方向)
     tubeFig  … マークチューブの取付方向を示す図 (読上げ) */
const SPEC_SHEET = [
  { title: "制御盤筐体仕様", blocks: [
    { t: "使用環境", kind: "optsMemo", k: "env", memoK: "env", memoLabel: "特記事項",
      opts: ["一般環境 (10℃〜40℃)", "特殊環境 (指定環境)"] },
    { t: "保護等級", kind: "grid2", k: "ip",
      opts: ["IP40", "IP41", "IP42", "IP43", "IP44", "IP54", "その他", "指定無し"] },
    /* memoAt = 記入がその選択肢の括弧に入る (指定色は 2 番の括弧)。
       選んだ行に書き込むと、標準色の行にまで指定色が出てしまう */
    { t: "材質", kind: "pair", heads: ["鉄", "ステンレス"], groups: [
      { k: "mat_fe", opts: ["標準色 (5Y7/1)", "指定色 (      )"], memoK: "mat_fe", memoAt: 1 },
      { k: "mat_sus", opts: ["無処理 (購入標準)", "鏡面", "ヘアライン"] },
    ] },
    { t: "電源接続方法", kind: "compare", heads: ["当社標準", "御社指定方法"], k: "pwr_std",
      opts: ["主幹用遮断器一次側へ引き込み (端子台)", "コネクター接続 (アメリカン電機:3112N) 配線長 3M"],
      memoK: "pwr", memoLabel: "御社指定方法" },
  ] },
  { title: "制御盤配線仕様", blocks: [
    { t: "単線", kind: "wire", heads: ["回路", "用途", "線色", "定格"], rows: [
      { c: "AC200V", use: "3相", k: "w_ac200_3", opts: [["黒", "黒", "黒"], ["赤", "白", "黒"], []], rate: "300V 以上" },
      { c: "AC200V", use: "単相", k: "w_ac200_1", opts: [["黒"], ["黄"], []], rate: "300V 以上" },
      { c: "AC100V", use: "制御回路", k: "w_ac100", opts: [["黒"], ["赤"], ["黄"]], rate: "300V 以上" },
      { c: "DC24V", use: "全般", k: "w_dc24", opts: [["青"], [], []], rate: "30V 以上" },
      { c: "計装", use: "- - -", opts: [[], [], []], rate: "30V 以上シールド付" },
    ] },
    { t: "マークチューブ・記名板", kind: "small", head: "チューブ長", k: "tube", memoK: "tube",
      opts: ["標準 (20mm)", "その他 (** mm)"] },
    { kind: "small", head: "取付方向", k: "tube_dir", memoK: "tube_dir",
      opts: ["標準 (読上げ)", "その他 (図示)"] },
    { kind: "tubeFig", label: "(読上げ)" },
  ] },
];
/* 2 枚目の仕様。1 枚目と同じ作法 (番号を押すと ◯ が移る・記入欄はクリックで書く)。
   ・opts   … 番号つきの選択肢を 1 列に並べる。multi=true なら複数選べる
   ・fields … ラベルと記入欄の行 (定常時の温度レンジなど) */
const SPEC_SHEET2 = [
  { title: "電源・環境仕様", blocks: [
    { t: "供給電源電圧", kind: "opts", k: "sup_v", memoK: "sup_v", memoAt: 2,
      opts: ["AC100V", "AC200V", "その他 (      )"] },
  ] },
  { title: "冷却・外部接続", blocks: [
    { t: "制御盤冷却方法", kind: "opts", k: "cool",
      opts: ["ファン", "盤クーラー", "エアーパージ"] },
    { t: "外部 I/F", kind: "opts", k: "extif", multi: true, note: "(複数チェック可)",
      opts: ["上流", "下流", "他装置"] },
    // チェックした I/F ごとに、内容を箇条書きで書き足せる欄。
    // 1 行書くと追記用の空き行が増えるので、同じ I/F が何本あっても書ける
    { kind: "bullets", of: "extif", head: "詳細 (チェックした I/F ごとに記入)" },
  ] },
];

/* ── 箇条書きの欄 (bullets) ──
   保存キーは of_i (1 行目)、of_i_1、of_i_2 … と行ごとに分かれる。
   書いたぶんだけ行が増え、途中の行を消したら詰める */
function specBulletKey(of, i, r) { return r ? `${of}_${i}_${r}` : `${of}_${i}`; }
/** その項目に書いてある行 (順番どおり・空きは無い前提) */
function specBullets(spec, of, i) {
  const memo = (spec && spec.memo) || {};
  const out = [];
  for (let r = 0; r < 30; r++) {
    const v = memo[specBulletKey(of, i, r)];
    if (v && String(v).trim()) out.push(String(v).trim()); else break;
  }
  return out;
}
/** 途中の行を消したときの空きを詰める。記入欄を書き換えた後に呼ぶ */
function specCompactBullets(spec) {
  if (!spec || !spec.memo) return;
  const blocks = SPEC_SHEETS.flatMap(sh => sh.flatMap(sec => sec.blocks));
  [...new Set(blocks.filter(b => b.kind === "bullets").map(b => b.of))].forEach(of => {
    const grp = blocks.find(b => b.k === of);
    const n = grp && grp.opts ? grp.opts.length : 8;
    for (let i = 0; i < n; i++) {
      const vals = [];
      for (let r = 0; r < 30; r++) {
        const k = specBulletKey(of, i, r);
        const v = spec.memo[k];
        if (v && String(v).trim()) vals.push(String(v).trim());
        delete spec.memo[k];
      }
      vals.forEach((v, r) => { spec.memo[specBulletKey(of, i, r)] = v; });
    }
  });
}
/** 仕様ページの様式 (1 枚目 / 2 枚目 …)。ページの並び順で決まる */
const SPEC_SHEETS = [SPEC_SHEET, SPEC_SHEET2];
function specSheetFor(page) {
  const specs = App.project ? App.project.pages.filter(p => p.kind === "spec") : [];
  const i = Math.max(0, specs.indexOf(page));
  return SPEC_SHEETS[Math.min(i, SPEC_SHEETS.length - 1)];
}
/** 記入欄の一覧 (プロパティに出す)。k = memo の保存キー */
function specMemoFields(sheet) {
  const out = [];
  const seen = new Set();
  const add = (k, label, where) => { if (k && !seen.has(k)) { seen.add(k); out.push({ k, label, where }); } };
  (sheet ? [sheet] : SPEC_SHEETS).forEach(sh => sh.forEach(sec => sec.blocks.forEach(b => {
    add(b.memoK, b.memoLabel || "指定内容", b.t || b.head || sec.title);
    add(b.memo2K, "理由", b.t || b.head || sec.title);
    (b.rows || []).forEach(r => add(r.memoK, r.label || "記入", b.t || sec.title));
    (b.groups || []).forEach(g => add(g.memoK, "指定色", b.t || sec.title));
  })));
  return out;
}
/** 選択肢を持つ組の一覧 (既定値・クリック判定で使う)。multi = 複数選べる組 */
function specGroups() {
  const out = [];
  SPEC_SHEETS.forEach(sh => sh.forEach(sec => sec.blocks.forEach(b => {
    if (b.k) out.push({ k: b.k, multi: !!b.multi });
    (b.groups || []).forEach(g => out.push({ k: g.k, multi: false }));
    (b.rows || []).forEach(r => { if (r.k) out.push({ k: r.k, multi: false }); });
  })));
  return out;
}
/** 既定の選択 (いちばん標準的な組み合わせ) */
function defaultSpec() {
  const sel = {};
  specGroups().forEach(g => { sel[g.k] = g.multi ? [] : 0; });
  sel.ip = 5;                    // IP54 (盤の実務でいちばん多い)
  return { sel, memo: {} };
}
/** 複数選べる組の選択状態 (配列で持つ) */
function specMultiSel(spec, k) {
  const v = spec && spec.sel ? spec.sel[k] : null;
  return Array.isArray(v) ? v : (typeof v === "number" ? [v] : []);
}
/** 目次の行 (表紙と目次そのものは載せない — 図面集の作法) */
function tocRows() {
  return App.project.pages
    .filter(pg => pg.kind !== "cover" && pg.kind !== "toc")
    .map(pg => ({ name: pg.name, no: pageDwgNo(pg) }));
}
/** プロジェクトに同梱されたシンボル定義を辞書へ取り込む (読込・undo 後に呼ぶ)。
    同じ id なのに絵が違う定義が来たら (旧式データ: 編集で id を使い回していた)、
    ライブラリ側は触らず「別の版」として取り込み、この図面の機器をその版へ
    付け替える — 読み込んだ図面が他の案件のシンボルを書き換えないため */
function mergeProjectSymbols() {
  const list = App.project && App.project.symbols;
  if (!Array.isArray(list)) return;
  const remap = {};
  list.forEach(sym => {
    if (!sym || !sym.id) return;
    const cur = SYMBOLS_BY_ID[sym.id];
    if (cur && cur !== sym && !symSameDrawing(cur, sym)) {
      // 同じ絵の版が既にあればそれを使い、無ければ退役版として登録する
      const base = (sym.verOf || String(sym.id).replace(/~\d+$/, ""));
      const hit = Object.values(SYMBOLS_BY_ID).find(s2 => symBaseOf(s2) === base && symSameDrawing(s2, sym));
      let nid;
      if (hit) nid = hit.id;
      else {
        nid = symNextVerId(sym.id);
        const moved = { ...sym, id: nid, verOf: base, retired: true };
        SYMBOLS_BY_ID[nid] = moved;
        if (typeof DB_SYMBOLS !== "undefined" && !DB_SYMBOLS.some(x => x.id === nid)) DB_SYMBOLS.push(moved);
      }
      remap[sym.id] = nid;
      return;
    }
    SYMBOLS_BY_ID[sym.id] = sym;
    if (typeof DB_SYMBOLS !== "undefined" && !DB_SYMBOLS.some(x => x.id === sym.id)) DB_SYMBOLS.push(sym);
  });
  if (Object.keys(remap).length) {
    App.project.pages.forEach(pg => (pg.devices || []).forEach(d => { if (remap[d.sym]) d.sym = remap[d.sym]; }));
  }
  /* この図面が使っている自作シンボルはパレットに出す。
     別の PC で作った図面を開いたときや、棚 (分類) を消した後に
     「機器は描けるのに記号がパレットに見当たらない」を防ぐ —
     データベースの棚はパレットに追加 (ピン) した記号しか出さないため */
  try {
    const used = new Set();
    App.project.pages.forEach(pg => (pg.devices || []).forEach(d => used.add(d.sym)));
    const pin = [];
    used.forEach(id => {
      const sym = SYMBOLS_BY_ID[id];
      if (sym && (sym.custom || sym.imported) && !sym.retired && !sym.altOf
        && symCatOf(sym) === "db" && !dbPinnedList().includes(id)) pin.push(id);
    });
    if (pin.length) {
      dbSetPinned([...new Set([...dbPinnedList(), ...pin])]);
      if (typeof UI !== "undefined" && UI.buildPalette && document.getElementById("symTree")) UI.buildPalette();
    }
  } catch (e) { /* パレットが無い画面 (テスト等) では何もしない */ }
}
/** 図面で実際に使われている取り込みシンボルをプロジェクトへ保存する */
function syncProjectSymbols() {
  if (!App.project) return;
  const used = new Set();
  App.project.pages.forEach(pg => pg.devices.forEach(d => used.add(d.sym)));
  const keep = [];
  used.forEach(id => {
    const sym = SYMBOLS_BY_ID[id];
    if (sym && sym.imported) keep.push(sym);
  });
  App.project.symbols = keep;
}

/** 旧データ互換: zones が無いページに追加 */
function pageZones(page) {
  if (!page.zones) page.zones = [];
  return page.zones;
}
/* 破線枠のコメント (ラベル)。既定は枠の左上のすぐ外側。
   lx/ly を持つ枠は、その位置 (枠の左上からの相対 mm) へ動かしてある —
   マウスでつまんで動かした結果を覚えておくため。
   labelSize はコメントの文字高 (mm)。プロパティで変えられる。 */
const ZONE_LABEL_DX = 2.5, ZONE_LABEL_DY = -1.8;
/* 破線枠は導体の格子 (5mm) に縛らない。電気的なつながりを持たない囲みなので、
   機器や配線のすき間へぴったり寄せられるよう細かい刻みで動かす。
   コメントの移動と同じ 0.5mm */
const ZONE_STEP = 0.5;
function snapZone(v) { return Math.round(v / ZONE_STEP) * ZONE_STEP; }
function zoneLabelSize(z) { return z.labelSize > 0 ? z.labelSize : TEXT_H.normal; }
function zoneLabelPos(z) {
  const f = contentScale();
  return {
    x: z.x + (z.lx !== undefined ? z.lx : ZONE_LABEL_DX * f),
    y: z.y + (z.ly !== undefined ? z.ly : ZONE_LABEL_DY * f),
    size: zoneLabelSize(z) * f,
  };
}
/** 破線枠のコメントの外接箱 (ベースライン基準・左寄せ) */
function zoneLabelBox(z) {
  if (!z.label) return null;
  const p = zoneLabelPos(z);
  return { x: p.x, y: p.y - p.size, w: textWidthMM(z.label, p.size), h: p.size };
}
function curPage() { return App.project.pages[App.pageIdx]; }

/* ══════════════ デバイス ══════════════ */
/* 定義が見つからないシンボル (取り込みシンボルを含む図面を別環境で開いた等) の
   代替。落とさずに「?」枠で描き、検図でエラーとして知らせる。 */
const MISSING_SYM = {
  id: "__missing", cat: "misc", letter: "", name: "未登録シンボル", nameEn: "Missing symbol",
  desc: "この図面が使うシンボル定義が見つかりません", pins: [{ x: 0, y: 0, n: "1" }, { x: 0, y: 20, n: "2" }],
  sim: "passthru", bounds: [-8, -2, 16, 24], missing: true,
  body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-7" y="4" width="14" height="12" stroke-dasharray="3 0.75" stroke-width="0.25"/>` +
    `<text x="0" y="12.6" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">?</text>`,
};
/* 伸縮シンボル (多芯ケーブルの囲み・シールド)。
   1つの図記号で心線の本数に合わせて長さを変えられるよう、"base@長さ" という
   id で寸法違いを表す。定義は使われた時に作って SYMBOLS_BY_ID へ載せるので、
   保存・再読込・DXF出力・部品表は通常のシンボルと同じ扱いで通る。
   パレット (DB_SYMBOLS) には基本形だけを置き、寸法違いは並べない。 */
const SYM_VARIANT_RE = /^(.+)@(\d+(?:\.\d+)?)$/;
/** 伸縮シンボルの寸法を丸める (刻み・上下限は各シンボルの stretch 定義に従う) */
function symStretchSpan(base, span) {
  const st = base.stretch;
  const step = st.step || 5;
  const v = Math.round((parseFloat(span) || st.def) / step) * step;
  return Math.max(st.min, Math.min(st.max, +v.toFixed(2)));
}
/** 基本形 + 長さ → 寸法違いのシンボル定義 */
function symStretchVariant(base, span) {
  const s = symStretchSpan(base, span);
  const id = `${base.id}@${s}`;
  const cur = SYMBOLS_BY_ID[id];
  if (cur) return cur;
  const v = { ...base, id, bounds: base.stretch.bounds(s), body: base.stretch.body(s), span: s, stretchOf: base.id };
  if (base.stretch.pins) v.pins = base.stretch.pins(s);      // 端子位置も長さに追従する (シールドのドレン線)
  if (base.stretch.extra) Object.assign(v, base.stretch.extra(s));  // 用紙・下地の寸法なども寸法違いへ追従
  delete v.stretch;                       // 寸法違いから更に派生させない
  SYMBOLS_BY_ID[id] = v;                  // DB_SYMBOLS へは入れない (パレットに増やさない)
  return v;
}
/** 伸縮シンボルの長さ ⇔ 心線の本数 (囲みは 1本目の 1ピッチ上から最終心線の 1ピッチ下まで) */
// 1 芯は遮へい単体 (シールド線・同軸) で使う。心線囲み (多芯ケーブル) の側は
// stretch.min = 15 なので 2 芯より小さくならない
function symSpanToCores(span) { return Math.max(1, Math.round((span - 5) / GRID)); }
function symCoresToSpan(n) { return Math.max(1, Math.round(n)) * GRID + GRID; }
/** 伸縮シンボルの基本形 (寸法違いなら元の定義) */
function symStretchBase(sym) {
  if (sym && sym.stretch) return sym;
  if (sym && sym.stretchOf) return SYMBOLS_BY_ID[sym.stretchOf] || null;
  return null;
}
function symOf(symId) {
  const s = SYMBOLS_BY_ID[symId];
  if (s) return s;
  const m = SYM_VARIANT_RE.exec(String(symId == null ? "" : symId));
  if (m) {
    const base = SYMBOLS_BY_ID[m[1]];
    if (base && base.stretch) return symStretchVariant(base, parseFloat(m[2]));
  }
  return MISSING_SYM;
}

/* 図記号・文字・線の太さは尺度によらず常に 1:1 で描く (シンボルの大きさは
   変えない)。尺度を変えると図枠 (用紙) だけが広くなり、1枚に収められる
   回路が増える。 */
function pinAbs(dev, pin) {
  const r = (dev.rot || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), k = devScale(dev);
  return { x: dev.x + (pin.x * c - pin.y * s) * k, y: dev.y + (pin.x * s + pin.y * c) * k };
}
function devPins(dev) {
  const sym = symOf(dev.sym);
  return sym.pins.map((p, i) => ({ ...pinAbs(dev, p), name: p.n, idx: i }));
}
function devBounds(dev) {
  const sym = symOf(dev.sym);
  const [bx, by, bw, bh] = sym.bounds;
  const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]
    .map(([x, y]) => pinAbs(dev, { x, y }));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 全ページから letter の次の連番タグを生成 (-S1, -K3 …) */
function nextTag(letter) {
  let max = 0;
  const re = new RegExp("^-" + letter + "(\\d+)$");
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    const m = re.exec(d.tag || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }));
  return "-" + letter + (max + 1);
}

function addDevice(page, symId, x, y, opts = {}) {
  /* NaN/Infinity の座標は黙って受けない。undefined になった旧フィールドを
     足し引きした結果の NaN で、機器が図枠外の虚空へ落ちてもエラーが出ない */
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sym = symOf(symId);
  const dev = {
    id: uid("d"), sym: symId, x: snap(x), y: snap(y), rot: opts.rot || 0,
    tag: opts.tag !== undefined ? opts.tag : (sym.letter ? nextTag(sym.letter) : ""),
    desc: opts.desc !== undefined ? opts.desc : (sym.fn || ""),
    typeRef: opts.typeRef !== undefined ? opts.typeRef : (sym.typ || ""), linkTo: opts.linkTo || null,
    props: opts.props || {},
  };
  page.devices.push(dev);
  return dev;
}

function findDevice(id) {
  for (const pg of App.project.pages) {
    const d = pg.devices.find(d => d.id === id);
    if (d) return { dev: d, page: pg };
  }
  return null;
}

/** デバイスの表示タグ (リンクされた補助接点は親コイルのタグを表示) */
function displayTag(dev) {
  if (dev.linkTo) {
    const f = findDevice(dev.linkTo);
    if (f) return f.dev.tag;
  }
  return dev.tag;
}

/** 格子参照の列番号 (クロスリファレンス "ページ.列"。JIS Z 8311: 左上を起点に 1 から) */
function sheetCol(x) {
  const inner = SHEET.w - SHEET.marginLeft - SHEET.margin;
  return Math.max(1, Math.min(SHEET.cols, Math.floor((x - SHEET.marginLeft) / (inner / SHEET.cols)) + 1));
}
/** 格子参照の行記号 (I・O を除く) */
function sheetRow(y) {
  const inner = SHEET.h - SHEET.margin * 2;
  const i = Math.max(0, Math.min(SHEET.rows - 1, Math.floor((y - SHEET.margin) / (inner / SHEET.rows))));
  return SHEET_ROW_LETTERS[i] || "Z";
}
/** このページに印字される図番 (表題欄・DXF・印刷で共通) */
function pageDwgNo(page) {
  return page.dwgNo || projectMeta().dwgNo || "E-" + String(page.no).padStart(3, "0");
}
function devLocation(dev) {
  const f = findDevice(dev.id);
  const pageNo = f ? f.page.no : "?";
  return pageNo + "." + sheetCol(dev.x);
}

/** コイルにリンクされた接点一覧 (接点ミラー / クロスリファレンス) */
function linkedContacts(coilDev) {
  const out = [];
  App.project.pages.forEach(pg => pg.devices.forEach(d => {
    if (d.linkTo === coilDev.id) out.push(d);
  }));
  return out;
}

/* ══════════════ ワイヤ ══════════════ */
/* 線種。solid のみが電気的な配線で、破線・一点鎖線は作図線 (作図補助・
   区画表現) として扱い、ネット解析・シミュレーション・DRC・線番・
   端子表・接続リストのいずれからも除外する。
   線の要素長さは JIS Z 8312 に従う (細線 d=0.25mm、破線=12d/3d、
   一点鎖線=24d/3d/点(0.5d)/3d)。dxf は同じ寸法の DXF LTYPE パターン。 */
const WIRE_STYLES = {
  solid:   { name: "実線 (配線)",                 dash: "",                     dxf: null },
  dash:    { name: "破線 (かくれ線・区画)",       dash: "3 0.75",               dxf: [3, -0.75] },
  // ISO 128-20 の点要素は線幅の 0.5 倍程度。butt では消えるので round キャップで描く
  dashdot: { name: "一点鎖線 (中心線・基準線)",   dash: "6 0.75 0 0.75",    dxf: [6, -0.75, 0, -0.75], round: true },
  dashdotdot: { name: "二点鎖線 (想像線・隣接機器)", dash: "6 0.75 0 0.75 0 0.75", dxf: [6, -0.75, 0, -0.75, 0, -0.75], round: true },
};
/** 折線の全長 (mm) */
function polyLengthMM(pts) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return n;
}
/** 配線に掛ける破線パターン (線素で始まり線素で終わるよう端数をならす) */
function wireDashArray(w, f) {
  const st = WIRE_STYLES[w.style] || WIRE_STYLES.solid;
  if (!st.dash) return "";
  const base = st.dash.split(" ").map(v => parseFloat(v) * f);
  return fitDashPattern(base, polyLengthMM(w.pts) ).join(" ");
}
/* 導通するか。既定は「実線=配線 / それ以外=作図線」だが、w.aux を明示すれば
   線種と独立に指定できる (破線で描く盤外配線を回路として残す等)。 */
function isWireConductive(w) {
  if (w.aux !== undefined) return !w.aux;
  return !w.style || w.style === "solid";
}
/** 電気的に有効な (実線の) 配線だけを返す */
function condWires(page) { return page.wires.filter(isWireConductive); }

function addWire(page, pts, opts = {}) {
  // raw: グリッドに丸めない (DXF 取り込みなど、元図形の座標を保つ場合)
  const q = opts.raw ? (v => Math.round(v * 100) / 100) : snap;
  const wire = { id: uid("w"), pts: pts.map(p => [q(p[0]), q(p[1])]), num: opts.num || null };
  if (opts.style && opts.style !== "solid") wire.style = opts.style;
  // 長さ0の連続点を除去
  wire.pts = wire.pts.filter((p, i) => i === 0 || p[0] !== wire.pts[i - 1][0] || p[1] !== wire.pts[i - 1][1]);
  if (wire.pts.length < 2) return null;
  page.wires.push(wire);
  return wire;
}

/** 配線上へのシンボル後付け: ピンが載った配線をピン位置で分割し、
    デバイスの2ピン間に完全に挟まれた区間は削除する。
    (シンボル設置→配線 の流れと同じ見た目・接続になる) */
function spliceDeviceIntoWires(page, dev) {
  const pins = devPins(dev);
  // 1) 各ピンで配線を分割
  pins.forEach(pin => {
    for (let wi = page.wires.length - 1; wi >= 0; wi--) {
      const w = page.wires[wi];
      if (!isWireConductive(w)) continue; // 作図線は分割しない
      for (let i = 0; i < w.pts.length - 1; i++) {
        if (ptOnSeg(pin.x, pin.y, w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1])) {
          const ptsA = [...w.pts.slice(0, i + 1), [pin.x, pin.y]];
          const ptsB = [[pin.x, pin.y], ...w.pts.slice(i + 1)];
          const mk = pts => ({ id: uid("w"), pts, num: w.num, fixed: w.fixed, numShow: false, spec: w.spec, stub: w.stub });
          page.wires.splice(wi, 1, mk(ptsA), mk(ptsB));
          break;
        }
      }
    }
  });
  // 2) デバイスの2ピン間に一致する配線 (シンボルに隠れる区間) を削除
  const isPin = p => pins.some(pin => Math.abs(pin.x - p[0]) < .01 && Math.abs(pin.y - p[1]) < .01);
  page.wires = page.wires.filter(w => {
    if (!isWireConductive(w)) return true;
    const a = w.pts[0], b = w.pts[w.pts.length - 1];
    if (!isPin(a) || !isPin(b)) return true;
    if (Math.abs(a[0] - b[0]) < .01 && Math.abs(a[1] - b[1]) < .01) return false; // 零長
    // 直線1区間でピン→ピンなら本体に重なるため削除
    return w.pts.length > 2;
  });
}

function ptOnSeg(px, py, x1, y1, x2, y2) {
  const eps = 0.01;
  if (Math.abs(x1 - x2) < eps) { // 垂直
    return Math.abs(px - x1) < eps && py > Math.min(y1, y2) + eps && py < Math.max(y1, y2) - eps;
  }
  if (Math.abs(y1 - y2) < eps) { // 水平
    return Math.abs(py - y1) < eps && px > Math.min(x1, x2) + eps && px < Math.max(x1, x2) - eps;
  }
  return false;
}

/* ══════════════ ネットリスト解析 ══════════════
   Union-Find でページ内の電気的接続をまとめる。
   ノード = ワイヤ端点/角 + デバイスピン。
   ワイヤ区間は常に導通。デバイスは conductivePairs() に従う。      */
function UnionFind() {
  const parent = new Map();
  const find = k => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union, parent };
}

/**
 * デバイスが導通させるピンペア。
 * mode:
 *  - "sim":    シミュレーション状態に従う
 *  - "closed": 全接点を閉として扱う (DRC の到達性チェック用)
 *  - "open":   スイッチ要素はすべて開 (配線番号は接点を跨いで伝播しない)
 */
/* 多機能シンボル: 1台の機器の中にコイル・接点・素通しなどを複数持つ。
   funcs: [{ kind, pins: [a, b], name }] — kind は sim と同じ種別。
   接点は同じ機器の中のコイル (最初の coil) に連動する。dev.linkTo があれば
   外部のコイルに従う (自社製ドライバの外部インタロック等)。 */
function devFuncs(sym) { return Array.isArray(sym.funcs) && sym.funcs.length ? sym.funcs : null; }
function funcKey(dev, fi) { return `${dev.id}#${fi}`; }
function simFuncActive(dev, fi) {
  const fs = devFuncs(symOf(dev.sym));
  if (!fs) return simActiveState(dev);
  const f = fs[fi] || {};
  if (f.ext && dev.linkTo) {                       // 外部コイル連動
    const t = App.sim.timers[dev.linkTo];
    return t ? t.output : !!App.sim.states[dev.linkTo];
  }
  const ci = fs.findIndex(x => x.kind === "coil");
  if (ci >= 0) return !!App.sim.states[funcKey(dev, ci)];
  if (dev.linkTo) {
    const t = App.sim.timers[dev.linkTo];
    return t ? t.output : !!App.sim.states[dev.linkTo];
  }
  return !!App.sim.states[dev.id];                 // 手動操作
}
/** 多機能シンボルの導通ペア */
function funcPairs(dev, mode) {
  const fs = devFuncs(symOf(dev.sym));
  const out = [];
  fs.forEach((f, fi) => {
    const a = (f.pins || [])[0], b = (f.pins || [])[1];
    if (a == null || b == null) return;
    switch (f.kind) {
      case "contact_no":
        if (mode === "open" || mode === "split") return;
        if (mode !== "sim" || simFuncActive(dev, fi)) out.push([a, b]);
        return;
      case "contact_nc":
        if (mode === "open" || mode === "split") return;
        if (mode !== "sim" || !simFuncActive(dev, fi)) out.push([a, b]);
        return;
      case "passthru":
        if (mode !== "split") out.push([a, b]);
        return;
      case "breaker":
        if (mode === "open" || mode === "split") return;
        if (!(mode === "sim" && dev.props && dev.props.open)) out.push([a, b]);
        return;
      default: return;                             // coil / load は導通しない
    }
  });
  return out;
}

function conductivePairs(dev, mode = "closed") {
  const sym = symOf(dev.sym);
  if (devFuncs(sym)) return funcPairs(dev, mode);
  /* 開閉するピンの組。既定は先頭 2 本だが、3 線式の直流検出器のように
     開閉要素が出力と 0V の間にある (NPN・シンク形) 記号は simPins で指定する */
  const P = sym.simPins || [0, 1];
  switch (sym.sim) {
    case "contact_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [P.slice(0, 2)] : [];
    case "contact_nc":
      if (mode === "open" || mode === "split") return [];
      if (mode === "sim") return simActiveState(dev) ? [] : [P.slice(0, 2)];
      return [P.slice(0, 2)];
    case "contact2_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1], [2, 3]] : [];
    case "contact2_nc":
      // 2重化 b接点 (非常停止 2NC 等): 1操作で両極が同時に開く
      if (mode === "open" || mode === "split") return [];
      if (mode === "sim") return simActiveState(dev) ? [] : [[0, 1], [2, 3]];
      return [[0, 1], [2, 3]];
    case "changeover":
      // 切替接点: pins[0]=a側固定(14) / pins[1]=b側固定(12) / pins[2]=共通(11)
      if (mode === "open" || mode === "split") return [];
      if (mode === "sim") return simActiveState(dev) ? [[0, 2]] : [[1, 2]];
      if (mode === "closedA") return [[0, 2]];   // 短絡検査用: a側だけ閉じた状態
      if (mode === "closedB") return [[1, 2]];   // 短絡検査用: b側だけ閉じた状態
      return [[0, 2], [1, 2]];                   // 到達性検査は「どちらかで届き得る」でよい
    case "contact3_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1], [2, 3], [4, 5]] : [];
    case "breaker":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1]];
    case "breaker2":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1], [2, 3]];
    case "breaker3":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" && dev.props.open) ? [] : [[0, 1], [2, 3], [4, 5]];
    case "passthru":
      // 端子: 線番も通す。"split" は端子表用に両側を分離
      return mode === "split" ? [] : (sym.pins.length >= 2 ? [[0, 1]] : []);
    case "fuse":
      // ヒューズ: 導通するが線番は跨がない (実務では番号が変わる)
      return (mode === "open" || mode === "split") ? [] : [[0, 1]];
    case "passthru2":
      return (mode === "open" || mode === "split") ? [] : [[0, 1], [2, 3]];
    case "passthru3":
      // サーマルリレー主回路: 導通するが線番は跨がない (2L1 → U1)
      return (mode === "open" || mode === "split") ? [] : [[0, 1], [2, 3], [4, 5]];
    default: return []; // coil / load / trafo(絶縁) / source は導通しない(消費・供給)
  }
}

/** 電位リンクのタグから極性を判定 (+24V/L+ → P極, 0V/M/N → N極) */
function linkPolarity(dev) {
  const t = (dev.tag || "").replace(/^-/, "").toUpperCase();
  if (["+24V", "24V", "L+", "P24", "P24V"].includes(t)) return "P";
  if (["0V", "M", "N", "-V", "GND", "N24V", "N24"].includes(t)) return "N";
  return null;
}

/**
 * ページ間電位リンクの伝播: 同じタグの電位リンクは全ページで同一電位。
 * pagesData: [{ page, pinNet, pNets, nNets, acNets }]
 * いずれかのページでリンクのネットが P/N/AC なら、同タグ全リンクのネットにも付与。
 */
/** 電位リンク (同じタグ) で繋がるネットを (ページをまたいで) 集める。
    片端接地・両端接地の判定を、別葉に描いた接地でも正しく数えるために使う。 */
function linkedNetSet(pagesData, pd0, net0) {
  const key = (pd, n) => pagesData.indexOf(pd) + "|" + n;
  const groups = new Map();            // タグ → [{pd, net}]
  pagesData.forEach(pd => pd.page.devices.forEach(dev => {
    if (symOf(dev.sym).sim !== "link" || !dev.tag) return;
    const n = pd.pinNet(dev, 0);
    if (!n) return;
    const t = dev.tag.replace(/^-/, "").toUpperCase();
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push({ pd, net: n });
  }));
  const seen = new Set([key(pd0, net0)]);
  const queue = [{ pd: pd0, net: net0 }];
  while (queue.length) {
    const cur = queue.shift();
    groups.forEach(list => {
      if (!list.some(e => e.pd === cur.pd && e.net === cur.net)) return;
      list.forEach(e => { if (!seen.has(key(e.pd, e.net))) { seen.add(key(e.pd, e.net)); queue.push(e); } });
    });
  }
  return seen;
}

function propagateLinkGroups(pagesData) {
  const groups = new Map(); // tag → [{pd, net}]
  pagesData.forEach(pd => {
    pd.page.devices.forEach(dev => {
      if (symOf(dev.sym).sim !== "link" || !dev.tag) return;
      const net = pd.pinNet(dev, 0);
      if (!net) return;
      const key = dev.tag.replace(/^-/, "").toUpperCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ pd, net });
    });
  });
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    groups.forEach(list => {
      ["pNets", "nNets", "acNets", "eNets"].forEach(kind => {
        const hot = list.some(({ pd, net }) => pd[kind].has(net));
        if (hot) list.forEach(({ pd, net }) => {
          if (!pd[kind].has(net)) { pd[kind].add(net); moved = true; }
        });
      });
    });
    if (!moved) break;
  }
}

/** 接点ミラー表の端子番号欄。切替接点は 共通·b側·a側 の 3 つ (11·12·14) を並べる
    — 表を見ただけでどの端子が渡り (共通) か分かるようにする */
function contactPinLabel(c) {
  const sym = symOf(c.sym);
  const nm = i => effectivePinName(c, i);
  if (sym.sim === "changeover" && (sym.pins || []).length >= 3) {
    /* 共通·b側·a側 の 3 欄。番号を消した端子があっても欄は残す (2 つに
       減らすと、ミラー表では b接点と見分けが付かなくなる) */
    const parts = [nm(2), nm(1), nm(0)].map(v => v || "-");
    return parts.some(v => v !== "-") ? parts.join("\u00b7") : "";
  }
  const n0 = nm(0), n1 = nm(1);
  return n0 && n1 ? `${n0}\u00b7${n1}` : "";
}
/** 接点ミラー表の列位置 (端子番号列 / 相互参照列)。文字幅から動的に決めて桁被りを防ぐ */
function mirrorCols(contacts) {
  const h = TEXT_H.small;
  let wPin = 0;
  contacts.forEach(c => {
    const t = contactPinLabel(c);
    if (t) wPin = Math.max(wPin, textWidthMM(t, h, false, true));
  });
  const pin = 7;
  return { pin, ref: pin + Math.max(wPin + 1.2, 8) };
}

/** 接点ミラー表の原点。既定はコイルの右下だが、他機器・他のミラー表・図枠外を
    避けられる位置を探す (見つからなければ重なり最小の候補)。 */
function mirrorOrigin(coilDev) {
  const f = contentScale();
  const csym0 = symOf(coilDev.sym);
  const wide = csym0.bounds[2] > 20;      // 多極機器は極間配線を避けて左下へ
  const baseX = wide ? coilDev.x - 24 * f : coilDev.x + 3 * f;
  const baseY = coilDev.y + 24 * f;
  const page = (findDevice(coilDev.id) || {}).page;
  if (!page) return { x: baseX, y0: baseY };
  const w = mirrorTableSize(coilDev);
  if (!w) return { x: baseX, y0: baseY };
  const obst = [];
  page.devices.forEach(d2 => {
    if (d2.id === coilDev.id) return;
    deviceObstacleBoxes(d2, OBST_INSET.label * f).forEach(b => obst.push(b));
    // 先に配置が決まっている (id 順で前の) コイルのミラー表
    if (d2.id < coilDev.id) mirrorLabelBoxes(d2).forEach(b => obst.push(b));
  });
  // 導体も避ける。表の中を配線が貫くと、どの接点の行か読めなくなる
  const HW = LINE_W.thick / 2 * f;
  condWires(page).forEach(o => {
    for (let i = 0; i < o.pts.length - 1; i++) {
      const p0 = o.pts[i], p1 = o.pts[i + 1];
      obst.push({ x: Math.min(p0[0], p1[0]) - HW, y: Math.min(p0[1], p1[1]) - HW,
        w: Math.abs(p1[0] - p0[0]) + HW * 2, h: Math.abs(p1[1] - p0[1]) + HW * 2 });
    }
  });
  const fr = frameRect();
  const outArea = bx => {
    const dx = Math.max(0, fr.x - bx.x) + Math.max(0, bx.x + bx.w - (fr.x + fr.w));
    const dy = Math.max(0, fr.y - bx.y) + Math.max(0, bx.y + bx.h - (fr.y + fr.h));
    return dx * bx.h + dy * bx.w;
  };
  const cands = [[baseX, baseY], [baseX, baseY + 4.2 * f], [baseX + 6 * f, baseY],
    [coilDev.x - 24 * f, baseY], [coilDev.x - 24 * f, baseY + 4.2 * f], [baseX, baseY - 6 * f],
    [baseX - w.w - 3 * f, baseY], [baseX + 10 * f, baseY], [baseX, baseY + 9 * f],
    [baseX - w.w - 3 * f, baseY + 4.2 * f], [baseX + 10 * f, baseY + 4.2 * f],
    [baseX, baseY - 12 * f], [baseX, baseY - 18 * f], [baseX + 10 * f, baseY - 12 * f]];
  let best = null;
  for (const [x, y0] of cands) {
    const box = { x, y: y0 - 2 * f, w: w.w, h: w.h };
    let sc = outArea(box);
    for (const r of obst) sc += overlapArea(box, r);
    if (sc === 0) return { x, y0 };
    if (!best || sc < best.sc) best = { sc, res: { x, y0 } };
  }
  return best.res;
}
/** 接点ミラー表の外形寸法 (幅×高さ)。接点が無ければ null */
function mirrorTableSize(coilDev) {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return null;
  const f = contentScale();
  const shown = contacts.slice(0, 4);
  const cols = mirrorCols(shown);
  const h = TEXT_H.small * f;
  let wMax = 0;
  shown.forEach(c => { wMax = Math.max(wMax, cols.ref * f + textWidthMM("/" + devLocation(c), h, false, true)); });
  return { w: wMax, h: shown.length * 4.2 * f + 2 * f };
}

/** 接点ミラー表の文字矩形 (検図・当たり判定用)。画面/DXF と同じ割付を使う */
function mirrorLabelBoxes(coilDev) {
  const contacts = linkedContacts(coilDev);
  if (!contacts.length) return [];
  const f = contentScale();
  const org = mirrorOrigin(coilDev);
  const x = org.x, y0 = org.y0;
  const rowH = 4.2 * f, MAXROWS = 4;
  const shown = contacts.slice(0, MAXROWS);
  const cols = mirrorCols(shown);
  const h = TEXT_H.small * f;
  const out = [];
  shown.forEach((c, i) => {
    const cy = y0 + i * rowH + 2.3 * f;
    const t = contactPinLabel(c);
    if (t) out.push({ x: x + cols.pin * f, y: cy - h, w: textWidthMM(t, h, false, true), h });
    const r = "/" + devLocation(c);
    out.push({ x: x + cols.ref * f, y: cy - h, w: textWidthMM(r, h, false, true), h });
  });
  return out;
}

/** 連動接点の実効端子番号: 同一コイル配下の n 番目の接点は 13/14 → n3/n4 に採番 */
/** 自動採番の端子番号 (連動接点は同一コイル内の順位で 13/14 → 23/24 …) */
function autoPinName(dev, idx) {
  const sym = symOf(dev.sym);
  const base = sym.pins[idx] ? sym.pins[idx].n : "";
  if (!dev.linkTo || !/^[1-8][1-8]$/.test(base)) return base;
  const f = findDevice(dev.linkTo);
  if (!f) return base;
  const siblings = linkedContacts(f.dev).filter(c => /^[1-8][1-8]$/.test((symOf(c.sym).pins[0] || {}).n || ""));
  const pos = siblings.findIndex(c => c.id === dev.id);
  if (pos < 0) return base;
  /* 十の位は順位番号。JIS C 8201-1 / IEC 60947-1 の補助接点表示は 1〜8 までなので
     9 個目以降は 8 で止める (9x は規格外)。この本数はコイルの接点数の検図でも
     警告が出るので、必要なら端子番号はプロパティで手入力する */
  return String(Math.min(pos + 1, 8)) + base[1];
}
/* 表示・出図・検図・接続リストが使う端子番号。プロパティで機器ごとに
   上書きできる (props.pinNames[端子index])。空欄 = 自動採番 */
function effectivePinName(dev, idx) {
  const ov = dev && dev.props && dev.props.pinNames;
  // 空文字の上書き = この端子の番号を印字しない (プロパティの入力欄を空にした状態)
  if (ov && ov[idx] !== undefined) return String(ov[idx]).trim();
  return autoPinName(dev, idx);
}

/**
 * ページのネットを計算。
 * @returns { uf, nodeNet: Map(ptKey→netRoot), wireNet: Map(wireId→netRoot), pinNet: (dev,pinIdx)→netRoot }
 */
function computeNets(page, mode = "closed") {
  const uf = UnionFind();
  const wires = condWires(page); // 作図線 (破線・一点鎖線) は導通しない
  // ワイヤ: 各区間の端点を union
  wires.forEach(w => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      uf.union(ptKey(w.pts[i][0], w.pts[i][1]), ptKey(w.pts[i + 1][0], w.pts[i + 1][1]));
    }
  });
  // T接続: ワイヤ端点が他ワイヤの区間中点に載る場合
  wires.forEach(w1 => {
    [w1.pts[0], w1.pts[w1.pts.length - 1]].forEach(ep => {
      wires.forEach(w2 => {
        if (w1 === w2) return;
        for (let i = 0; i < w2.pts.length - 1; i++) {
          if (ptOnSeg(ep[0], ep[1], w2.pts[i][0], w2.pts[i][1], w2.pts[i + 1][0], w2.pts[i + 1][1])) {
            uf.union(ptKey(ep[0], ep[1]), ptKey(w2.pts[i][0], w2.pts[i][1]));
          }
        }
      });
    });
  });
  // デバイスピン: ワイヤ区間の中間に載っているピンをその区間へ接続
  page.devices.forEach(dev => {
    devPins(dev).forEach(pin => {
      wires.forEach(w => {
        for (let i = 0; i < w.pts.length - 1; i++) {
          if (ptOnSeg(pin.x, pin.y, w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1])) {
            uf.union(ptKey(pin.x, pin.y), ptKey(w.pts[i][0], w.pts[i][1]));
          }
        }
      });
    });
  });
  // デバイスの導通ペア
  page.devices.forEach(dev => {
    const pins = devPins(dev);
    conductivePairs(dev, mode).forEach(([a, b]) => {
      if (pins[a] && pins[b]) uf.union(ptKey(pins[a].x, pins[a].y), ptKey(pins[b].x, pins[b].y));
    });
  });
  const pinNet = (dev, idx) => {
    const pins = devPins(dev);
    return pins[idx] ? uf.find(ptKey(pins[idx].x, pins[idx].y)) : null;
  };
  const wireNet = new Map();
  wires.forEach(w => wireNet.set(w.id, uf.find(ptKey(w.pts[0][0], w.pts[0][1]))));
  return { uf, pinNet, wireNet };
}

/** ワイヤ端点がデバイスピンに接続しているか (座標一致) */
function pinAtPoint(page, x, y) {
  for (const dev of page.devices) {
    for (const p of devPins(dev)) {
      if (Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01) return { dev, pin: p };
    }
  }
  return null;
}

/** ジャンクション(T接続)ドット位置の一覧 */
/* 接続ドット (JIS C 0617-3 / IEC 60617): 導体が「分かれる・集まる」点にだけ打つ。
   まっすぐ続くだけの継ぎ目 (線を 2 本に分けて引いた・同じ道に重ねて引いた) や、
   曲がり角には打たない — その点から出ていく向きが 3 方向以上あるかで決める */
function junctionDots(page) {
  const wires = condWires(page); // 作図線には接続ドットを打たない
  const cand = new Map();        // 候補点 (端点が他の線に触れている点)
  const add = (x, y) => { const k = ptKey(x, y); if (!cand.has(k)) cand.set(k, [x, y]); };
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  wires.forEach(w => {
    [w.pts[0], w.pts[w.pts.length - 1]].forEach(ep => {
      wires.forEach(w2 => {
        if (w === w2) return;
        for (let i = 0; i < w2.pts.length - 1; i++) {
          if (ptOnSeg(ep[0], ep[1], w2.pts[i][0], w2.pts[i][1], w2.pts[i + 1][0], w2.pts[i + 1][1])
            || same(ep, w2.pts[i]) || same(ep, w2.pts[i + 1])) add(ep[0], ep[1]);
        }
      });
    });
  });
  /* その点から導体が出ていく向きの数。まっすぐ続くだけなら 2 (上下) なので
     打たない。T 分岐は 3、十字は 4 */
  const dirsAt = (x, y) => {
    const set = new Set();
    const push = (dx, dy) => {
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      set.add(`${Math.round(dx / L * 1000)},${Math.round(dy / L * 1000)}`);
    };
    wires.forEach(w => {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a2 = w.pts[i], b2 = w.pts[i + 1];
        const onA = same([x, y], a2), onB = same([x, y], b2);
        const inside = ptOnSeg(x, y, a2[0], a2[1], b2[0], b2[1]);
        if (onA) push(b2[0] - a2[0], b2[1] - a2[1]);
        else if (onB) push(a2[0] - b2[0], a2[1] - b2[1]);
        else if (inside) { push(b2[0] - x, b2[1] - y); push(a2[0] - x, a2[1] - y); }
      }
    });
    return set.size;
  };
  const dots = [];
  cand.forEach(([x, y]) => { if (dirsAt(x, y) >= 3) dots.push([x, y]); });
  return dots;
}

/* ══════════════ 配線番号の自動付与 ══════════════ */
// 接地系のピン名 (PE/FG 等)。接地ネットには制御線の連番を振らず、ピン名を電位名として印字する
const RE_EARTH = /^(PE|PEN|FE|FG|⏚)$/i;
const EARTH_RANK = ["PE", "PEN", "FE", "FG", "⏚"];
function autoNumberWires() {
  // 全ページの予約語 (電位名・電位リンク名・手動固定線番) を先に集めておき、
  // 連番がそれらと衝突して同じ線番が2箇所に印字されるのを防ぐ
  const reserved = new Set();
  App.project.pages.forEach(page => {
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.sim === "psu") { reserved.add("+24V"); reserved.add("0V"); }
      if (sym.sim === "link" && dev.tag) reserved.add(dev.tag.replace(/^-/, ""));
    });
    condWires(page).forEach(w => { if (w.fixed && w.num) reserved.add(String(w.num)); });
  });
  const used = new Set(reserved);
  App.project.pages.forEach(page => {
    /* 線番は「ページの図番 × 100 + 連番」で振る (E-003 → 301, 302 …)。
       図面のタイトル (図番) で番号体系が破断するので、線番を見れば
       どの葉の線か分かり、ページを跨いだ重複も起きない。
       機器 (接点・コイル) を跨ぐと区間が変わる ("open" 採番) のと合わせて、
       「周辺の記号と図番で決まる線番」になる — 手入力は要らない */
    const m0 = /(\d+)\s*$/.exec(String(pageDwgNo(page)));
    const base = (m0 ? parseInt(m0[1], 10) : page.no) * 100;
    let n = base + 1;
    const nextNum = () => { while (used.has(String(n))) n++; used.add(String(n)); return String(n++); };
    // "open" モード: 接点・コイルを跨いで番号が伝播しない (実務どおり区間ごとに採番)
    const { pinNet, wireNet } = computeNets(page, "open");
    const netNum = new Map();
    // 1) 電源系ネット・電位リンクには電位名を付ける
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.sim === "psu") {
        const pNet = pinNet(dev, 2), nNet = pinNet(dev, 3);
        if (pNet) netNum.set(pNet, "+24V");
        if (nNet) netNum.set(nNet, "0V");
      }
      if (sym.sim === "link" && dev.tag) {
        const net = pinNet(dev, 0);
        if (net) netNum.set(net, dev.tag.replace(/^-/, ""));
      }
      // 接地端子 (PE/FG) につながるネットは連番でなく端子名を電位名として付ける。
      // PE と FG が接地母線で同一ネットになった場合は PE > PEN > FE > FG > ⏚ の優先順で表記を安定させる
      devPins(dev).forEach((pin, i) => {
        if (pin.name && RE_EARTH.test(pin.name)) {
          const net = pinNet(dev, i);
          if (!net) return;
          const nm = pin.name.toUpperCase(), cur = netNum.get(net);
          if (cur == null) netNum.set(net, nm);
          else if (RE_EARTH.test(cur) && EARTH_RANK.indexOf(nm) < EARTH_RANK.indexOf(cur)) netNum.set(net, nm);
        }
      });
    });
    // 2) 固定番号 (主回路の相名 L1/U1 等、手動で付けた線番) を尊重
    const wires = condWires(page); // 作図線には線番を付けない
    wires.forEach(w => {
      if (w.fixed && w.num) netNum.set(wireNet.get(w.id), w.num);
    });
    /* 2.2) 線番を付けるのは「機器のピンにつながる線」だけ。どのピンにも
       触れない線は配置図の外形・引出線などの作画であって回路ではないので、
       連番を振らず、過去に付いた自動番号も消す (手動線番・電位名は残す) */
    const netHasPin = new Set();
    page.devices.forEach(dev => devPins(dev).forEach((pin, i) => {
      const net = pinNet(dev, i);
      if (net != null) netHasPin.add(net);
    }));
    const isCircuit = net => netHasPin.has(net) || netNum.has(net);
    /* 2.4) 「線番を出さない」と決めた配線 (プロパティで空欄にしたもの) は
       採番の対象から外す。ネットごと黙らせる — 同じネットの他の線に
       番号が出ると、消したつもりの線番が別の場所に出てしまう */
    const quiet = new Set();
    wires.forEach(w => { if (w.numOff) quiet.add(wireNet.get(w.id)); });
    // 2.5) すでに振られている自動番号はそのまま据え置く。
    //      (1本だけ手動で直したときに、他の線番まで繰り上がるのを防ぐ)
    wires.forEach(w => {
      const net = wireNet.get(w.id);
      if (netNum.has(net) || !netHasPin.has(net) || quiet.has(net)) return;
      const prev = w.num == null ? "" : String(w.num).trim();
      if (prev && !used.has(prev)) { netNum.set(net, prev); used.add(prev); }
    });
    // 3) 残りに連番を振り、ネットごとに最長区間のワイヤ1本にだけラベルを表示
    const bestOfNet = new Map();
    wires.forEach(w => {
      const net = wireNet.get(w.id);
      if (quiet.has(net)) {           // 線番を出さない指定のネット
        w.num = null;
        w.numShow = false;
        return;
      }
      if (!isCircuit(net)) {          // 回路でない線: 自動で付いた番号を消す
        if (!w.fixed) w.num = null;
        w.numShow = false;
        return;
      }
      if (!netNum.has(net)) netNum.set(net, nextNum());
      w.num = netNum.get(net);
      w.numShow = false;
      let maxSeg = 0;
      for (let i = 0; i < w.pts.length - 1; i++) {
        maxSeg = Math.max(maxSeg, Math.abs(w.pts[i + 1][0] - w.pts[i][0]) + Math.abs(w.pts[i + 1][1] - w.pts[i][1]));
      }
      const cur = bestOfNet.get(net);
      if (!cur || maxSeg > cur.maxSeg) bestOfNet.set(net, { w, maxSeg });
    });
    bestOfNet.forEach(({ w }) => { w.numShow = true; }); // 全ネット必ず1箇所は表示
    /* 仕上げ: 線番を持っているのにどこにも出ていないネットを拾う。
       手で入れた線番が機器につながらない線に付いている場合や、古い版で
       保存した図面から来た numShow の取りこぼしがあっても、必ず 1 箇所に出す
       (「入力したのに表示されない」を作らない) */
    ensureNumShown(wires, wireNet);
    /* 作図線に残った線番の掃除。線種の変更やデータ取込の経路によっては
       非導通の線に昔の番号が残ることがあり、破線の上に線番が印字される */
    page.wires.forEach(w => {
      if (isWireConductive(w)) return;
      if (w.num != null || w.numShow || w.fixed) { w.num = null; w.numShow = false; w.fixed = false; }
    });
  });
}

/* 図面を開いたときの手当て: 線番を持っているのにどこにも出ていないネットを
   直す。古い版で保存した図面や、途中の操作で表示フラグが落ちた図面でも
   「入力したのに出ない」を残さない (番号そのものは変えない) */
function normalizeWireNumbers() {
  (App.project ? App.project.pages : []).forEach(page => {
    if (!isDrawingPage(page)) return;
    const wires = condWires(page).filter(w => w.num);
    if (!wires.length) return;
    const { wireNet } = computeNets(page, "open");
    ensureNumShown(wires, wireNet);
  });
}
/** 線番を持つネットは、必ずどれか 1 本 (いちばん長い区間の線) に表示させる */
function ensureNumShown(wires, wireNet) {
  const byNet = new Map();
  wires.forEach(w => {
    if (!w.num) return;
    const net = wireNet.get(w.id);
    if (!byNet.has(net)) byNet.set(net, []);
    byNet.get(net).push(w);
  });
  byNet.forEach(list => {
    if (list.some(w => w.numShow)) return;
    let best = list[0], bestLen = -1;
    list.forEach(w => {
      let m = 0;
      for (let i = 0; i < w.pts.length - 1; i++) {
        m = Math.max(m, Math.abs(w.pts[i + 1][0] - w.pts[i][0]) + Math.abs(w.pts[i + 1][1] - w.pts[i][1]));
      }
      if (m > bestLen) { bestLen = m; best = w; }
    });
    best.numShow = true;
  });
}

/** ワイヤ1本の線番編集をネット全体へ反映する (1ネットに2つの線番が印字されるのを防ぐ)。
    num が空なら自動採番に戻す。表示位置は autoNumberWires が最長区間で決める。 */
function setWireNumber(page, wire, num, opts = {}) {
  const v = (num == null ? "" : String(num)).trim();
  const { wireNet } = computeNets(page, "open");
  const net = wireNet.get(wire.id);
  const targets = net ? condWires(page).filter(w => wireNet.get(w.id) === net) : [wire];
  targets.forEach(w => {
    w.num = v || null;
    w.numShow = false;
    if (v) { w.fixed = true; delete w.numOff; }          // 手動線番は自動採番から保護
    else if (opts.auto) { w.fixed = false; delete w.numOff; }  // 自動採番へ戻す
    else { w.fixed = true; w.numOff = true; }            // 空欄 = この配線には線番を出さない
  });
  autoNumberWires();
  return targets.length;
}

/** ワイヤ1本の電線仕様をネット全体へ反映する */
function setWireSpec(page, wire, spec) {
  const v = (spec || "").trim();
  const { wireNet } = computeNets(page, "open");
  const net = wireNet.get(wire.id);
  const targets = net ? condWires(page).filter(w => wireNet.get(w.id) === net) : [wire];
  targets.forEach(w => { if (v) w.spec = v; else delete w.spec; });
  return targets.length;
}

/* ══════════════ 通電シミュレーション ══════════════ */
function simActiveState(dev) {
  const sym = symOf(dev.sym);
  if (sym.sim === "contact_no" || sym.sim === "contact_nc" || sym.sim === "contact2_no" || sym.sim === "contact3_no" ||
      sym.sim === "contact2_nc" || sym.sim === "changeover") {
    if (dev.linkTo) {
      // コイル連動接点: タイマは遅延を考慮
      const t = App.sim.timers[dev.linkTo];
      if (t) return t.output;
      return !!App.sim.states[dev.linkTo];
    }
    return !!App.sim.states[dev.id]; // 手動操作 (ボタン等)
  }
  return false;
}

/**
 * シミュレーション1ステップ: 全ページを対象に、コイル励磁状態が安定するまで反復。
 * P極(+24V / L)到達ネットと N極(0V / N)到達ネットを求め、
 * コイル/負荷は両極にまたがれば励磁。ページを跨ぐ連動 (制御回路のコイル →
 * 主回路の接触器) はリンク接点の状態参照で成立する。
 */
function simCollectPage(page) {
  const { pinNet, wireNet } = computeNets(page, "sim");
  const pNets = new Set(), nNets = new Set(), acNets = new Set();
  page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim === "psu") {
      const p = pinNet(dev, 2), n0 = pinNet(dev, 3);
      if (p) pNets.add(p);
      if (n0) nNets.add(n0);
    }
    if (sym.sim === "link") {
      // 明示極性リンク (+24V/0V) はそのページの電源になる
      const pol = linkPolarity(dev);
      const net = pinNet(dev, 0);
      if (net && pol === "P") pNets.add(net);
      if (net && pol === "N") nNets.add(net);
    }
    if (sym.sim === "source3") {
      sym.pins.forEach((_, i) => { const net = pinNet(dev, i); if (net) acNets.add(net); });
    }
    if (sym.sim === "source1") {
      // 単相電源: L を P 極・N を N 極として扱う (負荷判定は DC と同じ「両極にまたがる」)
      const l = pinNet(dev, 0), n = pinNet(dev, 1);
      if (l) pNets.add(l);
      if (n) nNets.add(n);
    }
  });
  return { page, pinNet, wireNet, pNets, nNets, acNets };
}

function simSolve() {
  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    // 1) 全ページのネット + 電源を収集し、電位リンク(同タグ)でページ間伝播
    const pagesData = App.project.pages.map(simCollectPage);
    propagateLinkGroups(pagesData);
    // 2) 励磁判定
    const byPage = new Map();
    pagesData.forEach(pd => {
      pd.page.devices.forEach(dev => {
        const sym = symOf(dev.sym);
        const fs = devFuncs(sym);
        if (fs) {
          // 多機能シンボル: コイル・負荷ごとに励磁を判定する
          let any = false;
          fs.forEach((f, fi) => {
            if (f.kind !== "coil" && f.kind !== "load") return;
            const a = (f.pins || [])[0], b = (f.pins || [])[1];
            if (a == null || b == null) return;
            const na = pd.pinNet(dev, a), nb = pd.pinNet(dev, b);
            const on = (pd.pNets.has(na) && pd.nNets.has(nb)) || (pd.pNets.has(nb) && pd.nNets.has(na));
            const k = funcKey(dev, fi);
            if (!!App.sim.states[k] !== on) changed = true;
            App.sim.states[k] = on;
            if (on) any = true;
          });
          if (!!App.sim.states[dev.id] !== any) changed = true;
          App.sim.states[dev.id] = any;             // 機器全体の表示用
          return;
        }
        let en = false;
        if (sym.sim === "coil" || sym.sim === "load") {
          const a = pd.pinNet(dev, 0), b = pd.pinNet(dev, 1);
          en = (pd.pNets.has(a) && pd.nNets.has(b)) || (pd.pNets.has(b) && pd.nNets.has(a));
        } else if (sym.sim === "load3") {
          let hot = 0;
          sym.pins.forEach((pin, i) => { if (pin.n !== "PE" && pd.acNets.has(pd.pinNet(dev, i))) hot++; });
          en = hot >= 2;
        }
        if (sym.sim === "coil" || sym.sim === "load" || sym.sim === "load3") {
          if (!!App.sim.states[dev.id] !== en) changed = true;
          App.sim.states[dev.id] = en;
        }
      });
      byPage.set(pd.page.id, { pNets: pd.pNets, nNets: pd.nNets, acNets: pd.acNets, wireNet: pd.wireNet, pinNet: pd.pinNet });
    });
    if (updateTimers()) changed = true;
    if (!changed) {
      App.sim.energizedByPage = byPage;
      App.sim.energized = byPage.get(curPage().id) || null;
      return;
    }
  }
  App.sim.energized = null;
  App.sim.energizedByPage = null;
}

function updateTimers() {
  const now = performance.now();
  let changed = false;
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim !== "coil" || !sym.timer) return;
    const en = !!App.sim.states[dev.id];
    let t = App.sim.timers[dev.id];
    if (!t) t = App.sim.timers[dev.id] = { output: false, since: null };
    const before = t.output;
    const delay = (parseFloat(dev.props.delay) || 2) * 1000;
    if (sym.timer === "on") {
      if (en) {
        if (t.since === null) t.since = now;
        t.output = (now - t.since) >= delay;
      } else { t.since = null; t.output = false; }
    } else { // off-delay
      if (en) { t.since = null; t.output = true; }
      else if (t.output) {
        if (t.since === null) t.since = now;
        if ((now - t.since) >= delay) { t.output = false; t.since = null; }
      }
    }
    if (t.output !== before) changed = true;
  }));
  return changed;
}

function simStart() {
  App.sim.running = true;
  App.sim.states = {};
  App.sim.timers = {};
  simSolve();
}
function simStop() {
  App.sim.running = false;
  App.sim.states = {};
  App.sim.timers = {};
  App.sim.energized = null;
}

/* ══════════════ DRC (設計ルールチェック) ══════════════ */
/** 接地を表す図記号 (シールドのドレン線がここへ落ちていれば接地とみなす) */
const EARTH_SYM_IDS = new Set(["earth", "prot_earth", "func_earth", "chassis_earth"]);
const DRC_RULES = [
  "未接続ピン", "宙吊り配線端点", "デバイスタグ重複", "コイル未リンク接点",
  "接点なしコイル", "接点数超過", "電源未到達負荷", "無開閉直結コイル", "電源短絡",
  "自動生成時の警告", "図枠外・表題欄との重なり", "文字の重なり", "未登録シンボル",
  "線番の重複", "図番の重複", "線番と導体の重なり", "記号の重なり", "導体が図記号を貫通", "3線式センサの電源が逆", "3線式センサが出力の枚",
  "分かれた枚の行き先が無い",
  "行き先未設定", "行き先の自己参照", "行き先の指し先が無い", "行き先の対が無い",
  "行き先の図番が入らない", "行き先どうしの重なり", "行き先の対が定まらない",
  "行き先とリンクの不一致", "尺度と用紙上の寸法", "記号の想定用紙と違う", "シールド未接地", "シールドと心線の短絡", "シールドの両端接地", "シールドをPEへ接続", "シールドと心線囲みの不一致", "囲みの芯数と心線本数の不一致",
];

/** 接地記号につながっているネット (遮へいの接地判定に使う) */
function drcEarthNets(page, pinNet) {
  const out = new Set();
  page.devices.forEach(d => {
    const s = symOf(d.sym);
    if (!EARTH_SYM_IDS.has(s.stretchOf || s.id)) return;
    (s.pins || []).forEach((_, i) => { const n = pinNet(d, i); if (n) out.add(n); });
  });
  return out;
}

function drcSources(page, pinNet) {
  const pNets = new Set(), nNets = new Set();
  page.devices.forEach(d => {
    const s = symOf(d.sym);
    if (s.sim === "psu") { pNets.add(pinNet(d, 2)); nNets.add(pinNet(d, 3)); }
    if (s.sim === "source1") { pNets.add(pinNet(d, 0)); nNets.add(pinNet(d, 1)); }
    if (s.sim === "link") {
      const pol = linkPolarity(d);
      const net = pinNet(d, 0);
      if (net && pol === "P") pNets.add(net);
      if (net && pol === "N") nNets.add(net);
    }
  });
  return { pNets, nNets };
}

function drcCollect(page, mode) {
  const { pinNet, wireNet } = computeNets(page, mode);
  const { pNets, nNets } = drcSources(page, pinNet);
  return { page, pinNet, wireNet, pNets, nNets, acNets: new Set(), eNets: drcEarthNets(page, pinNet) };
}

function runDRC() {
  const issues = [];
  const tagSeen = new Map();
  // 全ページのネットを先に解析し、電位リンク(同タグ)でページ間の電位を伝播させる
  const closedData = App.project.pages.map(p => drcCollect(p, "closed"));
  propagateLinkGroups(closedData);
  const openData = App.project.pages.map(p => drcCollect(p, "open"));
  propagateLinkGroups(openData);
  /* 切替接点は 11-12 と 11-14 が同時に閉じない。"closed" は両投を同時に閉じた
     仮の状態なので、a側の +24V と b側の 0V が同じネットに見えてしまう
     (「b側→0V / a側→+24V を選ぶ」という常套回路がそうなる)。
     そこで電位が絡む判定は、投ごと (a側のみ閉 / b側のみ閉) の 2 パスで見る:
       ・電位の誤り (センサの電源逆・短絡) … どちらの投でも成り立つときだけ出す
         (短絡だけは片方の投で成立すれば実際に短絡するので、その場で出す)
       ・電源への到達 … どちらかの投で届いていればよい
     注意: 2パスは全切替接点を一斉に同じ投へ倒す大域評価。複数の切替接点の
     混合状態 (SW1=a側・SW2=b側) でのみ成立する短絡は対象外 (組合せ爆発の回避) */
  const hasChangeover = App.project.pages.some(p => p.devices.some(d => symOf(d.sym).sim === "changeover"));
  const throwData = hasChangeover
    ? ["closedA", "closedB"].map(m => {
        const d = App.project.pages.map(p => drcCollect(p, m));
        propagateLinkGroups(d);
        return d;
      })
    : [closedData];
  App.project.pages.forEach((page, pageIdx) => {
    if (!isDrawingPage(page)) return;   // 表紙・目次・仕様は回路の検査対象外
    applySheet(page);        // 図枠まわりの検査はページごとの用紙・尺度で行う
    const closed = closedData[pageIdx];
    const open = openData[pageIdx];
    const srcClosed = { pNets: closed.pNets, nNets: closed.nNets };
    const srcOpen = { pNets: open.pNets, nNets: open.nNets };
    /* 投ごとのネット (切替接点が無ければ closed 1 つ)。電位の判定はこれで行う */
    const passes = throwData.map(ds => ds[pageIdx]);
    const allThrows = fn => passes.every(fn);   // どの投でもそうなる (誤検図を出さない)
    const anyThrow = fn => passes.some(fn);     // どれかの投でそうなる (到達性)

    // ワイヤ端点集合 / 区間集合
    const wireEndpoints = new Map(); // key → count
    const drcWires = condWires(page); // 作図線は検図対象外
    drcWires.forEach(w => w.pts.forEach(p => {
      const k = ptKey(p[0], p[1]);
      wireEndpoints.set(k, (wireEndpoints.get(k) || 0) + 1);
    }));
    const wireSegs = [];
    drcWires.forEach(w => { for (let i = 0; i < w.pts.length - 1; i++) wireSegs.push([w.pts[i], w.pts[i + 1], w.id]); });
    const allPins = [];
    page.devices.forEach(d => devPins(d).forEach(p => allPins.push(p)));

    // 自動生成時に配置できなかった要素 (無音の機器欠落を検図で必ず可視化する)
    (page.genWarnings || []).forEach(msg => {
      issues.push({ sev: "err", msg: `自動生成: ${msg}`, page: page.no, target: null, loc: `${page.no}.-` });
    });

    // 図枠外へのはみ出し / 表題欄・改訂履歴欄との重なり (用紙・尺度変更後の破綻を必ず可視化する)
    const fr = frameRect();
    const blocks = titleBlocksRects();       // 表題欄 + 改訂履歴欄
    const blockName = r => (r.kind === "rev" ? "改訂履歴欄" : "表題欄");
    const outOfFrame = b => b.x < fr.x || b.y < fr.y || b.x + b.w > fr.x + fr.w || b.y + b.h > fr.y + fr.h;
    const overlaps = (b, r) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    page.devices.forEach(dev => {
      const boxes = devPartBoxes(dev);        // 実際に線を引いている範囲で見る
      const b = devBounds(dev);
      const tag = displayTag(dev) || symOf(dev.sym).name;
      if (outOfFrame(b)) {
        issues.push({ sev: "err", msg: `${tag} が図枠 (輪郭線) の外にはみ出しています`, page: page.no, target: dev.id, loc: `${page.no}.${sheetCol(dev.x)}` });
      } else {
        const hitR = blocks.find(r => boxes.some(bx => overlaps(bx, r)));
        if (hitR) issues.push({ sev: "err", msg: `${tag} が${blockName(hitR)}に重なっています`, page: page.no, target: dev.id, loc: `${page.no}.${sheetCol(dev.x)}` });
      }
    });
    page.wires.forEach(w => {
      // 頂点だけでなく区間で判定する (両端が枠内でも途中が枠外/表題欄上を通る場合がある)
      const outside = w.pts.some(p => p[0] < fr.x || p[1] < fr.y || p[0] > fr.x + fr.w || p[1] > fr.y + fr.h);
      if (outside) {
        issues.push({ sev: "err", msg: `配線が図枠 (輪郭線) の外にはみ出しています`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(w.pts[0][0])}` });
        return;
      }
      for (let i = 0; i < w.pts.length - 1 && i < 200; i++) {
        const hitR = blocks.find(r => segCrossesRect(w.pts[i], w.pts[i + 1], r));
        if (hitR) {
          issues.push({ sev: "err", msg: `配線が${blockName(hitR)}に重なっています`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(w.pts[i][0])}` });
          break;
        }
      }
    });
    // 図枠外へはみ出した文字 (タグ・機能テキスト・線番・端子番号・注記)。
    // JIS Z 8311 の輪郭線・とじ代の外に文字が出るのは出図不可
    {
      const fr2 = frameRect(), tol = 0.3;
      const outside = bx => bx.x < fr2.x - tol || bx.y < fr2.y - tol ||
        bx.x + bx.w > fr2.x + fr2.w + tol || bx.y + bx.h > fr2.y + fr2.h + tol;
      const report = (bx, what, target) => {
        if (!outside(bx)) return;
        issues.push({ sev: "err", msg: `${what} が図枠 (輪郭線) の外にはみ出しています`, page: page.no, target, loc: `${page.no}.${sheetCol(bx.x)}` });
      };
      const blocks0 = titleBlocksRects();
      const onBlock = bx => blocks0.find(r => bx.x < r.x + r.w && bx.x + bx.w > r.x && bx.y < r.y + r.h && bx.y + bx.h > r.y);
      const report2 = (bx, what, target) => {
        report(bx, what, target);
        const hit = onBlock(bx);
        if (hit) issues.push({ sev: "err", msg: `${what} が${hit.kind === "rev" ? "改訂履歴欄" : "表題欄"}に重なっています`, page: page.no, target, loc: `${page.no}.${sheetCol(bx.x)}` });
      };
      page.devices.forEach(dev => {
        deviceLabelBoxes(page, dev).forEach(o => report2(o.box, `${displayTag(dev) || "機器"} の文字「${o.text}」`, dev.id));
        const xr = deviceXrefBox(page, dev);
        if (xr) report2(xr.box, `${displayTag(dev) || "機器"} の相互参照`, dev.id);
        mirrorLabelBoxes(dev).forEach(bx => report2(bx, `${displayTag(dev) || "コイル"} の接点ミラー`, dev.id));
        // 入出力結線図の機能欄 (行ごとの文言) も紙に出る文字なので同じ扱いにする
        deviceRowTexts(page, dev).forEach(o => report2(o.box, `機能欄「${o.text}」`, dev.id));
      });
      pinLabelBoxes(page).forEach(bx => report2(bx, "端子番号", bx.owner));
      condWires(page).forEach(w => {
        if (!w.num || w.numShow === false) return;
        const { num, spec } = wireLabelBoxes(w, wireLabelPos(w, page));
        report2(num, `線番 ${w.num}`, w.id);
        if (spec) report2(spec, `電線仕様「${w.spec}」`, w.id);
      });
      page.texts.forEach(t => report2(textBounds(t), `注記「${t.text}」`, t.id));
    }

    /* 3 線式の直流検出器の電源線が逆になっていないか。
       茶 (BN/P24V) を 0V に、青 (BU/N24V) を +24V につなぐと、通電した
       とたんにセンサが壊れる。未接続より重い誤りなのでエラーで出す */
    page.devices.forEach(dev => {
      const t = threeWirePins(symOf(dev.sym));
      if (!t) return;
      const tag = displayTag(dev) || symOf(dev.sym).name;
      // 端子番号は図面に出ている表記 (連動接点の繰り上げ・手入力) と同じものを使う
      const nm = i => effectivePinName(dev, i) || (symOf(dev.sym).pins[i] || {}).n || "";
      const on = (i, kind) => allThrows(pd => { const n = pd.pinNet(dev, i); return !!n && pd[kind].has(n); });
      if (on(t.sup, "nNets")) issues.push({ sev: "err", rule: "3線式センサの電源が逆",
        msg: `${tag} の ${nm(t.sup)} (電源+) が 0V 側につながっています`, page: page.no, target: dev.id, loc: devLocation(dev) });
      if (on(t.zero, "pNets")) issues.push({ sev: "err", rule: "3線式センサの電源が逆",
        msg: `${tag} の ${nm(t.zero)} (0V) が +24V 側につながっています`, page: page.no, target: dev.id, loc: devLocation(dev) });
    });

    /* 3 線式の直流検出器 (センサ) が出力の枠の隙間に置かれていないか。
       センサは入力機器で、出力の行は負荷の場所。下地も出力側では引き分けない
       ので、置いたまま出図すると結線できない図になる */
    page.devices.forEach(dev => {
      if (!threeWirePins(symOf(dev.sym))) return;
      const host = page.devices.find(d2 => {
        const sp2 = (symOf(d2.sym) || {}).ioSheet;
        if (!sp2 || sp2.side !== "right") return false;
        // 出力の枠の現場側の区画 (端子からレールまで) の行の上にあるか
        const x0 = d2.x, x1 = d2.x + sp2.rail;
        return devPins(dev).some(q => q.x >= x0 - 0.01 && q.x <= x1 + 0.01 &&
          sp2.rows.some(r => r.io && Math.abs(q.y - (d2.y + r.y)) < 0.01));
      });
      if (host) issues.push({ sev: "err", rule: "3線式センサが出力の枚",
        msg: `${displayTag(dev) || symOf(dev.sym).name} (3線式の検出器) が出力の結線図の行に置かれています — 検出器は入力の枚へ`,
        page: page.no, target: dev.id, loc: devLocation(dev) });
    });

    /* 図記号どうしの重なり。文字の重なりは見ていたのに、図記号どうしは
       見ていなかった — レール頭の電位リンクが食い込んでも検図 0 件だった。
       囲み記号 (多芯ケーブル・遮へい) は重ねて描くのが仕様なので除く */
    {
      const boxesOf = new Map(page.devices.map(d => [d.id, devInkBoxes(d)]));
      const encl = d => { const s0 = symOf(d.sym); return !!(s0.enclosure || s0.stretchOf === "cable_core" || s0.stretchOf === "shield"); };
      const seen = new Set();
      page.devices.forEach((a, ai) => {
        if (encl(a)) return;
        page.devices.forEach((b2, bi) => {
          if (bi <= ai || encl(b2)) return;
          // 連動接点・親子 (linkTo) は同じ機器の一部なので重なって当然
          if (a.linkTo === b2.id || b2.linkTo === a.id) return;
          const hit = boxesOf.get(a.id).some(ra => boxesOf.get(b2.id).some(rb => {
            const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
            const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
            if (ox <= 0.3 || oy <= 0.3) return false;
            // 小さいほうの面積の 1 割以上食い込んでいれば「重なり」
            return ox * oy > Math.min(ra.w * ra.h, rb.w * rb.h) * 0.1;
          }));
          if (!hit) return;
          const k = `${a.id}|${b2.id}`;
          if (seen.has(k)) return;
          seen.add(k);
          issues.push({ sev: "warn", rule: "記号の重なり",
            msg: `${displayTag(a) || symOf(a.sym).name} と ${displayTag(b2) || symOf(b2.sym).name} の図記号が重なっています`,
            page: page.no, target: a.id, loc: `${page.no}.${sheetCol(a.x)}` });
        });
      });
    }

    /* 導体が図記号を貫いていないか。画面は白塗りで隠れても、DXF には
       そのまま出る (塗りつぶしは線を消さない)。その機器の端子で終わっている
       導体は当然除く */
    {
      page.devices.forEach(dev => {
        const sym = symOf(dev.sym);
        if (!sym || sym.enclosure) return;                 // 囲み記号は貫くのが仕様
        /* 実際に線を引いている範囲 (インク) を、線の太さぶんだけ内へ縮めて見る。
           bounds は余白つきの枠なので、それで見ると隣を通っただけで鳴る */
        const boxes = devInkBoxes(dev).map(r => insetRect(r, LINE_W.thick / 2));
        const myPins = devPins(dev);
        const onPin = pt => myPins.some(q => Math.abs(q.x - pt[0]) < .01 && Math.abs(q.y - pt[1]) < .01);
        let hit = null;
        condWires(page).some(w => {
          for (let i = 0; i < w.pts.length - 1 && i < 200; i++) {
            const a = w.pts[i], b2 = w.pts[i + 1];
            if (onPin(a) || onPin(b2)) continue;            // その機器へ入る導体
            if (boxes.some(r => segCrossesRect(a, b2, r))) { hit = w; return true; }
          }
          return false;
        });
        if (hit) issues.push({ sev: "warn", rule: "導体が図記号を貫通",
          msg: `配線が ${displayTag(dev) || sym.name} の図記号を横切っています`,
          page: page.no, target: hit.id, loc: `${page.no}.${sheetCol(dev.x)}` });
      });
    }

    // 用紙に出る文字要素どうし・文字と図記号の重なり (検図の要)
    const f4 = contentScale();
    const labels = [];
    page.devices.forEach(dev => {
      deviceLabelBoxes(page, dev).forEach(o => labels.push({ ...o.box, dev, what: `${displayTag(dev) || "機器"} の文字` }));
      const xr = deviceXrefBox(page, dev);
      if (xr) labels.push({ ...xr.box, dev, what: `${displayTag(dev) || "機器"} の相互参照` });
      // 接点ミラー表 (コイル直下のクロスリファレンス表)
      mirrorLabelBoxes(dev).forEach(o => labels.push({ ...o, dev, what: `${displayTag(dev) || "コイル"} の接点ミラー` }));
      // 入出力結線図の機能欄。長い文言は隣の行とぶつかるので、ここで必ず当たる
      deviceRowTexts(page, dev).forEach(o => labels.push({ ...o.box, dev, what: `機能欄「${o.text}」` }));
    });
    // 端子番号 (描画・ラベル配置と同じ矩形で判定する)
    const devById = new Map(page.devices.map(d => [d.id, d]));
    pinLabelBoxes(page).forEach(b => {
      const dev = devById.get(b.owner);
      labels.push({ x: b.x, y: b.y, w: b.w, h: b.h, dev, what: `${displayTag(dev) || "機器"} の端子番号` });
    });
    // 線番・電線仕様・注記
    condWires(page).forEach(w => {
      if (!w.num || w.numShow === false) return;
      const { num, spec } = wireLabelBoxes(w, wireLabelPos(w, page));
      labels.push({ ...num, wire: w, what: `線番 ${w.num}` });
      if (spec) labels.push({ ...spec, wire: w, what: `電線仕様「${w.spec}」` });
    });
    page.texts.forEach(t => {
      const b0 = textBounds(t);
      labels.push({ ...b0, text: t, what: `注記「${t.text}」` });
    });
    /* 判定は絶対量で行う。JIS Z 8313-0 の文字間隔は線幅の2倍以上なので、
       重なっていなくても「あき」が 0.7mm 未満なら判読できないものとして指摘する。 */
    const MIN_GAP = 0.7 * f4;
    // 文字の「行の向き」(細いほう) でどちらの軸を見るか決める。高さ固定で見ると
    // 回転した文字 (縦区間の線番) の判定が効かない — symHit と同じ規則にそろえる
    const realHit = (a, b2) => {
      const ox = Math.min(a.x + a.w, b2.x + b2.w) - Math.max(a.x, b2.x);
      const oy = Math.min(a.y + a.h, b2.y + b2.h) - Math.max(a.y, b2.y);
      const vert = a.w < a.h && b2.w < b2.h;                  // どちらも縦書き
      if (vert) {
        if (ox <= Math.min(a.w, b2.w) * 0.4) return false;    // 列がずれていれば読める
        return oy > -MIN_GAP;
      }
      if (oy <= Math.min(a.h, b2.h) * 0.4) return false;      // 行がずれていれば読める
      return ox > -MIN_GAP;                                    // 重なり or 0.7mm 未満のあき
    };
    /* 文字と図記号は「重なり」だけを見る (図記号のすぐ脇に置くのは通常の作法) */
    const symHit = (a, r) => {
      const ox = Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x);
      const oy = Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y);
      if (ox <= 0.3 * f4 || oy <= 0.3 * f4) return false;
      // 文字の「細いほう」(行の高さ) に 4割以上食い込んでいれば重なりとみなす。
      // 回転した線番 (縦区間) は細いほうが x になるので、向きで見る軸を変える —
      // 高さ固定で見ていたため、縦書きの線番が図記号に乗っても鳴らなかった
      return a.w <= a.h ? ox > a.w * 0.4 : oy > a.h * 0.4;
    };
    const sameOwner = (a, b2) => (a.dev && a.dev === b2.dev) || (a.wire && a.wire === b2.wire) || (a.text && a.text === b2.text);
    let overlapCount = 0, overlapTotal = 0;
    const pairSeen = new Set();          // 同じ組を両側から2回報告しない
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      const oi = labels.findIndex((b2, j) => j !== i && !sameOwner(a, b2) && realHit(a, b2));
      const other = oi >= 0 ? labels[oi] : null;
      if (other) {
        const pk = i < oi ? `${i}|${oi}` : `${oi}|${i}`;
        if (pairSeen.has(pk)) continue;
        pairSeen.add(pk);
      }
      // 文字を置いてよい範囲の判定は配置器と同じ規則を使う (囲み記号の中は心線が
      // 通る前提で空けてあるので、外接矩形ぜんぶを「図記号」と見ない)
      const onSym = other ? null : page.devices.find(d => d !== a.dev &&
        deviceObstacleBoxes(d, OBST_INSET.drc * f4).some(bx => symHit(a, bx)));
      if (!other && !onSym) continue;
      overlapTotal++;
      if (overlapCount >= 20) continue;
      overlapCount++;
      const target = other ? other.what : `${displayTag(onSym) || "機器"} の図記号`;
      const near = other && (Math.min(a.x + a.w, other.x + other.w) - Math.max(a.x, other.x)) <= 0;
      issues.push({ sev: "warn", rule: "textOverlap", msg: `${a.what} が ${target} と${near ? "近すぎます (あき 0.7mm 未満)" : "重なっています"}`, page: page.no, target: (a.dev || a.wire || a.text || {}).id || null, loc: `${page.no}.${sheetCol(a.x)}` });
    }
    if (overlapTotal > overlapCount) {
      issues.push({ sev: "warn", rule: "textOverlap", msg: `文字の重なりは他に ${overlapTotal - overlapCount} 箇所あります`, page: page.no, target: null, loc: `${page.no}.-` });
    }
    /* 文字が導体の上に乗っていないか。梯子図では線番の脇を別の配線が横切るので、
       配置器が避けきれない図では検図で知らせる (自分の線は、脇に置くのが作法
       なので除く)。配置器と同じく導体の線幅ぶんを見込んで判定する */
    {
      const HW = LINE_W.thick / 2 * f4;
      const segsOf = (o) => {
        const rs = [];
        for (let i = 0; i < o.pts.length - 1; i++) {
          const p0 = o.pts[i], p1 = o.pts[i + 1];
          rs.push({ x: Math.min(p0[0], p1[0]) - HW, y: Math.min(p0[1], p1[1]) - HW,
                    w: Math.abs(p1[0] - p0[0]) + HW * 2, h: Math.abs(p1[1] - p0[1]) + HW * 2 });
        }
        return rs;
      };
      let n2 = 0;
      labels.forEach(a => {
        if (n2 >= 20) return;
        const on = (r) => {
          const ox = Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x);
          const oy = Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y);
          return ox > 0.3 * f4 && oy > 0.3 * f4;
        };
        const hit = condWires(page).find(o => (!a.wire || o.id !== a.wire.id) && segsOf(o).some(on));
        if (!hit) return;
        n2++;
        issues.push({ sev: "warn", rule: "textOnWire", page: page.no, loc: `${page.no}.${sheetCol(a.x)}`,
          target: (a.wire || a.dev || a.text || {}).id || null,
          msg: `${a.what} が導体${hit.num ? " (線番 " + hit.num + ")" : ""} と重なっています` });
      });
    }

    /* 縮小尺度では、作図領域の座標がそのまま用紙上で 1/f に縮む。
       この図に実際に置かれている文字と線を測って、用紙の上で読める寸法に
       なっているかを見る (尺度に合わせて大きく作った記号 — PLC の入出力結線図
       など — は縮んでもちょうど良い大きさになるので、決め打ちでは判定しない) */
    if (sheetScale() > 1 && page.devices.length) {
      const f3 = sheetScale();
      const m3 = pageDrawnMinima(page);
      const minH = m3.h / f3;           // 用紙上の最小文字高
      const minW = m3.w / f3;           // 用紙上の最細線
      const bad2 = [];
      if (minH < 2.5 - 0.001) bad2.push(`最小文字高 ${minH.toFixed(2)}mm は JIS Z 8313 の 2.5mm を下回ります`);
      if (minW < 0.13 - 0.0001) bad2.push(`最細線 ${minW.toFixed(3)}mm は JIS Z 8312 の線幅列 (最細 0.13mm) を下回ります`);
      if (bad2.length) {
        issues.push({
          sev: "err", rule: "尺度と用紙上の寸法",
          msg: `尺度 ${pageSheetMeta(page).scale} では図記号・文字が用紙上 1/${f3} になります` +
               ` — ${bad2.join("、")} (この用紙に合わせて作った記号を使うか、尺度を 1:1 にしてください)`,
          page: page.no, target: null, loc: `${page.no}.-`,
        });
      }
    }

    // 注記テキスト・破線枠も同じ検査にかける
    page.texts.forEach(t => {
      // 注記の枠外・欄との重なりは上の文字要素まとめて検査するブロックで見る
    });
    pageZones(page).forEach(z => {
      const b = { x: z.x, y: z.y, w: z.w, h: z.h };
      if (outOfFrame(b)) {
        issues.push({ sev: "err", msg: `破線枠${z.label ? ` (${z.label})` : ""} が図枠の外にはみ出しています`, page: page.no, target: z.id, loc: `${page.no}.${sheetCol(z.x)}` });
      } else {
        // 枠線が欄を横切る場合のみ指摘 (内側に欄を含むだけなら図として成立する)
        const edges = [[[z.x, z.y], [z.x + z.w, z.y]], [[z.x + z.w, z.y], [z.x + z.w, z.y + z.h]],
                       [[z.x + z.w, z.y + z.h], [z.x, z.y + z.h]], [[z.x, z.y + z.h], [z.x, z.y]]];
        const hitR = blocks.find(r => edges.some(([a, b2]) => segCrossesRect(a, b2, r)));
        if (hitR) issues.push({ sev: "err", msg: `破線枠${z.label ? ` (${z.label})` : ""} が${blockName(hitR)}に重なっています`, page: page.no, target: z.id, loc: `${page.no}.${sheetCol(z.x)}` });
      }
    });

    // 囲みを実際に横切る心線の本数と、シンボルに設定した芯数が合っているか
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      const baseId = sym.stretchOf || sym.id;
      if (baseId !== "cable_core" && baseId !== "shield") return;
      const span = sym.span || (symStretchBase(sym) || { stretch: { def: 25 } }).stretch.def;
      const want = symSpanToCores(span);
      const rx = sym.enclosure || 5;
      // 囲みを左右に貫く配線を数える。心線が囲みからはみ出していても気づけるよう、
      // 判定は囲みの外形 + 1 ピッチの範囲で見る (ドレン線の引出し行は数えない)
      let cross = 0;
      condWires(page).forEach(w => {
        for (let i = 0; i < w.pts.length - 1; i++) {
          const a = w.pts[i], b2 = w.pts[i + 1];
          const bd0 = sym.bounds;
          const cs = [[-rx, bd0[1] - GRID], [rx, bd0[1] + bd0[3] + GRID]].map(q => pinAbs(dev, { x: q[0], y: q[1] }));
          const x0 = Math.min(cs[0].x, cs[1].x), x1 = Math.max(cs[0].x, cs[1].x);
          const y0 = Math.min(cs[0].y, cs[1].y), y1 = Math.max(cs[0].y, cs[1].y);
          const horiz = Math.abs(a[1] - b2[1]) < 0.01;
          const through = horiz
            ? (a[1] > y0 - 0.01 && a[1] < y1 + 0.01 && Math.min(a[0], b2[0]) <= x0 + 0.01 && Math.max(a[0], b2[0]) >= x1 - 0.01)
            : (a[0] > x0 - 0.01 && a[0] < x1 + 0.01 && Math.min(a[1], b2[1]) <= y0 + 0.01 && Math.max(a[1], b2[1]) >= y1 - 0.01);
          // ドレン線 (遮へいの引出し行) は心線として数えない。重ねてある遮へいの
          // 引出し行も見る。回転していても機器座標で比べる
          const drain = page.devices.some(d3 => {
            const s3 = symOf(d3.sym);
            if (!((s3.stretchOf || s3.id) === "shield")) return false;
            if (Math.hypot(d3.x - dev.x, d3.y - dev.y) > 20) return false;
            return (s3.pins || []).some(pn => {
              const pa = pinAbs(d3, pn);
              return Math.abs(a[0] - pa.x) < 0.01 || Math.abs(a[1] - pa.y) < 0.01;
            });
          });
          if (through && !drain) { cross++; break; }
        }
      });
      // 囲みに掛かっているのに中で終わっている導体 (行き止まり) も拾う
      let deadEnd = 0;
      const bd1 = devBounds(dev);
      // この図記号自身の接続点 (遮へいのドレン線の引出し口など) で終わるのは
      // 正しい描き方なので、行き止まりに数えない
      const own = devPins(dev);
      const atPin = pt => own.some(q => Math.abs(q.x - pt[0]) < 0.01 && Math.abs(q.y - pt[1]) < 0.01);
      condWires(page).forEach(w => {
        const inside = pt => pt[0] > bd1.x + 1 && pt[0] < bd1.x + bd1.w - 1 && pt[1] > bd1.y + 1 && pt[1] < bd1.y + bd1.h - 1;
        if (w.pts.some(pt => inside(pt) && !atPin(pt))) deadEnd++;
      });
      if (deadEnd) {
        issues.push({ sev: "warn", loc: devLocation(dev), page: page.no, target: dev.id,
          msg: `${displayTag(dev) || sym.name} の中で終わっている配線が ${deadEnd} 本あります (心線は囲みを貫いて描いてください)` });
      }
      if (cross !== want) {
        issues.push({ sev: "warn", loc: devLocation(dev), page: page.no, target: dev.id,
          msg: cross === 0
            ? `${displayTag(dev) || sym.name} を貫いている心線がありません (${want} 芯に設定されています)`
            : `${displayTag(dev) || sym.name} は ${want} 芯に設定されていますが、実際に通っている心線は ${cross} 本です` });
      }
    });

    // シールドの遮へいは接地して初めて機能する。ドレン線が接地記号へ届いていなければ知らせる
    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if ((sym.stretchOf || sym.id) !== "shield") return;
      const net = closed.pinNet(dev, 0);
      // 同じネットに落ちている接地記号を数える。電位リンクで繋がる他ページの
      // 接地も数に入れる (別葉で両端接地している図を見逃さない)
      const linked = net ? linkedNetSet(closedData, closed, net) : new Set();
      const earths = [];
      if (net) closedData.forEach((pd, pi) => pd.page.devices.forEach(d2 => {
        const s2 = symOf(d2.sym);
        if (!EARTH_SYM_IDS.has(s2.stretchOf || s2.id)) return;
        const hit = (s2.pins || []).some((_, i) => {
          const n2 = pd.pinNet(d2, i);
          return n2 && linked.has(pi + "|" + n2);
        });
        if (hit) earths.push(d2);
      }));
      // 接地の有無は電位リンク経由で他ページの接地も見る (別葉で片端接地する
      // 描き方でも誤って「未接地」と言わない)
      const earthedAnywhere = net && closed.eNets.has(net);
      if (!earthedAnywhere) {
        issues.push({ sev: "warn", msg: `${displayTag(dev) || sym.name} のドレン線が接地されていません (片端のみ FE へ接続してください)`,
          page: page.no, target: dev.id, loc: devLocation(dev) });
      } else if (earths.length >= 2) {
        // 遮へいを両端で接地すると接地間の電位差で循環電流が流れる
        issues.push({ sev: "warn", msg: `${displayTag(dev) || sym.name} のドレン線が ${earths.length} 箇所で接地されています (片端のみにしてください — 両端接地は循環電流の原因)`,
          page: page.no, target: dev.id, loc: devLocation(dev) });
      } else if (earths.length === 1 && (symOf(earths[0].sym).stretchOf || symOf(earths[0].sym).id) === "prot_earth") {
        // 遮へいのドレン線はノイズ用の機能接地へ落とす (保護接地母線に載せない)
        issues.push({ sev: "warn", msg: `${displayTag(dev) || sym.name} のドレン線が保護接地 (PE) に接続されています (遮へいは機能接地 FE へ落としてください)`,
          page: page.no, target: dev.id, loc: devLocation(dev) });
      }
      // 遮へいは心線囲みに重ねて使う。位置や本数が食い違うと、どの心線を
      // 遮へいしているのか図面から読めない
      // 心線が並ぶ範囲 (ドレン線の引出し行と上下の余白は除く) を機器座標から作る。
      // 長円の直線部だけを見るので、ドレン線の引出し行 (y=span-5) は入らない
      const base0 = symStretchBase(sym);
      const span0 = sym.span || (base0 && base0.stretch.def) || 25;
      // 心線の行は y = 0 〜 (芯数-1)×5。ドレン線の引出し行 (y = span-5) は入れない
      const yLast = (symSpanToCores(span0) - 1) * GRID + 2;
      const cs0 = [[-6, -2], [6, -2], [6, yLast], [-6, yLast]].map(q => pinAbs(dev, { x: q[0], y: q[1] }));
      const xs0 = cs0.map(q => q.x), ys0 = cs0.map(q => q.y);
      const inner = { x: Math.min(...xs0), y: Math.min(...ys0), w: Math.max(...xs0) - Math.min(...xs0), h: Math.max(...ys0) - Math.min(...ys0) };
      const coreWires = condWires(page).filter(w => w.pts.some((pt, i) => i > 0 && segCrossesRect(w.pts[i - 1], pt, inner)));
      const core = cablePartner(page, dev);
      if (!core) {
        const near = page.devices.find(d2 => (symOf(d2.sym).stretchOf || d2.sym) === "cable_core" &&
          Math.hypot(d2.x - dev.x, d2.y - dev.y) < 20);
        // 遮へいだけを導体に掛ける図 (シールド線・同軸) も実務にはある。
        // 導体が 1 本も通っていないときだけ「囲む対象がない」と知らせる
        if (near || !coreWires.length) issues.push({ sev: "warn", loc: devLocation(dev), page: page.no, target: dev.id,
          msg: near ? `${displayTag(dev) || sym.name} と心線囲みの位置がずれています (同じ位置に重ねてください)`
                    : `${displayTag(dev) || sym.name} に囲まれる導体がありません (心線か心線囲みを重ねてください)` });
      } else if ((symOf(core.sym).span || 0) !== (sym.span || 0)) {
        issues.push({ sev: "warn", loc: devLocation(dev), page: page.no, target: dev.id,
          msg: `${displayTag(dev) || sym.name} と心線囲みの心線本数が違います (${symSpanToCores(symOf(core.sym).span || 25)} 芯 / ${symSpanToCores(sym.span || 25)} 芯)` });
      }

      // 遮へいの中を通る心線とドレン線が同じネットになっていたら短絡 (遮へいの意味が失われる)
      if (net) {
        const hit = coreWires.find(w => closed.wireNet.get(w.id) === net);
        if (hit) {
          issues.push({ sev: "err", msg: `${displayTag(dev) || sym.name} のドレン線が中の心線と同じネットになっています (遮へいと心線は分けてください)`,
            page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      }
    });

    /* 用紙に合わせて作った記号 (入出力結線図など) は、想定の用紙でないと
       紙の上の寸法が変わってしまう。プロパティの「この用紙にする」で直せる */
    page.devices.forEach(dev => {
      const sy = symOf(dev.sym);
      const mm = symSheetMismatch(page, sy);
      if (!mm) return;
      issues.push({ sev: "err", rule: "記号の想定用紙と違う", page: page.no, target: dev.id, loc: devLocation(dev),
        msg: `${displayTag(dev) || sy.name} は ${sheetLabel(mm.want)} 用の記号です ` +
          `(このページは ${sheetLabel({ paper: mm.now.paper, orient: mm.now.orient || "landscape", scale: mm.now.scale })}。` +
          `プロパティの「この用紙にする」で合わせられます)` });
    });

    /* 行き先 (継続先)。相互参照は「指し先が一意に決まる」ことと「往復で対に
       なっている」ことで初めて図面の続きが追える (IEC 61082-1)。
       未設定のまま出図すると紙に「?」が刷られるので、警告ではなくエラー */
    const gotoDevs = page.devices.filter(d => { const s = symOf(d.sym); return s && s.gotoRef; });
    gotoDevs.forEach(dev => {
      const sy = symOf(dev.sym);
      const id = dev.props && dev.props.toPage;
      const who = displayTag(dev) || "行き先";
      if (!id) {
        issues.push({ sev: "err", rule: "行き先未設定", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} の指す先が選ばれていません (このままだと図面に「?」が刷られます。プロパティの「行き先」でページを選んでください)` });
        return;
      }
      if (id === page.id) {
        issues.push({ sev: "err", rule: "行き先の自己参照", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} が自分のページを指しています (続きの葉を選び直してください)` });
        return;
      }
      const to = gotoTargetPage(dev);
      if (!to) {
        issues.push({ sev: "err", rule: "行き先の指し先が無い", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} が指しているページは削除されています (行き先を選び直してください)` });
        return;
      }
      // 相手の葉に、こちらを指し返す行き先が無いと「どこから来たか」が追えない
      const back = gotoBackRefs(page, dev);
      if (!back.length) {
        issues.push({ sev: "warn", rule: "行き先の対が無い", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} の指す ${pageDwgNo(to)} に、この葉を指し返す行き先がありません (相互参照は往復で対にしてください)` });
      } else if (!gotoCounterpart(dev)) {
        // 対がいくつもあって信号で選べないと、区分 (列・行) を書きようがない
        issues.push({ sev: "warn", rule: "行き先の対が定まらない", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} の対が ${pageDwgNo(to)} で一つに定まりません (両側の線に同じタグの電位リンクを付けてください。定まるまで区分は書きません)` });
      }
      /* 電気的な継続は電位リンクが担う。行き先の線と同じネットにリンクが無い、
         あるいはリンクの相手が行き先の指す葉と食い違っていると、
         図面の見た目と回路の実体がずれる (IEC 61082-1 の中断表示) */
      const gnet = closed.pinNet(dev, 0);
      if (gnet) {
        const links = page.devices.filter(d => {
          const s2 = symOf(d.sym);
          return s2 && s2.sim === "link" && d.tag && closed.pinNet(d, 0) === gnet;
        });
        if (!links.length) {
          issues.push({ sev: "warn", rule: "行き先とリンクの不一致", page: page.no, target: dev.id, loc: devLocation(dev),
            msg: `${who} の線に電位リンクがありません (行き先は表示だけで通電しません。回路の続きは同じタグの電位リンクでつないでください)` });
        } else {
          const reach = new Set();
          links.forEach(lk => App.project.pages.forEach(pg2 => {
            if (pg2 === page) return;
            if (pg2.devices.some(d2 => { const s3 = symOf(d2.sym); return s3 && s3.sim === "link" && d2.tag === lk.tag; })) reach.add(pg2.id);
          }));
          if (reach.size && !reach.has(to.id)) {
            // 端子台を介して渡す図など、リンクを別の葉にまとめる描き方もある。
            // 断定はできないので警告にとどめる
            const names = [...reach].map(id2 => pageDwgNo(App.project.pages.find(pg2 => pg2.id === id2))).join("・");
            issues.push({ sev: "warn", rule: "行き先とリンクの不一致", page: page.no, target: dev.id, loc: devLocation(dev),
              msg: `${who} は ${pageDwgNo(to)} を指していますが、線がつながっている電位リンクの相手は ${names} です` });
          }
        }
      }
      /* 図番が旗に入りきらないと、どこへ続くのか読めない。幅だけでなく高さも見る
         (和文の図番は最小呼び 3.5mm へ上がるので、旗の内側に収まらないことがある)。
         はみ出した図番は隣の図形に重なって読めないので、警告ではなくエラー */
      const txt2 = gotoRefText(dev);
      const h2 = textHeightMM(txt2, TEXT_H.small * contentScale());
      const room = gotoTextRoom(sy) * contentScale();
      const roomH = gotoTextRoomH(sy) * contentScale();
      const tw2 = textWidthMM(txt2, h2, false, true);
      const ink2 = textInkMM(txt2, h2, true, false);
      if (tw2 > room + 0.01) {
        issues.push({ sev: "err", rule: "行き先の図番が入らない", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} の「${txt2}」が記号に入りきりません (幅 ${tw2.toFixed(1)}mm / 旗の内側 ${room.toFixed(1)}mm)` });
      } else if (ink2.up + ink2.down > roomH + 0.01) {
        issues.push({ sev: "err", rule: "行き先の図番が入らない", page: page.no, target: dev.id, loc: devLocation(dev),
          msg: `${who} の「${txt2}」は字の高さが旗に収まりません (${(ink2.up + ink2.down).toFixed(1)}mm / 旗の内側 ${roomH.toFixed(1)}mm。和文の図番は最小呼び 3.5mm になります)` });
      }
    });
    // 行き先どうしが近すぎると旗が重なって読めない (5mm ピッチで並べたとき)
    for (let i = 0; i < gotoDevs.length; i++) {
      for (let j = i + 1; j < gotoDevs.length; j++) {
        const g = rectGap(gotoFlagBox(gotoDevs[i]), gotoFlagBox(gotoDevs[j]));
        if (g < GOTO_TEXT_GAP) {
          issues.push({ sev: "warn", rule: "行き先どうしの重なり", page: page.no, target: gotoDevs[i].id,
            loc: devLocation(gotoDevs[i]),
            msg: `行き先の旗 (${gotoRefText(gotoDevs[i])} @${devLocation(gotoDevs[i])}) と ` +
              `(${gotoRefText(gotoDevs[j])} @${devLocation(gotoDevs[j])}) が近すぎます ` +
              `(あき ${g.toFixed(1)}mm / ${GOTO_TEXT_GAP}mm 以上あけてください。継続線は 10mm ピッチで並べてください)` });
        }
      }
    }

    // 電源短絡 (+24V と 0V が閉状態で同一ネット)。切替接点は投ごとの2パスで見る
    shortHit: for (const sd of throwData) {
      const s = sd[pageIdx];
      for (const p of s.pNets) {
        if (p && s.nNets.has(p)) {
          issues.push({ sev: "err", msg: "+24V と 0V が短絡しています (接点閉時)", page: page.no, target: null, loc: `${page.no}.-` });
          break shortHit;
        }
      }
    }

    // 宙吊り配線端点 (ピンにも他ワイヤにも接続しない末端)。stub=意図的な引込線/レール端は除外
    drcWires.forEach(w => {
      /* stub = 意図的な引込線・レール端。genGap = 入出力結線図の下地が空けた
         「機器を置く隙間」の端。全点を使い切る図面のほうが珍しいので、
         空いている行を毎回 2 件ずつ知らせると、本当に見るべき指摘が埋もれる */
      if (w.stub || w.genGap) return;
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(ep => {
        const k = ptKey(ep[0], ep[1]);
        const attached =
          (wireEndpoints.get(k) || 0) >= 2 ||
          allPins.some(p => Math.abs(p.x - ep[0]) < .01 && Math.abs(p.y - ep[1]) < .01) ||
          wireSegs.some(([a, b, wid]) => wid !== w.id && ptOnSeg(ep[0], ep[1], a[0], a[1], b[0], b[1]));
        if (!attached) {
          issues.push({ sev: "warn", msg: `配線の端点 (${ep[0]}, ${ep[1]}) がどこにも接続していません`, page: page.no, target: w.id, loc: `${page.no}.${sheetCol(ep[0])}` });
        }
      });
    });

    page.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (sym.missing) {
        issues.push({ sev: "err", msg: `${dev.tag || "機器"} のシンボル定義 (${dev.sym}) が見つかりません — 元の図面から再取り込みが必要です`, page: page.no, target: dev.id, loc: devLocation(dev) });
      }
      // 未接続ピン (絶縁処理端末など「未接続であること」を示す記号は除外)
      /* 未接続ピン。記号ぜんぶを黙らせる noDrc のほかに、ピン単位の除外も見る。
         PLC の入出力結線図のように「使わない点があるのが普通」の記号でも、
         電源・コモン・保護接地の結び忘れは必ず知らせたい */
      const pinWired = pin => wireEndpoints.has(ptKey(pin.x, pin.y)) ||
        wireSegs.some(([a, b]) => ptOnSeg(pin.x, pin.y, a[0], a[1], b[0], b[1])) ||
        page.devices.some(d2 => d2 !== dev && devPins(d2).some(p2 => Math.abs(p2.x - pin.x) < .01 && Math.abs(p2.y - pin.y) < .01));
      /* 切替接点は片方の投だけ使うのが普通 (1c で a側だけ使う等)。共通が
         つながっていれば、使わない側 1 つの未接続は知らせない。
         共通の結び忘れと、両方とも未接続 (置いただけ) は今までどおり出す */
      const coIdle = (() => {
        if (sym.sim !== "changeover" || (sym.pins || []).length < 3) return -1;
        const ps = devPins(dev);
        if (!pinWired(ps[2])) return -1;                        // 共通が未接続なら黙らない
        const a = pinWired(ps[0]), b = pinWired(ps[1]);
        return a && !b ? 1 : b && !a ? 0 : -1;                  // 使っていない側の index
      })();
      if (!sym.noDrc) devPins(dev).forEach((pin, pi) => {
        if ((sym.pins[pi] || {}).noDrc || pi === coIdle) return;
        const onWire = pinWired(pin);
        if (!onWire) {
          /* 同じ名前の端子が複数ある記号 (入出力結線図の COM など) では、
             どの端子かが分かるように区分 (列・行) を添える。飛び先も端子の位置に
             する — 用紙 1 枚を占める記号では、記号の原点では遠すぎる */
          const dup = sym.pins.filter(q => q.n && q.n === pin.name).length > 1;
          const zone = `${sheetCol(pin.x)}${sheetRow(pin.y)}`;
          // 図面に印字されている端子番号で言う (連動接点は繰り上げ後・手入力は上書き後)
          const shown = effectivePinName(dev, pi) || pin.name;
          /* 保護接地の結び忘れは注意ではなく誤り。感電保護 (JIS C 60364-4-41 /
             IEC 60204-1 8.2) は PE が確実につながっていることが前提なので、
             出図前に必ず消してもらう */
          const isPE = /^(PE|E)$/.test(pin.name || "");
          issues.push({ sev: isPE ? "err" : "warn",
            msg: `${displayTag(dev) || sym.name} のピン ${shown || pin.idx + 1}${dup ? ` (${zone})` : ""} が未接続です` +
              (isPE ? " — 保護接地は必ず接続してください" : ""),
            page: page.no, target: dev.id, loc: `${page.no}.${sheetCol(pin.x)}` });
        }
      });
      /* タグ重複 (電位リンクは同タグで対にするのが仕様なので除外)。
         入出力結線図のように 1 台の機器を複数枚に分けて描く記号は、
         同じ機種どうしなら同じタグでよい (同じ実機の別の葉)。
         囲み記号 (多芯ケーブル・シールド = enclosure) は機器ではなく
         導体への注記なので、同じ呼び (例 -sq1.25) を何個置いてもよい */
      if (dev.tag && !dev.linkTo && sym.sim !== "link" && !sym.enclosure) {
        const prev = tagSeen.get(dev.tag);
        const sameUnit = prev && sym.unitSheet && symOf(prev.sym || "").unitSheet &&
          symOf(prev.sym || "").typ === sym.typ;
        if (tagSeen.has(dev.tag) && !sameUnit) {
          issues.push({ sev: "err", msg: `デバイスタグ ${dev.tag} が重複しています`, page: page.no, target: dev.id, loc: devLocation(dev) });
        } else if (!tagSeen.has(dev.tag)) tagSeen.set(dev.tag, dev);
      }
      // リンク未設定の補助接点
      if (sym.linked && !dev.linkTo) {
        issues.push({ sev: "warn", msg: `${sym.name} ${dev.tag} がコイルにリンクされていません`, page: page.no, target: dev.id, loc: devLocation(dev) });
      }
      if (sym.mirror) {
        const contacts = linkedContacts(dev);
        // 接点なしコイル
        if (sym.sim === "coil" && contacts.length === 0 && dev.sym !== "plc_di") {
          issues.push({ sev: "warn", msg: `コイル ${dev.tag} に連動する接点がありません`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
        // 接点数超過 (物理リレーの接点残数)
        const max = dev.props.maxContacts || sym.maxContacts || 4;
        if (contacts.length > max) {
          issues.push({ sev: "err", msg: `${dev.tag} の連動接点が ${contacts.length} 点あり、実装可能数 ${max} 点を超えています`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      }
      if (sym.sim === "coil" || sym.sim === "load") {
        const a = closed.pinNet(dev, 0), b = closed.pinNet(dev, 1);
        // 電源未到達 (全接点閉でも電源に届かない)
        if (srcClosed.pNets.size) {
          /* 入出力結線図の枠記号 (unitSheet) の端子につながっていれば、
             そこから先は機器の中なので図では追えない。出力の枚は
             「+24V →負荷→ 出力端子」で正しいのに、枠が sim を持たないため
             負荷 1 台につき 1 件のエラーが必ず出ていた */
          const intoUnit = page.devices.some(d2 => {
            const s2 = symOf(d2.sym);
            if (!s2 || !s2.unitSheet) return false;
            return (s2.pins || []).some((_, i) => {
              const n = closed.pinNet(d2, i);
              return n && (n === a || n === b);
            });
          });
          const ok = intoUnit || anyThrow(pd => {
            const a2 = pd.pinNet(dev, 0), b2 = pd.pinNet(dev, 1);
            return (pd.pNets.has(a2) && pd.nNets.has(b2)) || (pd.pNets.has(b2) && pd.nNets.has(a2));
          });
          if (!ok) issues.push({ sev: "err", msg: `${displayTag(dev)} が電源 (+24V/0V) に接続されていません`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
        // 無開閉直結 (接点を1つも介さず両極に直結 → 電源投入と同時に動作)
        const ao = open.pinNet(dev, 0), bo = open.pinNet(dev, 1);
        const direct = (srcOpen.pNets.has(ao) && srcOpen.nNets.has(bo)) || (srcOpen.pNets.has(bo) && srcOpen.nNets.has(ao));
        if (direct) {
          issues.push({ sev: "err", msg: `${displayTag(dev)} が開閉要素なしで電源間に直結しています (投入と同時に動作)`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      }
    });
  });

  // 線番の重複 — 電気的につながっていない別ネットに同じ線番が印字されると誤結線になる。
  // 電位名 (+24V/0V) と電位リンク名はページをまたいで同一で正しいので除外する。
  const potentialNames = new Set();
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    const sym = symOf(dev.sym);
    if (sym.sim === "psu") { potentialNames.add("+24V"); potentialNames.add("0V"); }
    if (sym.sim === "link" && dev.tag) potentialNames.add(dev.tag.replace(/^-/, ""));
  }));
  // 主回路の相名 (L1 / 1L2 / M2-U1 …) は線番ではなく相の呼称なので重複を見ない
  const RE_PHASE = /^([A-Z]+\d*-)?\d*[LUVWNRST]\d*$/;
  const numUse = new Map();               // 線番 → ネット代表の配列
  /* 電位リンクで葉をまたいでつないだネットは、電気的には 1 本のネット。
     継続した回路に同じ線番を振るのは正しい作法なので、リンクのタグで
     ネットを束ねてから重複を数える (束ねないと、多葉の図で必ず誤警告になる) */
  const seenNet = new Set();                        // 束ねたネット単位で数える
  const netUF = UnionFind();
  const linkNets = new Map();                       // タグ → ネットキーの配列
  App.project.pages.forEach((page, pageIdx) => {
    const pn = openData[pageIdx].pinNet;
    page.devices.forEach(dev => {
      const sy = symOf(dev.sym);
      if (!sy || sy.sim !== "link" || !dev.tag) return;
      const net = pn(dev, 0);
      if (!net) return;
      const tag = dev.tag.replace(/^-/, "").toUpperCase();
      if (!linkNets.has(tag)) linkNets.set(tag, []);
      linkNets.get(tag).push(`${page.no}#${net}`);
    });
  });
  linkNets.forEach(keys => keys.forEach(k => netUF.union(keys[0], k)));
  App.project.pages.forEach((page, pageIdx) => {
    const wn = openData[pageIdx].wireNet;
    condWires(page).forEach(w => {
      if (w.num == null || w.num === "") return;
      const num = String(w.num);
      const netKey = netUF.find(`${page.no}#${wn.get(w.id)}`);
      if (seenNet.has(num + "|" + netKey)) return;
      seenNet.add(num + "|" + netKey);
      if (!numUse.has(num)) numUse.set(num, []);
      numUse.get(num).push({ page, w, netKey });
    });
  });
  numUse.forEach((list, num) => {
    if (list.length < 2) return;
    // 電位名 (+24V/0V) と電位リンク名は、同一ページでも複数ネットに現れて正しい。
    // シミュレータも同電位として扱うので、検図でも同じ解釈にそろえる。
    if (potentialNames.has(num) || RE_PHASE.test(num) || RE_EARTH.test(num)) return;
    const samePage = new Map();
    list.forEach(e => { if (!samePage.has(e.page.no)) samePage.set(e.page.no, []); samePage.get(e.page.no).push(e); });
    const dupPages = [...samePage.entries()].filter(([, v]) => v.length >= 2);
    dupPages.forEach(([, v]) => {          // 重複しているページをすべて報告する
      const e = v[0];
      issues.push({
        sev: "err",
        msg: `線番 ${num} が同一ページ内の異なる ${v.length} 本のネットに重複しています`,
        page: e.page.no, target: e.w.id, loc: `${e.page.no}.${sheetCol(e.w.pts[0][0])}`,
      });
    });
    if (!dupPages.length && samePage.size > 1) {
      const pages = [...samePage.keys()];
      issues.push({
        sev: "warn",
        msg: `線番 ${num} が複数ページ (${pages.join(", ")}) の別ネットに使われています`,
        page: list[0].page.no, target: list[0].w.id, loc: `${list[0].page.no}.${sheetCol(list[0].w.pts[0][0])}`,
      });
    }
  });

  // 図番の重複 (同じ図番のページが2枚あると図面管理が破綻する)
  {
    const seen = new Map();
    App.project.pages.forEach(pg => {
      const no = pageDwgNo(pg);
      if (!seen.has(no)) seen.set(no, []);
      seen.get(no).push(pg);
    });
    seen.forEach((pgs, no) => {
      if (pgs.length < 2) return;
      issues.push({
        sev: "err", msg: `図番 ${no} が ${pgs.length} ページ (${pgs.map(x => x.no).join(", ")}) で重複しています`,
        page: pgs[0].no, target: null, loc: `${pgs[0].no}.-`,
      });
    });
  }

  /* 1 台の機器を複数枚に分けて描いた図 (入出力結線図) の通しの検査。
     分かれている枚どうしは行き先記号で結ぶ (IEC 61082-1 の中断と継続)。
     ※ ユニットの電源と接地は別紙 (電源回路図) に描くので、入出力結線図の
        側では電源端子の有無を見ない */
  {
    const units = new Map();                 // タグ+機種 → [{page, dev, sym}]
    App.project.pages.forEach(pg => pg.devices.forEach(dev => {
      const sym = symOf(dev.sym);
      if (!sym || !sym.unitSheet || !dev.tag) return;
      const k = `${dev.tag}|${dev.typeRef || sym.typ || ""}`;
      if (!units.has(k)) units.set(k, []);
      units.get(k).push({ pg, dev, sym });
    }));
    units.forEach((list, k) => {
      const tag = k.split("|")[0];
      if (list.length < 2) return;
      const pageIds = new Set(list.map(e => e.pg.id));
      list.forEach(e => {
        const linked = e.pg.devices.some(d2 => {
          const s2 = symOf(d2.sym);
          return s2 && s2.gotoRef && d2.props && pageIds.has(d2.props.toPage);
        });
        if (linked) return;
        issues.push({ sev: "warn", rule: "分かれた枚の行き先が無い",
          msg: `${tag} は ${list.length} 枚に分かれていますが、このページに他の枚への行き先がありません`,
          page: e.pg.no, target: e.dev.id, loc: devLocation(e.dev) });
      });
    });
  }

  applySheet(curPage());   // 現在ページの図枠に戻す
  // 同じ対象・同じ内容の重複を1行にまとめる (検図一覧を作業キューとして使えるように)
  const seenMsg = new Set();
  const uniq = issues.filter(i => {
    const k = `${i.page}|${i.sev}|${i.target || ""}|${i.msg}`;
    if (seenMsg.has(k)) return false;
    seenMsg.add(k); return true;
  });
  return uniq;
}

/* ══════════════ 部品表 (BOM) ══════════════ */
/** 芯数を部品表に出すケーブル系シンボルか */
function baseIdOfCable(sym) {
  const id = sym.stretchOf || sym.id;
  return id === "cable_core" || id === "shield";
}
/** 心線囲み ⇔ 遮へい の相方 (同じ位置・同じ向きに重ねてあるもの)。
    検図・部品表・プロパティ (芯数の連動) で同じ判定を使う */
function cablePartner(page, dev) {
  const id = symOf(dev.sym).stretchOf || symOf(dev.sym).id;
  const want = id === "shield" ? "cable_core" : id === "cable_core" ? "shield" : null;
  if (!want || !page) return null;
  return page.devices.find(d2 => d2 !== dev && (symOf(d2.sym).stretchOf || d2.sym) === want &&
    Math.abs(d2.x - dev.x) < 0.01 && Math.abs(d2.y - dev.y) < 0.01 && (d2.rot || 0) === (dev.rot || 0)) || null;
}
const BOM_EXCLUDE = new Set(["link", "supply3", "supply1", "earth", "goto_ref"]); // 購買部品でないもの (行き先は図面の注記)
function buildBOM() {
  const rows = new Map();
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    if (dev.linkTo) return; // 連動接点は親デバイスの一部
    const sym = symOf(dev.sym);
    // 伸縮シンボルは寸法違いでも同じ部品なので基本形の id でまとめる
    const symId = sym.stretchOf || sym.id;
    if (BOM_EXCLUDE.has(symId)) return;
    // 端子は本数だけ数える (タグ -X1:n を -X1 に集約)
    const baseTag = symId === "terminal" ? (dev.tag || "-X1").split(":")[0] : null;
    /* 入出力結線図のように 1 台を複数枚で描く記号は、機種とタグでまとめる
       (記号 id で分けると、1 台の PLC が枚数ぶん部品表に並ぶ) */
    const key = symId === "terminal" ? "terminal|" + baseTag
      : sym.unitSheet ? "unit|" + (dev.typeRef || sym.typ || "") + "|" + (dev.tag || "")
      : symId + "|" + (dev.typeRef || "");
    // 多芯ケーブルは 1 本の物理ケーブルなので、心線囲みと遮へいを 1 行にまとめる
    // (現場は CVVS-1.25sq-6C を 1 品目として拾う)。芯数と遮へいの有無は購買の属性
    let cableCores = null, shielded = false;
    if (baseIdOfCable(sym)) {
      const mate = cablePartner(page, dev);
      // 遮へい側は相方がいれば行を作らない (心線囲み側にまとめる)
      if ((sym.stretchOf || sym.id) === "shield" && mate) return;
      cableCores = symSpanToCores(sym.span || 25);
      shielded = (sym.stretchOf || sym.id) === "shield" || !!mate;
    }
    const rowKey = cableCores ? key + "|" + cableCores + "|" + (shielded ? "S" : "") + (sym.stretchOf || sym.id) : key;
    const solo = cableCores && (sym.stretchOf || sym.id) === "shield";   // 遮へいだけを掛けた図
    const rowName = sym.unitSheet ? `${dev.typeRef || sym.typ} (入出力結線図)`
      : !cableCores ? sym.name
      : solo ? `シールド線 ${cableCores}芯`
      : `多芯ケーブル ${cableCores}芯${shielded ? " (遮へい付)" : ""}`;
    if (!rows.has(rowKey)) rows.set(rowKey, { name: rowName, typeRef: dev.typeRef || "—", tags: [], len: 0, cable: !!cableCores });
    const row = rows.get(rowKey);
    const tg = displayTag(dev) || "—";
    if (!(sym.unitSheet && row.tags.includes(tg))) row.tags.push(tg);   // 同じ実機は 1 台
    row.len += cableCores ? (parseFloat(dev.props && dev.props.len) || 0) : 0;
  }));
  return [...rows.values()].sort((a, b) => (a.tags[0] || "").localeCompare(b.tags[0] || ""));
}

function bomCSV() {
  const rows = buildBOM();
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return "﻿名称,型式,数量,長さ (m),デバイスタグ\n" +
    rows.map(r => [esc(r.name), esc(r.typeRef), r.tags.length,
      esc(r.cable ? (r.len ? +r.len.toFixed(1) : "—") : ""), esc(r.tags.join(" "))].join(",")).join("\n");
}

/** PLC アドレス一覧 */
function buildPLCList() {
  const rows = [];
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    const b0 = symBaseIdOf(dev.sym);
    if (b0 === "plc_di" || b0 === "plc_do") {
      rows.push({ tag: dev.tag, addr: dev.desc || "—", kind: b0 === "plc_di" ? "入力" : "出力", loc: devLocation(dev) });
    }
  }));
  return rows.sort((a, b) => a.addr.localeCompare(b.addr));
}

/** 接続 (ワイヤ) リスト: 線番ごとに接続先デバイス:ピンを列挙 */
function buildConnectionList() {
  const rows = [];
  App.project.pages.forEach(page => {
    const { pinNet, wireNet } = computeNets(page, "open");
    const netName = new Map();
    condWires(page).forEach(w => { if (w.num) netName.set(wireNet.get(w.id), w.num); });
    const netPins = new Map();
    page.devices.forEach(dev => {
      devPins(dev).forEach(pin => {
        const net = pinNet(dev, pin.idx);
        if (!net) return;
        if (!netPins.has(net)) netPins.set(net, []);
        const sym = symOf(dev.sym);
        const label = symBaseIdOf(dev.sym) === "terminal" || sym.sim === "link"
          ? (dev.tag || sym.name)
          : `${displayTag(dev) || sym.name}:${effectivePinName(dev, pin.idx) || pin.idx + 1}`;
        if (!netPins.get(net).includes(label)) netPins.get(net).push(label); // 端子等の重複列挙を防ぐ
      });
    });
    netPins.forEach((pins, net) => {
      if (pins.length >= 2) rows.push({ page: page.no, num: netName.get(net) || "(直結)", pins });
    });
  });
  return rows.sort((a, b) => a.page - b.page || String(a.num).localeCompare(String(b.num), undefined, { numeric: true }));
}
function connectionCSV() {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return "﻿ページ,線番,接続先\n" +
    buildConnectionList().map(r => [r.page, esc(r.num), esc(r.pins.join(" ⇔ "))].join(",")).join("\n");
}

/** 端子表: 端子ごとの内部/外部接続。
    "split" モード (端子を開いた状態) で解析し、端子の両側を区別する */
function buildTerminalList() {
  const rows = [];
  App.project.pages.forEach(page => {
    const split = computeNets(page, "split");
    const netName = new Map();
    condWires(page).forEach(w => { if (w.num) netName.set(split.wireNet.get(w.id), w.num); });
    const pinsOfNet = new Map();
    page.devices.forEach(dev => devPins(dev).forEach(pin => {
      const net = split.pinNet(dev, pin.idx);
      if (!net) return;
      if (!pinsOfNet.has(net)) pinsOfNet.set(net, []);
      pinsOfNet.get(net).push({ dev, pin });
    }));
    const pinLabel = (d, idx) => {
      const s = symOf(d.sym);
      if (symBaseIdOf(d.sym) === "terminal" || s.sim === "link") return d.tag || s.name;
      return `${displayTag(d) || s.name}:${effectivePinName(d, idx) || idx + 1}`;
    };
    page.devices.forEach(dev => {
      if (dev.sym !== "terminal") return;
      const side = i => {
        const net = split.pinNet(dev, i);
        const others = (pinsOfNet.get(net) || []).filter(e => e.dev !== dev)
          .map(e => pinLabel(e.dev, e.pin.idx));
        return { num: netName.get(net) || "(直結)", others };
      };
      const s0 = side(0), s1 = side(1);
      // 接続点の少ない側 = 現場機器側 (外部)、多い側 = 盤内 (内部) と判定
      const ext = s0.others.length <= s1.others.length ? s0 : s1;
      const int_ = ext === s0 ? s1 : s0;
      rows.push({ tag: dev.tag || "-X?", page: page.no, int: int_, ext });
    });
  });
  return rows.sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }));
}
function terminalCSV() {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const fmt = side => side.others.length > 4
    ? `${side.others.slice(0, 4).join(" ")} ほか${side.others.length - 4}点`
    : side.others.join(" ");
  return "﻿端子,ページ,外部側 線番,外部側 接続 (現場),内部側 線番,内部側 接続 (盤内)\n" +
    buildTerminalList().map(r => [esc(r.tag), r.page, esc(r.ext.num), esc(fmt(r.ext)), esc(r.int.num), esc(fmt(r.int))].join(",")).join("\n");
}

/* ══════════════ 元に戻す / やり直し ══════════════ */
function commit() {
  App.labelRev++;          // ラベル配置キャッシュを無効化
  App.undoStack.push(JSON.stringify(App.project));
  if (App.undoStack.length > 100) App.undoStack.shift();
  App.redoStack.length = 0;
  App.dirty = true;                   // ファイルへ未保存の変更あり
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
}
/** Undo/Redo 後も、まだ存在するオブジェクトの選択は維持する */
function retainSelection() {
  const alive = new Set();
  App.project.pages.forEach(pg => {
    pg.devices.forEach(d => alive.add(d.id));
    pg.wires.forEach(w => alive.add(w.id));
    pg.texts.forEach(t => alive.add(t.id));
    (pg.zones || []).forEach(z => alive.add(z.id));
  });
  [...App.selection].forEach(id => { if (!alive.has(id)) App.selection.delete(id); });
}
function undo() {
  if (App.sim.running) return false;
  if (!App.undoStack.length) return false;
  App.redoStack.push(JSON.stringify(App.project));
  App.project = JSON.parse(App.undoStack.pop());
  mergeProjectSymbols();
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  applySheet(); // 用紙・尺度も一緒に巻き戻す
  retainSelection();
  App.dirty = true;
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
  return true;
}
function redo() {
  if (App.sim.running) return false;
  if (!App.redoStack.length) return false;
  App.undoStack.push(JSON.stringify(App.project));
  App.project = JSON.parse(App.redoStack.pop());
  mergeProjectSymbols();
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  applySheet();
  retainSelection();
  App.dirty = true;
  if (typeof UI !== "undefined" && UI.updateSaveButton) UI.updateSaveButton();
  saveLocal();
  return true;
}

/* ══════════════ 保存 / 読込 ══════════════ */
const LS_KEY = "electracad.project.v1";
/* 自動保存。localStorage は 5MB 程度で頭打ちになり、大きな図面 (数百機器) は
   入り切らずに「毎回ファイルを開き直す」羽目になる。そこで IndexedDB
   (設計完了・一時保存と同じ入れ物) にも置き、起動時はそちらも見る。
   IndexedDB への書き込みは連続編集で重くならないよう少し遅らせてまとめる */
const AUTOSAVE_ID = "autosave";
let _autosaveTimer = null;
function saveLocal() {
  syncProjectSymbols();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(App.project));
    localStorage.setItem(LS_KEY + ".ok", "1");
  } catch (e) {
    // 入り切らなかった印 — 起動時に IndexedDB 側を採用する
    try { localStorage.setItem(LS_KEY + ".ok", "0"); } catch (e2) { }
  }
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try { relPutSnapshot(AUTOSAVE_ID, App.project); } catch (e) { /* 保存領域なし */ }
  }, 800);
}
/** 前回の図面を読み出す (localStorage が壊れている/入り切らなかったときは IndexedDB) */
async function loadAutosave() {
  const ls = loadLocal();
  let lsOK = true;
  try { lsOK = localStorage.getItem(LS_KEY + ".ok") !== "0"; } catch (e) { }
  if (ls && lsOK) return ls;
  try {
    const p = await relGetSnapshot(AUTOSAVE_ID);
    if (p && p.pages && p.pages.length) return p;
  } catch (e) { }
  return ls;
}
function loadLocal() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) { const p = JSON.parse(s); if (p && p.pages && p.pages.length) return p; }
  } catch (e) { /* 破損データは無視 */ }
  return null;
}
function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ══════════════ 出図のまとめ (PDF / ZIP) ══════════════
   外部ライブラリを使わずに、図面一式を 1 つのファイルにまとめる。
   ・buildPDF … 各ページを紙の大きさどおりに並べた 1 本の PDF
   ・buildZIP … 出力したファイルを 1 つの書庫に (無圧縮 store) */

/* ── 出図の版 (社内保存用 / 顧客提出用) ────────────────
   同じ図面から 2 通りの PDF を作る。
   ・社内保存用 … 表紙・目次・仕様・回路図まで、すべての図面
   ・顧客提出用 … 仕様のページを外したもの (社外に出さない取り決めのため)
   図番 (E-001 …) は両方で同じものを使う — 同じ図面を指すため。
   用紙の右下の「n / N」と目次だけ、その版に載るページで数え直す。 */
const RELEASE_KINDS = [
  { k: "internal", label: "社内保存用", desc: "すべての図面" },
  { k: "customer", label: "顧客提出用", desc: "仕様のページを外す" },
];
function releaseKindLabel(kind) {
  const r = RELEASE_KINDS.find(x => x.k === kind);
  return r ? r.label : String(kind || "");
}
/** その版に載せるページ (顧客提出用は仕様のページを外す) */
function releasePages(kind, pages) {
  const src = pages || (App.project ? App.project.pages : []) || [];
  return kind === "customer" ? src.filter(pg => pg.kind !== "spec") : src.slice();
}
/** その版のページだけを載せた図面として fn を走らせる (目次と「n / N」を合わせる)。
    ページは写しを使うので、元の図面のページ番号は書き換わらない。 */
async function withReleaseProject(kind, fn) {
  const keep = App.project, keepIdx = App.pageIdx;
  const list = releasePages(kind, keep.pages).map(pg => ({ ...pg }));
  list.forEach((pg, i) => { pg.no = i + 1; });
  App.project = { ...keep, pages: list };
  App.pageIdx = Math.max(0, Math.min(list.length - 1, keepIdx));
  try { return await fn(list); }
  finally { App.project = keep; App.pageIdx = keepIdx; }
}

/** ページの SVG を紙の実寸で画像にする (dpi は 1 インチあたりの画素) */
async function pageToImage(page, dpi = 200) {
  const [pw, ph] = paperSize(pageSheetMeta(page).paper, pageSheetMeta(page).orient);
  const svg = exportSheetSVG(page).replace(/^<\?xml[^>]*\?>\s*/, "");
  const px = v => Math.max(1, Math.round(v / 25.4 * dpi));
  const w = px(pw), h = px(ph);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error("SVG の画像化に失敗しました"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);       // 紙は白 (透過のまま貼らない)
  cx.drawImage(img, 0, 0, w, h);
  const url = cv.toDataURL("image/jpeg", 0.92);
  return { w, h, pw, ph, data: url.slice(url.indexOf(",") + 1) };
}

/** 全ページを 1 本の PDF にまとめる (各ページを紙の実寸で貼る) */
async function buildPDF(pages, opts = {}) {
  const dpi = opts.dpi || 200;
  const cur = curPage();
  const imgs = [];
  for (let i = 0; i < pages.length; i++) {
    if (opts.onProgress) opts.onProgress(i, pages.length);
    imgs.push(await pageToImage(pages[i], dpi));
  }
  applySheet(cur);                       // 図枠を元のページへ戻す
  /* PDF は 1pt = 1/72 インチ。用紙 (mm) を pt に直して MediaBox にする。
     画像は DCTDecode (JPEG) をそのまま埋め込む — 再圧縮しないので速い */
  const mm2pt = v => +(v * 72 / 25.4).toFixed(2);
  const objs = [];                       // 1 始まりの本体 (文字列)
  const add = str => { objs.push(str); return objs.length; };
  const bin = [];                        // 画像の生データ (obj 番号 → バイト列)
  const kidsIds = [];
  const pagesId = objs.length + 1 + 0;   // 後で確定するので仮置き
  // 先に 1 番を「ページの親」に予約する
  objs.push("");                         // 1: /Pages (後で埋める)
  pages.forEach((pg, i) => {
    const im = imgs[i];
    const raw = atob(im.data);
    const bytes = new Uint8Array(raw.length);
    for (let j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
    const imgId = add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n\u0000STREAM\u0000\nendstream`);
    bin[imgId] = bytes;
    const W = mm2pt(im.pw), H = mm2pt(im.ph);
    const contId = add(`<< /Length ${`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`.length} >>\nstream\nq ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\nendstream`);
    const pageId = add(`<< /Type /Page /Parent 1 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contId} 0 R >>`);
    kidsIds.push(pageId);
  });
  objs[0] = `<< /Type /Pages /Kids [${kidsIds.map(id => `${id} 0 R`).join(" ")}] /Count ${kidsIds.length} >>`;
  const catId = add(`<< /Type /Catalog /Pages 1 0 R >>`);
  const infoId = add(`<< /Title (${pdfStr(App.project.name || "図面")}) /Producer (ElectraCAD Studio) >>`);

  // ── バイト列として組み立てる (画像は生のまま) ──
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const push = u8 => { parts.push(u8); len += u8.length; };
  const pushStr = s => push(enc.encode(s));
  pushStr("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
  const offsets = [];
  objs.forEach((body, i) => {
    const id = i + 1;
    offsets[id] = len;
    pushStr(`${id} 0 obj\n`);
    if (bin[id]) {                        // 画像: ヘッダ → 生データ → 後書き
      const [head, tail] = body.split("\u0000STREAM\u0000");
      pushStr(head);
      push(bin[id]);
      pushStr(tail);
    } else pushStr(body);
    pushStr("\nendobj\n");
  });
  const xref = len;
  pushStr(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    objs.map((_, i) => String(offsets[i + 1]).padStart(10, "0") + " 00000 n \n").join(""));
  pushStr(`trailer\n<< /Size ${objs.length + 1} /Root ${catId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let at = 0;
  parts.forEach(u8 => { out.set(u8, at); at += u8.length; });
  return new Blob([out], { type: "application/pdf" });
}
/** PDF の文字列リテラルへ入れられる形に逃がす */
function pdfStr(s) { return String(s).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "_"); }

/* ── ZIP (無圧縮 store)。図面一式を 1 つの書庫にまとめる ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** files = [{ name, data: Uint8Array | string }] → ZIP の Blob */
function buildZIP(files) {
  const enc = new TextEncoder();
  const items = files.map(f => ({
    name: f.name,
    bytes: typeof f.data === "string" ? enc.encode(f.data) : f.data,
  }));
  const parts = [];
  let off = 0;
  const central = [];
  const u16 = v => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const cat = (...arrs) => {
    const n = arrs.reduce((a, b) => a + b.length, 0), o = new Uint8Array(n);
    let at = 0; arrs.forEach(a => { o.set(a, at); at += a.length; });
    return o;
  };
  items.forEach(it => {
    const nameB = enc.encode(it.name);
    const crc = crc32(it.bytes);
    const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(it.bytes.length), u32(it.bytes.length), u16(nameB.length), u16(0), nameB);
    parts.push(local, it.bytes);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(it.bytes.length), u32(it.bytes.length), u16(nameB.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), nameB));
    off += local.length + it.bytes.length;
  });
  const cenAll = cat(...central);
  const end = cat(u32(0x06054b50), u16(0), u16(0), u16(items.length), u16(items.length),
    u32(cenAll.length), u32(off), u16(0));
  return new Blob([...parts, cenAll, end], { type: "application/zip" });
}
