/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — シンボルデータベース (JIS C 0617 / IEC 60617)
   使用頻度の低い規格記号を収蔵する。編集メニュー「シンボルデータベース…」
   から検索し、「パレットに追加」で左のライブラリ (データベース分類) に
   いつでも引き出せる。jis: 図記号番号
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const DB_DEFAULT_PINNED = [
  "cable_core", "shield", "plug_socket", "insul_end", "prot_earth", "func_earth",
  "elb2", "elb3", "inverter_box", "ps_box", "plc_box", "fan",
  "cp1", "cp2", "cont_no_main", "cont_nc_main",
  "conn_rj45", "conn_usb_a", "conn_hdmi",
];

/** 多極コネクタ (レセプタクル) を作る。
    ピンは左端 (列ごとに +colGap) に 5mm ピッチ。山形の開口は配線側を向く。
    sigs: 端子名の配列 / perCol: 1列あたりの極数 (超えたら右の列へ折り返す) */
function mkConn(o) {
  const pitch = 5, colGap = o.colGap || 26;
  const per = o.perCol || o.sigs.length;
  const rows = Math.min(per, o.sigs.length);
  const pins = [], parts = [];
  o.sigs.forEach((sig, i) => {
    const col = Math.floor(i / per), r = i % per;
    const x = col * colGap, y = r * pitch;
    pins.push({ x, y, n: sig });
    parts.push(`<path d="M${x},${y} H${x + 2.6}"/>`);                                   // 引出線
    parts.push(o.plug
      ? `<path d="M${x + 2.6},${y - 2.2} L${x + 5.2},${y} L${x + 2.6},${y + 2.2}"/>`     // プラグ (凸)
      : `<path d="M${x + 5.2},${y - 2.2} L${x + 2.6},${y} L${x + 5.2},${y + 2.2}"/>`);   // レセプタクル (凹)
    parts.push(`<text x="${x + 9.4}" y="${y + 0.9}" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${i + 1}</text>`);
  });
  const nCols = Math.ceil(o.sigs.length / per);
  const h = (rows - 1) * pitch + 8;
  for (let c = 0; c < nCols; c++) parts.push(`<rect x="${c * colGap + 2}" y="-4" width="12.8" height="${h}"/>`);
  const w = (nCols - 1) * colGap + 14.8;
  parts.push(`<text x="${w / 2}" y="-6" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${o.label}</text>`);
  // 外接矩形は他の記号と同じ作法で一様余白 2mm。ラベル幅は等幅 2.5mm の概算
  const tw = String(o.label).length * 2.05;
  const x0 = Math.min(0, w / 2 - tw / 2), x1 = Math.max(w, w / 2 + tw / 2);
  const y0 = -8.6, y1 = -4 + h;
  const r = v => Math.round(v * 10) / 10;
  return {
    id: o.id, db: true, group: "通信・コネクタ", cat: "db", letter: o.letter || "X",
    name: o.name, nameEn: o.nameEn, desc: o.desc, typ: o.typ || "",
    stdNote: o.stdNote || "接続器 (JIS C 0617-3)。極数と端子名は実機の仕様に合わせる",
    pins, sim: "none",
    bounds: [r(x0 - 2), r(y0 - 2), r(x1 - x0 + 4), r(y1 - y0 + 4)],
    body: parts.join(""),
  };
}

const DB_SYMBOLS = [

  /* ── 導体・接続部品 (JIS C 0617-3) ── */
  {
    id: "cable_core", db: true, group: "導体・接続", jis: "03-01-09", cat: "db", letter: "W",
    name: "多芯ケーブル (心線囲み)", nameEn: "Cable cores",
    desc: "並走する心線を長円で囲む。心線の本数はプロパティで変えられる (挿入点=1本目の心線・5mm ピッチ)。ケーブル種別は機能テキストに (例 CVV-1.25sq-4C)",
    pins: [], enclosure: 5, sim: "none",     // enclosure = 輪郭の半幅 (芯数の検図で、囲みを貫く心線を数えるのに使う)
    // n 本の心線 (5mm ピッチ) を上下 1 ピッチずつの余白で囲む → 長さ 5n+5mm。
    // 上端 -5 / 下端 5n はどちらも 5mm グリッド上に乗り、余白も上下対称になる。既定は 4芯
    stretch: {
      min: 15, max: 125, step: 5, def: 25, label: "心線の本数",
      bounds: (h) => [-7, -7, 14, h + 4],
      // 長円 (両端が半径5の半円・直線部が心線に沿う)。楕円だと遮へいとの間隔が
      // 肩で詰まるが、長円どうしなら全周で一定の 2mm を保てる
      body: (h) => `<path d="M-5,0 A5,5 0 0 1 5,0 L5,${h - 10} A5,5 0 0 1 -5,${h - 10} Z"/>`,
    },
  },
  {
    id: "shield", db: true, group: "導体・接続", jis: "03-01-07",
    stdNote: "心線囲み 03-01-09 の外側に全周 2mm の間隔で重ねて描ける",
    cat: "db", letter: "W",
    name: "シールド (遮へい)", nameEn: "Screen / shield",
    desc: "導体・心線群を囲む遮へい (破線)。ドレン線は片端 (通常は盤側) のみ FE へ接続する — 両端接地は循環電流の原因になる。心線の本数はプロパティで変えられる",
    // 心線囲み (rx=5 / y=-5〜5n) の外側へ全周 2mm 広げた長円。
    // ドレン線は心線の無い行 (最終心線の 1 ピッチ下) から右へ引き出す
    pins: [], enclosure: 7, sim: "none", noDrc: true,   // enclosure = 輪郭の半幅 (芯数の検図で、囲みを貫く心線を数えるのに使う)
    // ドレン線の未接続は「シールド未接地」で知らせるので、端子の未接続警告は出さない
    stretch: {
      min: 15, max: 125, step: 5, def: 25, label: "心線の本数",
      // ドレン線は囲みの下端よりさらに 1 ピッチ下へ引き出す。心線の行にも
      // 心線囲みの下端頂点にも重ならない位置で、かつ 5mm グリッド上
      pins: (h) => [{ x: 10, y: h, n: "S" }],
      bounds: (h) => [-9, -9, 21, h + 11],   // 下端はドレン線の引出し (y=h) まで
      // 心線囲みと同じ長円を半径 7 で描く。半円の中心が同じなので、
      // 直線部も端部も全周で一定の 2mm 間隔になる。
      // 破線は 6:1.5 (線素:すき間 = 4:1 を保ったまま、囲みの長さでも読める寸法)。
      // 太さは指定せず導体と同じ — 遮へい自体が導体だから
      body: (h) => {
        // 引出し口は下側の半円の 45° 位置。そこから 45° 方向へ出すと輪郭の
        // 法線 (中心から見た向き) と一致し、長円に「接する別の線」に見えない。
        // 7/√2 ≒ 4.95 なので、そのまま伸ばすと端点はちょうど (10, h) の格子点
        const q = +(7 / Math.SQRT2).toFixed(2);
        const xS = q, yS = +(h - 10 + q).toFixed(2);
        return `<path d="M-7,0 A7,7 0 0 1 7,0 L7,${h - 10} A7,7 0 0 1 -7,${h - 10} Z" stroke-dasharray="6 1.5" stroke-linecap="butt"/>` +
          `<path d="M${xS},${yS} L10,${h}"/>`;
      },
    },
  },
  {
    id: "twist_joint", db: true, group: "導体・接続", jis: "03-01-08", cat: "db", letter: "W",
    name: "撚り合わせ接続", nameEn: "Twisted connection", desc: "導体群の上に重ねて撚り合わせを表す",
    pins: [], sim: "none", bounds: [-12,-2, 24, 22],
    body: `<path d="M-8,18 L8,0 M8,0 L10,2 M-8,18 L-10,16"/>`,
  },
  {
    id: "insul_end", db: true, group: "導体・接続", jis: "03-01-15", cat: "db", letter: "W",
    name: "絶縁処理した端末", nameEn: "Insulated conductor end", desc: "特別な絶縁処理した未接続導体・ケーブル端",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-4.5,-2, 9, 24.5], noDrc: true,
    // JIS C 0617-3 03-01-15: 半円2つと直線で閉じた輪。導体はその頂点で終端する
    body: `<path d="M0,0 V5.5"/><path d="M-2.5,8 A2.5,2.5 0 0 1 2.5,8 V18 A2.5,2.5 0 0 1 -2.5,18 Z"/>`,
  },
  {
    id: "plug_socket", db: true, group: "導体・接続", jis: "03-03-05", cat: "db", letter: "X",
    name: "プラグおよびソケット (コネクタ)", nameEn: "Plug and socket / connector", desc: "着脱可能な接続。プラグ (オス)=塗り潰し、ソケット (メス)=半円", typ: "",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "passthru", bounds: [-5.5,-2, 11, 24],
    body: `<path d="M0,0 V5.5"/><path d="M-3.5,9 A3.5,3.5 0 0 1 3.5,9"/><path d="M0,20 V12.4"/><path d="M-2.8,12.4 L0,9.2 L2.8,12.4 Z" fill="currentColor"/>`,
  },

  /* ── 接地 (JIS C 0617-2 / IEC 60617 02-15 群) ── */
  {
    id: "prot_earth", db: true, group: "接地", jis: "02-15-03", cat: "db", letter: "E",
    name: "保護接地 (PE)", nameEn: "Protective earth", desc: "保護接地。接地記号を円で囲む",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-8,-2, 16, 20],
    body: `<path d="M0,0 V4"/><circle cx="0" cy="10" r="6"/><path d="M0,4 V7.4 M-3.6,7.4 H3.6 M-2.4,9.8 H2.4 M-1.2,12.2 H1.2"/>`,
  },
  {
    id: "func_earth", db: true, group: "接地", jis: "02-15-02", cat: "db", letter: "E",
    name: "機能接地 (FE)", nameEn: "Functional earth", desc: "雑音のない (機能) 接地。接地記号をひし形で囲む",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-9,-2, 18, 20],
    body: `<path d="M0,0 V4"/><path d="M0,4 L-7,10 L0,16 L7,10 Z"/><path d="M-3.6,8.5 H3.6 M-2.4,10.5 H2.4 M-1.2,12.5 H1.2 M0,6.5 V8.5"/>`,
  },
  {
    id: "chassis_earth", db: true, group: "接地", jis: "02-15-04", cat: "db", letter: "E",
    name: "フレーム接続 (FG・シャーシ)", nameEn: "Frame / chassis", desc: "機器フレーム・シャーシへの接続",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-10.5,-2, 18.5, 12.5],
    body: `<path d="M0,0 V5 M-6,5 H6 M-6,5 L-8.5,8.5 M-1.5,5 L-4,8.5 M3,5 L0.5,8.5 M6,5 L3.5,8.5"/>`,
  },

  /* ── 受動部品 (JIS C 0617-4) ── */
  {
    id: "resistor", db: true, group: "受動部品", jis: "04-01-01", cat: "db", letter: "R",
    name: "抵抗器", nameEn: "Resistor", desc: "固定抵抗器",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-4.5,-2, 9, 24],
    body: `<path d="M0,0 V5 M0,20 V15"/><rect x="-2.5" y="5" width="5" height="10"/>`,
  },
  {
    id: "var_resistor", db: true, group: "受動部品", jis: "04-01-02", cat: "db", letter: "R",
    name: "可変抵抗器", nameEn: "Variable resistor", desc: "斜め矢印つき抵抗器",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-7,-2, 14, 24],
    body: `<path d="M0,0 V5 M0,20 V15"/><rect x="-2.5" y="5" width="5" height="10"/><path d="M-5,16 L5,4 M5,4 L3.271,5.006 M5,4 L4.322,5.882"/>`,
  },
  {
    id: "capacitor", db: true, group: "受動部品", jis: "04-02-01", cat: "db", letter: "C",
    name: "コンデンサ", nameEn: "Capacitor", desc: "無極性コンデンサ",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-7,-2, 14, 24],
    body: `<path d="M0,0 V8.5 M0,20 V11.5 M-5,8.5 H5 M-5,11.5 H5"/>`,
  },
  {
    id: "cap_pol", db: true, group: "受動部品", jis: "04-02-02", cat: "db", letter: "C",
    name: "有極性コンデンサ", nameEn: "Polarized capacitor", desc: "電解コンデンサ。+側を明示",
    pins: [{x:0,y:0,n:"+"},{x:0,y:20,n:"-"}], sim: "none", bounds: [-7,-2, 16.6, 24],
    body: `<path d="M0,0 V8.5 M0,20 V13.5 M-5,8.5 H5"/><rect x="-5" y="11.3" width="10" height="2.2"/><path d="M4,3 H7.6 M5.8,1.2 V4.8"/>`,
  },
  {
    id: "inductor", db: true, group: "受動部品", jis: "04-03-01", cat: "db", letter: "L",
    name: "インダクタ (コイル)", nameEn: "Inductor", desc: "空心コイル",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "passthru", bounds: [-2,-2, 6.5, 24],
    body: `<path d="M0,0 V2.5"/><path d="M0,2.5 A2.5,2.5 0 0 1 0,7.5 A2.5,2.5 0 0 1 0,12.5 A2.5,2.5 0 0 1 0,17.5"/><path d="M0,17.5 V20"/>`,
  },
  {
    id: "inductor_core", db: true, group: "受動部品", jis: "04-03-02", cat: "db", letter: "L",
    name: "鉄心入りインダクタ", nameEn: "Iron-core inductor", desc: "リアクトル・チョークコイル",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "passthru", bounds: [-2,-2, 9, 24],
    body: `<path d="M0,0 V2.5"/><path d="M0,2.5 A2.5,2.5 0 0 1 0,7.5 A2.5,2.5 0 0 1 0,12.5 A2.5,2.5 0 0 1 0,17.5"/><path d="M0,17.5 V20"/><path d="M5,3 V17"/>`,
  },

  /* ── 半導体 (JIS C 0617-5) ── */
  {
    id: "diode", db: true, group: "半導体", jis: "05-03-01", cat: "db", letter: "V",
    name: "ダイオード", nameEn: "Diode", desc: "整流用ダイオード (上→下が順方向)",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 13, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/>`,
  },
  {
    id: "led", db: true, group: "半導体", jis: "05-03-02", cat: "db", letter: "V",
    name: "発光ダイオード (LED)", nameEn: "LED", desc: "ダイオード+光の矢印2本",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 19.5, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/><path d="M5,7 L9.5,4 M9.5,4 L7.557,4.473 M9.5,4 L8.316,5.612 M6.5,10.5 L11,7.5 M11,7.5 L9.057,7.973 M11,7.5 L9.816,9.112"/>`,
  },
  {
    id: "zener", db: true, group: "半導体", jis: "05-03-06", cat: "db", letter: "V",
    name: "定電圧ダイオード (ツェナー)", nameEn: "Zener diode", desc: "カソードバーに折り返し",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 13, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5 M4.5,14 V12"/>`,
  },
  {
    id: "thyristor", db: true, group: "半導体", jis: "05-04-04", cat: "db", letter: "V",
    name: "サイリスタ", nameEn: "Thyristor", desc: "逆阻止3端子サイリスタ",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"},{x:10,y:20,n:"G"}], sim: "none", bounds: [-6.5,-2, 18.5, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/><path d="M10,20 V16 L4.5,14"/>`,
  },
  {
    id: "tr_npn", db: true, group: "半導体", jis: "05-05-01", cat: "db", letter: "V",
    name: "トランジスタ (NPN)", nameEn: "NPN transistor", desc: "エミッタ矢印は外向き",
    pins: [{x:-10,y:10,n:"B"},{x:0,y:0,n:"C"},{x:0,y:20,n:"E"}], sim: "none", bounds: [-12,-2, 21.5, 24],
    body: `<circle cx="0" cy="10" r="7.5"/><path d="M-10,10 H-3 M-3,5.5 V14.5 M-3,8 L0,3 M0,3 V0 M-3,12 L0,17 M0,17 V20"/><path d="M0,17 L-0.38,15.037 L-1.553,15.74 Z" fill="currentColor"/>`,
  },

  /* ── 電源・変換 (JIS C 0617-6) ── */
  {
    id: "battery", db: true, group: "電源・変換", jis: "06-15-01", cat: "db", letter: "G",
    name: "電池", nameEn: "Battery", desc: "長線=+、短線=−",
    pins: [{x:0,y:0,n:"+"},{x:0,y:20,n:"-"}], sim: "none", bounds: [-8,-2, 17.5, 24],
    body: `<path d="M0,0 V8.5 M0,20 V12 M-6,8.5 H6 M-2.8,12 H2.8"/><path d="M4.5,3 H7.5 M6,1.5 V4.5"/>`,
  },
  {
    id: "autotrafo", db: true, group: "電源・変換", jis: "06-09-08", cat: "db", letter: "T",
    name: "単巻変圧器", nameEn: "Autotransformer", desc: "共通巻線+タップ",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:10,n:"3"}], sim: "trafo", bounds: [-2,-2, 14, 24],
    body: `<path d="M0,0 V2.5"/><path d="M0,2.5 A2.5,2.5 0 0 1 0,7.5 A2.5,2.5 0 0 1 0,12.5 A2.5,2.5 0 0 1 0,17.5"/><path d="M0,17.5 V20 M2.5,10 H10"/>`,
  },
  {
    id: "ct", db: true, group: "電源・変換", jis: "06-09-11", cat: "db", letter: "T",
    name: "変流器 (CT)", nameEn: "Current transformer", desc: "一次貫通導体+二次巻線円",
    pins: [{x:0,y:0,n:"P1"},{x:0,y:20,n:"P2"},{x:10,y:5,n:"S1"},{x:10,y:15,n:"S2"}], sim: "passthru", bounds: [-7.5,-2, 19.5, 24],
    body: `<path d="M0,0 V20"/><circle cx="0" cy="10" r="5.5"/><path d="M3.889,6.111 L10,5"/><path d="M3.889,13.889 L10,15"/>`,
  },
  {
    id: "rectifier", stdNote: "整流器 (合成記号)", db: true, group: "電源・変換", cat: "db", letter: "U",
    name: "整流器", nameEn: "Rectifier", desc: "箱+ダイオード記号 (AC→DC)",
    pins: [{x:-5,y:0,n:"~"},{x:5,y:0,n:"~"},{x:-5,y:30,n:"+"},{x:5,y:30,n:"-"}], sim: "none", horizontalPins: true, bounds: [-14,-2, 28, 34],
    body: `<path d="M-5,0 V5 M5,0 V5 M-5,30 V25 M5,25 V30"/><rect x="-12" y="5" width="24" height="20"/><path d="M12,5 L-12,25"/><text x="-7" y="12.5" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><path d="M4,20 H10"/><path d="M4,22.4 H10" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "inverter_box", nonstd: true, db: true, group: "電源・変換", cat: "db", letter: "U",
    name: "インバータ (INV)", nameEn: "Inverter / VFD", desc: "可変周波数駆動装置 R/S/T→U/V/W (一次側に PE。モータフレーム接地は別途)",
    typ: "FR-D720", horizontalPins: true,
    // PE は末尾に追加 (R/S/T/U/V/W の index と既存図面の配線座標を保持)。
    // 端子脇は保護接地 IEC 60617 02-15-03 (丸囲み)。対角線と干渉しないよう PE は R の左 (x=-15) に置く
    pins: [{x:-10,y:0,n:"R"},{x:0,y:0,n:"S"},{x:10,y:0,n:"T"},{x:-10,y:30,n:"U"},{x:0,y:30,n:"V"},{x:10,y:30,n:"W"},{x:-15,y:0,n:"PE"}],
    sim: "none", bounds: [-22,-2, 39, 34],
    body: `<path d="M-15,0 V5 M-10,0 V5 M0,0 V5 M10,0 V5 M-10,30 V25 M0,25 V30 M10,25 V30"/><rect x="-20" y="5" width="35" height="20"/><path d="M15,5 L-20,25"/><circle cx="-15" cy="8.8" r="3"/><path d="M-15,6.7 V8.7 M-16.6,8.7 H-13.4 M-16.05,9.8 H-13.95 M-15.5,10.9 H-14.5"/><text x="-6" y="13" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><text x="9" y="23" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><text x="3.5" y="20" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">INV</text>`,
  },
  {
    id: "ps_box", nonstd: true, db: true, group: "電源・変換", cat: "db", letter: "G",
    name: "電源装置 (PS)", nameEn: "Power supply unit", desc: "汎用電源ボックス (入力 L/PE/N)。出力電圧は機能テキストに",
    typ: "", horizontalPins: true,
    // PE は末尾 index=4 に追加 (sim "psu" が +V/-V を pinNet(dev,2)/(dev,3) で参照するため順序を保持)
    pins: [{x:-10,y:0,n:"L"},{x:10,y:0,n:"N"},{x:-10,y:30,n:"+V"},{x:10,y:30,n:"-V"},{x:0,y:0,n:"PE"}],
    sim: "psu", bounds: [-17,-2, 34, 34],
    // PE 端子脇は保護接地 IEC 60617 02-15-03 (IEC 60417-5019: 円囲みの接地記号)
    body: `<path d="M-10,0 V5 M0,0 V5 M10,0 V5 M-10,30 V25 M10,25 V30"/><rect x="-15" y="5" width="30" height="20"/><circle cx="0" cy="8.8" r="3"/><path d="M0,6.7 V8.7 M-1.6,8.7 H1.6 M-1.05,9.8 H1.05 M-0.5,10.9 H0.5"/><text x="0" y="17.5" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">PS</text>`,
  },

  /* ── 開閉・保護 (JIS C 0617-7) ── */
  {
    id: "elb2", jis: "07-13-08", db: true, group: "開閉・保護", cat: "db", letter: "F",
    name: "漏電遮断器 (ELB/ELCB) 2P", nameEn: "Earth-leakage breaker 2P", desc: "零相変流器つき遮断器 (単相用)", typ: "NV32-SV 2P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "breaker2", bounds: [-6.8,-2, 21.8, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g>` + gLink(bladeXNO(10.5), bladeXNO(10.5) + 10, 10.5) + `<path d="M5,19.8 A8,2.3 0 1 0 5,15.2 A8,2.3 0 1 0 5,19.8"/>`,
  },
  {
    id: "elb3", jis: "07-13-08", db: true, group: "開閉・保護", cat: "db", letter: "F",
    name: "漏電遮断器 (ELB/ELCB) 3P", nameEn: "Earth-leakage breaker 3P", desc: "零相変流器つき遮断器 (三相用)", typ: "NV63-CV 3P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "breaker3", bounds: [-6.8,-2, 31.8, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(20,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g>` + gLink(bladeXNO(10.5), bladeXNO(10.5) + 20, 10.5) + `<path d="M10,19.8 A13,2.3 0 1 0 10,15.2 A13,2.3 0 1 0 10,19.8"/>`,
  },
  {
    id: "disconnector", db: true, group: "開閉・保護", jis: "07-13-06", cat: "db", letter: "Q",
    name: "断路器", nameEn: "Disconnector", desc: "無負荷開閉用",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "breaker", bounds: [-6.8,-2, 11.8, 24],
    body: `<path d="M0,0 V7 M-3,7 H3 M0,20 V13 M0,13 L-4.8,5"/>`,
  },
  {
    id: "changeover", db: true, group: "開閉・保護", jis: "07-02-04", cat: "db", letter: "S",
    name: "切替接点 (c接点)", nameEn: "Changeover contact", desc: "1回路2接点。不動作時はNC側に接触 (共通は下)",
    pins: [{x:0,y:0,n:"NC"},{x:10,y:0,n:"NO"},{x:5,y:20,n:"COM"}], sim: "none", bounds: [-3.5,-2, 17, 24],
    body: `<path d="M0,0 V7 M-1.5,7 H3 M10,0 V7 M7,7 H11.5 M5,20 V13 M5,13 L1.5,7"/>`,
  },
  {
    id: "arrester", jis: "05-04-01", db: true, group: "開閉・保護", cat: "db", letter: "F",
    name: "避雷器 (アレスタ)", nameEn: "Surge arrester", desc: "サージ保護デバイス",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-5.5,-2, 11, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-3.5" y="4" width="7" height="12"/><path d="M0,5.5 V12 M0,14.5 L-1.8,11.5 H1.8 L0,14.5 Z"/>`,
  },

  /* ── 計器・信号 (JIS C 0617-8) ── */
  {
    id: "voltmeter", db: true, group: "計器・信号", jis: "08-02-01", cat: "db", letter: "P",
    name: "電圧計", nameEn: "Voltmeter",  desc: "指示計器 V",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><circle cx="0" cy="10" r="6"/><text x="0" y="12.3" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">V</text>`,
  },
  {
    id: "ammeter", db: true, group: "計器・信号", jis: "08-02-01", cat: "db", letter: "P",
    name: "電流計", nameEn: "Ammeter", desc: "指示計器 A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><circle cx="0" cy="10" r="6"/><text x="0" y="12.3" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">A</text>`,
  },
  {
    id: "hour_meter", db: true, group: "計器・信号", jis: "08-04-01", cat: "db", letter: "P",
    name: "時間計 (アワメータ)", nameEn: "Hour meter", desc: "運転時間の積算計",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-6" y="4" width="12" height="12"/><text x="0" y="12.6" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">h</text>`,
  },
  {
    id: "bell", db: true, group: "計器・信号", stdNote: "電鈴 (JIS C 0617-8 音響信号装置。ランプ 08-10-01 とは別図)", cat: "db", letter: "P",
    name: "ベル", nameEn: "Bell", desc: "電鈴 (外側の打鈴子で ブザーと区別)",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-8.5,-2, 17, 24],
    body: `<path d="M0,0 V6.5"/><path d="M-6.5,13 A6.5,6.5 0 0 1 6.5,13"/><path d="M-6.5,13 H6.5"/><path d="M0,20 V13"/><circle cx="4" cy="10.5" r="1.6"/>`,
  },
  {
    id: "horn", jis: "08-10-04", db: true, group: "計器・信号", cat: "db", letter: "P",
    name: "スピーカ (拡声器)", nameEn: "Loudspeaker", desc: "音響信号装置 (箱+コーン)",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-5,-2, 15, 24],
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-3" y="6" width="6" height="8"/><path d="M3,6 L8,3 V17 L3,14"/>`,
  },

  /* ── 実務機器 (盤設計でよく使う非規格ボックス) ── */
  {
    id: "plc_box", nonstd: true, db: true, group: "実務機器", cat: "db", letter: "A",
    name: "PLC 本体", nameEn: "PLC unit", desc: "PLC本体 (電源のみ接続: 上側 AC_L / AC_N / FG の3端子)", typ: "FX5U",
    horizontalPins: true,
    pins: [{x:-15,y:0,n:"AC_L"},{x:0,y:0,n:"AC_N"},{x:15,y:0,n:"FG"}],
    sim: "none", bounds: [-22,-2, 44, 29],
    // FG 端子脇は接地(一般) IEC 60617 02-15-01 (FG=機能接地なので保護接地記号は用いない)。
    // 旧版 (ピン ±10/I0〜Q3) で保存した図面は自動追従しない — DRC の未接続ピン警告で検出し手動で再配線する運用
    body: `<path d="M-15,0 V5 M0,0 V5 M15,0 V5"/><rect x="-20" y="5" width="40" height="20"/><path d="M15,5 V8 M13.2,8 H16.8 M13.8,9.2 H16.2 M14.4,10.4 H15.6"/><text x="0" y="17.5" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">PLC</text>`,
  },
  {
    id: "fan", stdNote: "送風機 (電動機 06-04-01 に羽根を付した実務記号)", db: true, group: "実務機器", cat: "db", letter: "M",
    name: "換気ファン (FAN)", nameEn: "Fan", desc: "盤用換気扇", typ: "MF-950",
    pins: [{x:0,y:0,n:"1"},{x:0,y:35,n:"2"}], sim: "load", bounds: [-10,-2, 20, 39],
    body: `<path d="M0,0 V8 M0,35 V24"/><circle cx="0" cy="16" r="8"/><path d="M0,16 C-2,11 2,11 0,8 M0,16 C5,14 5,18 8,16 M0,16 C2,21 -2,21 0,24 M0,16 C-5,18 -5,14 -8,16"/>`,
  },
{
    id: "mms", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "開閉・保護", cat: "db", letter: "Q",
    name: "モータブレーカ (MMS) 3P", nameEn: "Manual motor starter", desc: "手動モータスタータ (遮断器+熱動素子)。図記号はサーキットプロテクタと同形で、極数と品名で区別する", typ: "MMP-T32 2.5A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "breaker3", mirror: true, maxContacts: 2, bounds: [-6.8,-2, 30.6, 24],
    body: `<g>${G_CP}</g><g transform="translate(10,0)">${G_CP}</g><g transform="translate(20,0)">${G_CP}</g>` +
      gLink(bladeXNO(10.5), bladeXNO(10.5) + 20, 10.5),
  },

  {
    id: "cb_aux_no", jis: "07-02-01", db: true, group: "開閉・保護", cat: "db", letter: "F",
    name: "遮断器補助接点 (AX)", nameEn: "Breaker aux contact", desc: "MCCB/ELBの補助a接点 (投入で閉)。遮断器にリンクして使用",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 8.8, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/>`,
  },
  {
    id: "cb_al_no", jis: "07-02-01", db: true, group: "開閉・保護", cat: "db", letter: "F",
    name: "遮断器警報接点 (AL)", nameEn: "Breaker alarm contact", desc: "トリップで閉じる警報a接点。遮断器にリンクして使用",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "contact_no", linked: true, bounds: [-9.5,-2, 11.5, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-7.5,9 L-6,11.5 L-4.5,9"/>` + gLink(-6, bladeXNO(11.5), 11.5) + ``,
  },
  {
    id: "pb_lamp", stdNote: "押しボタン (07-07-02) と表示灯 (08-10-01) の合成記号", db: true, group: "実務機器", cat: "db", letter: "S",
    name: "照光押しボタン", nameEn: "Illuminated pushbutton", desc: "押しボタンa接点+表示灯の複合 (灯側 X1/X2)", typ: "XB4-BW33B1",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"},{x:15,y:0,n:"X1"},{x:15,y:20,n:"X2"}],
    sim: "contact_no", momentary: true, bounds: [-17,-2, 39.5, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/>` + G_PB(bladeXNO(10)) + `<g transform="translate(15,0)"><path d="M0,0 V4.5 M0,20 V15.5"/><circle cx="0" cy="10" r="5.5"/><path d="M-3.9,6.1 L3.9,13.9 M-3.9,13.9 L3.9,6.1"/></g>`,
  },
  {
    id: "sel3", stdNote: "手動回転操作 (07-06-01) の3位置形", db: true, group: "実務機器", cat: "db", letter: "S",
    name: "3位置セレクタ (手動-切-自動)", nameEn: "3-position selector", desc: "左=手動接点 / 右=自動接点。中央位置で両開", typ: "XB4-BD33",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"},{x:10,y:0,n:"23"},{x:10,y:20,n:"24"}],
    sim: "contact2_no", bounds: [-17,-2, 29, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/></g><path d="M-2.4,9 L7.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/><path d="M-15,6 L-11,9 L-15,12"/>` + gLink(-11, bladeXNO(9), 9) + ``,
  },

  /* ── シーケンス制御でよく使う記号 (提供資料「シーケンス制御回路でよく使う記号」より) ── */
  {
    id: "cp1", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "よく使う記号", cat: "db", letter: "F",
    name: "サーキットプロテクタ (CP) 1P", nameEn: "Circuit protector 1P",
    desc: "制御回路の小容量保護器。過電流で開路 (熱動+電磁)", typ: "CP30-BA 1P 10A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "breaker", bounds: [-6.8,-2, 10.6, 24],
    body: G_CP,
  },
  {
    id: "cp2", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "よく使う記号", cat: "db", letter: "F",
    name: "サーキットプロテクタ (CP) 2P", nameEn: "Circuit protector 2P",
    desc: "単相制御回路の保護器 (2極連動)", typ: "CP30-BA 2P 10A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "breaker2", bounds: [-6.8,-2, 20.6, 24],
    body: `<g>${G_CP}</g><g transform="translate(10,0)">${G_CP}</g>` +
      gLink(bladeXNO(10.5), bladeXNO(10.5) + 10, 10.5),
  },

  {
    id: "ms_no", jis: "07-02-01", db: true, group: "よく使う記号", cat: "db", letter: "Q",
    name: "電磁開閉器 (MS) A接点", nameEn: "Magnetic starter NO contact",
    desc: "電磁開閉器・電磁接触器の補助メーク接点 (文字記号 Q)。図記号はリレー補助接点と同形で、機器の文字記号で区別する。コイルにリンクして使用", typ: "",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 8.8, 24],
    body: G_NO,
  },
  {
    id: "ms_nc", jis: "07-02-03", db: true, group: "よく使う記号", cat: "db", letter: "Q",
    name: "電磁開閉器 (MS) B接点", nameEn: "Magnetic starter NC contact",
    desc: "電磁開閉器・電磁接触器の補助ブレーク接点 (文字記号 Q)。図記号はリレー補助接点と同形で、機器の文字記号で区別する。コイルにリンクして使用", typ: "",
    pins: [{x:0,y:0,n:"21"},{x:0,y:20,n:"22"}], sim: "contact_nc", linked: true, bounds: [-7,-2, 9, 24],
    body: G_NC,
  },
  {
    id: "cont_no_main", db: true, group: "よく使う記号", jis: "07-13-02", cat: "db", letter: "Q",
    name: "電磁接触器 主メーク接点 1極", nameEn: "Contactor main contact 1P",
    desc: "固定接点に接触器機能の半円を付けたメーク接点 (3極版は「電磁接触器 主接点」)", typ: "",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 10.6, 24],
    body: G_NO_CONT,
  },
  {
    id: "cont_nc_main", db: true, group: "よく使う記号", jis: "07-13-03", cat: "db", letter: "Q",
    name: "電磁接触器 主ブレーク接点 1極", nameEn: "Contactor main NC contact 1P",
    desc: "接触器機能つきブレーク接点", typ: "",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "contact_nc", linked: true, bounds: [-10,-2, 12, 24],
    body: G_NC_CONT,
  },
  /* ── 通信・コネクタ (実機の端子配列に合わせた多極コネクタ) ── */
  mkConn({ id: "conn_rj45", label: "RJ45", letter: "X",
    name: "EtherNet/IP コネクタ (RJ45)", nameEn: "EtherNet/IP connector (RJ45)",
    desc: "8極モジュラジャック。EtherNet/IP・PROFINET・産業用イーサネット共通", typ: "8P8C シールド付",
    sigs: ["TD+", "TD-", "RD+", "NC1", "NC2", "RD-", "NC3", "NC4"] }),
  mkConn({ id: "conn_usb_a", label: "USB-A", letter: "X",
    name: "USB コネクタ (Type-A)", nameEn: "USB connector Type-A",
    desc: "ティーチング・パラメータ設定用。VBUS +5V / D± / GND", typ: "USB2.0 Type-A",
    sigs: ["VBUS", "D-", "D+", "GND"] }),
  mkConn({ id: "conn_usb_b", label: "USB-B", letter: "X",
    name: "USB コネクタ (Type-B)", nameEn: "USB connector Type-B",
    desc: "機器側の受け口。コントローラのティーチングポートに多い", typ: "USB2.0 Type-B",
    sigs: ["VBUS", "D-", "D+", "GND"] }),
  mkConn({ id: "conn_usb_c", label: "USB-C", letter: "X",
    name: "USB コネクタ (Type-C)", nameEn: "USB connector Type-C",
    desc: "電源・信号兼用。CC で向きと給電を判定 (主要端子のみ)", typ: "USB Type-C",
    sigs: ["VBUS", "GND", "CC1", "CC2", "D+", "D-", "SHELL"] }),
  mkConn({ id: "conn_hdmi", label: "HDMI", letter: "X",
    name: "HDMI コネクタ (Type-A)", nameEn: "HDMI connector Type-A",
    desc: "19極。表示器・タッチパネルの映像用", typ: "HDMI Type-A",
    perCol: 10, colGap: 30,
    sigs: ["D2+", "D2S", "D2-", "D1+", "D1S", "D1-", "D0+", "D0S", "D0-", "CK+",
           "CKS", "CK-", "CEC", "RSV", "SCL", "SDA", "GND", "+5V", "HPD"] }),
  mkConn({ id: "conn_dsub9", label: "D-sub9", letter: "X",
    name: "D-sub コネクタ 9極", nameEn: "D-sub 9-pin",
    desc: "RS-232C / RS-422 などのシリアル通信", typ: "D-sub 9P",
    sigs: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }),
  mkConn({ id: "conn_dsub25", label: "D-sub25", letter: "X",
    name: "D-sub コネクタ 25極", nameEn: "D-sub 25-pin",
    desc: "コントローラの I/O・パラレル接続", typ: "D-sub 25P",
    perCol: 13, colGap: 30,
    sigs: Array.from({ length: 25 }, (_, i) => String(i + 1)) }),
  mkConn({ id: "conn_power6", label: "PWR", letter: "X",
    name: "電源コネクタ 6極", nameEn: "Power connector 6-pin",
    desc: "主電源・制御電源・保護接地をまとめた機器側コネクタ",
    sigs: ["L1", "L2", "L1C", "L2C", "NC", "PE"] }),
  mkConn({ id: "conn_io8", label: "I/O", letter: "X",
    name: "システム I/O コネクタ 8極", nameEn: "System I/O connector 8-pin",
    desc: "非常停止・イネーブル・ブレーキなどの制御入出力",
    sigs: ["S1", "S2", "EMG+", "EMG-", "ENB+", "ENB-", "BK+", "BK-"] }),
  mkConn({ id: "conn_motor4", label: "MOT", letter: "X",
    name: "モータ動力コネクタ 4極", nameEn: "Motor power connector 4-pin",
    desc: "アクチュエータの動力線 (U/V/W/PE)",
    sigs: ["U", "V", "W", "PE"] }),
  mkConn({ id: "conn_enc6", label: "ENC", letter: "X",
    name: "エンコーダコネクタ 6極", nameEn: "Encoder connector 6-pin",
    desc: "アクチュエータの検出器線",
    sigs: ["A+", "A-", "B+", "B-", "+5V", "GND"] }),
];

/* 伸縮シンボルの基本形 (パレットに出る姿) は、寸法違いと同じ定義から作る。
   静的に書いた図形と伸縮側の式が食い違い、既定長を選び直しただけで端子が
   ずれる — といった事故を防ぐため、定義元は stretch 側に一本化する。 */
DB_SYMBOLS.forEach(sym => {
  const st = sym.stretch;
  if (!st) return;
  sym.body = st.body(st.def);
  sym.bounds = st.bounds(st.def);
  if (st.pins) sym.pins = st.pins(st.def);
});

/* パレットに引き出されているDBシンボル (localStorage) */
/* 既定でパレットに出す記号を増やしたときの版数。上げると、その版より前から
   使っている人のパレットにも新しい既定記号だけを追い足す (並べ替えや外した
   記号はそのまま残す)。 */
const DB_PINNED_VER = 2;
function dbPinnedList() {
  try {
    const s = localStorage.getItem("electracad.dbPinned");
    if (s) {
      const list = JSON.parse(s);
      if (!Array.isArray(list)) return [...DB_DEFAULT_PINNED];
      const ver = +(localStorage.getItem("electracad.dbPinnedVer") || 1);
      if (ver >= DB_PINNED_VER) return list;
      // 版が古い: 既定に増えた記号だけを追加する
      const add = DB_DEFAULT_PINNED.filter(id => !list.includes(id));
      const merged = add.length ? [...list, ...add] : list;
      try {
        localStorage.setItem("electracad.dbPinned", JSON.stringify(merged));
        localStorage.setItem("electracad.dbPinnedVer", String(DB_PINNED_VER));
      } catch (e) { /* 保存できなくても今回の一覧は正しい */ }
      return merged;
    }
  } catch (e) { /* 破損は既定に戻す */ }
  return [...DB_DEFAULT_PINNED];
}
function dbSetPinned(list) {
  try {
    localStorage.setItem("electracad.dbPinned", JSON.stringify(list));
    localStorage.setItem("electracad.dbPinnedVer", String(DB_PINNED_VER));
  } catch (e) { }
}

// 全シンボル辞書へ統合 (描画・配置・部品表・DXFすべてで使える)
DB_SYMBOLS.forEach(s => { SYMBOLS_BY_ID[s.id] = s; });
