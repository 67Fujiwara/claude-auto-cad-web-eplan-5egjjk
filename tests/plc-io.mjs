/* キーエンス KV Nano シリーズ (KV-N14AT / KV-N24AT / KV-N40AT) の入出力結線図。

   実務の結線図の形。入力と出力は実機のユニットどおり鏡像 —
   入力: 左に現場側のレール、各行はそこから分岐して機器を通り、端子 (○ + リレー
   番号) からユニットの箱へ入る。箱の右は機能欄 (下線に文言)。
   出力: 箱が左。箱 → 端子 → 負荷 → レールと右へ流れ、名称欄は右端。
   機器は rot 270 で置けば、入力は左が電源側 (P,N)・右が信号、
   出力は左が信号・右が電源側と、どちらも向きが合う。

   ・用紙 1 枚 = 1 記号 = 「A3 横に収まる行数」(最大 10 点)。チャネル (16 点) は
     またがず均等に割る。用紙は記号の大きさから選び、表題欄 (160×30) と
     その左隣の改訂履歴欄 (120×30) — あわせて幅 280mm の帯 — を空ける。
     用紙は機種でそろえる (枚ごとに決めるとピッチを広げたとき横と縦が混ざる)。
   ・ユニットの電源と接地は描かない (別紙の電源回路図)。補助行はコモンだけ。
   ・端子より左 (現場側) は実際の導体で描く。プロパティの「結線図の下地を作る」で
     レールと各行の分岐を引き、機器を落とす隙間を空ける。記号の中に線を描いて
     しまうと、見た目はつながっているのに検図もシミュレーションも通らない図になる。
   ・機能欄の文言は機器のプロパティに持つ (記号に焼き込まない)。画面・DXF で同じ。
   ・尺度は 1:1。縮小すると線番・注記・現場機器が用紙の上で半分になり、
     JIS Z 8313 の最小呼び 2.5mm を割る。

   判定
   ・群ごとの点数と端子番号が実機どおりで、16 点で次のチャネルへ繰り上がること
   ・想定の用紙 (すべて NS) の図枠に収まり、表題欄・改訂履歴欄に掛からないこと。
     既定ピッチ 20mm ではすべて A3 横。どのピッチでも同じ機種の枚は同じ用紙
   ・紙の上の寸法 (行ピッチ 20mm・文字 2.5mm・線 0.25mm) が群によらず同じこと
   ・見出し (形式・種別) が箱に収まり、上辺・行間・罫線と 1mm 以上あくこと。
     種別は和文なので JIS Z 8313-0 の和文最小 3.5mm で描かれる — 実寸で測る
   ・未使用の入出力点は警告しないが、コモンの結び忘れは知らせること。
     接地の図記号は焼き込まないこと
   ・「下地を作る」が本物の導体を引き、コモンを外側のレールへ結ぶこと。
     電位名 (+24V/0V) が自分のレールに付くこと (25mm 隣のレールより近い)。
     二度押しても二重に引かないこと。出力の枚に負荷を置いても検図 0 件になること
   ・3 線式の直流検出器は NPN (シンク) 形 — 開閉要素は「出力と 0V」の間
   ・機能欄の文言が画面と DXF に出て下線の上に載り、長すぎれば検図に出ること
   ・プロパティで同じ群の機種に差し替えられ、下地も引き直されること。
     想定と違う用紙は検図に出て「この用紙にする」で消えること
   ・1 台の PLC を複数枚に分けて描いてもタグ重複にならず、部品表は 1 行 1 台
   ・部品表に出て、DXF に端子番号が出ること */
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
  const out = { group: {}, sheet: {}, print: {} };
  const SPEC = {
    /* 1 枚 = 1 チャネル (16 点 + コモン)。A3 縦 1:1 にびっしり収まる。
       端子の刻印は取説の回路図どおり (デバイス番号から R を除いた数字、
       コモンは C0/C1…、出力の 1 枚目にサービス電源 0V/24V)。
       AT 形の出力コモンの刻印と N24/N40 の入力コモンは未確認 (類推) */
    kv_n14at_in:  { io: 8,  first: "000", last: "007", aux: "C0", paper: "A3", orient: "landscape" },
    kv_n14at_out: { io: 6,  first: "500", last: "505", aux: "0V,24V,COM", paper: "A3", orient: "landscape" },
    kv_n24at_in:  { io: 14, first: "000", last: "013", aux: "C0", paper: "A3", orient: "portrait" },
    kv_n24at_out: { io: 10, first: "500", last: "509", aux: "0V,24V,COM", paper: "A3", orient: "portrait" },
    kv_n40at_in1: { io: 16, first: "000", last: "015", aux: "C0", paper: "A3", orient: "portrait" },
    kv_n40at_in2: { io: 8,  first: "100", last: "107", aux: "C0", paper: "A3", orient: "portrait" },
    kv_n40at_out: { io: 16, first: "500", last: "515", aux: "0V,24V,COM", paper: "A3", orient: "portrait" },
    kv_n14ar_in:  { io: 8,  first: "000", last: "007", aux: "C0", paper: "A3", orient: "landscape" },
    kv_n14ar_out: { io: 6,  first: "500", last: "505", aux: "0V,24V,C1,C2,C3,C4", paper: "A3", orient: "landscape" },
  };
  // 尺度は社内標準に合わせて 1:1 (幾何は NS と同一)
  Object.values(SPEC).forEach(v => { v.scale = "1:1"; });
  out.spec = SPEC;

  /* 記号 id が変わるような作り替えをしたら、途中で落ちずに「どの id が無いか」
     を名前で出す (落ちると、どの判定が壊れたのか分からない) */
  out.missingIds = Object.keys(SPEC).filter(id => !symOf(id) || symOf(id).missing);

  // ① 群ごとの点数・端子番号・用紙
  Object.entries(SPEC).forEach(([id, sp]) => {
    const sym = symOf(id);
    if (!sym || !Array.isArray(sym.pins) || !sym.pins.every(q => q && q.n !== undefined)) {
      out.group[id] = "記号がありません"; return;
    }
    const io = sym.pins.filter(x => /^\d+$/.test(x.n)), aux = sym.pins.filter(x => !/^\d+$/.test(x.n));
    if (!io.length) { out.group[id] = "端子がありません"; return; }
    out.group[id] = {
      io: io.length, first: io[0].n, last: io[io.length - 1].n, aux: aux.map(x => x.n).join(","),
      sheet: symSheetSpec(sym), swap: sym.swapGroup, typ: sym.typ, fnRows: sym.fnRows,
      /* 未使用の入出力点とサービス電源 (0V/24V) は黙る。コモンは黙らせない —
         浮いていれば群ごと動かない */
      ioSkipped: io.every(x => x.noDrc === true) &&
        aux.every(x => /^(COM|C\d+)$/.test(x.n) ? !x.noDrc : x.noDrc === true),
      /* 接地の図記号を焼き込まないこと。端子の小円 (行数ぶん) 以外の円が無い */
      peEarth: (sym.body.match(/<circle /g) || []).length === sym.pins.length && !/r="6"/.test(sym.body),
      // 機能欄の下線が行数ぶんある
      fnLines: (sym.body.match(/stroke-width="0\.25"/g) || []).length,
      /* 端子名は外郭の内側に描いてあること (自動ラベルは出さない)。
         外に出すと現場側の配線区画に文字が並び、端子の丸ともあきが取れない */
      termInBody: sym.pins.every(q => q.inBody === true) &&
        sym.pins.every(q => sym.body.includes(`>${q.n}</text>`)),
      rail: sym.ioSheet && sym.ioSheet.rail, gap: sym.ioSheet && sym.ioSheet.gap,
      /* 実機のユニットに合わせた向き: 入力は現場側が左 (レール→機器→端子→箱)、
         出力は箱が左 (箱→端子→負荷→レール→名称欄)。箱の位置と名称欄の位置で確かめる */
      layout: { side: (sym.ioSheet || {}).side,
        boxX: Math.min(...(sym.body.match(/<rect x="(-?[\d.]+)"/g) || ['<rect x="99"'])
          .map(m => parseFloat(m.replace(/^<rect x="/, "")))),
        fnTextX: (sym.ioSheet || {}).fnTextX },
      /* 見出し (形式・種別) が箱の中に収まり、罫線に触れないこと。
         種別は和文なので、呼び 2.5 と書いても JIS Z 8313-0 の和文最小 3.5mm で
         描かれる — 実際に描かれる大きさで測る */
      header: (() => {
        const rule = 12;                       // 見出しの罫線 (KV_HDR - 1)
        const ts = [...sym.body.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" data-h="([\d.]+)"[^>]*font-family="([a-z-]+)"[^>]*>([^<]+)<\/text>/g)]
          .map(m => ({ x: +m[1], y: +m[2], h: +m[3], mono: m[4] === "monospace", t: m[5] }))
          .filter(o => o.y < rule);
        if (ts.length !== 2) return { n: ts.length };
        const box = ts.map(o => {
          const ink = textInkMM(o.t, o.h, o.mono, false);
          const w = textWidthMM(o.t, textHeightMM(o.t, o.h), o.mono, false);
          return { top: o.y - ink.up, bot: o.y + ink.down, l: o.x - w / 2, r: o.x + w / 2, t: o.t };
        }).sort((a, b2) => a.top - b2.top);
        /* 外郭は端子の直径ぶん右にある (ピンを 5mm 格子に乗せるため)。
           見出しの文字がその内側に収まっているか */
        const bx0 = Math.min(...(sym.body.match(/<rect x="(-?[\d.]+)"/g) || ['<rect x="0"'])
          .map(m => parseFloat(m.replace(/^<rect x="/, ""))));
        return { n: 2, inBox: box.every(o => o.l >= bx0 + 0.5 && o.r <= bx0 + 30 - 0.5),
          fromTop: +box[0].top.toFixed(2),          // 箱の上辺からのあき
          between: +(box[1].top - box[0].bot).toFixed(2),
          toRule: +(rule - box[1].bot).toFixed(2) };
      })(),
    };
  });
  /* 行ピッチと用紙の対応。「A3 横に 16 点」はピッチ 15mm なら成り立つ
     (ただし横に倒した機器どうしは接する — だから既定は 20mm) */
  out.pitchPaper = {};
  out.pitchPaperByModel = {};
  const lab = sh => sh ? sh.paper + (sh.orient === "landscape" ? "横" : "縦") + " " + sh.scale : "-";
  [15, 20, 25, 30, 35].forEach(v => {
    out.pitchPaper[v] = Object.keys(SPEC).map(id => lab((symOf(id + "@" + v) || {}).sheet)).join(",");
    // 機種ごとに、その機種の枚が何種類の用紙になるか (1 種類であること)
    const byModel = {};
    Object.keys(SPEC).forEach(id => {
      const m = id.replace(/_(in|out)\d*$/, "");
      (byModel[m] = byModel[m] || []).push(lab((symOf(id + "@" + v) || {}).sheet));
    });
    out.pitchPaperByModel[v] = {};
    Object.entries(byModel).forEach(([m, v2]) => { out.pitchPaperByModel[v][m] = [...new Set(v2)]; });
  });

  if (out.missingIds.length) return out;      // 以降は記号がそろっている前提

  // ② 用紙に収まるか / 紙の上の寸法
  App.project = newProject("KV Nano 入出力結線図");
  /* 置き場所: 入力は現場側 (レール) が左なので、レールの左に 10mm 残す。
     出力は箱が左なので、箱の左辺を図枠から 5mm あける。どちらも 5mm 格子 */
  const kvPlaceX = (sym, fr) => Math.ceil((sym.ioSheet.side === "right"
    ? fr.x - sym.bounds[0] + 5 : fr.x + sym.ioSheet.rail + 15) / 5) * 5;
  const pages = {};
  Object.entries(SPEC).forEach(([id, sp], i) => {
    const sym = symOf(id), want = sym && symSheetSpec(sym);
    if (!want || !sym.ioSheet) { out.sheet[id] = { inFrame: false, onBlock: true, railRoom: -1 }; return; }
    const pg = i === 0 ? App.project.pages[0] : (() => {
      const q = newPage(id, App.project.pages.length + 1); App.project.pages.push(q); return q;
    })();
    pg.name = sym.name;
    pg.paper = want.paper; pg.orient = want.orient; pg.scale = want.scale;
    App.pageIdx = App.project.pages.indexOf(pg); applySheet(pg);
    const fr = frameRect(), tb = titleBlocksRects();
    const d = addDevice(pg, id, kvPlaceX(sym, fr), fr.y + 5, { tag: `-A${i + 1}` });
    // 置き場所は 5mm 格子 (行の y が格子に乗るように)
    pages[id] = { pg, d, sym };
    const bd = devBounds(d), bb = devPartBoxes(d);
    out.sheet[id] = {
      inFrame: bd.x >= fr.x && bd.y >= fr.y && bd.x + bd.w <= fr.x + fr.w && bd.y + bd.h <= fr.y + fr.h,
      onBlock: bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y)),
      // 現場側の端 (入力=レールの左 / 出力=名称欄の右) と図枠のあき
      railRoom: sym.ioSheet.side === "right"
        ? Math.round(fr.x + fr.w - (d.x + sym.bounds[0] + sym.bounds[2]))
        : Math.round(d.x - sym.ioSheet.rail - fr.x),
    };
    /* 行ピッチは「並びで隣り合う io 行」の間で測る。分割コモン (C1〜) が
       間に挟まる箇所は 1 行ぶん広いのが正しい */
    const rr = sym.ioSheet.rows;
    const gaps = rr.slice(1).map((r, i) => (rr[i].io && r.io) ? r.y - rr[i].y : null).filter(v => v !== null);
    const m = pageDrawnMinima(pg);
    out.print[id] = { pitch: gaps.length ? Math.min(...gaps) : sym.ioSheet.pitch,
      minText: +m.h.toFixed(3), minLine: +m.w.toFixed(3) };
  });
  App.labelRev++;

  // ③ 置いただけ: 入出力点は黙り、電源・コモン・PE は知らせる
  const un = runDRC().filter(i => /未接続/.test(i.msg));
  out.unconnected = { total: un.length,
    names: [...new Set(un.map(i => (/ピン (\S+)/.exec(i.msg) || [])[1]))].sort().join(","),
    /* 保護接地の結び忘れは注意ではなく誤り (感電保護は PE がつながっている前提)。
       電源・コモンは注意のまま — 使い方によっては別紙で結ぶことがある */
    peSev: [...new Set(un.filter(i => /ピン PE/.test(i.msg)).map(i => i.sev))].join(","),
    otherSev: [...new Set(un.filter(i => !/ピン PE/.test(i.msg)).map(i => i.sev))].join(",") };

  /* ④ 下地を作る → 隙間に機器を置き COM をつなぐ → 検図 0 件。
     下地は本物の導体なので、機器を置けばそのまま回路として成立する */
  const t = pages.kv_n14at_in;
  if (!t) return out;
  App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  const n1 = buildIoScaffold(t.pg, t.d);
  const n2 = buildIoScaffold(t.pg, t.d);               // 二度押しても増えない (引き直す)
  // 自動の端子番号ラベルが 1 つも出ていないこと (記号の中に描いてあるので)
  out.termLabels = pinLabelBoxes(t.pg).filter(x => x.owner === t.d.id).length;
  /* 下地を引いただけ (機器はまだ置いていない) で検図が 0 件であること。
     全点を使い切る図面のほうが珍しいので、空いている行の隙間の端を
     毎回「宙吊り」と言われると、本当に見るべき指摘が埋もれる */
  App.labelRev++;
  out.emptyDrc = runDRC().filter(i => i.page === t.pg.no).map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`);
  /* 図記号どうしの重なりを検図が見ること。文字の重なりは見ていたのに
     図記号どうしは素通りで、レール頭の電位リンクが食い込んでも 0 件だった */
  {
    const a = t.pg.devices.find(d2 => d2.gen === t.d.id && symOf(d2.sym).sim === "link");
    const dup = addDevice(t.pg, a.sym, a.x + 2, a.y, { tag: "N24V", rot: a.rot || 0 });
    App.labelRev++;
    out.symOverlap = runDRC().filter(i => i.rule === "記号の重なり").length;
    t.pg.devices.splice(t.pg.devices.indexOf(dup), 1);
    App.labelRev++;
  }
  /* 導体が図記号を貫いていないか。画面は白塗りで隠れても DXF にはそのまま出る。
     外郭のまん中を横切る導体を 1 本引いて、検図が拾うことを確かめる */
  {
    const b4 = devBounds(t.d), midY = b4.y + b4.h / 2;
    const w4 = addWire(t.pg, [[b4.x - 10, midY], [b4.x + b4.w + 10, midY]]);
    App.labelRev++;
    out.pierce = runDRC().filter(i => i.rule === "導体が図記号を貫通").length;
    t.pg.wires.splice(t.pg.wires.indexOf(w4), 1);
    App.labelRev++;
  }
  out.scaffold = { wires: n1, again: n2, total: t.pg.wires.length, same: n1 === n2,
    // レールは導体で、電位リンクが付く
    hasLink: t.pg.devices.some(d => symOf(d.sym).sim === "link") };
  /* 電位名 (+24V / 0V) が自分のレールに付いていること。25mm 隣にもう 1 本
     レールがあるので、まわりを探して置く既定規則だと「相手のレールのほうが
     近い」位置に落ち、+24V と 0V が入れ替わって読める */
  {
    const links = t.pg.devices.filter(x => x.gen === t.d.id && symOf(x.sym).sim === "link");
    out.railLabels = links.map(l => {
      const lb = deviceLabelBoxes(t.pg, l).find(o => o.isTag);
      if (!lb) return { tag: l.tag, noLabel: true };
      const cx = lb.box.x + lb.box.w / 2;
      const others = links.filter(o => Math.abs(o.x - l.x) > 1).map(o => Math.abs(cx - o.x));
      // 電位リンクの三角 (挿入点から 8mm) に文字が乗っていないこと
      const ib = devInkBox(l);
      const on = lb.box.x < ib.x + ib.w && lb.box.x + lb.box.w > ib.x &&
        lb.box.y < ib.y + ib.h && lb.box.y + lb.box.h > ib.y;
      return { tag: l.tag, toOwn: +Math.abs(cx - l.x).toFixed(2),
        toOther: +Math.min(...others).toFixed(2), onGlyph: on };
    });
  }
  /* 機器を置き、配線は自分で引く (行のスタブはもう描かれない)。
     行ごと: 分岐レール → 機器 → 端子 */
  const sp = t.sym.ioSheet;
  const branchX0 = t.d.x - sp.rail + sp.sep;
  const wireRow = (pg2, dd2, d2, rowY) => {
    const ps = devPins(d2);
    const left = ps[0].x <= ps[ps.length - 1].x ? ps[0] : ps[ps.length - 1];
    const right = ps[0].x <= ps[ps.length - 1].x ? ps[ps.length - 1] : ps[0];
    const sp2 = symOf(dd2.sym).ioSheet;
    const bx = sp2.side === "right" ? dd2.x + sp2.rail - sp2.sep : dd2.x - sp2.rail + sp2.sep;
    if (sp2.side === "right") {
      addWire(pg2, [[dd2.x, rowY], [left.x, rowY]]);
      addWire(pg2, [[right.x, rowY], [bx, rowY]]);
    } else {
      addWire(pg2, [[bx, rowY], [left.x, rowY]]);
      addWire(pg2, [[right.x, rowY], [dd2.x, rowY]]);
    }
  };
  sp.rows.filter(r => r.io).forEach(r => {
    const d2 = addDevice(t.pg, "pb_no", t.d.x + sp.gapX0, t.d.y + r.y, { tag: "", rot: 270 });
    wireRow(t.pg, t.d, d2, t.d.y + r.y);
  });
  /* コモンは下地が外側のレール (入力なら +24V) へ自動で結ぶ。
     いちばん自然な操作なのに手でやると必ず宙吊りになっていたので、引くようにした */
  const com = t.sym.pins.findIndex(q => q.n === "C0");
  const cp = devPins(t.d)[com];
  App.labelRev++;
  {
    const nets0 = computeNets(t.pg, "closed");
    const outer = t.pg.devices.find(d2 => d2.gen === t.d.id && symOf(d2.sym).sim === "link" &&
      Math.abs(d2.x - (t.d.x - sp.rail)) < 0.01);
    out.comAuto = { linked: !!outer && nets0.pinNet(t.d, com) === nets0.pinNet(outer, 0),
      tag: outer && outer.tag };
  }
  out.wired = runDRC().filter(i => i.page === t.pg.no).map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`);
  // 現場機器と PLC 端子が同じネットになっている (絵だけでなく回路として通っている)
  const nets = computeNets(t.pg, "closed");
  const sw = t.pg.devices.filter(d => d.sym === "pb_no")[0];
  out.electrical = nets.pinNet(sw, 1) === nets.pinNet(t.d, 0) || nets.pinNet(sw, 0) === nets.pinNet(t.d, 0);

  /* ④a-2 機器タグの居場所。用紙 1 枚を占める記号なので、まわりを探す規則のままだと
     現場側の配線区画のまん中へ降りてしまう。見出しの左肩に固定されていること */
  {
    const lb = deviceLabelBoxes(t.pg, t.d).find(o => o.isTag);
    const row0 = t.d.y + sp.rows[0].y;                 // 1 行目 (ここから下は現場側の区画)
    const hit = (a, b2) => a.x < b2.x + b2.w && a.x + a.w > b2.x && a.y < b2.y + b2.h && a.y + a.h > b2.y;
    out.tagPlace = { has: !!lb,
      aboveRows: !!lb && lb.box.y + lb.box.h <= row0 - 2,
      leftOfBox: !!lb && lb.box.x + lb.box.w <= t.d.x,           // 箱 (x=0〜30) に掛からない
      // 現場側に置いた機器・下地の導体とぶつからない
      clearOfDevices: !!lb && !t.pg.devices.some(d2 => d2 !== t.d && hit(lb.box, devBounds(d2))) };
  }

  /* ④b 行ピッチ: 横に倒した現場機器が隣の行とぶつからないこと。
     いちばん背の高い単極の入出力記号でも、ピッチを広げれば収まること */
  {
    const q = newPage("干渉の確認", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    q.paper = "A3"; q.orient = "landscape"; q.scale = "1:1"; applySheet(q);
    const dd = addDevice(q, "kv_n14at_in", 130, 20, { tag: "-A9" });
    const sp2 = symOf(dd.sym).ioSheet;
    const put = (id) => sp2.rows.filter(r => r.io).slice(0, 3).map(r =>
      addDevice(q, id, dd.x + sp2.gapX0, dd.y + r.y, { tag: "", rot: 270 }));
    /* 外接矩形は全周 2mm の余白つきなので、実際に線が引かれる範囲で測る。
       隣の行の機器と 1mm 以上あいていなければ「干渉」 */
    const ink = (d2) => { const b3 = devBounds(d2); return { y0: b3.y + 2, y1: b3.y + b3.h - 2 }; };
    const clash = (ds) => { let n = 0;
      for (let i = 0; i < ds.length - 1; i++) {
        const a = ink(ds[i]), b2 = ink(ds[i + 1]);
        if (b2.y0 - a.y1 < 0.5) n++;      // 線どうしが 0.5mm 未満なら干渉
      }
      return n; };
    const gapOf = (ds) => Math.min(...ds.slice(1).map((d2, i) => ink(d2).y0 - ink(ds[i]).y1));
    /* id を間違えると symOf が欠損の代わりを返し、cat が misc になって黙って
       落ちる (selector という id は無く、正しくは sel_sw だった)。
       落とさずに並べ、見つからなければ判定で落ちるようにする */
    const kinds = ["pb_no", "estop", "estop2", "sel_sw", "limit_sw", "float_sw", "thermo", "prox", "press_sw"];
    // 既定ピッチで収まるのは単極の機器まで。多極・横に長い機器は広げる前提
    const WIDE_ONLY = ["estop2", "photo"];
    out.pitch = { def: sp2.pitch, clash: {}, gap: {},
      missing: kinds.filter(id => !symOf(id) || symOf(id).missing) };
    kinds.forEach(id => { const ds = put(id); out.pitch.clash[id] = clash(ds); out.pitch.gap[id] = +gapOf(ds).toFixed(2); ds.forEach(d2 => q.devices.splice(q.devices.indexOf(d2), 1)); });
    out.pitch.wideOnly = WIDE_ONLY;
    // 背の高い記号 (光電センサ) は既定ピッチではぶつかるが、広げれば収まる
    const tall = put("photo");
    out.pitch.tallAtDef = clash(tall);
    tall.forEach(d2 => q.devices.splice(q.devices.indexOf(d2), 1));
    const base = symStretchBase(symOf(dd.sym));
    symStretchVariant(base, 30); dd.sym = `${base.id}@30`;
    App.labelRev++;
    const sp3 = symOf(dd.sym).ioSheet;
    out.pitch.wideClash = {};
    WIDE_ONLY.forEach(id => {
      const ds = sp3.rows.filter(r => r.io).slice(0, 3).map(r =>
        addDevice(q, id, dd.x + sp3.gapX0, dd.y + r.y, { tag: "", rot: 270 }));
      out.pitch.wideClash[id] = clash(ds);
      out.pitch.gap[id + "@30"] = +gapOf(ds).toFixed(2);
      ds.forEach(d2 => q.devices.splice(q.devices.indexOf(d2), 1));
    });
    const tall2 = sp3.rows.filter(r => r.io).slice(0, 3).map(r =>
      addDevice(q, "photo", dd.x + sp3.gapX0, dd.y + r.y, { tag: "", rot: 270 }));
    out.pitch.tallAtWide = clash(tall2);
    out.pitch.wide = sp3.pitch;
    out.pitch.sheetGrew = JSON.stringify(symSheetSpec(symOf(dd.sym))) !== JSON.stringify(symSheetSpec(symOf("kv_n14at_in")));
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④b-2 改訂履歴欄を入れても図が欄に乗らないこと。
     改訂履歴欄は表題欄の「左隣」に並ぶので、右下でふさがるのは幅 280mm の帯。
     改訂 0 行でしか回していなかったため、この経路が抜けていた */
  {
    const meta = projectMeta();
    const keep = meta.revs;
    meta.revs = [1, 2, 3, 4].map(i => ({ rev: String(i), date: "2026-01-0" + i, desc: "改訂", appr: "—" }));
    App.labelRev++;
    out.withRevs = {};
    [15, 20, 25, 30, 35].forEach(v => {
      const bad = [];
      Object.keys(SPEC).forEach(id => {
        const s2 = symOf(id + "@" + v);
        if (!s2 || !s2.sheet) { bad.push(id + ":記号なし"); return; }
        const q = newPage("改訂の確認", App.project.pages.length + 1);
        App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
        q.paper = s2.sheet.paper; q.orient = s2.sheet.orient; q.scale = s2.sheet.scale; applySheet(q);
        addDevice(q, id + "@" + v, kvPlaceX(s2, frameRect()), frameRect().y + 5, { tag: "-A50" });
        App.labelRev++;
        runDRC().filter(i => i.page === q.no && /改訂履歴欄|表題欄|図枠/.test(i.msg))
          .forEach(i => bad.push(`${id}@${v}:${i.msg}`));
        App.project.pages.pop();
      });
      out.withRevs[v] = bad;
    });
    meta.revs = keep;
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
    App.labelRev++;
  }

  /* ④b-3 行ピッチを変えたら、隙間に置いてある現場機器も新しい行へ運ばれること。
     記号だけ差し替えると機器が旧位置に残り、全行が外れる */
  {
    const q = newPage("ピッチ変更", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    const s0 = symOf("kv_n14at_in"), w1 = symSheetSpec(s0);
    q.paper = w1.paper; q.orient = w1.orient; q.scale = w1.scale; applySheet(q);
    const dd = addDevice(q, "kv_n14at_in", frameRect().x + s0.ioSheet.rail + 15, frameRect().y + 5, { tag: "-A60" });
    buildIoScaffold(q, dd);
    const spA = symOf(dd.sym).ioSheet;
    const rowsA = spA.rows.filter(r => r.io);
    rowsA.forEach(r => {
      const d2 = addDevice(q, "pb_no", dd.x + spA.gapX0, dd.y + r.y, { tag: "", rot: 270 });
      wireRow(q, dd, d2, dd.y + r.y);
    });
    const base2 = symStretchBase(symOf(dd.sym));
    symStretchVariant(base2, 30);
    const oldSp = symOf(dd.sym).ioSheet;
    dd.sym = `${base2.id}@30`;
    const moved = moveIoRowDevices(q, dd, oldSp, symOf(dd.sym).ioSheet);
    buildIoScaffold(q, dd);
    /* ピッチを広げると要る用紙も変わる。検図が知らせるので、その指示どおり
       用紙を合わせてから残りの指摘を見る (「この用紙にする」と同じ手順) */
    const w2 = symSheetSpec(symOf(dd.sym));
    out.pitchSheet = `${w2.paper}/${w2.orient}`;
    q.paper = w2.paper; q.orient = w2.orient; q.scale = w2.scale; applySheet(q);
    App.labelRev++;
    const spB = symOf(dd.sym).ioSheet;
    const nets3 = computeNets(q, "closed");
    out.pitchMove = { moved,
      // 機器が新しい行の高さに乗り、端子と同じネットのままか
      onRows: q.devices.filter(d2 => d2.sym === "pb_no").every((d2, i) =>
        Math.abs(d2.y - (dd.y + spB.rows.filter(r => r.io)[i].y)) < 0.01),
      wired: q.devices.filter(d2 => d2.sym === "pb_no").every((d2, i) =>
        nets3.pinNet(d2, 1) === nets3.pinNet(dd, i) || nets3.pinNet(d2, 0) === nets3.pinNet(dd, i)),
      drc: runDRC().filter(i => i.page === q.no).map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`) };
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④b-4 出力の枚。隙間に負荷 (表示灯) を落として結線すると検図 0 件になること。
     出力は「+24V →負荷→ 出力端子」で、帰りは機器の中 (COM=0V) を通るので、
     図の上では電源へ届かない。ここを見ていなかったため、出荷している 10 枚の
     うち出力 4 枚は一度も通しで試されていなかった */
  {
    const q = newPage("出力の枚", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    const s0 = symOf("kv_n14at_out"), w1 = symSheetSpec(s0);
    q.paper = w1.paper; q.orient = w1.orient; q.scale = w1.scale; applySheet(q);
    const dd = addDevice(q, "kv_n14at_out", kvPlaceX(s0, frameRect()), frameRect().y + 5, { tag: "-A70" });
    buildIoScaffold(q, dd);
    const spO = symOf(dd.sym).ioSheet;
    const rowsO = spO.rows.filter(r => r.io);
    rowsO.forEach((r, i) => {
      const d2 = addDevice(q, "lamp", dd.x + spO.gapX0, dd.y + r.y, { tag: `-P${i + 1}`, rot: 270 });
      wireRow(q, dd, d2, dd.y + r.y);
    });
    App.labelRev++;
    const netsO = computeNets(q, "closed");
    out.outSheet = {
      loads: rowsO.length,
      /* 向きまで見る: 負荷の左ピン = 出力端子 (信号)、右ピン = +24V (分岐レール)。
         「アウトプットは左が信号線・右が P,N」の要件そのもの */
      wired: (() => {
        const br = q.devices.find(d2 => d2.gen === dd.id && symOf(d2.sym).sim === "link" &&
          d2.tag === spO.railTags.branch);
        // 端子の添字: サービス電源 (0V/24V) が先頭にあるので、io 端子だけの並びで引く
        const ioIdx = symOf(dd.sym).pins.map((p2, k) => [p2, k])
          .filter(([p2]) => /^\d+$/.test(p2.n)).map(([, k]) => k);
        return !!br && q.devices.filter(d2 => d2.sym === "lamp").every((d2, i) => {
          const ps = devPins(d2);
          const left = ps[0].x <= ps[1].x ? 0 : 1;
          return netsO.pinNet(d2, left) === netsO.pinNet(dd, ioIdx[i]) &&
            netsO.pinNet(d2, 1 - left) === netsO.pinNet(br, 0);
        });
      })(),
      drc: runDRC().filter(i => i.page === q.no).map(i => `${i.sev}:${i.rule || "?"}:${i.msg}`),
    };
    /* ④b-5 出力の枚に 3 線式センサを置く誤り。下地は引き分けず (入力の前提の
       まま引くと BN→0V / BU→+24V の短絡入りの下地を自分で描いてしまう)、
       検図が「検出器は入力の枚へ」と知らせること */
    {
      const spO2 = symOf(dd.sym).ioSheet;
      const r0 = spO2.rows.find(r => r.io);
      const q2 = q.devices.filter(d2 => d2.sym === "lamp");
      const lamp0 = q2[0];
      q.devices.splice(q.devices.indexOf(lamp0), 1);       // 1 行目を空けて
      const sens = addDevice(q, "prox", dd.x + spO2.gapX0, dd.y + r0.y, { tag: "-B70", rot: 270 });
      buildIoScaffold(q, dd);
      App.labelRev++;
      const drc3 = runDRC().filter(i => i.page === q.no);
      out.out3wire = {
        // 短絡入りの下地を自分で描いていないこと
        noShort: !drc3.some(i => /短絡/.test(i.msg)),
        // 置き場所の誤りをエラーで知らせること
        told: drc3.filter(i => i.rule === "3線式センサが出力の枚" && i.sev === "err").length,
      };
      q.devices.splice(q.devices.indexOf(sens), 1);
      addDevice(q, "lamp", dd.x + spO2.gapX0, dd.y + r0.y, { tag: lamp0.tag, rot: 270 });
      buildIoScaffold(q, dd);
      App.labelRev++;
    }
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④b-6 分割コモン (KV-N14AR・リレー出力)。取説の回路図どおり
     0V/24V, 500, C1, 501, C2, 502, C3, 503, 504, 505, C4 の並びで、
     「下地を作る」が 4 つのコモンを全部 0V レールへ結ぶこと */
  {
    const q = newPage("分割コモン", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    const s0 = symOf("kv_n14ar_out"), w1 = symSheetSpec(s0);
    q.paper = w1.paper; q.orient = w1.orient; q.scale = w1.scale; applySheet(q);
    const fr = frameRect();
    const dd = addDevice(q, "kv_n14ar_out", Math.ceil((fr.x - s0.bounds[0] + 5) / 5) * 5, fr.y + 10, { tag: "-A90" });
    buildIoScaffold(q, dd);
    App.labelRev++;
    const nets = computeNets(q, "closed");
    const outer = q.devices.find(d2 => d2.gen === dd.id && symOf(d2.sym).sim === "link" && d2.tag === "N24V");
    const comIdx = s0.pins.map((p2, k) => [p2, k]).filter(([p2]) => /^C\d+$/.test(p2.n));
    const rr2 = s0.ioSheet.rows;
    const fio = rr2.findIndex(r => r.io);
    out.splitCom = {
      order: s0.pins.map(p2 => p2.n).join(","),
      even: rr2.slice(fio + 1).every((r, i) => r.y - rr2[fio + i].y === s0.ioSheet.pitch),
      coms: comIdx.length,
      allOn0V: !!outer && comIdx.every(([, k]) => nets.pinNet(dd, k) === nets.pinNet(outer, 0)),
      drc: runDRC().filter(i => i.page === q.no).map(i => `${i.sev}:${i.msg}`) };
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④c 3 線式センサ (現場の主役)。配線は自分で引く方式なので、
     茶=P24V (コモン側レール) / 青=N24V (分岐レール) / 黒=入力端子 へ手で引く。
     茶を N24V へ引き間違えたら「3線式センサの電源が逆」のエラーで知らせること */
  {
    const q = newPage("3線センサ", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    const sym0 = symOf("kv_n14at_in"), w0 = symSheetSpec(sym0);
    q.paper = w0.paper; q.orient = w0.orient; q.scale = w0.scale; applySheet(q);
    const fr = frameRect();
    const dd = addDevice(q, "kv_n14at_in", fr.x + sym0.ioSheet.rail + 15, fr.y + 5, { tag: "-A8" });
    buildIoScaffold(q, dd);
    const sp4 = symOf(dd.sym).ioSheet;
    const supplyX = dd.x - sp4.rail, branchX = supplyX + sp4.sep;
    const r0 = sp4.rows.find(r => r.io), ry = dd.y + r0.y;
    const sens2 = addDevice(q, "prox", dd.x + sp4.gapX0, ry, { tag: "-B8", rot: 270 });
    const sp5 = devPins(sens2);
    const at0 = n => sp5.find(x => x.name === n);
    // まず引き間違い: 茶 (BN) を N24V (分岐レール) へ → エラーで知らせる
    const wrong = addWire(q, [[branchX, at0("BN").y], [at0("BN").x, at0("BN").y]]);
    App.labelRev++;
    const bad = runDRC().filter(i => i.target === sens2.id);
    q.wires.splice(q.wires.indexOf(wrong), 1);
    // 正しく引く: 茶→P24V / 青→N24V / 黒→端子
    addWire(q, [[supplyX, at0("BN").y], [at0("BN").x, at0("BN").y]]);
    addWire(q, [[branchX, at0("BU").y], [at0("BU").x, at0("BU").y]]);
    addWire(q, [[at0("BK").x, at0("BK").y], [dd.x, ry]]);
    App.labelRev++;
    const nets2 = computeNets(q, "closed");
    const at = n => sp5.findIndex(x => x.name === n);
    const linkAt = x => q.devices.find(d2 => d2.gen === dd.id && symOf(d2.sym).sim === "link" &&
      Math.abs(d2.x - x) < 0.01);
    /* 3 線式の直流検出器は NPN (シンク) 形で描かれていること。開閉要素が
       「+V と 出力」の間 (PNP・ソース形) だと、プラスコモンの入力につないでも
       永久に ON しない図になる。記号・型式・結線が食い違ってはいけない */
    out.npn = ["prox", "photo", "press_sw"].map(id => {
      const s3 = symOf(id);
      const pr = conductivePairs({ id: "x", sym: id, x: 0, y: 0, props: {} }, "closed");
      const nm = i => (s3.pins[i] || {}).n || "";
      return { id, pins: (pr[0] || []).map(nm).sort().join("-"),
        // 開閉要素が 0V 側の端子を含むこと (BU / N24V)
        sinks: (pr[0] || []).some(i => /^(BU|N24V)$/.test(nm(i))) };
    });
    out.sensor3 = {
      // 押す前: 茶が 0V 側という誤りをエラーで知らせる
      beforeSev: bad.map(i => i.sev).join(","),
      beforeRule: bad.map(i => i.rule || "?").join(","),

      drc: runDRC().filter(i => i.page === q.no && i.target === sens2.id).map(i => i.msg),
      // 茶が +24V レール、青が 0V レール、黒が入力端子と同じネット
      bnOnSupply: nets2.pinNet(sens2, at("BN")) === nets2.pinNet(linkAt(supplyX), 0),
      buOnBranch: nets2.pinNet(sens2, at("BU")) === nets2.pinNet(linkAt(branchX), 0),
      bkOnTerminal: nets2.pinNet(sens2, at("BK")) === nets2.pinNet(dd, 0),
    };
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④d 1 台の PLC を複数枚に分けて描いても、同じタグでよく、部品表は 1 行 */
  {
    const q1 = newPage("1台2枚 その1", App.project.pages.length + 1);
    const q2 = newPage("1台2枚 その2", App.project.pages.length + 2);
    App.project.pages.push(q1, q2);
    [[q1, "kv_n40at_in1"], [q2, "kv_n40at_in2"]].forEach(([q, id]) => {
      const w2 = symSheetSpec(symOf(id));
      q.paper = w2.paper; q.orient = w2.orient; q.scale = w2.scale;
      App.pageIdx = App.project.pages.indexOf(q); applySheet(q);
      addDevice(q, id, frameRect().x + symOf(id).ioSheet.rail + 15, frameRect().y + 5, { tag: "-A100" });
    });
    App.labelRev++;
    out.unit = {
      dupTag: runDRC().filter(i => /タグ .* が重複/.test(i.msg)).length,
      // -A100 の 2 枚が 1 行にまとまるか (別タグの機器は別行で当たり前なので除く)
      bomRows: buildBOM().filter(r => /KV-N40AT/.test(r.typeRef) &&
        (r.tags || []).includes("-A100")).length,
      bomTags: (buildBOM().find(r => /KV-N40AT/.test(r.typeRef) &&
        (r.tags || []).includes("-A100")) || {}).tags,
      allRows: buildBOM().filter(r => /KV-N40AT/.test(r.typeRef)).map(r => (r.tags || []).join("+")),
    };
    App.project.pages.splice(App.project.pages.indexOf(q1), 1);
    App.project.pages.splice(App.project.pages.indexOf(q2), 1);
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  // ⑤ 機能欄 (行ごとの文言) が画面と DXF に出る
  t.d.props = { fn: { "000": "操作電源 入", "001": "タンク1本選択", "003": "No1タンク選択" } };
  App.labelRev++;
  const rt = deviceRowTexts(t.pg, t.d);
  const svg = devLabelsSVG(t.d, t.sym, t.pg);
  const dxf1 = pageToDXF(t.pg);
  out.fn = { count: rt.length, first: rt[0] && rt[0].text,
    // 下線 (行の y + 1.5) の上に載っているか
    onLine: rt.every(o => { const y0 = t.d.y + t.sym.pins[o.row].y; return o.y <= y0 + 1.5 && o.y > y0 - 4; }),
    svg: /操作電源 入/.test(svg), dxf: /\\U\+64CD/.test(dxf1) || /操作電源/.test(dxf1),
    skipsEmpty: !rt.some(o => o.name === "002"),
    // 端子名で持つので、機種を差し替えても文言がずれない
    byName: rt.every(o => ({ "000": "操作電源 入", "001": "タンク1本選択", "003": "No1タンク選択" })[o.name] === o.text) };

  /* ⑤b 機能欄の文言も「紙に出る文字」なので、長すぎて図枠の外へ出たり
         表題欄に乗ったりしたら検図で必ず出ること (下線の長さだけの問題ではない) */
  {
    const long = "あ".repeat(140);
    const before = runDRC().filter(i => i.target === t.d.id && /機能欄/.test(i.msg)).length;
    t.d.props = { fn: { "000": long } };
    App.labelRev++;
    const after = runDRC().filter(i => i.target === t.d.id && /機能欄/.test(i.msg));
    out.fnDrc = { before, out: after.some(i => /図枠/.test(i.msg)),
      over: (deviceRowTexts(t.pg, t.d)[0] || {}).over === true };
    t.d.props = { fn: { "000": "操作電源 入", "001": "タンク1本選択", "003": "No1タンク選択" } };
    App.labelRev++;
  }

  // ⑥ 部品表・DXF の端子番号
  out.bom = buildBOM().filter(r => /KV-N/.test(r.typeRef)).length;
  const i2 = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n40at_in2"));
  if (i2 < 0) { out.dxf = { r107: false, com: false }; return out; }
  App.pageIdx = i2;
  applySheet(curPage());
  const dxf = pageToDXF(curPage());
  out.dxf = { r107: /\n1\n107\n/.test(dxf), com: /\n1\nC0\n/.test(dxf) };
  return out;
});
console.log(JSON.stringify(R, null, 1));
/* 機種の差し替え。同じ群 (入力どうし・出力どうし) の機種に置き換えられること */
const U = await p.evaluate(() => {
  const f = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n24at_in"));
  if (f < 0) return { hasSwap: false, tag: "", options: "", hasScaffoldBtn: false, hasFnBox: false };
  App.pageIdx = f; applySheet(curPage());
  const dev = curPage().devices.find(d => d.sym === "kv_n24at_in");
  App.selection.clear(); App.selection.add(dev.id);
  UI.showProps();
  const sel = document.querySelector("#pSwap");
  return { hasSwap: !!sel, tag: dev.tag,
    options: sel ? [...sel.options].map(o => o.value).sort().join(",") : "",
    hasScaffoldBtn: !!document.querySelector("#pScaffold"),
    hasStdNoteBtn: !!document.querySelector("#pStdNote"),
    hasFnBox: !!document.querySelector("#pFn") };
});
const hasSwap = await p.waitForSelector("#pSwap", { timeout: 4000 }).then(() => true).catch(() => false);
const canPick = hasSwap && await p.$eval("#pSwap", el => [...el.options].some(o => o.value === "kv_n40at_in1"));
if (canPick) { await p.selectOption("#pSwap", "kv_n40at_in1"); await p.waitForTimeout(300); }
/* 差し替え先の用紙が違うときは検図で必ず知らせ、「この用紙にする」で直せること。
   14点 (A3横) → 16点 (A2横) のように、機種を変えると要る紙が変わる */
const U2a = await p.evaluate(() => {
  const dev = (curPage() || { devices: [] }).devices.find(d => /^kv_/.test(d.sym));
  if (!dev) return { swapped: "", keptTag: false, pins: 0, sheetErr: 0 };
  App.labelRev++;
  /* 想定と違う用紙に置いたら検図に出ること。全枚 A3 横にそろえたので
     差し替えでは用紙が変わらない — わざと A4 縦にして確かめる */
  const pg = curPage();
  pg.paper = "A4"; pg.orient = "portrait"; applySheet(pg);
  App.labelRev++;
  UI.showProps();          // 用紙を変えたあとのプロパティ (「この用紙にする」が出る)
  return { swapped: dev.sym, keptTag: dev.tag === "-A3",
    pins: symOf(dev.sym).pins.length,
    wantPaper: (symSheetSpec(symOf(dev.sym)) || {}).paper,
    pagePaper: pg.paper,
    sheetErr: runDRC().filter(i => i.rule === "記号の想定用紙と違う" && i.target === dev.id).length };
});
const hasFix = await p.waitForSelector("#pSheetFix", { timeout: 4000 }).then(() => true).catch(() => false);
if (hasFix) { await p.click("#pSheetFix"); await p.waitForTimeout(300); }
/* 差し替えたあと、下地が壊れていないこと (旧い行の高さに導体が残ると、
   コモンの線が宙に浮いて枠の中を横切る) */
const U2b = await p.evaluate(() => {
  const dev = (curPage() || { devices: [] }).devices.find(d => /^kv_/.test(d.sym));
  if (!dev) return { swapDrc: ["機器がありません"] };
  App.labelRev++;
  return { swapDrc: runDRC().filter(i => i.page === curPage().no &&
    /貫通|宙吊り|どこにも接続|未接続/.test(i.msg)).map(i => `${i.sev}:${i.msg}`) };
});
const U2 = { ...U2a, hasFix, ...U2b, ...await p.evaluate(() => {
  const dev = (curPage() || { devices: [] }).devices.find(d => /^kv_/.test(d.sym));
  if (!dev) return { fixedPaper: "", sheetErrAfter: -1, frameErrAfter: -1 };
  App.labelRev++;
  return { fixedPaper: curPage().paper + "/" + curPage().orient + "/" + curPage().scale,
    sheetErrAfter: runDRC().filter(i => i.rule === "記号の想定用紙と違う" && i.target === dev.id).length,
    frameErrAfter: runDRC().filter(i => i.target === dev.id && /図枠|表題欄|改訂履歴欄/.test(i.msg)).length };
}) };
console.log("機種の差し替え:", JSON.stringify({ ...U, ...U2 }, null, 1));

/* 出力の枚の UI 経路。入力でだけ試して出力で壊れていた前科があるので、
   機種差し替え (#pSwap) と行ピッチ (#pSpanMM) を出力の枚でも通す */
const V1 = await p.evaluate(() => {
  const q = newPage("出力UI", App.project.pages.length + 1);
  App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
  const s0 = symOf("kv_n14at_out"), w1 = symSheetSpec(s0);
  q.paper = w1.paper; q.orient = w1.orient; q.scale = w1.scale; applySheet(q);
  const fr = frameRect();
  const dd = addDevice(q, "kv_n14at_out", Math.ceil((fr.x - s0.bounds[0] + 5) / 5) * 5, fr.y + 10, { tag: "-A80" });
  buildIoScaffold(q, dd);
  const sp = s0.ioSheet;
  /* 配線は自分で引く方式: 行ごとに 端子 → 負荷 → 分岐レール (P24V) を引く */
  const bxV = dd.x + sp.rail - sp.sep;
  sp.rows.filter(r => r.io).forEach((r, i) => {
    const d2 = addDevice(q, "lamp", dd.x + sp.gapX0, dd.y + r.y, { tag: `-P8${i}`, rot: 270 });
    const ps = devPins(d2);
    const L = ps[0].x <= ps[1].x ? ps[0] : ps[1], R2 = ps[0].x <= ps[1].x ? ps[1] : ps[0];
    addWire(q, [[dd.x, dd.y + r.y], [L.x, L.y]]);
    addWire(q, [[R2.x, R2.y], [bxV, dd.y + r.y]]);
  });
  App.selection.clear(); App.selection.add(dd.id);
  UI.showProps(); App.labelRev++;
  return { drc0: runDRC().filter(i => i.page === q.no).length };
});
// 機種差し替え: 6 点 → 8 点 (行ピッチは同じなので既存 6 行はそのまま合う)
await p.selectOption("#pSwap", "kv_n40at_out").catch(() => {});
await p.waitForTimeout(250);
const V2 = await p.evaluate(() => {
  const q = curPage();
  const dd = q.devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  return { swapped: dd.sym,
    drc: runDRC().filter(i => i.page === q.no && /貫通|宙吊り|どこにも接続|短絡|ピン COM/.test(i.msg)).map(i => i.sev + ":" + i.msg) };
});
// 行ピッチを 30 に (UI の入力欄経由) → 負荷が新しい行へ運ばれること
await p.$eval("#pSpanMM", el => { el.value = "30"; el.dispatchEvent(new Event("change", { bubbles: true })); }).catch(() => {});
await p.waitForTimeout(250);
const V3 = await p.evaluate(() => {
  const q = curPage();
  const dd = q.devices.find(d => /^kv_/.test(d.sym));
  const w2 = symSheetSpec(symOf(dd.sym));
  q.paper = w2.paper; q.orient = w2.orient; q.scale = w2.scale; applySheet(q);
  App.labelRev++;
  const sp = symOf(dd.sym).ioSheet;
  const rows = sp.rows.filter(r => r.io);
  const nets = computeNets(q, "closed");
  const lamps = q.devices.filter(d2 => d2.sym === "lamp");
  const r = { pitch: sp.pitch,
    onRows: lamps.every((d2, i) => Math.abs(d2.y - (dd.y + rows[i].y)) < 0.01),
    wired: lamps.every((d2, i) => {
      const ioIdx = symOf(dd.sym).pins.map((p2, k) => [p2, k])
        .filter(([p2]) => /^\d+$/.test(p2.n)).map(([, k]) => k);
      return nets.pinNet(d2, 0) === nets.pinNet(dd, ioIdx[i]);
    }),
    drc: runDRC().filter(i => i.page === q.no).map(i => i.sev + ":" + i.msg) };
  App.project.pages.pop(); App.pageIdx = 0; applySheet(curPage());
  return r;
});
console.log("出力の枚のUI経路:", JSON.stringify({ ...V1, ...V2, ...V3 }, null, 1));

/* パレットから置いた瞬間に P24V/N24V のレールと下地が引かれること (事前レール)。
   「下地を作る」を押さなくても、置けばもうレールがある */
const W1 = await p.evaluate(() => {
  const q = newPage("事前レール", App.project.pages.length + 1);
  App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
  const s0 = symOf("kv_n40at_in1"), w1 = symSheetSpec(s0);
  q.paper = w1.paper; q.orient = w1.orient; q.scale = w1.scale; applySheet(q);
  const fr = frameRect();
  Editor.ghost = { symId: "kv_n40at_in1", x: Math.ceil((fr.x + s0.ioSheet.rail + 15) / 5) * 5, y: fr.y + 10, rot: 0 };
  placeGhost();
  Editor.ghost = null;
  const dd = q.devices.find(d => /^kv_/.test(d.sym));
  const gen = q.wires.filter(w => w.gen === dd.id);
  const tags = [...new Set(q.devices.filter(d => d.gen === dd.id && symOf(d.sym).sim === "link")
    .map(d => d.tag))].sort();
  App.labelRev++;
  /* 引かれるのはレール 2 本とコモンの結線だけ。行ごとのスタブ (端子から
     出る宙に浮いた配線) は無い — 配線は自分で引く */
  const ioYs = new Set(s0.ioSheet.rows.filter(r2 => r2.io).map(r2 => dd.y + r2.y));
  const stubs = gen.filter(w => w.pts.every(pt2 => Math.abs(pt2[1] - w.pts[0][1]) < 0.01) &&
    ioYs.has(w.pts[0][1])).length;
  const r = { railsDrawn: gen.length, stubs, tags: tags.join(","),
    drc: runDRC().filter(i => i.page === q.no).length,
    // A3 縦をびっしり使っているか (16 点 + C0 の行の広がり)
    rowSpan: s0.ioSheet.rows[s0.ioSheet.rows.length - 1].y - s0.ioSheet.rows[0].y,
    fnRoom: s0.ioSheet.fnRoom };
  App.project.pages.pop(); App.pageIdx = 0; applySheet(curPage());
  return r;
});
console.log("事前レール:", JSON.stringify(W1));

const ids = Object.keys(R.spec);
const checks = {
  // 想定の枚 (id) がすべてあること
  symbolsExist: Array.isArray(R.missingIds) && R.missingIds.length === 0 && ids.length === 9,
  // 群ごとの点数・端子番号 (16 点で次のチャネルへ繰り上がる)
  groups: ids.every(id => R.group[id] && R.group[id].io !== undefined && R.group[id].io === R.spec[id].io &&
    R.group[id].first === R.spec[id].first && R.group[id].last === R.spec[id].last &&
    R.group[id].aux === R.spec[id].aux),
  // 16 点で次のチャネルへ繰り上がる (枚の切れ目はチャネルをまたがない)
  relayCarry: (R.group.kv_n40at_in1 || {}).last === "015" && (R.group.kv_n40at_in2 || {}).first === "100" &&
    (R.group.kv_n40at_out || {}).last === "515",
  // 1 枚 = 1 チャネル (16 点まで)
  perSheet16: ids.every(id => (R.group[id] || {}).io <= 16),
  // 用紙は 1:1。図枠に収まり表題欄を避け、レールの左に余白が残る
  sheetChoice: ids.every(id => (R.group[id] || {}).sheet && R.group[id].sheet.paper === R.spec[id].paper &&
    R.group[id].sheet.orient === R.spec[id].orient && R.group[id].sheet.scale === R.spec[id].scale),
  fitsSheet: ids.every(id => (R.sheet[id] || {}).inFrame && !R.sheet[id].onBlock && R.sheet[id].railRoom >= 0),
  // 見出しの 2 行が箱に収まり、上辺・行間・罫線と 1mm 以上あくこと
  header: ids.every(id => { const h = (R.group[id] || {}).header || {};
    return h.n === 2 && h.inBox === true && h.fromTop >= 1 && h.between >= 1 && h.toRule >= 1; }),
  /* 行ピッチを 15mm にすれば 16 点でも A3 横 1:1 に収まる (用紙の希望どおり)。
     既定 20mm では A2 横まで大きくなる — 現場機器がぶつからない距離を優先している */
  /* 既定ピッチ (20mm) でどの枚も A3 (16 点の機種は縦・小さい機種は横)。
     どのピッチでも「同じ機種の枚どうしは同じ用紙」であること —
     枚ごとに用紙を決めると、ピッチを広げたとき 1 台の図面集に横と縦が混ざる */
  pitchPaper: ((R.pitchPaper || {})[20] || "").split(",").every(v => /^A3[横縦] 1:1$/.test(v)) &&
    Object.values(R.pitchPaperByModel || {}).every(m => Object.values(m).every(v => v.length === 1)),
  // 横に倒した現場機器が隣の行とぶつからない (既定ピッチ)。
  // 背の高い記号は既定では当たるが、ピッチを広げれば収まる
  /* 単極の入出力機器は既定ピッチ (20mm) で隣の行とぶつからない。
     多極 (非常停止 2NC) と横に長い記号 (光電センサ) は既定では当たるが、
     30mm へ広げれば収まる — 記号の id を間違えて黙って検査から落ちないよう、
     見つからない id があればここで落ちる */
  noClash: ((R.pitch || {}).missing || ["?"]).length === 0 &&
    Object.entries((R.pitch || {}).clash || {})
      .every(([id, v]) => (R.pitch.wideOnly || []).includes(id) ? v > 0 : v === 0) &&
    Object.keys((R.pitch || {}).clash || {}).length >= 9 &&
    Object.values((R.pitch || {}).wideClash || {}).every(v => v === 0) &&
    Object.keys((R.pitch || {}).wideClash || {}).length === 2 &&
    R.pitch.tallAtDef > 0 && R.pitch.tallAtWide === 0 && R.pitch.wide === 30,
  // 紙の上の見え方が群によらず同じ
  printedSame: ids.every(id => (R.print[id] || {}).pitch === 20 && R.print[id].minText >= 2.5 - 0.001 &&
    R.print[id].minLine >= 0.25 - 0.001),
  // 未使用の入出力点は黙る。電源・コモン・保護接地は知らせる
  /* 未使用の入出力点は黙るが、コモンの結び忘れは知らせる。
     電源と接地はこの図に無い (別紙) ので、ここには出てこない */
  /* 未使用の入出力点とサービス電源 (0V/24V) は黙るが、コモンの結び忘れは
     知らせる。分割コモン (C1〜C4) も 1 つずつ */
  pinLevelDrc: ids.every(id => (R.group[id] || {}).ioSkipped) && R.unconnected.names === "C0,C1,C2,C3,C4,COM" &&
    R.unconnected.otherSev === "warn" && R.unconnected.peSev === "" &&
    // 電源端子・接地端子が 1 つも無いこと
    ids.every(id => !/[LN]|PE/.test((R.group[id] || {}).aux || "")),
  peEarth: ids.every(id => (R.group[id] || {}).peEarth),
  // 端子名は記号の中。画面で自動ラベルが 1 つも出ないこと
  termInBody: ids.every(id => (R.group[id] || {}).termInBody) && R.termLabels === 0,
  // 機能欄の下線が行数ぶんある
  fnRuling: ids.every(id => (R.group[id] || {}).fnLines === (R.group[id] || {}).fnRows),
  /* 3 線式センサは NPN (シンク) 形 — 開閉要素は「出力と 0V」の間 */
  npnSensors: Array.isArray(R.npn) && R.npn.length === 3 && R.npn.every(o => o.sinks === true) &&
    R.npn.map(o => o.pins).join(",") === "BK-BU,BK-BU,N24V-OUT",
  /* パレットから置いた瞬間にレールが引かれる。タグは P24V/N24V (スクショの呼び方)。
     16 点 + C0 の行の広がりは 320mm — A3 縦 (作図領域 400) をびっしり使う。
     機能欄の下線は 50mm (長すぎたので半分にした) */
  preRails: W1.railsDrawn === 3 && W1.stubs === 0 && W1.tags === "N24V,P24V" && W1.drc === 0 &&
    W1.rowSpan >= 320 && W1.fnRoom === 49,
  /* 出力の A3 縦置きは横幅をぎりぎりまで使う — 現場側 (レールまでの距離) を
     160mm へ広げる (箱 36 + 現場 160 + コメント欄 62 ≈ 作図領域 267)。
     A3 横の出力 (8 点以下の機種) は従来の 80mm のまま */
  fillWidth: (R.group.kv_n40at_out || {}).rail >= 155 && (R.group.kv_n24at_out || {}).rail >= 155 &&
    (R.group.kv_n14at_out || {}).rail === 80 && (R.group.kv_n40at_in1 || {}).rail === 80,
  /* 分割コモン (KV-N14AR): 取説どおりの並びで、コモン 4 つが全部 0V レールへ結ばれる */
  splitCom: (R.splitCom || {}).order === "0V,24V,500,C1,501,C2,502,C3,503,504,505,C4" &&
    R.splitCom.coms === 4 && R.splitCom.allOn0V === true &&
    // 信号行とコモン行のピッチがそろっている (サービス電源より下は全部 20mm)
    R.splitCom.even === true &&
    Array.isArray(R.splitCom.drc) && R.splitCom.drc.length === 0,
  /* 実機のユニットに合わせた鏡像: 入力は現場側が左 (箱は端子の右 = boxX > 0、
     名称欄は箱の右 = fnTextX < rail)。出力は箱が左 (boxX < 0)、
     名称欄はレールのさらに右 (fnTextX > rail) */
  mirror: ids.every(id => {
    const L = (R.group[id] || {}).layout || {};
    return /_out/.test(id)
      ? L.side === "right" && L.boxX < 0 && L.fnTextX > (R.group[id] || {}).rail
      : L.side === "left" && L.boxX > 0 && L.fnTextX < (R.group[id] || {}).rail;
  }),
  // 出力の枚でも UI 経路 (機種差し替え・行ピッチ) が下地と負荷を壊さない
  outUi: V1.drc0 === 0 && V2.swapped === "kv_n40at_out" && V2.drc.length === 0 &&
    V3.pitch === 30 && V3.onRows === true && V3.wired === true && V3.drc.length === 0,
  // 出力の枚の 3 線式センサ: 短絡を描かず、置き場所の誤りをエラーで知らせる
  out3wire: (R.out3wire || {}).noShort === true && R.out3wire.told >= 1,
  // 出力の枚も、負荷を落として結線すれば検図 0 件
  outSheet: (R.outSheet || {}).loads === 6 && R.outSheet.wired === true &&
    Array.isArray(R.outSheet.drc) && R.outSheet.drc.length === 0,
  // 電位名は自分のレールに付く (相手のレールより必ず近い)
  railLabels: Array.isArray(R.railLabels) && R.railLabels.length >= 4 &&
    R.railLabels.every(o => !o.noLabel && o.toOwn < o.toOther - 5 && o.onGlyph === false),
  // 下地を引いただけ (未使用の行だらけ) でも検図は 0 件
  emptyDrc: Array.isArray(R.emptyDrc) && R.emptyDrc.length === 0,
  // 図記号どうしの重なりと、図記号を貫く導体を検図が見る
  symOverlap: R.symOverlap > 0,
  pierce: R.pierce > 0,
  // 下地は本物の導体。二度押しても増えない。機器を置けば検図 0 件で回路も通る
  // 下地は引き直せる (二度押しで同じ本数・増えない) / レールは 2 本 + 電位リンク
  scaffold: (R.scaffold || {}).wires > 0 && R.scaffold.same === true &&
    R.scaffold.total === R.scaffold.wires && R.scaffold.hasLink === true,
  wiredClean: (R.wired || []).length === 0 && !!R.wired,
  // コモンは下地が外側のレール (入力なら +24V) へ自動で結ぶ
  comAuto: (R.comAuto || {}).linked === true && R.comAuto.tag === "P24V",
  electrical: R.electrical === true,
  // 機能欄の文言は画面と DXF に出て、下線の上に載る (空行は飛ばす)
  fnText: (R.fn || {}).count === 3 && R.fn.first === "操作電源 入" && R.fn.onLine === true &&
    R.fn.svg === true && R.fn.dxf === true && R.fn.skipsEmpty === true && R.fn.byName === true,
  // 改訂履歴欄 (表題欄の左隣) を入れても、どのピッチでも欄に乗らない
  withRevs: R.withRevs && Object.keys(R.withRevs).length === 5 &&
    Object.values(R.withRevs).every(v => Array.isArray(v) && v.length === 0),
  // 行ピッチを変えると、隙間の現場機器も新しい行へ運ばれ、つながったまま
  pitchMove: (R.pitchMove || {}).moved > 0 && R.pitchMove.onRows === true &&
    R.pitchMove.wired === true && R.pitchMove.drc.length === 0 &&
    R.pitchSheet === "A3/portrait",
  // 機器タグは見出しの左肩に固定 (現場側の区画へ降りない)
  tagPlace: (R.tagPlace || {}).has === true && R.tagPlace.aboveRows === true &&
    R.tagPlace.leftOfBox === true && R.tagPlace.clearOfDevices === true,
  // 機能欄の文言が紙からはみ出したら検図で出る (下線からのはみ出しも分かる)
  fnDrc: (R.fnDrc || {}).before === 0 && R.fnDrc.out === true && R.fnDrc.over === true,
  // 3 線式センサ (茶=+24V / 青=0V / 黒=入力) が結線できる
  sensor3: (R.sensor3 || {}).drc && R.sensor3.drc.length === 0 &&
    R.sensor3.bnOnSupply === true && R.sensor3.buOnBranch === true && R.sensor3.bkOnTerminal === true &&
    // 茶を N24V へ引き間違えたら「電源が逆」をエラーで知らせる (未接続の警告では足りない)
    /err/.test(R.sensor3.beforeSev || "") && /3線式センサの電源が逆/.test(R.sensor3.beforeRule || ""),
  // 1 台を複数枚に分けて描いてもタグ重複にならず、部品表は 1 行 1 台
  unitSheets: (R.unit || {}).dupTag === 0 && R.unit.bomRows === 1 &&
    (R.unit.bomTags || []).join(",") === "-A100",
  // 部品表・DXF
  bom: R.bom === 9,
  dxf: (R.dxf || {}).r107 === true && R.dxf.com === true,
  // プロパティ: 機種の差し替え・下地・機能欄の入口があること
  /* 規格外の図記号は図面上で説明する (JIS C 0617-1)。プロパティの説明文は
     紙にも DXF にも出ないので、注記として貼る入口があること */
  props: U.hasSwap === true && U.hasScaffoldBtn === true && U.hasFnBox === true &&
    U.hasStdNoteBtn === true &&
    U.options === "kv_n14ar_in,kv_n14at_in,kv_n24at_in,kv_n40at_in1,kv_n40at_in2",
  swapModel: hasSwap === true && canPick === true && U2.swapped === "kv_n40at_in1" && U2.keptTag === true &&
    U2.pins === 17 &&
    // 想定と違う用紙は検図に出て、「この用紙にする」で消える
    U2.sheetErr === 1 && U2.hasFix === true && U2.fixedPaper === "A3/portrait/1:1" &&
    U2.sheetErrAfter === 0 && U2.frameErrAfter === 0 &&
    // 差し替えで下地が壊れていない
    Array.isArray(U2.swapDrc) && U2.swapDrc.length === 0,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
