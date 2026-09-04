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
  "conn_rj45",
  // KV Nano は全機種を出しておく (枚数は機種で違う)
  "kv_n14at_in", "kv_n14at_out", "kv_n24at_in1", "kv_n24at_in2", "kv_n24at_out1", "kv_n24at_out2",
  "kv_n40at_in1", "kv_n40at_in2", "kv_n40at_in3", "kv_n40at_out1", "kv_n40at_out2",
  "kv_n14ar_in", "kv_n14ar_out",
];

/** 多極コネクタ (レセプタクル) を作る。
    ピンは左端 (列ごとに +colGap) に 5mm ピッチ。山形の開口は配線側を向く。
    sigs: 端子名の配列 / perCol: 1列あたりの極数 (超えたら右の列へ折り返す) */
const r1 = v => Math.round(v * 10) / 10;
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
    if (!o.noNum) parts.push(`<text x="${x + 9.4}" y="${y + 0.9}" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${i + 1}</text>`);
  });
  const nCols = Math.ceil(o.sigs.length / per);
  const h = (rows - 1) * pitch + 8;
  for (let c = 0; c < nCols; c++) parts.push(`<rect x="${c * colGap + 2}" y="-4" width="12.8" height="${h}"/>`);
  const w = (nCols - 1) * colGap + 14.8;
  /* 受け口を正面から見た識別図 + ラベルを、記号の上に「見出し」として置く。
     ・data-upright を付けたグループにするので、機器を回しても常に正立する
       (実物の外観図を回すと、上下逆さまの受け口という実在しない絵になる)
     ・グループの中は姿勢が変わらないので、絵とラベルの上下関係も崩れない
     ・確保する枠は 14×14mm の正方形にしてある。回しても外接矩形が変わらないので、
       90°/270° でも見出しが枠からはみ出さない
     ・識別図は細線 0.25mm (JIS Z 8312)。電気的な意味は下の接続器記号が持つ */
  const BLK = 14;                                  // 見出しに確保する正方形の辺
  const cy = -6 - BLK / 2;                         // 見出しの中心 (記号の枠の上)
  const tw = String(o.label).length * 2.05;        // ラベル幅は等幅 2.5mm の概算
  if (o.glyph) {
    parts.push(`<g data-upright="1" transform="translate(${r1(w / 2)},${r1(cy)})">` +
      `<g transform="translate(0,-2.5)">${o.glyph}</g>` +
      `<text x="0" y="6" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${o.label}</text>` +
      `</g>`);
  } else {
    parts.push(`<text x="${w / 2}" y="-6" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${o.label}</text>`);
  }
  // 外接矩形は他の記号と同じ作法で一様余白 2mm
  const bw = o.glyph ? BLK : tw;
  const x0 = Math.min(0, w / 2 - bw / 2), x1 = Math.max(w, w / 2 + bw / 2);
  const y0 = o.glyph ? cy - BLK / 2 : -8.6, y1 = -4 + h;
  const r = v => Math.round(v * 10) / 10;
  return {
    id: o.id, db: true, group: "通信・コネクタ", cat: "db", letter: o.letter || "CN",
    ...(o.fn ? { fn: o.fn } : {}),
    // パレットの見出しは、図面に出るのと同じ「見出し」だけを映す (記号全体を
    // 46px に収めると識別図が数 px に潰れる)。図面と同じ図形をそのまま使うので、
    // パレットで見た絵と図面に出る絵が必ず一致する
    ...(o.glyph ? { thumbBox: [r(w / 2 - BLK / 2), r(cy - BLK / 2), BLK, BLK] } : {}),
    name: o.name, nameEn: o.nameEn, desc: o.desc, typ: o.typ || "",
    stdNote: o.stdNote || "接続器 (JIS C 0617-3)。極数と端子名は実機の仕様に合わせる",
    pins, sim: "none",
    bounds: [r(x0 - 2), r(y0 - 2), r(x1 - x0 + 4), r(y1 - y0 + 4)],
    body: parts.join(""),
  };
}

/** 通信ポート記号を作る。
    受け口の識別図 (見出し) + JIS C 0617-3 03-03-05「プラグおよびソケット」1極。
    LAN・USB・HDMI は既製ケーブル 1 品目なので、心線を 8 本・19 本と展開せず、
    「機器 ─ ポート ─ ケーブル」の 1 本の接続として描くのが実務の作法。
    端子の割付は desc に文字で残す (図面に 8 本の線を引くためのものではない)。 */
function mkPort(o) {
  const BLK = 14;                       // 見出しに確保する正方形 (回しても外接矩形が変わらない)
  const cx = 10, cy = -6 - BLK / 2;     // 見出しの中心 (記号の上)
  // 03-03-05 をピンが左右に来る向きにしたもの。
  // ソケット (メス) = 半円 / プラグ (オス) = 塗り潰した三角。半円の口が三角を受ける
  const body =
    `<path d="M0,0 H5.5"/>` +
    `<path d="M9,3.5 A3.5,3.5 0 0 0 9,-3.5"/>` +
    `<path d="M12.4,2.8 L9.2,0 L12.4,-2.8 Z" fill="currentColor"/>` +
    `<path d="M20,0 H12.4"/>` +
    `<g data-upright="1" transform="translate(${cx},${cy})">` +
      `<g transform="translate(0,-2.5)">${o.glyph}</g>` +
      `<text x="0" y="6" data-h="2.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">${o.label}</text>` +
    `</g>`;
  return {
    id: o.id, db: true, group: "通信・コネクタ", cat: "db", letter: o.letter || "CN",
    ...(o.fn ? { fn: o.fn } : {}),
    name: o.name, nameEn: o.nameEn, desc: o.desc, typ: o.typ || "",
    stdNote: "プラグおよびソケット (JIS C 0617-3 03-03-05) 1極。上の細線は受け口の識別図で、電気的な意味は持たない",
    // 左=機器側 / 右=ケーブル側。1極なので接続は 1 本
    pins: [{ x: 0, y: 0, n: "" }, { x: 20, y: 0, n: "" }],
    /* 通信は「接続が関係ない図」(どの口にどのケーブルが刺さるかの説明図)
       として扱う — 制御回路のシミュレーションにも、未接続の検図にも載せない */
    sim: "none", noDrc: true,
    // 図形は x 0〜20 / y -3.5〜3.5、見出しは x 3〜17 / y -20〜-6。余白は一様 2mm
    bounds: [-2, cy - BLK / 2 - 2, 24, (3.5 + 2) - (cy - BLK / 2 - 2)],
    thumbBox: [cx - BLK / 2, cy - BLK / 2, BLK, BLK],
    body,
  };
}

/* ── PLC 入出力結線図 (キーエンス KV Nano シリーズ) ─────────────────────
   実務の入出力結線図の形に合わせる。入力と出力は実機のユニットどおり鏡像:

   入力 (現場側が左):
    +24V ┃ 0V ┃                              ┌──────────┐
         ┃    ┣━━[ 機器 ]━━○─┤R007      │ ── 起動押ボタン ──
         ┃    ┃                              │KV-N24AT  │
         ┃    ┣━━[ 機器 ]━━○─┤R008      │ ── 停止押ボタン ──
         ┃    ┃                              │入力(2/2) │
         ┗━━━━━━━━━━━━━━○─┤COM       │
                                             └──────────┘
      外側=      内側=     現場側    端子  端子名は      機能欄 (下線に書く)
      コモン側    分岐側    (実線)   (小円) 外郭の内側

   出力 (箱が左・現場側が右・名称欄は右端。端子名は外郭の内側):
    ┌──────────┐
    │KV-N14AT  │
    │出力 6点  │
    │     R500├○━━[ 負荷 ]━━┃+24V ┃0V   ── 運転表示灯 ──
    │     COM ├○━━━━━━━━━━━━━━━┃   ── 出力コモン ──
    └──────────┘             内側=分岐側  外側=コモン側

   機器は rot 270 で置けば向きが合う — 入力は左が電源側 (P,N)・右が信号、
   出力は左が信号 (出力端子)・右が電源側 (P,N)。

   ・用紙 1 枚 = 1 記号 = 「A3 横に収まる高さ」まで。チャネル (16 点) は
     またがず、1 チャネルを均等に割る。16 点を 1 枚にすると、機器がぶつからない
     行ピッチ (20mm) では縦が A3 に入らず A2 になってしまうため。
     用紙は機種でそろえる (枚ごとに決めるとピッチを広げたとき横と縦が混ざる)。
   ・端子の刻印は取扱説明書の入出力回路図どおり: デバイス番号から R を除いた
     数字 (000〜/500〜)、コモンは C0/C1…。出力の 1 枚目にはサービス電源
     (0V/24V) の端子。リレー出力形 (N14AR) はコモンが分割で、群ごとに
     コモン行が挟まる。
   ・端子の小円は外郭に接して描き、導体は円の外周で終える。端子名は外郭の内側。
   ・端子の左 (現場側) は実際の導体で描く。プロパティの「結線図の下地を作る」を
     押すと、レール 2 本と各行の分岐を実線で引き、機器を落とす隙間を空け、
     コモンを外側のレールへ結ぶ。3 線式センサが隙間にあれば茶/青/黒を引き分ける。
     こうすると絵と回路が一致する (記号の中に線を描いてしまうと、見た目はつながって
     いるのに検図もシミュレーションも通らない図になる)。
   ・右は機能欄。行ごとの文言はプロパティでまとめて貼り付けられる。
   ・ユニットの電源と接地は描かない (別紙の電源回路図)。補助行はコモンだけ。
   ・尺度は NS (非尺度)。図記号で表す図は実物との寸法比を持たない。
     なお縮小尺度も使えない — 図記号を尺度に関わらず実寸で描くので、縮小すると
     線番・注記・現場機器の記号が用紙の上で半分になり JIS Z 8313 の 2.5mm を割る。

   端子番号は KV Nano の内蔵入出力リレー (入力 R000〜 / 出力 R500〜)。
   リレー番号は「R + チャネル + 点 (00〜15)」なので、17 点目は R100 へ繰り上がる。 */
// 行の y は 5mm 格子の倍数にする (配線を引くとき端点が格子へ丸められるため)
/* 見出しの高さ 13mm = あき 1.5 + 形式 3.5 + あき 1.5 + 種別 3.5 + あき 2 + 罫。
   種別 (「入力 (1) 8点」) は和文なので、呼び 2.5 を書いても JIS Z 8313-0 の
   和文最小 3.5mm へ引き上げられて描かれる。行取りも 3.5 で数える */
const KV_AUXROW = 10, KV_HDR = 13, KV_BOT = 4, KV_Y0 = 15;
const KV_BOXW = 30;                    // ユニットの箱 (細くてよい。中は形式と CH だけ)
const KV_FN_X = 5, KV_FN_W = 50;       // 機能欄の下線の長さ (長すぎるので半分にした)
/* レールまでの距離 / 機器を落とす隙間 / レール 2 本の間隔 / 隙間までの引出し。
   間隔は電位リンク記号の幅 (18mm) より広くとる — 狭いとレール頭の記号どうしが
   重なって、どちらのレールの電位か読めない */
const KV_RAIL = 80, KV_GAP = 20, KV_RAIL_SEP = 25, KV_RAIL_LEAD = 10;
/* 端子の小円。図記号番号は規格原本との照合が必要 (symbols.js の terminal と
   同じ扱い)。大きさはライブラリで 1 つにそろえる — 同じ「端子」が図面の中で
   2 通りの径で並ぶと、縮小・複写したときに別のものに見える */
const KV_TERM_R = TERM_R;
const KV_TERM_X = 3;                   // 外郭の左辺から端子名の左端まで
/** KV の端子表示 (16 点で次のチャネルへ繰り上がる)。
    取扱説明書の入出力回路図のとおり、端子の刻印はデバイス番号 (R000〜) から
    R を除いた数字 (000〜 / 500〜)。ソフト側のデバイス番号は R + この数字 */
function kvTerm(startCh, i) {
  return `${startCh + Math.floor(i / 16)}${String(i % 16).padStart(2, "0")}`;
}
const kvText = (x, y, h, s, anchor = "middle", mono = true) =>
  `<text x="${r1(x)}" y="${r1(y)}" data-h="${h}" text-anchor="${anchor}" fill="currentColor" stroke="none" font-family="${mono ? "monospace" : "sans-serif"}">${s}</text>`;

/* 行ピッチは「横に倒した現場機器がぶつからない距離」で決める。
   記号を 270° 回して行に置くと、外接矩形の幅がそのまま縦の広がりになるので、
   いちばん背の高い単極の入出力記号 (光電センサ 29mm など) に合わせると
   広がりすぎて紙も大きくなる。既定は 20mm — 押しボタン・非常停止・セレクタ・
   リミットスイッチ・近接/圧力センサまで、単極の入出力機器の線どうしが 1mm 以上
   あく最小の格子寸法で、どの群も A3 に収まる (15mm では接点どうしが接する)。
   光電センサ (図が横に長い) や多極の機器を並べる図では、プロパティの
   「行ピッチ」で 25〜35mm へ広げる — 用紙は自動で選び直す */
const KV_PITCH_MIN = 15, KV_PITCH_MAX = 35, KV_PITCH_DEF = 20;

/* 行の y を並びから出す。io 行どうしは行ピッチ、io 行の次の補助行
   (コモン・サービス電源) は「横に倒した機器が下へ張り出す」ぶんの
   max(補助行, ピッチ)、補助行の次はどれも補助行ピッチ */
function kvSeqRows(seq, pitch) {
  let y = KV_Y0;
  return seq.map((e, i) => {
    if (i > 0) {
      const prev = seq[i - 1];
      /* 信号行とコモン行のピッチはそろえる (行送りは全部 pitch)。
         コモンの次だけ詰めると 20/10 の交互の刻みになって読みにくい。
         例外はサービス電源 (0V/24V) — 対で 5mm に詰め、次の行へは補助ピッチ */
      y += (prev.svc && e.svc) ? 5
        : prev.svc ? KV_AUXROW
        : prev.io && !e.io ? Math.max(KV_AUXROW, pitch)
        : pitch;
    }
    return { n: e.n, y, io: e.io, noDrc: e.noDrc, ...(e.disp ? { disp: e.disp } : {}) };
  });
}
function kvSeqH(seq, pitch) {
  const rows = kvSeqRows(seq, pitch);
  return rows[rows.length - 1].y + KV_BOT + 4;   // bounds の縦 (上下 2mm ずつ)
}

/** 入出力結線図の中身を行ピッチから組み立てる (伸縮シンボルの寸法違いに使う)。

    向きは実機のユニットに合わせて入力と出力で鏡像にする:
    ・入力 (o.fieldSide = "left")  … 現場側が左。レール → 機器 → 端子 → 箱、機能欄は箱の右
    ・出力 (o.fieldSide = "right") … 箱が左。箱 → 端子 → 機器 → レール、名称 (機能欄) は右端
    どちらも行の読み順が「電流の入る側 → ユニット」/「ユニット → 負荷 → 電源」になる。
    機器は rot 270 で置けば、入力は左が電源側 (0V)・右が信号、
    出力は左が信号 (出力端子)・右が電源側 (+24V) と、自然に向きが合う */
function kvBuild(o, pitch) {
  const W = KV_BOXW, TR = KV_TERM_R;
  const flip = o.fieldSide === "right";     // 出力: 現場側が右
  const rows = kvSeqRows(o.seq, pitch);
  const bh = rows[rows.length - 1].y + KV_BOT;
  /* 用紙は高さで決まる (幅が決め手になることはない)。先に決めて、
     出力の縦置きでは現場側 (レールまでの距離) を広げ、図枠の横幅を
     ぎりぎりまで使う — コメント欄 (50mm) は右端に寄る */
  /* 拡張の図中注記 (※拡張◯台目…) は箱の下 7mm に出る。用紙判定へ入れないと
     「判定は入るが注記が表題欄帯に掛かる」機種がいずれ出る (bounds と申告の一致) */
  const noteH = o.expNote ? 7 : 0;
  const sheetH = r1(Math.max(...(o.allSeqs || [o.seq]).map(q => kvSeqH(q, pitch))) + noteH);
  /* 幅は「本物の最小幅」を渡す。1 などの仮値だと「表題欄の左に収まる細い記号」
     と誤判定され、右下の帯 (表題欄 + 改訂履歴欄) を確保しない高さで
     用紙が選ばれてしまう。この記号は最小でも 170mm ある */
  const sheet = kvSheetFor({ w: 170, h: sheetH });
  let RAIL = KV_RAIL;
  if (flip && sheet.orient === "portrait") {
    const pp = KV_PAPERS.find(x => x.paper === sheet.paper && x.orient === sheet.orient);
    const c = sheet.paper === "A1" ? 20 : 10;
    const inW = pp.w - Math.max(20, c) - c;
    // 幅 = 箱 (2TR+W+2) + 現場側 + あき 10 + コメント欄 + 2。左右あわせて 8mm 残す
    RAIL = Math.floor((inW - 8 - (W + 2) - (10 + KV_FN_W + 2)) / 5) * 5;
  }
  const pins = [], parts = [];
  /* 端子 (小円) はユニットの外郭の「中」に描く (取扱説明書の回路図と同じ —
     四角の中に丸)。円は外郭の辺に内側から接し、ピンはその接点 (辺の上)。
     導体は接点まで来て円の外周で終わり、円の中へは入らない。
     外郭の辺は円に接するだけで貫かない (画面でも DXF でも)。
     ピンは 5mm 格子に乗る (格子から外れると配線の端点が丸められて届かない) */
  const BX = flip ? -W : 0;                   // 外郭の箱側の辺 (左端の x)
  parts.push(`<rect x="${r1(BX)}" y="0" width="${W}" height="${r1(bh)}"/>`);
  parts.push(kvText(BX + W / 2, 5, 3.5, o.model, "middle"));
  parts.push(kvText(BX + W / 2, 10, 3.5, o.title, "middle", false));
  parts.push(`<path d="M${r1(BX)},${KV_HDR - 1} H${r1(BX + W)}"/>`);
  /* 機能欄の下線の左端。入力は箱の右、出力はレールのさらに右 (右端の名称欄)。
     出力はレールから 10mm あける — レール頭の電位名 (+24V は半幅 5.8mm) が
     下線の帯に食い込まないように */
  const FX = flip ? RAIL + 10 : W + KV_FN_X;
  rows.forEach((r, i) => {
    /* noDrc: 未使用でも黙る端子。入出力点とサービス電源 (0V/24V) は使わない
       図面が普通にある。コモンは黙らせない — 浮いていれば群ごと動かない */
    pins.push({ x: 0, y: r.y, n: r.n, noDrc: !!r.noDrc, inBody: true, row: i });
    parts.push(`<circle cx="${flip ? -TR : TR}" cy="${r1(r.y)}" r="${TR}"/>`);
    /* 群の区切り線: コモン行 (群の末尾) の次の io 行の上に引く。
       コモンは自分の群の点と同じ区画に入る */
    if (i > 0 && !rows[i - 1].io && r.io) parts.push(`<path d="M${r1(BX)},${r1(r.y - KV_AUXROW / 2)} H${r1(BX + W)}"/>`);
    /* 端子名は外郭の内側 (端子の丸のすぐ隣)。外に置くと現場側の配線区画に
       文字が並び、機器のピン番号・線番と同じ帯で読み合わせることになる */
    // 表示は disp があればそちら (三菱: デバイス番号 + 端子台の TB 番号併記)
    if (flip) parts.push(kvText(-(TR * 2 + KV_TERM_X), r1(r.y + 1.25), 2.5, r.disp || r.n, "end"));
    else parts.push(kvText(TR * 2 + KV_TERM_X, r1(r.y + 1.25), 2.5, r.disp || r.n, "start"));
    /* 機能欄 (コメント欄) の下線は body に焼き込まない — 機器ごとに
       ドラッグで位置を変えられるように、描画側 (画面・DXF) が
       ioSheet.fnX/fnW + 機器の fnDx から毎回引く */
  });
  /* 保護接地の図記号は焼き込まない。焼き込むと「紙の上は接地済み・モデルは
     未接続」という食い違いが起き、利用者が指示どおり結線すると導体が接地記号を
     貫き、別に prot_earth を置けば接地記号が 2 つ並ぶ */
  /* 拡張ユニット: 割付の前提 (何台目 = 先頭チャネル) を図面の面に残す。
     端子番号の正しさが接続順という図面外の前提に依存するため、
     プロパティの説明だけでなく紙にも出す (IEC 61082-1 の一義性) */
  if (o.expNote) parts.push(kvText(BX, r1(bh + 7), 2.5, o.expNote, "start", false));
  const BOT = o.expNote ? 11 : 4;              // 注記のぶん外接矩形を下へ広げる
  const bounds = flip
    ? [r1(BX - 2), -2, r1((FX + KV_FN_W + 2) - (BX - 2)), r1(bh + BOT)]
    : [-2, -2, r1(W + KV_FN_X + KV_FN_W + 4), r1(bh + BOT)];
  /* 実際に線を引いている帯。外接矩形 (余白つき) をそのまま「インク」として
     申告すると、記号に触れていない導体まで「貫通」になる。
     ① 端子の丸 + 外郭  ② 機能欄の下線 — その間 (出力では現場側の区画) は何も無い */
  /* 帯には線の太さの半分 (0.25) を織り込む。中心線で申告すると、描いて測った
     実インク (getBBox + 半幅) より 0.25mm 過小になる */
  const HW = 0.25;
  const inkBoxes = (flip
    ? [[BX, 0, W, bh], [FX, KV_Y0, KV_FN_W, bh - KV_Y0, "fn"]]
    : [[0, 0, W, bh], [FX, KV_Y0, KV_FN_W, bh - KV_Y0, "fn"]])
    .map(([x, y, w2, h2, tag]) => {
      const r = [r1(x - HW), r1(y - HW), r1(w2 + HW * 2), r1(h2 + HW * 2)];
      if (tag) r.push(tag);              // "fn" = 機能欄の帯 (機器の fnDx に追従する)
      return r;
    });
  // 注記の帯もインクとして申告 (ラベルの自動配置が上に乗らないように)
  if (o.expNote) inkBoxes.push([r1(BX), r1(bh + 3), Math.max(48, r1(o.expNote.length * 3.6)), 5.5]);
  // 機器を落とす隙間 (dev.x からの左端/右端)。内側レールから lead だけ機器側
  /* 現場機器の置き場所の目安 (内側レールから引出しぶん端子側)。
     配線は自分で引く方式なので、これは配置の案内に使うだけ */
  const gapX1 = flip ? RAIL - KV_RAIL_SEP - KV_RAIL_LEAD : -(RAIL - KV_RAIL_SEP - KV_RAIL_LEAD - KV_GAP);
  const gapX0 = gapX1 - KV_GAP;
  return {
    pins, body: parts.join(""), bounds, inkBoxes,
    fnRows: rows.filter(r => r.io).length,   // 機能欄の行 = 入出力点のみ
    /* 下地の寸法 (端子からの距離)。テストや使う人がここから隙間の位置を出せる:
       side = 現場側がどちらか。外側 (コモン側) レール = x ± rail /
       内側 (分岐側) = そこから sep だけ機器側 / 隙間 = [x+gapX0, x+gapX1] */
    ioSheet: { side: flip ? "right" : "left",
      rail: RAIL, gap: KV_GAP, pitch, railTags: o.railTags,
      sep: KV_RAIL_SEP, lead: KV_RAIL_LEAD,
      fnTextX: FX + 1, fnRoom: KV_FN_W - 1,   // 機能欄の文字の左端 / 下線の長さ
      fnX: FX, fnW: KV_FN_W,                  // 下線そのもの (画面・DXF が機器ごとに引く)
      gapX0, gapX1,
      // 後方互換 (公開していた旧フィールド。dev.x - gapFrom = 隙間の左端)
      gapFrom: -gapX0, gapTo: -gapX1,
      rows: rows.map(r => ({ y: r.y, io: r.io })) },
    /* 用紙は「この機種でいちばん背の高い枚」で先に決めてある (上の sheet)。
       枚ごとに決めると、行ピッチを広げたとき 1 台の図面集に横と縦が混ざる */
    sheet,
  };
}

/** 入出力結線図の記号 (1 群ぶん)。入力は端子が箱の左、出力は端子が箱の右 */
function mkKvSheet(o) {
  const built = kvBuild(o, KV_PITCH_DEF);
  const flip = o.fieldSide === "right";
  return {
    id: o.id, db: true, group: "PLC入出力結線図", cat: "db", letter: "PLC",
    nonstd: true, swapGroup: o.swapGroup, unitSheet: true,
    name: o.name, nameEn: o.nameEn, desc: o.desc, typ: o.model,
    ...(o.expCh ? { expCh: o.expCh, expAlts: o.expAlts, ...(o.altOf ? { altOf: o.altOf } : {}) } : {}),
    stdNote: o.stdNote || "機器の端子配置を写した実務用の枠記号 (JIS C 0617-1 の作成原則で構成: " +
      "外郭 + 端子 + 端子名。端子の図記号番号は規格原本との照合が必要)。" +
      "端子の刻印とコモンの分割は取扱説明書の入出力回路図どおり " +
      "(写しで確認できたのは KV-N14AR。AT 形の出力コモンの刻印と、" +
      "N24AT/N40AT の入力コモンの数・刻印は未確認 — C0 が 1 つ、は N14AR からの類推)。" +
      "ユニットの電源と接地は別紙の電源回路図に描きます",
    sim: "none", thumbBox: flip ? [-KV_BOXW, 0, KV_BOXW, 16] : [0, 0, KV_BOXW, 16],
    /* 機器タグは箱の肩 (入力=左肩・出力=右肩)。1 行目より上なので
       現場側の区画を汚さない */
    tagAnchor: flip ? { x: 2, y: 6, anchor: "start" } : { x: -2, y: 6, anchor: "end" },
    ...built,
    /* 行ピッチの寸法違い。現場機器がぶつからない距離を図ごとに選べる */
    stretch: {
      min: KV_PITCH_MIN, max: KV_PITCH_MAX, step: 5, def: KV_PITCH_DEF, unit: "mm",
      label: "行ピッチ (横に倒した機器がぶつからない距離)",
      bounds: (v) => kvBuild(o, v).bounds,
      body: (v) => kvBuild(o, v).body,
      pins: (v) => kvBuild(o, v).pins,
      extra: (v) => { const k = kvBuild(o, v); return { ioSheet: k.ioSheet, sheet: k.sheet, fnRows: k.fnRows, inkBoxes: k.inkBoxes }; },
    },
  };
}

/* 入るいちばん小さい用紙。作図領域から表題欄の帯を除いた高さで判定する。
   engine.js より先に読まれるので、用紙寸法はここに持つ (JIS Z 8311 の A 列) */
const KV_PAPERS = [
  // 小さい順。同じ大きさなら横 (JIS Z 8311 は横長を基本とする) を先に見る
  { paper: "A3", orient: "landscape", w: 420, h: 297 },
  { paper: "A3", orient: "portrait", w: 297, h: 420 },
  { paper: "A2", orient: "landscape", w: 594, h: 420 },
  { paper: "A2", orient: "portrait", w: 420, h: 594 },
  { paper: "A1", orient: "landscape", w: 841, h: 594 },
  { paper: "A1", orient: "portrait", w: 594, h: 841 },
];
/* 右下でふさがる帯: 表題欄 160×30 と、その左隣に置かれる改訂履歴欄 120×30。
   engine.js の revisionRect() は余地があれば改訂履歴欄を表題欄の「左」に並べる
   ので、ふさがるのは幅 280mm・高さ 30mm の帯。改訂は後から増えるので、
   いちばん大きくなった姿 (4 行 + 見出し = 30mm) で場所を空けておく */
const KV_TB_W = 160, KV_REV_W = 120, KV_BLOCK_W = KV_TB_W + KV_REV_W, KV_BLOCK_H = 35;
/* 尺度はユーザーの社内標準に合わせて 1:1 (幾何は NS と同一 — このアプリは
   図記号を常に実寸で描く)。JIS 的には結線図は非尺度 (NS) だが、
   出図先の標準が 1:1 表記なのでそれに従う */
const KV_SCALE = "1:1";
function kvSheetFor(size) {
  for (const s of KV_PAPERS) {
    const c = s.paper === "A1" ? 20 : 10;       // 輪郭線までの余白 (とじ代は 20mm)
    const inW = s.w - Math.max(20, c) - c, inH = s.h - c * 2;
    /* 記号が細くて表題欄・改訂履歴欄の左に収まるなら、高さは作図領域いっぱいまで使える */
    const roomH = size.w <= inW - KV_BLOCK_W ? inH : inH - KV_BLOCK_H;
    // 置き余白は 5mm — 「なるべくびっしり使う」ため (16 点 + COM が A3 縦に入る)
    if (size.w <= inW && size.h + 5 <= roomH) return { paper: s.paper, orient: s.orient, scale: KV_SCALE };
  }
  const l = KV_PAPERS[KV_PAPERS.length - 1];
  return { paper: l.paper, orient: l.orient, scale: KV_SCALE };
}

/* 1 枚に載せる高さの上限 (既定ピッチでの h)。kvSheetFor の A3 縦の判定
   (h + 5 ≤ 作図領域 400 − 表題欄の帯 35) から来る。
   1 枚 = 1 チャネル (16 点 + COM) が A3 縦にびっしり収まる — 16 行 × 20mm +
   コモン + サービス電源で h 358。ここを超える機種だけ枚を割る */
const KV_FIT_H = 360;

/* ── 機種の端子データ ─────────────────────────────────────
   取扱説明書の入出力回路図から。KV-N14AR は写しで確認済み:
   ・端子の刻印はデバイス番号から R を除いた数字 (入力 000〜 / 出力 500〜)
   ・コモンの刻印は C0, C1, … (入力は C0 が 1 つ)
   ・出力コモンは機種で分割が違う — N14AR は C1=500 / C2=501 / C3=502 /
     C4=503〜505 (リレー出力なので群ごとに別電源を入れられる)
   ・出力側の端子台にはサービス電源 (0V / 24V) の端子がある (交流電源形)
   写しで確認できたのは N14AR のみ。AT 形の出力コモンの刻印は未確認 (COM のまま)。
   N24AT/N40AT の入力コモン「C0 が 1 つ」も N14AR からの類推で、実機で分割
   (C0/C1 併設など) なら inGroups/outGroups を書けば端子構成ごと差し替わる */
const KV_UNITS = [
  ["KV-N14AT", { nIn: 8, nOut: 6 }],
  ["KV-N24AT", { nIn: 14, nOut: 10 }],
  ["KV-N40AT", { nIn: 24, nOut: 16 }],
  ["KV-N14AR", { nIn: 8, relay: true,
    outGroups: [
      { pts: ["500"], com: "C1" }, { pts: ["501"], com: "C2" },
      { pts: ["502"], com: "C3" }, { pts: ["503", "504", "505"], com: "C4" },
    ] }],
  /* 拡張ユニット (トランジスタ・シンク出力形)。exp = 拡張:
     ・入力枚は無し。サービス電源 (0V/24V) の端子も無い — あれは基本ユニット
       (交流電源形) の出力端子台のもの
     ・リレー番号は接続順で決まる (拡張1台目 = R600〜, 2台目 = R700〜 …
       1 ユニット 1 チャネル占有の前提)。記号の刻印は「拡張1台目」を既定にする。
       2台目以降に使うときはシンボル編集で複製して端子名を読み替える
     ・コモンは 1 つ (N16ET は 16点/1コモン — カタログ値)。刻印は N14AR の
       出力コモンからの類推で COM のまま (実機未確認) */
  ["KV-N8ET", { nOut: 8, ch0: 6, exp: true }],
  ["KV-N16ET", { nOut: 16, ch0: 6, exp: true }],
];

/** KV Nano 基本ユニットの結線図記号。1 枚 = A3 横に収まる高さまで */
function mkKvUnit(model, cfg) {
  const out = [];
  /* 枚の中身 (行の並び)。svc = サービス電源 (0V/24V) を頭に載せる。
     入出力点とサービス電源は未使用でも黙る (noDrc)。コモンは黙らせない */
  const mkSeq = (gs, svc) => {
    const seq = [];
    if (svc) seq.push({ n: "0V", io: false, noDrc: true, svc: true },
      { n: "24V", io: false, noDrc: true, svc: true });
    gs.forEach(g => {
      g.pts.forEach(n => seq.push({ n, io: true, noDrc: true }));
      seq.push({ n: g.com, io: false });
    });
    return seq;
  };
  /* 自動割付 (コモン分割の無い機種): チャネル (16 点) で切り、A3 横に収まる
     高さまで均等に割る。サービス電源が載る枚は補助行が 2 行増えるぶん
     背が高くなるので、その姿で入るまで枚数を増やす */
  const autoSheets = (ch0, n, com, kind) => {
    const sheets = [];
    for (let c = 0; c < n; c += 16) {
      const cnt = Math.min(16, n - c);
      for (let nSheets = 1; ; nSheets++) {
        const trial = [];
        let at = 0;
        for (let k = 0; k < nSheets; k++) {
          const take = Math.ceil((cnt - at) / (nSheets - k));
          const pts = [];
          for (let i = 0; i < take; i++) pts.push(kvTerm(ch0, c + at + i));
          trial.push([{ pts, com }]);
          at += take;
        }
        const fits = trial.every((gs, k) =>
          kvSeqH(mkSeq(gs, kind === "出力" && !cfg.exp && sheets.length === 0 && k === 0), KV_PITCH_DEF)
            + (cfg.exp ? 7 : 0) <= KV_FIT_H);   // 拡張は図中注記のぶんも枚割りに入れる
        if (fits) { trial.forEach(gs => sheets.push(gs)); break; }
      }
    }
    return sheets;
  };
  /* 拡張ユニット (出力専用)。リレー番号は接続順で決まるので、1〜3台目
     (KV Nano は拡張 3 台まで) の 3 通りを同じ姿で作る。パレットに出すのは
     1台目だけ — 2/3台目は「拡張ユニットの台数」プロパティで差し替える
     (端子の位置・図形は同一なので、配線・タグ・機能欄はそのまま残る) */
  if (cfg.exp) {
    const chs = [cfg.ch0, cfg.ch0 + 1, cfg.ch0 + 2];
    const idOf = ch => `${model.toLowerCase().replace(/-/g, "_")}_out${ch === cfg.ch0 ? "" : `_c${ch}`}`;
    const altIds = {};
    chs.forEach(ch => { altIds[ch] = idOf(ch); });
    chs.forEach((ch, ci) => {
      const n = ci + 1;
      const sheets = autoSheets(ch, cfg.nOut, "COM", "出力");
      // 螺子端子の拡張出力は最大 16 点 = 1 枚に収まる (収まらない機種を
      // 足すときは基本ユニットと同じ枚割り・id 連番に戻すこと)
      sheets.forEach(gs => {
        const seq = mkSeq(gs, false);
        const pts = gs.flatMap(g => g.pts);
        out.push(mkKvSheet({
          id: altIds[ch], model,
          title: `拡張出力 ${pts.length}点`,
          seq, allSeqs: sheets.map(g2 => mkSeq(g2, false)),
          railTags: { branch: "P24V", supply: "N24V" },
          fieldSide: "right",
          swapGroup: "kv_nano_out",
          expCh: ch, expAlts: altIds, ...(ch !== cfg.ch0 ? { altOf: altIds[cfg.ch0] } : {}),
          expNote: `※拡張${n}台目の割付 (R${ch}00〜)`,
          name: `${model} 出力結線図${ch === cfg.ch0 ? "" : ` (拡張${n}台目 R${ch}00〜)`}`,
          nameEn: `${model} output wiring${ch === cfg.ch0 ? "" : ` (unit ${n})`}`,
          stdNote: "機器の端子配置を写した実務用の枠記号 (JIS C 0617-1 の作成原則で構成: 外郭 + 端子 + 端子指示。端子の図記号番号は規格原本との照合が必要)。" +
            `ただし端子位置の表示は KV のデバイス番号 (R を除いた数字) — 実機の端子台の刻印ではない (${model} の刻印は未確認)。` +
            "リレー番号は接続順で決まるため、図中の『※拡張◯台目の割付』注記とプロパティ「拡張ユニットの台数」を実機の接続順に合わせること。" +
            "コモンの刻印 COM は N14AR からの類推 (実機未確認)。ユニットの電源と接地は別紙の電源回路図に描きます",
          desc: `キーエンス KV Nano 拡張ユニット ${model} の出力結線図 (端子 ${pts[0]}〜${pts[pts.length - 1]} の${pts.length}点・拡張${n}台目 R${ch}00〜)。` +
            `プロパティ「拡張ユニットの台数」で 1〜3台目 (R${cfg.ch0}00〜 / R${cfg.ch0 + 1}00〜 / R${cfg.ch0 + 2}00〜) を切り替えられます — 端子の位置は同じなので配線・タグ・機能欄はそのまま。` +
            `コモンは 1 つ (${pts.length}点/1コモン) — コモン線には全点の合計電流が乗るのでサイズ選定に注意。` +
            `サービス電源 (0V/24V) の端子は無い (拡張バスから給電)。` +
            `置くと P24V/N24V のレールとコモンの結線が実線で引かれます — 端子までの配線は自分で引きます。機能欄の文言はプロパティでまとめて入れられます。`,
        }));
      });
    });
    return out;
  }
  const inSheets = cfg.nIn ? autoSheets(0, cfg.nIn, "C0", "入力") : [];
  const outSheets = cfg.outGroups ? [cfg.outGroups]
    : autoSheets(cfg.ch0 !== undefined ? cfg.ch0 : 5, cfg.nOut, "COM", "出力");
  // 用紙は機種でそろえる (入力・出力ぜんぶの中でいちばん背の高い枚に合わせる)
  const allSeqs = [
    ...inSheets.map(gs => mkSeq(gs, false)),
    ...outSheets.map((gs, i) => mkSeq(gs, i === 0 && !cfg.exp)),
  ];
  const build = (kind, sheetsG) => {
    const many = sheetsG.length > 1;
    const kindId = kind === "入力" ? "in" : "out";
    sheetsG.forEach((gs, i) => {
      const seq = mkSeq(gs, kind === "出力" && i === 0 && !cfg.exp);
      const pts = gs.flatMap(g => g.pts);
      const no = many ? ` (${i + 1}/${sheetsG.length})` : "";
      out.push(mkKvSheet({
        id: `${model.toLowerCase().replace(/-/g, "_")}_${kindId}${many ? i + 1 : ""}`,
        model, title: `${kind}${no} ${pts.length}点`, seq, allSeqs,
        /* シンク (NPN) 形・リレー形とも下地は DC24V の想定:
           入力はコモンを P24V へ、機器の帰りは N24V。出力はコモンを N24V へ、
           負荷の帰りは P24V。リレー出力は電源極性が自由なので、交流負荷なら
           レールのタグを手で描き替える。
           どちらの紙でも「外側 = コモン側 / 内側 = 分岐側」で位置をそろえる */
        railTags: kind === "入力" ? { branch: "N24V", supply: "P24V" } : { branch: "P24V", supply: "N24V" },
        /* 実機のユニットに合わせて、入力は現場側が左・出力は現場側が右 (鏡像) */
        fieldSide: kind === "入力" ? "left" : "right",
        swapGroup: `kv_nano_${kindId}`,
        name: `${model} ${kind}結線図${no}`,
        nameEn: `${model} ${kindId === "in" ? "input" : "output"} wiring`,
        desc: `キーエンス KV Nano 基本ユニット ${model} の${kind}結線図 (端子 ${pts[0]}〜${pts[pts.length - 1]} の${pts.length}点)。` +
          `端子の刻印は取扱説明書の回路図どおり (デバイス番号は R + 数字)。` +
          (cfg.relay && kind === "出力" ? `リレー出力でコモンは分割 (${gs.map(g => `${g.com}=${g.pts.join("·")}`).join(" / ")})。` : "") +
          (kind === "出力" && i === 0 ? `0V/24V はユニットのサービス電源端子。` : "") +
          `置くと P24V/N24V のレールとコモンの結線が実線で引かれます — 端子までの配線は自分で引きます。` +
          `機能欄の文言はプロパティでまとめて入れられます。ユニットの電源と接地は別紙の電源回路図に描きます。`,
      }));
    });
  };
  build("入力", inSheets);
  build("出力", outSheets);
  return out;
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
      min: 10, max: 125, step: 5, def: 25, label: "心線の本数",   // 10 = 1心 (シールド線・同軸)
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
        // 輪郭は「端部の半円 2 つ + 直線部 2 本」を別々の path にする。
        // 1 本の閉じた path にすると、DXF では 4 要素に割れて線種の位相が
        // 要素ごとに振り出しに戻り、画面と納品物で破線の切れ方が食い違う。
        // 分けておけば、どの要素も「線素で始まり線素で終わる」補正が効き、
        // 画面と DXF がまったく同じ図になる。1 芯 (直線部 0mm) では直線部を
        // 出さない — 長さ 0 の要素は DXF の検査 (AUDIT) でエラーになる
        const st = h - 10;
        const D = ` stroke-dasharray="6 1.5" stroke-linecap="butt"`;
        let out = `<path d="M-7,0 A7,7 0 0 1 7,0"${D}/>`;
        if (st > 0.01) out += `<path d="M7,0 L7,${st}"${D}/>`;
        out += `<path d="M7,${st} A7,7 0 0 1 -7,${st}"${D}/>`;
        if (st > 0.01) out += `<path d="M-7,${st} L-7,0"${D}/>`;
        return out + `<path d="M${xS},${yS} L10,${h}"/>`;
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
    id: "plug_socket", db: true, group: "導体・接続", jis: "03-03-05", cat: "db", letter: "CN",
    name: "プラグおよびソケット (コネクタ)", nameEn: "Plug and socket / connector", desc: "着脱可能な接続。プラグ (オス)=塗り潰し、ソケット (メス)=半円", typ: "",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "passthru", bounds: [-5.5,-2, 11, 24],
    body: `<path d="M0,0 V5.5"/><path d="M-3.5,9 A3.5,3.5 0 0 1 3.5,9"/><path d="M0,20 V12.4"/><path d="M-2.8,12.4 L0,9.2 L2.8,12.4 Z" fill="currentColor"/>`,
  },

  /* ── 接地 (JIS C 0617-2 / IEC 60617 02-15 群) ── */
  {
    id: "prot_earth", db: true, group: "接地", jis: "02-15-03", cat: "db", letter: "PE",
    name: "保護接地 (PE)", nameEn: "Protective earth", desc: "保護接地。接地記号を円で囲む",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-6,-2, 12, 15],
    /* 中身は一般接地と同じ比率 (横棒 4.8 / 3.2 / 1.6 = 1 : 2/3 : 1/3)・間隔 1.2mm。
       この 4.8mm が囲み記号の下限: 最短棒 1.6mm は線幅 0.5mm の 3.2 倍で「棒」に
       見える最小 (これ以下は点に見える)、間隔 1.2mm はすき間がちょうど JIS Z 8312
       の下限 0.7mm。しかも 1.2 = 最長棒の 1/4 で、一般接地の比率規則とも一致する。
       円は r4.0。あきは線の縁どうしで測る — 記号は端が丸い線 (round cap) で描くので、
       棒の外形は端点から全方向へ線幅の半分ふくらむ。棒端 (±2.4, 5.8) から円心までの
       2.68mm に 0.25 を足し、円の内縁 (4.0−0.25) から引いて あき 0.82mm。
       円 d8.0 は端子の小円 (d4.4) の 1.8 倍あり、見分けがつく */
    body: `<path d="M0,0 V3"/><circle cx="0" cy="7" r="4"/><path d="M0,3 V5.8 M-2.4,5.8 H2.4 M-1.6,7 H1.6 M-0.8,8.2 H0.8"/>`,
  },
  {
    id: "func_earth", db: true, group: "接地", jis: "02-15-02", cat: "db", letter: "FE",
    name: "機能接地 (FE)", nameEn: "Functional earth", desc: "雑音のない (機能) 接地。接地記号をひし形で囲む",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-7.4,-2, 14.8, 17.8],
    /* 保護接地とまったく同じ中身 (横棒 4.8 / 3.2 / 1.6・間隔 1.2) を、
       正方形を 45° 回したひし形 (対角 10.8mm) で囲む。ひし形は内接余地が円より
       狭い (内接円 r3.82 ≒ 円 r4.0) ので、同じ中身でも囲みは一回り大きくなる。
       端の丸みを含めた棒の外形と斜辺のあきは 0.77mm。
       引込線 3mm なので、囲みの上端 (y=3) は保護接地とそろう (下端は円 11.0 /
       ひし形 13.8 でそろわない — ひし形の方が大きくなるため)。
       棒積みの中心は囲みの中心と一致させている */
    body: `<path d="M0,0 V3"/><path d="M0,3 L-5.4,8.4 L0,13.8 L5.4,8.4 Z"/><path d="M0,3 V7.2 M-2.4,7.2 H2.4 M-1.6,8.4 H1.6 M-0.8,9.6 H0.8"/>`,
  },
  {
    id: "chassis_earth", db: true, group: "接地", jis: "02-15-04", cat: "db", letter: "FG",
    name: "フレーム接続 (FG・シャーシ)", nameEn: "Frame / chassis", desc: "機器フレーム・シャーシへの接続",
    pins: [{x:0,y:0,n:""}], sim: "none", bounds: [-5,-2, 10, 10.8],
    /* 一般接地と同じ横棒 6mm に 45° の斜線 3 本 (dx = dy = 1.8・ピッチ 2.1mm)。
       斜線は横棒の幅にちょうど収める — 左端の斜線の下端が棒の左端 (-3)、
       右端の斜線の上端が棒の右端 (+3)。4 本にすると幅 6mm に収めるにはピッチが
       1.4mm となり、斜線どうしのすき間が 0.49mm で印刷の下限 0.7mm を割る */
    body: `<path d="M0,0 V5 M-3,5 H3 M-1.2,5 L-3,6.8 M0.9,5 L-0.9,6.8 M3,5 L1.2,6.8"/>`,
  },

  /* ── 受動部品 (JIS C 0617-4) ── */
  {
    id: "resistor", db: true, group: "受動部品", jis: "04-01-01", cat: "db", letter: "R",
    name: "抵抗器", nameEn: "Resistor", desc: "固定抵抗器",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-4.5,-2, 9, 24],
    body: `<path d="M0,0 V5 M0,20 V15"/><rect x="-2.5" y="5" width="5" height="10"/>`,
  },
  {
    id: "var_resistor", db: true, group: "受動部品", jis: "04-01-02", cat: "db", letter: "VR",
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
    id: "diode", db: true, group: "半導体", jis: "05-03-01", cat: "db", letter: "D",
    name: "ダイオード", nameEn: "Diode", desc: "整流用ダイオード (上→下が順方向)",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 13, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/>`,
  },
  {
    id: "led", db: true, group: "半導体", jis: "05-03-02", cat: "db", letter: "LED",
    name: "発光ダイオード (LED)", nameEn: "LED", desc: "ダイオード+光の矢印2本",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 19.5, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/><path d="M5,7 L9.5,4 M9.5,4 L7.557,4.473 M9.5,4 L8.316,5.612 M6.5,10.5 L11,7.5 M11,7.5 L9.057,7.973 M11,7.5 L9.816,9.112"/>`,
  },
  {
    id: "zener", db: true, group: "半導体", jis: "05-03-06", cat: "db", letter: "ZD",
    name: "定電圧ダイオード (ツェナー)", nameEn: "Zener diode", desc: "カソードバーに折り返し",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"}], sim: "none", bounds: [-6.5,-2, 13, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5 M4.5,14 V12"/>`,
  },
  {
    id: "thyristor", db: true, group: "半導体", jis: "05-04-04", cat: "db", letter: "SCR",
    name: "サイリスタ", nameEn: "Thyristor", desc: "逆阻止3端子サイリスタ",
    pins: [{x:0,y:0,n:"A"},{x:0,y:20,n:"K"},{x:10,y:20,n:"G"}], sim: "none", bounds: [-6.5,-2, 18.5, 24],
    body: `<path d="M0,0 V6 M0,20 V14 M-4.5,6 L4.5,6 L0,14 Z M-4.5,14 H4.5"/><path d="M10,20 V16 L4.5,14"/>`,
  },
  {
    id: "tr_npn", db: true, group: "半導体", jis: "05-05-01", cat: "db", letter: "Q",
    name: "トランジスタ (NPN)", nameEn: "NPN transistor", desc: "エミッタ矢印は外向き",
    pins: [{x:-10,y:10,n:"B"},{x:0,y:0,n:"C"},{x:0,y:20,n:"E"}], sim: "none", bounds: [-12,-2, 21.5, 24],
    body: `<circle cx="0" cy="10" r="7.5"/><path d="M-10,10 H-3 M-3,5.5 V14.5 M-3,8 L0,3 M0,3 V0 M-3,12 L0,17 M0,17 V20"/><path d="M0,17 L-0.38,15.037 L-1.553,15.74 Z" fill="currentColor"/>`,
  },

  /* ── 電源・変換 (JIS C 0617-6) ── */
  {
    id: "battery", db: true, group: "電源・変換", jis: "06-15-01", cat: "db", letter: "BAT",
    name: "電池", nameEn: "Battery", desc: "長線=+、短線=−",
    pins: [{x:0,y:0,n:"+"},{x:0,y:20,n:"-"}], sim: "none", bounds: [-8,-2, 17.5, 24],
    body: `<path d="M0,0 V8.5 M0,20 V12 M-6,8.5 H6 M-2.8,12 H2.8"/><path d="M4.5,3 H7.5 M6,1.5 V4.5"/>`,
  },
  {
    id: "autotrafo", db: true, group: "電源・変換", jis: "06-09-08", cat: "db", letter: "TR",
    name: "単巻変圧器", nameEn: "Autotransformer", desc: "共通巻線+タップ",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:10,n:"3"}], sim: "trafo", bounds: [-2,-2, 14, 24],
    body: `<path d="M0,0 V2.5"/><path d="M0,2.5 A2.5,2.5 0 0 1 0,7.5 A2.5,2.5 0 0 1 0,12.5 A2.5,2.5 0 0 1 0,17.5"/><path d="M0,17.5 V20 M2.5,10 H10"/>`,
  },
  {
    id: "ct", db: true, group: "電源・変換", jis: "06-09-11", cat: "db", letter: "CT",
    name: "変流器 (CT)", nameEn: "Current transformer", desc: "一次貫通導体+二次巻線円",
    pins: [{x:0,y:0,n:"P1"},{x:0,y:20,n:"P2"},{x:10,y:5,n:"S1"},{x:10,y:15,n:"S2"}], sim: "passthru", bounds: [-7.5,-2, 19.5, 24],
    body: `<path d="M0,0 V20"/><circle cx="0" cy="10" r="5.5"/><path d="M3.889,6.111 L10,5"/><path d="M3.889,13.889 L10,15"/>`,
  },
  {
    id: "rectifier", stdNote: "整流器 (合成記号)", db: true, group: "電源・変換", cat: "db", letter: "REC",
    name: "整流器", nameEn: "Rectifier", desc: "箱+ダイオード記号 (AC→DC)",
    pins: [{x:-5,y:0,n:"~"},{x:5,y:0,n:"~"},{x:-5,y:30,n:"+"},{x:5,y:30,n:"-"}], sim: "none", horizontalPins: true, bounds: [-14,-2, 28, 34],
    body: `<path d="M-5,0 V5 M5,0 V5 M-5,30 V25 M5,25 V30"/><rect x="-12" y="5" width="24" height="20"/><path d="M12,5 L-12,25"/><text x="-7" y="12.5" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><path d="M4,20 H10"/><path d="M4,22.4 H10" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "inverter_box", nonstd: true, db: true, group: "電源・変換", cat: "db", letter: "INV",
    name: "インバータ (INV)", nameEn: "Inverter / VFD", desc: "可変周波数駆動装置 R/S/T→U/V/W (一次側に PE。モータフレーム接地は別途)",
    typ: "FR-D720", horizontalPins: true,
    // PE は末尾に追加 (R/S/T/U/V/W の index と既存図面の配線座標を保持)。
    // 端子脇は保護接地 IEC 60617 02-15-03 (丸囲み)。対角線と干渉しないよう PE は R の左 (x=-15) に置く
    pins: [{x:-10,y:0,n:"R"},{x:0,y:0,n:"S"},{x:10,y:0,n:"T"},{x:-10,y:30,n:"U"},{x:0,y:30,n:"V"},{x:10,y:30,n:"W"},{x:-15,y:0,n:"PE"}],
    sim: "none", bounds: [-22,-2, 39, 34],
    body: `<path d="M-15,0 V5 M-10,0 V5 M0,0 V5 M10,0 V5 M-10,30 V25 M0,25 V30 M10,25 V30"/><rect x="-20" y="5" width="35" height="20"/><path d="M15,5 L-20,25"/><circle cx="-15" cy="8.8" r="3"/><path d="M-15,6.7 V8.7 M-16.6,8.7 H-13.4 M-16.05,9.8 H-13.95 M-15.5,10.9 H-14.5"/><text x="-6" y="13" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><text x="9" y="23" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">~</text><text x="3.5" y="20" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">INV</text>`,
  },
  {
    id: "ps_box", nonstd: true, db: true, group: "電源・変換", cat: "db", letter: "PSU",
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
    id: "elb2", jis: "07-13-08", db: true, group: "開閉・保護", cat: "db", letter: "ELB",
    name: "漏電遮断器 (ELB/ELCB) 2P", nameEn: "Earth-leakage breaker 2P", desc: "零相変流器つき遮断器 (単相用)", typ: "NV32-SV 2P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "breaker2", bounds: [-6.8,-2, 21.8, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g>` + gLink(bladeXNO(10.5), bladeXNO(10.5) + 10, 10.5) + `<path d="M5,19.8 A8,2.3 0 1 0 5,15.2 A8,2.3 0 1 0 5,19.8"/>`,
  },
  {
    id: "elb3", jis: "07-13-08", db: true, group: "開閉・保護", cat: "db", letter: "ELB",
    name: "漏電遮断器 (ELB/ELCB) 3P", nameEn: "Earth-leakage breaker 3P", desc: "零相変流器つき遮断器 (三相用)", typ: "NV63-CV 3P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "breaker3", bounds: [-6.8,-2, 31.8, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g><g transform="translate(20,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-1.8,5.2 L1.8,8.8 M-1.8,8.8 L1.8,5.2"/></g>` + gLink(bladeXNO(10.5), bladeXNO(10.5) + 20, 10.5) + `<path d="M10,19.8 A13,2.3 0 1 0 10,15.2 A13,2.3 0 1 0 10,19.8"/>`,
  },
  {
    id: "disconnector", db: true, group: "開閉・保護", jis: "07-13-06", cat: "db", letter: "DS",
    name: "断路器", nameEn: "Disconnector", desc: "無負荷開閉用",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "breaker", bounds: [-6.8,-2, 11.8, 24],
    body: `<path d="M0,0 V7 M-3,7 H3 M0,20 V13 M0,13 L-4.8,5"/>`,
  },
  {
    /* 操作スイッチ用の切替接点 (共通が中央)。標準の c接点は補助接点 aux_co
       (07-02-04) の方で、こちらは実務でよく見る変形。同じ番号を別の図形に
       付けないよう jis は名乗らず、stdNote で断る */
    id: "changeover", db: true, group: "開閉・保護", cat: "db", letter: "COS",
    stdNote: "切替接点 (07-02-04) の変形 — 共通を中央に置いた操作スイッチ用の実務図。" +
      "端子表示 NO/NC/COM も北米慣行 (JIS C 8201-1 の数字表示は 11/12/14)。図記号・端子表示とも規格原本との照合が必要",
    name: "切替接点 (c接点・操作スイッチ用)", nameEn: "Changeover contact", desc: "1回路2接点。不動作時はNC側に接触 (共通は下)",
    /* 端子の並びは a側 → b側 → 共通 (conductivePairs の切替接点と同じ順)。
       座標は変えていないので、既にこの記号で描いた配線はそのまま */
    pins: [{x:10,y:0,n:"NO"},{x:0,y:0,n:"NC"},{x:5,y:20,n:"COM"}], sim: "changeover", bounds: [-3.5,-2, 17, 24],
    /* a 側 (メーク) の固定接点は導線の端で表す (横バーを付けるとブレーク要素に
       読める)。可動刃は b 側のバーを越えて描く — 突き当てで止めると接触して
       いるのか届いていないのか読めない */
    body: `<path d="M0,0 V7 M-1.5,7 H3 M10,0 V7 M5,20 V13 M5,13 L0.6,5.5"/>`,
  },
  {
    id: "arrester", jis: "05-04-01", db: true, group: "開閉・保護", cat: "db", letter: "LA",
    name: "避雷器 (アレスタ)", nameEn: "Surge arrester", desc: "サージ保護デバイス",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-5.5,-2, 11, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-3.5" y="4" width="7" height="12"/><path d="M0,5.5 V12 M0,14.5 L-1.8,11.5 H1.8 L0,14.5 Z"/>`,
  },

  /* ── 計器・信号 (JIS C 0617-8) ── */
  {
    id: "voltmeter", db: true, group: "計器・信号", jis: "08-02-01", cat: "db", letter: "VM",
    name: "電圧計", nameEn: "Voltmeter",  desc: "指示計器 V",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><circle cx="0" cy="10" r="6"/><text x="0" y="12.3" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">V</text>`,
  },
  {
    id: "ammeter", db: true, group: "計器・信号", jis: "08-02-01", cat: "db", letter: "AM",
    name: "電流計", nameEn: "Ammeter", desc: "指示計器 A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "none", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><circle cx="0" cy="10" r="6"/><text x="0" y="12.3" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">A</text>`,
  },
  {
    id: "hour_meter", db: true, group: "計器・信号", jis: "08-04-01", cat: "db", letter: "HM",
    name: "時間計 (アワメータ)", nameEn: "Hour meter", desc: "運転時間の積算計",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-8,-2, 16, 24],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-6" y="4" width="12" height="12"/><text x="0" y="12.6" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-style="italic">h</text>`,
  },
  {
    id: "bell", db: true, group: "計器・信号", stdNote: "電鈴 (JIS C 0617-8 音響信号装置。ランプ 08-10-01 とは別図)", cat: "db", letter: "BL",
    name: "ベル", nameEn: "Bell", desc: "電鈴 (外側の打鈴子で ブザーと区別)",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-8.5,-2, 17, 24],
    body: `<path d="M0,0 V6.5"/><path d="M-6.5,13 A6.5,6.5 0 0 1 6.5,13"/><path d="M-6.5,13 H6.5"/><path d="M0,20 V13"/><circle cx="4" cy="10.5" r="1.6"/>`,
  },
  {
    id: "horn", jis: "08-10-04", db: true, group: "計器・信号", cat: "db", letter: "SP",
    name: "スピーカ (拡声器)", nameEn: "Loudspeaker", desc: "音響信号装置 (箱+コーン)",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "load", bounds: [-5,-2, 15, 24],
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-3" y="6" width="6" height="8"/><path d="M3,6 L8,3 V17 L3,14"/>`,
  },

  /* ── 実務機器 (盤設計でよく使う非規格ボックス) ── */
  {
    id: "plc_box", nonstd: true, db: true, group: "実務機器", cat: "db", letter: "PLC",
    name: "PLC 本体", nameEn: "PLC unit", desc: "PLC本体 (電源のみ接続: 上側 AC_L / AC_N / FG の3端子)", typ: "FX5U",
    horizontalPins: true,
    pins: [{x:-15,y:0,n:"AC_L"},{x:0,y:0,n:"AC_N"},{x:15,y:0,n:"FG"}],
    sim: "none", bounds: [-22,-2, 44, 29],
    // FG 端子脇は接地(一般) IEC 60617 02-15-01 (FG=機能接地なので保護接地記号は用いない)。
    // 旧版 (ピン ±10/I0〜Q3) で保存した図面は自動追従しない — DRC の未接続ピン警告で検出し手動で再配線する運用
    body: `<path d="M-15,0 V5 M0,0 V5 M15,0 V5"/><rect x="-20" y="5" width="40" height="20"/><path d="M15,5 V8 M13.2,8 H16.8 M13.8,9.2 H16.2 M14.4,10.4 H15.6"/><text x="0" y="17.5" data-h="3.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">PLC</text>`,
  },
  {
    id: "fan", stdNote: "送風機 (電動機 06-04-01 に羽根を付した実務記号)", db: true, group: "実務機器", cat: "db", letter: "FAN",
    name: "換気ファン (FAN)", nameEn: "Fan", desc: "盤用換気扇", typ: "MF-950",
    pins: [{x:0,y:0,n:"1"},{x:0,y:35,n:"2"}], sim: "load", bounds: [-10,-2, 20, 39],
    body: `<path d="M0,0 V8 M0,35 V24"/><circle cx="0" cy="16" r="8"/><path d="M0,16 C-2,11 2,11 0,8 M0,16 C5,14 5,18 8,16 M0,16 C2,21 -2,21 0,24 M0,16 C-5,18 -5,14 -8,16"/>`,
  },
{
    id: "mms", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "開閉・保護", cat: "db", letter: "MMS",
    name: "モータブレーカ (MMS) 3P", nameEn: "Manual motor starter", desc: "手動モータスタータ (遮断器+熱動素子)。図記号はサーキットプロテクタと同形で、極数と品名で区別する", typ: "MMP-T32 2.5A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "breaker3", mirror: true, maxContacts: 2, bounds: [-6.8,-2, 30.6, 24],
    body: `<g>${G_CP}</g><g transform="translate(10,0)">${G_CP}</g><g transform="translate(20,0)">${G_CP}</g>` +
      gLink(bladeXNO(10.5), bladeXNO(10.5) + 20, 10.5),
  },

  {
    id: "cb_aux_no", jis: "07-02-01", db: true, group: "開閉・保護", cat: "db", letter: "AX",
    name: "遮断器補助接点 (AX)", nameEn: "Breaker aux contact", desc: "MCCB/ELBの補助a接点 (投入で閉)。遮断器にリンクして使用",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 8.8, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/>`,
  },
  {
    id: "cb_al_no", jis: "07-02-01", db: true, group: "開閉・保護", cat: "db", letter: "AL",
    name: "遮断器警報接点 (AL)", nameEn: "Breaker alarm contact", desc: "トリップで閉じる警報a接点。遮断器にリンクして使用",
    pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}], sim: "contact_no", linked: true, bounds: [-9.5,-2, 11.5, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/><path d="M-7.5,9 L-6,11.5 L-4.5,9"/>` + gLink(-6, bladeXNO(11.5), 11.5) + ``,
  },
  {
    id: "pb_lamp", stdNote: "押しボタン (07-07-02) と表示灯 (08-10-01) の合成記号", db: true, group: "実務機器", cat: "db", letter: "PBL",
    name: "照光押しボタン", nameEn: "Illuminated pushbutton", desc: "押しボタンa接点+表示灯の複合 (灯側 X1/X2)", typ: "XB4-BW33B1",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"},{x:15,y:0,n:"X1"},{x:15,y:20,n:"X2"}],
    sim: "contact_no", momentary: true, bounds: [-17,-2, 39.5, 24],
    body: `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/>` + G_PB(bladeXNO(10)) + `<g transform="translate(15,0)"><path d="M0,0 V4.5 M0,20 V15.5"/><circle cx="0" cy="10" r="5.5"/><path d="M-3.9,6.1 L3.9,13.9 M-3.9,13.9 L3.9,6.1"/></g>`,
  },
  {
    id: "sel3", stdNote: "手動回転操作 (07-06-01) の3位置形", db: true, group: "実務機器", cat: "db", letter: "SS",
    name: "3位置セレクタ (手動-切-自動)", nameEn: "3-position selector", desc: "左=手動接点 / 右=自動接点。中央位置で両開", typ: "XB4-BD33",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"},{x:10,y:0,n:"23"},{x:10,y:20,n:"24"}],
    sim: "contact2_no", bounds: [-17,-2, 29, 24],
    body: `<g><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/></g><g transform="translate(10,0)"><path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/></g><path d="M-2.4,9 L7.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/><path d="M-15,6 L-11,9 L-15,12"/>` + gLink(-11, bladeXNO(9), 9) + ``,
  },

  /* ── シーケンス制御でよく使う記号 (提供資料「シーケンス制御回路でよく使う記号」より) ── */
  {
    id: "cp1", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "よく使う記号", cat: "db", letter: "CP",
    name: "サーキットプロテクタ (CP) 1P", nameEn: "Circuit protector 1P",
    desc: "制御回路の小容量保護器。過電流で開路 (熱動+電磁)", typ: "CP30-BA 1P 10A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "breaker", bounds: [-6.8,-2, 10.6, 24],
    body: G_CP,
  },
  {
    id: "cp2", stdNote: "遮断器 (07-13-05) と熱動素子 (07-21-04) の合成記号", db: true, group: "よく使う記号", cat: "db", letter: "CP",
    name: "サーキットプロテクタ (CP) 2P", nameEn: "Circuit protector 2P",
    desc: "単相制御回路の保護器 (2極連動)", typ: "CP30-BA 2P 10A",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "breaker2", bounds: [-6.8,-2, 20.6, 24],
    body: `<g>${G_CP}</g><g transform="translate(10,0)">${G_CP}</g>` +
      gLink(bladeXNO(10.5), bladeXNO(10.5) + 10, 10.5),
  },

  {
    id: "ms_no", jis: "07-02-01", db: true, group: "よく使う記号", cat: "db", letter: "MS",
    name: "電磁開閉器 (MS) A接点", nameEn: "Magnetic starter NO contact",
    desc: "電磁開閉器・電磁接触器の補助メーク接点 (文字記号 Q)。図記号はリレー補助接点と同形で、機器の文字記号で区別する。コイルにリンクして使用", typ: "",
    pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 8.8, 24],
    body: G_NO,
  },
  {
    id: "ms_nc", jis: "07-02-03", db: true, group: "よく使う記号", cat: "db", letter: "MS",
    name: "電磁開閉器 (MS) B接点", nameEn: "Magnetic starter NC contact",
    desc: "電磁開閉器・電磁接触器の補助ブレーク接点 (文字記号 Q)。図記号はリレー補助接点と同形で、機器の文字記号で区別する。コイルにリンクして使用", typ: "",
    pins: [{x:0,y:0,n:"21"},{x:0,y:20,n:"22"}], sim: "contact_nc", linked: true, bounds: [-7,-2, 9, 24],
    body: G_NC,
  },
  {
    id: "cont_no_main", db: true, group: "よく使う記号", jis: "07-13-02", cat: "db", letter: "MC",
    name: "電磁接触器 主メーク接点 1極", nameEn: "Contactor main contact 1P",
    desc: "固定接点に接触器機能の半円を付けたメーク接点 (3極版は「電磁接触器 主接点」)", typ: "",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "contact_no", linked: true, bounds: [-6.8,-2, 10.6, 24],
    body: G_NO_CONT,
  },
  {
    id: "cont_nc_main", db: true, group: "よく使う記号", jis: "07-13-03", cat: "db", letter: "MC",
    name: "電磁接触器 主ブレーク接点 1極", nameEn: "Contactor main NC contact 1P",
    desc: "接触器機能つきブレーク接点", typ: "",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}], sim: "contact_nc", linked: true, bounds: [-10,-2, 12, 24],
    body: G_NC_CONT,
  },
  /* ── 通信・コネクタ (実機の端子配列に合わせた多極コネクタ) ──
     コントローラの通信ポートは、極数だけでは EtherNet/IP・USB・HDMI を見分け
     られない。受け口を正面から見た形を細線で添えて一目で分かるようにする。
     細線 (0.25mm) にしてあるのは、これが電気的な意味を持つ図記号ではなく
     「どの規格の口か」を示す説明図だから (JIS Z 8312 の細線)。 */
  mkPort({ id: "conn_rj45", label: "RJ45", letter: "X", fn: "EtherNet/IP",
    name: "EtherNet/IP ポート (RJ45)", nameEn: "EtherNet/IP port (RJ45)",
    desc: "8極モジュラジャック。EtherNet/IP・PROFINET など産業用イーサネット共通。ツメ (ラッチ) 付きの受け口。端子 1=TD+ 2=TD- 3=RD+ 6=RD- (100BASE-TX)",
    typ: "8P8C シールド付",
    /* RJ45 ジャック正面。LAN の口と一目で分かるように、モジュラジャック特有の
       「2 段のラッチ溝」(肩が 2 回すぼまる) を描き、接点 8 本も長めに出す。
       1 段だけだと角穴にしか見えない */
    glyph: '<path d="M-6,-4 H6 V0.6 H3.9 V2.3 H1.9 V4 H-1.9 V2.3 H-3.9 V0.6 H-6 Z" stroke-width="0.25" stroke-linejoin="miter"/>' +
           '<path d="M-3.85,-4 V-1 M-2.75,-4 V-1 M-1.65,-4 V-1 M-0.55,-4 V-1 M0.55,-4 V-1 M1.65,-4 V-1 M2.75,-4 V-1 M3.85,-4 V-1" stroke-width="0.25"/>' }),
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
const DB_PINNED_VER = 7;
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

/* ── シンボルの分類の入れ替え (localStorage) ──
   ライブラリの全記号はデータベースに載っていて、パレット上の分類
   (インプット機器 / ロジック機器 / アウトプット機器 …) を記号ごとに
   移し替えられる。id → SYM_CATS のキー。元の分類に戻したら記録を消す */
let SYM_CAT_OVR = {};
(function symCatLoad() {
  try {
    const s = localStorage.getItem("electracad.symCats");
    const v = s ? JSON.parse(s) : {};
    SYM_CAT_OVR = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (e) { SYM_CAT_OVR = {}; }
})();
function symCatOf(s) {
  const c = SYM_CAT_OVR[s.id] || s.cat || "db";
  return allCats()[c] ? c : (s.cat || "db");   // 消した棚に居た記号は元の棚へ戻す
}
function setSymCat(id, cat) {
  const base = SYMBOLS_BY_ID[id];
  if (!base || !allCats()[cat]) return;
  if (cat === (base.cat || "db")) delete SYM_CAT_OVR[id];
  else SYM_CAT_OVR[id] = cat;
  try { localStorage.setItem("electracad.symCats", JSON.stringify(SYM_CAT_OVR)); } catch (e) { }
}

/* ── パレットの棚 (分類) の追加 ──
   標準の棚 (SYM_CATS) に、使う人が作った棚を足せる。id → { name, color }。
   localStorage に持ち、記号の割り当ては既存の分類入れ替え (SYM_CAT_OVR) と同じ */
let USER_CATS = {};
(function userCatLoad() {
  try {
    const v = JSON.parse(localStorage.getItem("electracad.userCats") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) USER_CATS = v;
  } catch (e) { USER_CATS = {}; }
})();
function userCatSave() {
  try { localStorage.setItem("electracad.userCats", JSON.stringify(USER_CATS)); } catch (e) { }
}
/** 標準 + 自分で作った棚。データベースの棚は最後に置く (並びを崩さない) */
function allCats() {
  const out = {};
  Object.entries(SYM_CATS).forEach(([k, v]) => { if (k !== "db") out[k] = v; });
  Object.entries(USER_CATS).forEach(([k, v]) => { out[k] = v; });
  if (SYM_CATS.db) out.db = SYM_CATS.db;
  return out;
}
function isUserCat(id) { return !!USER_CATS[id]; }
/** 棚の色の候補 (パレットの点の色) */
const CAT_COLORS = ["#3ddc97", "#4da3ff", "#ffb454", "#c792ea", "#8b96ab", "#e5c07b", "#ff7b72", "#5ccfe6"];
/** 棚を足す。名前が空・重複なら null。返り値は新しい棚の id */
function addUserCat(name, color) {
  const nm = String(name || "").trim();
  if (!nm) return null;
  if (Object.values(allCats()).some(c => c.name === nm)) return null;   // 同じ名前の棚は作らない
  const id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  USER_CATS[id] = { name: nm, color: color || CAT_COLORS[Object.keys(USER_CATS).length % CAT_COLORS.length] };
  userCatSave();
  return id;
}
/** 棚の名前・色を変える (自分で作った棚だけ) */
function renameUserCat(id, name, color) {
  if (!USER_CATS[id]) return false;
  const nm = String(name || "").trim();
  if (!nm) return false;
  if (Object.entries(allCats()).some(([k, c]) => k !== id && c.name === nm)) return false;
  USER_CATS[id] = { name: nm, color: color || USER_CATS[id].color };
  userCatSave();
  return true;
}
/** 棚を消す。その棚に入れていた記号は元の分類へ戻る */
function deleteUserCat(id) {
  if (!USER_CATS[id]) return 0;
  let moved = 0;
  // この棚へ移していた記号は、元の分類へ戻す
  Object.keys(SYM_CAT_OVR).forEach(sid => { if (SYM_CAT_OVR[sid] === id) { delete SYM_CAT_OVR[sid]; moved++; } });
  delete USER_CATS[id];
  userCatSave();
  try { localStorage.setItem("electracad.symCats", JSON.stringify(SYM_CAT_OVR)); } catch (e) { }
  return moved;
}

/* デバイスタグの表示モード (シンボル単位・localStorage)。
   "show"    = 画面にも PDF/DXF 出力にも出す
   "hide"    = どこにも出さない
   "noprint" = 画面には出すが、PDF/DXF 出力には出さない (既定)
   タグは作図中の手がかりとして要るが、納品する紙には載せたくない、が既定の運用 */
const TAG_VIS_MODES = ["show", "hide", "noprint"];
const TAG_VIS_DEFAULT = "noprint";
let SYM_TAG_VIS = {};
(function symTagVisLoad() {
  try {
    const s2 = localStorage.getItem("electracad.symTagVis");
    const v = s2 ? JSON.parse(s2) : {};
    SYM_TAG_VIS = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (e) { SYM_TAG_VIS = {}; }
})();
function symTagVis(sym) {
  const v = sym && SYM_TAG_VIS[sym.id];
  return TAG_VIS_MODES.includes(v) ? v : TAG_VIS_DEFAULT;
}
function setSymTagVis(id, v) {
  if (!TAG_VIS_MODES.includes(v)) return;
  if (v === TAG_VIS_DEFAULT) delete SYM_TAG_VIS[id];
  else SYM_TAG_VIS[id] = v;
  try { localStorage.setItem("electracad.symTagVis", JSON.stringify(SYM_TAG_VIS)); } catch (e) { }
}
/** タグをこの場面 (print = PDF/DXF 出力) で出すか */
function tagShownFor(dev, print) {
  const v = symTagVis(symOf(dev.sym));
  if (v === "hide") return false;
  if (v === "noprint") return !print;
  return true;
}

/* パレットから外した記号 (localStorage)。「データベース」以外の分類の記号は
   既定で棚に出るので、外したものだけをここに記録する */
function symHiddenList() {
  try {
    const v = JSON.parse(localStorage.getItem("electracad.symHidden") || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function symSetHidden(list) {
  try { localStorage.setItem("electracad.symHidden", JSON.stringify(list)); } catch (e) { }
}

/* ── シンボルの版管理 ──────────────────────────
   既存シンボルを編集すると、同じ id を上書きせず「新しい版」(別 id) として
   登録する。置いてある機器は元の版の id を持ち続けるので、この図面でも
   別の案件の図面でも絵は変わらない — 変更が効くのはシンボルを追加する
   ときから。版の id は「元id~2」「元id~3」…、verOf に元 (根) の id を持つ。
   パレット・シンボルDBにはいちばん新しい版だけを出す。
   retired = その版をパレットから退かせた印 (置いてある機器のためには残す) */
function symBaseOf(sym) { return (sym && sym.verOf) || (sym && String(sym.id).replace(/~\d+$/, "")) || ""; }
/** id だけから元 (根) の id を引く (機器の特別扱い判定に使う) */
function symBaseIdOf(id) {
  const s = SYMBOLS_BY_ID[id];
  return s ? symBaseOf(s) : String(id).replace(/~\d+$/, "");
}
/** 次の版の id (空いている番号まで進める) */
function symNextVerId(fromId) {
  const base = symBaseIdOf(fromId);
  let n = 2;
  while (SYMBOLS_BY_ID[`${base}~${n}`]) n++;
  return `${base}~${n}`;
}
/** 元 id → いちばん新しい版 {n, id} (退役した版は数えない) */
function symLatestMap() {
  const best = {};
  [...SYMBOLS, ...DB_SYMBOLS].forEach(s2 => {
    if (s2.retired) return;
    const b = symBaseOf(s2);
    const m = /~(\d+)$/.exec(s2.id);
    const n = m ? +m[1] : 1;
    if (!best[b] || n > best[b].n) best[b] = { n, id: s2.id };
  });
  return best;
}
/** 絵と働きが同じか (名前などの付帯情報は見ない)。版を増やすかの判定に使う */
function symSameDrawing(a, b) {
  const pick = s2 => JSON.stringify({ body: s2.body, pins: s2.pins, bounds: s2.bounds,
    sim: s2.sim, funcs: s2.funcs || null, lw: s2.lw || null });
  return !!a && !!b && pick(a) === pick(b);
}
/** 棚の割当・パレットのピン/外し・タグ表示の設定を新しい版へ引き継ぐ */
function symCarryPrefs(oldId, newId) {
  if (SYM_CAT_OVR[oldId] && !SYM_CAT_OVR[newId]) {
    SYM_CAT_OVR[newId] = SYM_CAT_OVR[oldId];
    try { localStorage.setItem("electracad.symCats", JSON.stringify(SYM_CAT_OVR)); } catch (e) { }
  }
  const tv = SYM_TAG_VIS[oldId];
  if (tv) setSymTagVis(newId, tv);
  const pin = dbPinnedList();
  if (pin.includes(oldId)) dbSetPinned([...new Set(pin.map(x => (x === oldId ? newId : x)))]);
  const hid = symHiddenList();
  if (hid.includes(oldId) && !hid.includes(newId)) symSetHidden([...hid, newId]);
}
/** その元 id に「生きた」(退役していない) 定義が 1 つでもあるか */
function symHasLiveOf(baseId) {
  return [...SYMBOLS, ...DB_SYMBOLS].some(s2 => symBaseOf(s2) === baseId && !s2.retired);
}
/** その元 id の版すべてをパレットから退かせる (「元に戻す」)。
    置いてある機器のために定義は消さない */
function symRetireVersions(baseId) {
  let n = 0;
  DB_SYMBOLS.forEach(s2 => {
    if (symBaseOf(s2) === baseId && s2.id !== baseId && s2.imported && !s2.retired) { s2.retired = true; n++; }
  });
  if (n && typeof symSerTouch === "function") symSerTouch();   // 直列化の使い回しを破棄
  return n;
}

/* キーエンス KV Nano 基本ユニットの入出力結線図 (機種を差し替えれば端子ごと入れ替わる) */
KV_UNITS.forEach(([m, cfg]) => mkKvUnit(m, cfg).forEach(s2 => {
  if (s2.altOf) { SYMBOLS_BY_ID[s2.id] = s2; return; }   // 台数違いはパレットに出さない (プロパティで差し替える)
  DB_SYMBOLS.push(s2);
}));

/* ── 三菱 MELSEC iQ-R ユニットの入出力結線図 ──
   作り (枠・端子・レール・機能欄・行ピッチ) は KV Nano と同じ機構を使い、
   接点構成 (端子の刻印・コモン・空き端子) は三菱の取扱説明書どおり:
   ・RX40C7   … DC入力 16点 (＋/−コモン共用)。18点端子台。
                TB1〜TB16 = X00〜X0F、TB17 = COM、TB18 = 空き端子 (結線禁止)
   ・RY40NT5P … トランジスタ出力 (シンク) 16点。DC12/24V 0.5A/点・5A/コモン。
                TB1〜TB16 = Y00〜Y0F、TB18 = COM、TB17 = 空き端子
   デバイス番号は 16進 (X00〜X0F / Y00〜Y0F)。空き端子は結線してはいけない
   端子なので行としては描かない (注記で知らせる) */
const MEL_UNITS = [
  ["RX40C7", { kind: "入力", pts: 16, head: "X0", com: "COM",
    comTB: "TB17", vacantTB: "TB18",
    spec: "DC24V 7mA・プラスコモン/マイナスコモン共用・16点/1コモン" }],
  ["RY40NT5P", { kind: "出力", pts: 16, head: "Y0", com: "COM",
    comTB: "TB18", vacantTB: "TB17",
    spec: "トランジスタ出力 (シンク)・DC12/24V 0.5A/点・5A/コモン・16点/1コモン" }],
];
function mkMelUnit(model, cfg) {
  const isIn = cfg.kind === "入力";
  // デバイス番号は 16進: X00〜X0F / Y00〜Y0F
  const dev = i => cfg.head + i.toString(16).toUpperCase();
  /* 端子名はデバイス番号 + 括弧で端子台の TB 番号を併記する。
     RX40C7 は TB17 = COM だが RY40NT5P は TB18 = COM と物理位置が入れ違いで、
     番号が紙に無いと出力の COM を空き端子 (TB17) に締める誤配線を誘発する */
  const seq = [];
  for (let i = 0; i < cfg.pts; i++) seq.push({ n: dev(i), disp: `${dev(i)} (${i + 1})`, io: true, noDrc: true });
  seq.push({ n: cfg.com, disp: `${cfg.com} (${cfg.comTB.replace("TB", "")})`, io: false });   // コモンは結び忘れを知らせる (noDrc にしない)
  return mkKvSheet({
    id: model.toLowerCase() + (isIn ? "_in" : "_out"),
    model, title: `${cfg.kind} ${cfg.pts}点`, seq, allSeqs: [seq],
    /* 下地は DC24V の想定 (KV と同じ規則):
       入力は COM = +24V (プラスコモン・シンク入力/NPN 機器)、機器の帰りは N24V。
       出力 (シンク) はコモンを N24V へ、負荷の帰りは P24V */
    railTags: isIn ? { branch: "N24V", supply: "P24V" } : { branch: "P24V", supply: "N24V" },
    fieldSide: isIn ? "left" : "right",
    swapGroup: `melsec_${isIn ? "in" : "out"}`,
    name: `${model} ${cfg.kind}結線図`,
    nameEn: `${model} ${isIn ? "input" : "output"} wiring`,
    /* 紙に必ず載る注記 (箱の下)。COM の物理位置が 2 形式で入れ違いのため、
       空き端子の結線禁止と TB 番号の意味は注記貼付を待たず図自体で知らせる */
    expNote: `※( )内は端子台の TB 番号。${cfg.vacantTB} は空き端子 — 結線禁止` +
      (isIn ? "" : "　定格 DC12/24V 0.5A/点・5A/コモン (誘導負荷は還流ダイオード推奨)"),
    stdNote: "機器の端子配置を写した実務用の枠記号 (JIS C 0617-1 の作成原則で構成: " +
      "外郭 + 端子 + 端子指示。端子の図記号番号は規格原本との照合が必要)。" +
      `端子の並びは三菱 MELSEC iQ-R ${model} の取扱説明書どおり (${cfg.comTB} = COM)。` +
      `図の端子名はデバイス番号 (${dev(0)}〜${dev(cfg.pts - 1)})、括弧の数字が端子台の刻印 (TB 番号)。` +
      `${cfg.vacantTB} は空き端子 (結線禁止) のため描いていない。` +
      "ユニットの電源と接地は別紙の電源回路図に描きます",
    desc: `三菱 MELSEC iQ-R ${model} の${cfg.kind}結線図 (${dev(0)}〜${dev(cfg.pts - 1)} の${cfg.pts}点)。` +
      `${cfg.spec}。端子台は 18点ねじ端子 (TB1〜TB16 = ${dev(0)}〜${dev(cfg.pts - 1)}、${cfg.comTB} = COM、${cfg.vacantTB} = 空き端子・結線禁止)。` +
      (isIn ? `下地は COM = +24V のプラスコモン (シンク入力・NPN 機器向け)。ソース入力 (マイナスコモン・COM = 0V) で使うときはレールのタグを描き替えてください。`
            : `シンク出力: 負荷は出力端子と P24V の間、COM は N24V (0V) へ。`) +
      `置くと P24V/N24V のレールとコモンの結線が実線で引かれます — 端子までの配線は自分で引きます。` +
      `機能欄の文言はプロパティでまとめて入れられます。ユニットの電源と接地は別紙の電源回路図に描きます。`,
  });
}
MEL_UNITS.forEach(([m, cfg]) => DB_SYMBOLS.push(mkMelUnit(m, cfg)));

// 全シンボル辞書へ統合 (描画・配置・部品表・DXFすべてで使える)
DB_SYMBOLS.forEach(s => { SYMBOLS_BY_ID[s.id] = s; });
