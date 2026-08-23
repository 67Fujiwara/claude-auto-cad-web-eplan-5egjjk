/* キーエンス KV Nano シリーズ (KV-N14AT / KV-N24AT / KV-N40AT) の入出力結線図。

   実務の結線図の形 — 左に現場側のレール、各行はそこから分岐して機器を通り、
   端子 (○ + リレー番号) からユニットの箱へ入る。箱の右は機能欄 (下線に文言)。

   ・用紙 1 枚 = 1 記号 = 1 群 (16 点まで)。16 点を超える入力は 2 枚に分ける。
     用紙は記号の大きさから選び、表題欄 (160×30) と改訂履歴欄 (120×30) を空ける。
     「A3 横で 16 点」は行ピッチ 15mm なら成り立つが、そのとき横に倒した機器どうしが
     接する。既定は「ぶつからない距離」を優先した 20mm で、16 点の群は A2 横になる。
   ・端子より左 (現場側) は実際の導体で描く。プロパティの「結線図の下地を作る」で
     レールと各行の分岐を引き、機器を落とす隙間を空ける。記号の中に線を描いて
     しまうと、見た目はつながっているのに検図もシミュレーションも通らない図になる。
   ・機能欄の文言は機器のプロパティに持つ (記号に焼き込まない)。画面・DXF で同じ。
   ・尺度は 1:1。縮小すると線番・注記・現場機器が用紙の上で半分になり、
     JIS Z 8313 の最小呼び 2.5mm を割る。

   判定
   ・群ごとの点数と端子番号が実機どおりで、16 点で次のチャネルへ繰り上がること
   ・想定の用紙 (すべて 1:1) の図枠に収まり、表題欄・改訂履歴欄に掛からないこと。
     行ピッチ 15mm ならすべて A3 横に収まること
   ・紙の上の寸法 (行ピッチ 20mm・文字 2.5mm・線 0.25mm) が群によらず同じこと
   ・見出し (形式・種別) が箱に収まり、上辺・行間・罫線と 1mm 以上あくこと。
     種別は和文なので JIS Z 8313-0 の和文最小 3.5mm で描かれる — 実寸で測る
   ・未使用の入出力点は警告しないが、電源・コモン・保護接地の結び忘れは知らせること。
     PE の未接続はエラーで、丸囲みの保護接地 02-15-03 が付くこと
   ・「下地を作る」が本物の導体を引き、隙間に機器を置いて COM をつなげば検図が 0 件に
     なること。二度押しても二重に引かないこと
   ・機能欄の文言が画面と DXF に出て下線の上に載り、長すぎれば検図に出ること
   ・プロパティで同じ群の機種に差し替えられ、用紙が変わる差し替えは検図に出てから
     「この用紙にする」で消えること
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
    kv_n14at_in: { io: 8, first: "R000", last: "R007", aux: "COM", paper: "A3", orient: "landscape" },
    kv_n14at_out: { io: 6, first: "R500", last: "R505", aux: "COM,L,N,PE", paper: "A3", orient: "landscape" },
    kv_n24at_in: { io: 14, first: "R000", last: "R013", aux: "COM", paper: "A3", orient: "portrait" },
    kv_n24at_out: { io: 10, first: "R500", last: "R509", aux: "COM,L,N,PE", paper: "A3", orient: "landscape" },
    kv_n40at_in1: { io: 16, first: "R000", last: "R015", aux: "COM", paper: "A2", orient: "landscape" },
    kv_n40at_in2: { io: 8, first: "R100", last: "R107", aux: "COM,L,N,PE", paper: "A3", orient: "landscape" },
    kv_n40at_out: { io: 16, first: "R500", last: "R515", aux: "COM", paper: "A2", orient: "landscape" },
  };
  out.spec = SPEC;

  // ① 群ごとの点数・端子番号・用紙
  Object.entries(SPEC).forEach(([id, sp]) => {
    const sym = symOf(id);
    if (!sym || !Array.isArray(sym.pins) || !sym.pins.every(q => q && q.n !== undefined)) {
      out.group[id] = "記号がありません"; return;
    }
    const io = sym.pins.filter(x => /^R/.test(x.n)), aux = sym.pins.filter(x => !/^R/.test(x.n));
    if (!io.length) { out.group[id] = "端子がありません"; return; }
    out.group[id] = {
      io: io.length, first: io[0].n, last: io[io.length - 1].n, aux: aux.map(x => x.n).join(","),
      sheet: symSheetSpec(sym), swap: sym.swapGroup, typ: sym.typ, fnRows: sym.fnRows,
      // 未使用の入出力点は黙る。電源・コモン・PE は黙らせない
      ioSkipped: io.every(x => x.noDrc === true) && aux.every(x => !x.noDrc),
      // PE は保護接地 02-15-03 (接地記号を円で囲む)。丸のない 02-15-01 では不可
      peEarth: !aux.some(x => x.n === "PE") ||
        (/<circle cx="-10" cy="[\d.]+" r="6"\/>/.test(sym.body) && /M-7.4,[\d.-]+ V/.test(sym.body)),
      // 機能欄の下線が行数ぶんある
      fnLines: (sym.body.match(/stroke-width="0\.25"/g) || []).length,
      rail: sym.ioSheet && sym.ioSheet.rail, gap: sym.ioSheet && sym.ioSheet.gap,
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
        return { n: 2, inBox: box.every(o => o.l >= 0.5 && o.r <= 30 - 0.5),
          fromTop: +box[0].top.toFixed(2),          // 箱の上辺からのあき
          between: +(box[1].top - box[0].bot).toFixed(2),
          toRule: +(rule - box[1].bot).toFixed(2) };
      })(),
    };
  });
  /* 行ピッチと用紙の対応。「A3 横に 16 点」はピッチ 15mm なら成り立つ
     (ただし横に倒した機器どうしは接する — だから既定は 20mm) */
  out.pitchPaper = {};
  [15, 20, 25, 30, 35].forEach(v => {
    out.pitchPaper[v] = Object.keys(SPEC).map(id => {
      const s2 = symOf(id + "@" + v), sh = s2 && s2.sheet;
      return sh ? sh.paper + (sh.orient === "landscape" ? "横" : "縦") + " " + sh.scale : "-";
    }).join(",");
  });

  // ② 用紙に収まるか / 紙の上の寸法
  App.project = newProject("KV Nano 入出力結線図");
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
    const d = addDevice(pg, id, fr.x + sym.ioSheet.rail + 15, fr.y + 5, { tag: `-A${i + 1}` });
    // 置き場所は 5mm 格子 (行の y が格子に乗るように)
    pages[id] = { pg, d, sym };
    const bd = devBounds(d), bb = devPartBoxes(d);
    out.sheet[id] = {
      inFrame: bd.x >= fr.x && bd.y >= fr.y && bd.x + bd.w <= fr.x + fr.w && bd.y + bd.h <= fr.y + fr.h,
      onBlock: bb.some(x => tb.some(r => x.x < r.x + r.w && x.x + x.w > r.x && x.y < r.y + r.h && x.y + x.h > r.y)),
      railRoom: Math.round(d.x - sym.ioSheet.rail - fr.x),      // レールの左に残る余白 (10mm 目安)
    };
    const rows = sym.pins.filter(x => /^R/.test(x.n));
    const m = pageDrawnMinima(pg);
    out.print[id] = { pitch: rows.length > 1 ? rows[1].y - rows[0].y : 15,
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
  out.scaffold = { wires: n1, again: n2, total: t.pg.wires.length, same: n1 === n2,
    // レールは導体で、電位リンクが付く
    hasLink: t.pg.devices.some(d => symOf(d.sym).sim === "link") };
  const sp = t.sym.ioSheet;
  sp.rows.filter(r => r.io).forEach(r => {
    addDevice(t.pg, "pb_no", t.d.x - sp.gapFrom, t.d.y + r.y, { tag: "", rot: 270 });
  });
  // COM を +24V の電位リンクへ
  const com = t.sym.pins.findIndex(q => q.n === "COM");
  const cp = devPins(t.d)[com];
  addWire(t.pg, [[cp.x - 25, cp.y], [cp.x, cp.y]]);
  addDevice(t.pg, "link", cp.x - 25, cp.y, { tag: "+24V" });
  App.labelRev++;
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
      addDevice(q, id, dd.x - sp2.gapFrom, dd.y + r.y, { tag: "", rot: 270 }));
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
    const kinds = ["pb_no", "estop", "float_sw", "limit_sw", "selector", "prox", "press_sw"]
      .filter(id => symOf(id) && ["input", "output"].includes(symOf(id).cat));
    out.pitch = { def: sp2.pitch, clash: {} };
    out.pitch.gap = {};
    kinds.forEach(id => { const ds = put(id); out.pitch.clash[id] = clash(ds); out.pitch.gap[id] = +gapOf(ds).toFixed(2); ds.forEach(d2 => q.devices.splice(q.devices.indexOf(d2), 1)); });
    // 背の高い記号 (光電センサ) は既定ピッチではぶつかるが、広げれば収まる
    const tall = put("photo");
    out.pitch.tallAtDef = clash(tall);
    tall.forEach(d2 => q.devices.splice(q.devices.indexOf(d2), 1));
    const base = symStretchBase(symOf(dd.sym));
    symStretchVariant(base, 30); dd.sym = `${base.id}@30`;
    App.labelRev++;
    const sp3 = symOf(dd.sym).ioSheet;
    const tall2 = sp3.rows.filter(r => r.io).slice(0, 3).map(r =>
      addDevice(q, "photo", dd.x - sp3.gapFrom, dd.y + r.y, { tag: "", rot: 270 }));
    out.pitch.tallAtWide = clash(tall2);
    out.pitch.wide = sp3.pitch;
    out.pitch.sheetGrew = JSON.stringify(symSheetSpec(symOf(dd.sym))) !== JSON.stringify(symSheetSpec(symOf("kv_n14at_in")));
    App.project.pages.pop();
    App.pageIdx = App.project.pages.indexOf(t.pg); applySheet(t.pg);
  }

  /* ④c 3 線式センサ (現場の主役) が結線できること。
     直列の隙間は 2 線のドライ接点用なので、センサは分岐を外して
     茶=+24V (電源レール) / 青=0V (分岐レール) / 黒=入力端子 とつなぐ */
  {
    const q = newPage("3線センサ", App.project.pages.length + 1);
    App.project.pages.push(q); App.pageIdx = App.project.pages.length - 1;
    const sym0 = symOf("kv_n14at_in"), w0 = symSheetSpec(sym0);
    q.paper = w0.paper; q.orient = w0.orient; q.scale = w0.scale; applySheet(q);
    const fr = frameRect();
    const dd = addDevice(q, "kv_n14at_in", fr.x + sym0.ioSheet.rail + 15, fr.y + 5, { tag: "-A8" });
    buildIoScaffold(q, dd);
    const sp4 = symOf(dd.sym).ioSheet;
    const supplyX = dd.x - sp4.rail, branchX = supplyX + 10;
    const r0 = sp4.rows.find(r => r.io), ry = dd.y + r0.y;
    // この行は分岐を外してセンサ 3 線に置き換える
    const stub = q.wires.find(w => w.gen === dd.id && Math.abs(w.pts[0][1] - ry) < .01 &&
      Math.abs(w.pts[0][0] - branchX) < .01);
    if (stub) q.wires.splice(q.wires.indexOf(stub), 1);
    const sens2 = addDevice(q, "prox", dd.x - sp4.gapFrom, ry, { tag: "-B8", rot: 270 });
    const sp5 = devPins(sens2);
    const at = (n) => sp5.find(x => x.name === n);
    addWire(q, [[at("BN").x, at("BN").y], [at("BN").x, ry - 12], [supplyX, ry - 12]]);   // 茶 → +24V
    addWire(q, [[at("BU").x, at("BU").y], [at("BU").x, ry + 8], [branchX, ry + 8]]);      // 青 → 0V
    addWire(q, [[at("BK").x, at("BK").y], [dd.x, ry]]);                                   // 黒 → 入力端子
    // コモンは +24V (シンク入力)
    const ci = symOf(dd.sym).pins.findIndex(x => x.n === "COM");
    const cp2 = devPins(dd)[ci];
    addWire(q, [[branchX, cp2.y], [cp2.x, cp2.y]]);
    App.labelRev++;
    const nets2 = computeNets(q, "closed");
    out.sensor3 = {
      drc: runDRC().filter(i => i.page === q.no && i.target === sens2.id).map(i => i.msg),
      // 茶が +24V レール、黒が入力端子と同じネットになっている
      bnOnSupply: nets2.pinNet(sens2, sp5.findIndex(x => x.name === "BN")) ===
        nets2.pinNet(q.devices.find(d2 => d2.gen === dd.id && Math.abs(d2.x - supplyX) < .01), 0),
      bkOnTerminal: nets2.pinNet(sens2, sp5.findIndex(x => x.name === "BK")) === nets2.pinNet(dd, 0),
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
  t.d.props = { fn: { R000: "操作電源 入", R001: "タンク1本選択", R003: "No1タンク選択" } };
  App.labelRev++;
  const rt = deviceRowTexts(t.pg, t.d);
  const svg = devLabelsSVG(t.d, t.sym, t.pg);
  const dxf1 = pageToDXF(t.pg);
  out.fn = { count: rt.length, first: rt[0] && rt[0].text,
    // 下線 (行の y + 1.5) の上に載っているか
    onLine: rt.every(o => { const y0 = t.d.y + t.sym.pins[o.row].y; return o.y <= y0 + 1.5 && o.y > y0 - 4; }),
    svg: /操作電源 入/.test(svg), dxf: /\\U\+64CD/.test(dxf1) || /操作電源/.test(dxf1),
    skipsEmpty: !rt.some(o => o.name === "R002"),
    // 端子名で持つので、機種を差し替えても文言がずれない
    byName: rt.every(o => ({ R000: "操作電源 入", R001: "タンク1本選択", R003: "No1タンク選択" })[o.name] === o.text) };

  /* ⑤b 機能欄の文言も「紙に出る文字」なので、長すぎて図枠の外へ出たり
         表題欄に乗ったりしたら検図で必ず出ること (下線の長さだけの問題ではない) */
  {
    const long = "あ".repeat(140);
    const before = runDRC().filter(i => i.target === t.d.id && /機能欄/.test(i.msg)).length;
    t.d.props = { fn: { R000: long } };
    App.labelRev++;
    const after = runDRC().filter(i => i.target === t.d.id && /機能欄/.test(i.msg));
    out.fnDrc = { before, out: after.some(i => /図枠/.test(i.msg)),
      over: (deviceRowTexts(t.pg, t.d)[0] || {}).over === true };
    t.d.props = { fn: { R000: "操作電源 入", R001: "タンク1本選択", R003: "No1タンク選択" } };
    App.labelRev++;
  }

  // ⑥ 部品表・DXF の端子番号
  out.bom = buildBOM().filter(r => /KV-N/.test(r.typeRef)).length;
  const i2 = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n40at_in2"));
  if (i2 < 0) { out.dxf = { r107: false, com: false }; return out; }
  App.pageIdx = i2;
  applySheet(curPage());
  const dxf = pageToDXF(curPage());
  out.dxf = { r107: /\n1\nR107\n/.test(dxf), com: /\n1\nCOM\n/.test(dxf) };
  return out;
});
console.log(JSON.stringify(R, null, 1));
/* 機種の差し替え。同じ群 (入力どうし・出力どうし) の機種に置き換えられること */
const U = await p.evaluate(() => {
  const f = App.project.pages.findIndex(pg => pg.devices.some(d => d.sym === "kv_n24at_in"));
  App.pageIdx = f; applySheet(curPage());
  const dev = curPage().devices.find(d => d.sym === "kv_n24at_in");
  App.selection.clear(); App.selection.add(dev.id);
  UI.showProps();
  const sel = document.querySelector("#pSwap");
  return { hasSwap: !!sel, tag: dev.tag,
    options: sel ? [...sel.options].map(o => o.value).sort().join(",") : "",
    hasScaffoldBtn: !!document.querySelector("#pScaffold"),
    hasFnBox: !!document.querySelector("#pFn") };
});
const hasSwap = await p.waitForSelector("#pSwap", { timeout: 4000 }).then(() => true).catch(() => false);
const canPick = hasSwap && await p.$eval("#pSwap", el => [...el.options].some(o => o.value === "kv_n40at_in1"));
if (canPick) { await p.selectOption("#pSwap", "kv_n40at_in1"); await p.waitForTimeout(300); }
/* 差し替え先の用紙が違うときは検図で必ず知らせ、「この用紙にする」で直せること。
   14点 (A3横) → 16点 (A2横) のように、機種を変えると要る紙が変わる */
const U2a = await p.evaluate(() => {
  const dev = curPage().devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  return { swapped: dev.sym, keptTag: dev.tag === "-A3",
    pins: symOf(dev.sym).pins.length,
    wantPaper: (symSheetSpec(symOf(dev.sym)) || {}).paper,
    pagePaper: curPage().paper,
    sheetErr: runDRC().filter(i => i.rule === "記号の想定用紙と違う" && i.target === dev.id).length };
});
const hasFix = await p.waitForSelector("#pSheetFix", { timeout: 4000 }).then(() => true).catch(() => false);
if (hasFix) { await p.click("#pSheetFix"); await p.waitForTimeout(300); }
const U2 = { ...U2a, hasFix, ...await p.evaluate(() => {
  const dev = curPage().devices.find(d => /^kv_/.test(d.sym));
  App.labelRev++;
  return { fixedPaper: curPage().paper + "/" + curPage().orient,
    sheetErrAfter: runDRC().filter(i => i.rule === "記号の想定用紙と違う" && i.target === dev.id).length,
    frameErrAfter: runDRC().filter(i => i.target === dev.id && /図枠|表題欄|改訂履歴欄/.test(i.msg)).length };
}) };
console.log("機種の差し替え:", JSON.stringify({ ...U, ...U2 }, null, 1));

const ids = Object.keys(R.spec);
const checks = {
  // 群ごとの点数・端子番号 (16 点で次のチャネルへ繰り上がる)
  groups: ids.every(id => R.group[id] && R.group[id].io !== undefined && R.group[id].io === R.spec[id].io &&
    R.group[id].first === R.spec[id].first && R.group[id].last === R.spec[id].last &&
    R.group[id].aux === R.spec[id].aux),
  relayCarry: (R.group.kv_n40at_in1 || {}).last === "R015" && (R.group.kv_n40at_in2 || {}).first === "R100" &&
    (R.group.kv_n40at_out || {}).last === "R515",
  // 1 群 16 点まで (A3 横で 16 点かけるための割付)
  perSheet16: ids.every(id => (R.group[id] || {}).io <= 16),
  // 用紙は 1:1。図枠に収まり表題欄を避け、レールの左に余白が残る
  sheetChoice: ids.every(id => (R.group[id] || {}).sheet && R.group[id].sheet.paper === R.spec[id].paper &&
    R.group[id].sheet.orient === R.spec[id].orient && R.group[id].sheet.scale === "1:1"),
  fitsSheet: ids.every(id => R.sheet[id].inFrame && !R.sheet[id].onBlock && R.sheet[id].railRoom >= 0),
  // 見出しの 2 行が箱に収まり、上辺・行間・罫線と 1mm 以上あくこと
  header: ids.every(id => { const h = (R.group[id] || {}).header || {};
    return h.n === 2 && h.inBox === true && h.fromTop >= 1 && h.between >= 1 && h.toRule >= 1; }),
  /* 行ピッチを 15mm にすれば 16 点でも A3 横 1:1 に収まる (用紙の希望どおり)。
     既定 20mm では A2 横まで大きくなる — 現場機器がぶつからない距離を優先している */
  pitchPaper: /^(A3横 1:1,){6}A3横 1:1$/.test((R.pitchPaper || {})[15] || "") &&
    /A2横 1:1/.test((R.pitchPaper || {})[20] || "") &&
    Object.values(R.pitchPaper || {}).every(v => !/A1|-/.test(v)),
  // 横に倒した現場機器が隣の行とぶつからない (既定ピッチ)。
  // 背の高い記号は既定では当たるが、ピッチを広げれば収まる
  noClash: Object.values((R.pitch || {}).clash || {}).every(v => v === 0) &&
    Object.keys((R.pitch || {}).clash || {}).length >= 6 &&
    R.pitch.tallAtDef > 0 && R.pitch.tallAtWide === 0 && R.pitch.wide === 30,
  // 紙の上の見え方が群によらず同じ
  printedSame: ids.every(id => (R.print[id] || {}).pitch === 20 && R.print[id].minText >= 2.5 - 0.001 &&
    R.print[id].minLine >= 0.25 - 0.001),
  // 未使用の入出力点は黙る。電源・コモン・保護接地は知らせる
  pinLevelDrc: ids.every(id => R.group[id].ioSkipped) && R.unconnected.names === "COM,L,N,PE" &&
    R.unconnected.peSev === "err" && R.unconnected.otherSev === "warn",
  peEarth: ids.every(id => R.group[id].peEarth),
  // 機能欄の下線が行数ぶんある
  fnRuling: ids.every(id => R.group[id].fnLines === R.group[id].fnRows),
  // 下地は本物の導体。二度押しても増えない。機器を置けば検図 0 件で回路も通る
  // 下地は引き直せる (二度押しで同じ本数・増えない) / レールは 2 本 + 電位リンク
  scaffold: (R.scaffold || {}).wires > 0 && R.scaffold.same === true &&
    R.scaffold.total === R.scaffold.wires && R.scaffold.hasLink === true,
  wiredClean: (R.wired || []).length === 0 && !!R.wired,
  electrical: R.electrical === true,
  // 機能欄の文言は画面と DXF に出て、下線の上に載る (空行は飛ばす)
  fnText: (R.fn || {}).count === 3 && R.fn.first === "操作電源 入" && R.fn.onLine === true &&
    R.fn.svg === true && R.fn.dxf === true && R.fn.skipsEmpty === true && R.fn.byName === true,
  // 機器タグは見出しの左肩に固定 (現場側の区画へ降りない)
  tagPlace: (R.tagPlace || {}).has === true && R.tagPlace.aboveRows === true &&
    R.tagPlace.leftOfBox === true && R.tagPlace.clearOfDevices === true,
  // 機能欄の文言が紙からはみ出したら検図で出る (下線からのはみ出しも分かる)
  fnDrc: (R.fnDrc || {}).before === 0 && R.fnDrc.out === true && R.fnDrc.over === true,
  // 3 線式センサ (茶=+24V / 青=0V / 黒=入力) が結線できる
  sensor3: (R.sensor3 || {}).drc && R.sensor3.drc.length === 0 &&
    R.sensor3.bnOnSupply === true && R.sensor3.bkOnTerminal === true,
  // 1 台を複数枚に分けて描いてもタグ重複にならず、部品表は 1 行 1 台
  unitSheets: (R.unit || {}).dupTag === 0 && R.unit.bomRows === 1 &&
    (R.unit.bomTags || []).join(",") === "-A100",
  // 部品表・DXF
  bom: R.bom === 7,
  dxf: (R.dxf || {}).r107 === true && R.dxf.com === true,
  // プロパティ: 機種の差し替え・下地・機能欄の入口があること
  props: U.hasSwap === true && U.hasScaffoldBtn === true && U.hasFnBox === true &&
    U.options === "kv_n14at_in,kv_n24at_in,kv_n40at_in1,kv_n40at_in2",
  swapModel: hasSwap === true && canPick === true && U2.swapped === "kv_n40at_in1" && U2.keptTag === true &&
    U2.pins === 17 &&
    // 用紙が変わる差し替えなので、いったん検図に出て、直すと消える
    U2.sheetErr === 1 && U2.hasFix === true && U2.fixedPaper === "A2/landscape" &&
    U2.sheetErrAfter === 0 && U2.frameErrAfter === 0,
};
const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log("CHECKS:", JSON.stringify(checks), fail.length ? "FAIL " + fail.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0, 3));
await b.close();
if (fail.length || errs.length) process.exit(1);
