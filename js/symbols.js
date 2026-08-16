/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — IEC 60617 シンボルライブラリ
   座標系: 1単位 = 1mm。制御回路シンボルは縦向き(電流は上→下)、
   接続ピンは 20mm ピッチのグリッド上に置く。
   typ: 部品表用の代表型式 (配置時のデフォルト)
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const SYM_STROKE = 1.3;

// カテゴリ定義
const SYM_CATS = {
  input:  { name: "インプット機器",   color: "#3ddc97" },
  logic:  { name: "ロジック機器",     color: "#4da3ff" },
  output: { name: "アウトプット機器", color: "#ffb454" },
  power:  { name: "電源・保護",       color: "#c792ea" },
  misc:   { name: "端子・その他",     color: "#8b96ab" },
  db:     { name: "データベース",     color: "#e5c07b" },
};

// ── 部品ジオメトリのヘルパ ─────────────────────────────
// 縦型接点: ピン(0,0)-(0,20)
const G_NO = `<path d="M0,0 V7 M0,20 V13 M0,13 L-4.8,5"/>`;
const G_NC = `<path d="M0,0 V7 M0,7 H-5 M0,13 L-4.8,3.4 M0,20 V13"/>`;
// 押しボタン操作部 (E形キャップ + 破線リンク)
const G_PB = `<path d="M-12,6.5 H-15 V13.5 H-12"/><path d="M-15,10 H-13" /><path d="M-11,10 H-1.8" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`;
// キノコ頭 (非常停止)
const G_MUSH = `<path d="M-13,4.5 A6.5,6.5 0 0 0 -13,15.5"/><path d="M-13,4.5 V15.5"/><path d="M-13,10 H-11"/><path d="M-11,10 H-1.8" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/><path d="M-8.5,10 L-7,12.5 L-5.5,10" />`;
// 接触器主接点1極 (固定接点に接触器機能の小円弧)
const G_NO_CONT = G_NO + `<path d="M-1.8,7 A1.8,1.8 0 0 0 1.8,7"/>`;
// 遮断器1極 (接点 + ×)
const G_CB = G_NO + `<path d="M-1.8,11.2 L1.8,14.8 M-1.8,14.8 L1.8,11.2"/>`;
// サーマル1極 (熱動素子の凸形迂回)
const G_OL = `<path d="M0,0 V7 M0,7 H-3 V13 H0 M0,13 V20"/>`;

const SYMBOLS = [

  /* ══════════ インプット機器 ══════════ */
  {
    id: "pb_no", cat: "input", letter: "S", name: "押しボタン (a接点)", nameEn: "Pushbutton NO",
    desc: "モーメンタリ・メーク接点", typ: "XB4-BA31", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", momentary: true, bounds: [-17,-2, 20, 24],
    body: G_NO + G_PB,
  },
  {
    id: "pb_nc", cat: "input", letter: "S", name: "押しボタン (b接点)", nameEn: "Pushbutton NC",
    desc: "モーメンタリ・ブレーク接点", typ: "XB4-BA42", pins: [{x:0,y:0,n:"11"},{x:0,y:20,n:"12"}],
    sim: "contact_nc", momentary: true, bounds: [-17,-2, 20, 24],
    body: G_NC + G_PB,
  },
  {
    id: "estop", cat: "input", letter: "S", name: "非常停止ボタン", nameEn: "Emergency stop",
    desc: "キノコ形・b接点・ラッチ式", typ: "XA1E-BV302", pins: [{x:0,y:0,n:"11"},{x:0,y:20,n:"12"}],
    sim: "contact_nc", momentary: false, bounds: [-21,-2, 24, 24],
    body: G_NC + G_MUSH,
  },
  {
    id: "sel_sw", cat: "input", letter: "S", name: "セレクタスイッチ", nameEn: "Selector switch",
    desc: "回転式・オルタネイト (JIS C 0617 手動操作・回転)", typ: "XB4-BD21", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", momentary: false, bounds: [-18,-2, 21, 24],
    body: G_NO + `<path d="M-15,7 L-11,10 L-15,13"/><path d="M-11,10 H-1.8" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "limit_sw", cat: "input", letter: "B", name: "リミットスイッチ (LS)", nameEn: "Limit switch",
    desc: "位置スイッチ・メーク接点", jis: "07-08-01", typ: "D4V-8104Z", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", momentary: false, bounds: [-11.6,-2, 13.6, 24],
    // 07-08-01: メーク接点 + 可動接点先端の直角三角形 (位置スイッチ)
    body: G_NO + `<path d="M-4.8,5 L-9.6,5 L-9.6,9.8 Z"/>`,
  },
  {
    id: "prox", cat: "input", letter: "B", name: "近接センサ", nameEn: "Proximity sensor",
    desc: "誘導形 3線式 (BN=+V/BK=出力/BU=0V)", typ: "E2E-X5ME1", pins: [{x:0,y:0,n:"BN"},{x:0,y:20,n:"BK"},{x:-10,y:20,n:"BU"}],
    sim: "contact_no", momentary: false, bounds: [-21,0, 25, 20],
    body: `<rect x="-19" y="3" width="14" height="14"/><path d="M-16.5,10 l3.5,-3.5 l3.5,3.5 l-3.5,3.5 z"/><path d="M-10,17 V20"/>` + G_NO,
  },
  {
    id: "photo", cat: "input", letter: "B", name: "光電センサ", nameEn: "Photoelectric sensor",
    desc: "透過形/反射形 3線式 (BN=+V/BK=出力/BU=0V)", typ: "E3Z-D61", pins: [{x:0,y:0,n:"BN"},{x:0,y:20,n:"BK"},{x:-10,y:20,n:"BU"}],
    sim: "contact_no", momentary: false, bounds: [-27,0, 31, 20],
    body: `<rect x="-19" y="3" width="14" height="14"/><path d="M-25,7 l5,2 m-2.2,-1.6 l2.2,1.6 l-2.6,0.6 M-25,12 l5,1 m-2.1,-1.4 l2.1,1.4 l-2.5,0.8"/><path d="M-10,17 V20"/>` + G_NO,
  },
  {
    id: "press_sw", cat: "input", letter: "B", name: "圧力スイッチ", nameEn: "Pressure switch",
    desc: "設定圧で動作・a接点", typ: "SNS-C102X", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", momentary: false, bounds: [-18,-2, 21, 24],
    body: G_NO + `<path d="M-15,13 A3.2,3.2 0 0 1 -8.6,13 Z"/><path d="M-11.6,10 H-1.8" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "float_sw", cat: "input", letter: "B", name: "フロートスイッチ", nameEn: "Float switch",
    desc: "液面レベル検出", typ: "", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", momentary: false, bounds: [-19,-2, 22, 24],
    body: G_NO + `<circle cx="-13" cy="13.5" r="3"/><path d="M-13,10.5 V10 M-13,10 H-1.8" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "thermo", cat: "input", letter: "B", name: "サーモスタット", nameEn: "Thermostat",
    desc: "温度スイッチ・b接点", typ: "US-622", pins: [{x:0,y:0,n:"11"},{x:0,y:20,n:"12"}],
    sim: "contact_nc", momentary: false, bounds: [-19,-2, 22, 24],
    body: G_NC + `<text x="-13" y="12.6" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="serif" font-style="italic">ϑ</text><path d="M-10.2,10 H-1.5" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },

  /* ══════════ ロジック機器 ══════════ */
  {
    id: "coil", cat: "logic", letter: "K", name: "リレーコイル", nameEn: "Relay coil",
    desc: "補助リレー A1-A2", typ: "MY4N DC24V", pins: [{x:0,y:0,n:"A1"},{x:0,y:20,n:"A2"}],
    sim: "coil", bounds: [-7,0, 14, 20], mirror: true, maxContacts: 4,
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/>`,
  },
  {
    id: "cont_coil", cat: "logic", letter: "Q", name: "電磁接触器コイル", nameEn: "Contactor coil",
    desc: "主回路開閉用 A1-A2", typ: "SD-T21 DC24V", pins: [{x:0,y:0,n:"A1"},{x:0,y:20,n:"A2"}],
    sim: "coil", bounds: [-7,0, 14, 20], mirror: true, maxContacts: 5,
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/>`,
  },
  {
    id: "timer_on", cat: "logic", letter: "K", name: "タイマ (オンディレイ)", nameEn: "On-delay timer",
    desc: "励磁後 t 秒で動作", typ: "H3Y-2 DC24V", pins: [{x:0,y:0,n:"A1"},{x:0,y:20,n:"A2"}],
    sim: "coil", bounds: [-8,0, 22.5, 20], mirror: true, timer: "on", maxContacts: 2,
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/><path d="M-3,4.2 A3,3 0 0 1 3,4.2"/><text x="7" y="12.6" font-size="3.5" fill="currentColor" stroke="none" font-family="monospace">TON</text>`,
  },
  {
    id: "timer_off", cat: "logic", letter: "K", name: "タイマ (オフディレイ)", nameEn: "Off-delay timer",
    desc: "消磁後 t 秒で復帰", typ: "H3Y-2 DC24V", pins: [{x:0,y:0,n:"A1"},{x:0,y:20,n:"A2"}],
    sim: "coil", bounds: [-8,0, 22.5, 20], mirror: true, timer: "off", maxContacts: 2,
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/><path d="M-3,1.6 A3,3 0 0 0 3,1.6"/><text x="7" y="12.6" font-size="3.5" fill="currentColor" stroke="none" font-family="monospace">TOF</text>`,
  },
  {
    id: "aux_no", cat: "logic", letter: "K", name: "補助接点 (a接点)", nameEn: "Aux contact NO",
    desc: "リレー/接触器の連動接点", pins: [{x:0,y:0,n:"13"},{x:0,y:20,n:"14"}],
    sim: "contact_no", linked: true, bounds: [-8,-2, 11, 24],
    body: G_NO,
  },
  {
    id: "aux_nc", cat: "logic", letter: "K", name: "補助接点 (b接点)", nameEn: "Aux contact NC",
    desc: "リレー/接触器の連動接点", pins: [{x:0,y:0,n:"11"},{x:0,y:20,n:"12"}],
    sim: "contact_nc", linked: true, bounds: [-8,-2, 11, 24],
    body: G_NC,
  },
  {
    id: "aux_ton_no", cat: "logic", letter: "K", name: "限時動作a接点 (TON)", nameEn: "On-delay contact NO",
    desc: "オンディレイタイマの限時動作接点", pins: [{x:0,y:0,n:"17"},{x:0,y:20,n:"18"}],
    sim: "contact_no", linked: true, bounds: [-12,-2, 15, 24],
    body: G_NO + `<path d="M-6.8,7.6 A2.8,2.8 0 0 1 -1.2,7.6" />`,
  },
  {
    id: "aux_ton_nc", cat: "logic", letter: "K", name: "限時動作b接点 (TON)", nameEn: "On-delay contact NC",
    desc: "オンディレイタイマの限時動作接点", pins: [{x:0,y:0,n:"15"},{x:0,y:20,n:"16"}],
    sim: "contact_nc", linked: true, bounds: [-12,-2, 15, 24],
    body: G_NC + `<path d="M-6.8,11.2 A2.8,2.8 0 0 1 -1.2,11.2" />`,
  },
  {
    id: "aux_toff_no", cat: "logic", letter: "K", name: "限時復帰a接点 (TOF)", nameEn: "Off-delay contact NO",
    desc: "オフディレイタイマの限時復帰接点", pins: [{x:0,y:0,n:"17"},{x:0,y:20,n:"18"}],
    sim: "contact_no", linked: true, bounds: [-12,-2, 15, 24],
    body: G_NO + `<path d="M-6.8,6 A2.8,2.8 0 0 0 -1.2,6" />`,
  },
  {
    id: "aux_toff_nc", cat: "logic", letter: "K", name: "限時復帰b接点 (TOF)", nameEn: "Off-delay contact NC",
    desc: "オフディレイタイマの限時復帰接点", pins: [{x:0,y:0,n:"15"},{x:0,y:20,n:"16"}],
    sim: "contact_nc", linked: true, bounds: [-12,-2, 15, 24],
    body: G_NC + `<path d="M-6.8,10 A2.8,2.8 0 0 0 -1.2,10" />`,
  },
  {
    id: "safety_relay", cat: "logic", letter: "K", name: "セーフティリレー", nameEn: "Safety relay",
    desc: "強制ガイド式接点リレー", typ: "G7SA-3A1B", pins: [{x:0,y:0,n:"A1"},{x:0,y:20,n:"A2"}],
    sim: "coil", bounds: [-9,0, 18, 20], mirror: true, maxContacts: 4,
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/><rect x="-7" y="4" width="14" height="12" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "plc_di", cat: "logic", letter: "A", name: "PLC入力ポイント", nameEn: "PLC digital input",
    desc: "DIカードの1点", typ: "PLC DI", pins: [{x:0,y:0,n:"I"},{x:0,y:20,n:"COM"}],
    sim: "coil", bounds: [-10,0, 20, 20],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-8" y="4" width="16" height="12"/><text x="0" y="12.7" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">DI</text>`,
  },
  {
    id: "plc_do", cat: "logic", letter: "A", name: "PLC出力ポイント", nameEn: "PLC digital output",
    desc: "DOカードの1点 (シミュレーションではクリックでON/OFF)", typ: "PLC DO", pins: [{x:0,y:0,n:"Q"},{x:0,y:20,n:"COM"}],
    sim: "contact_no", bounds: [-10,0, 20, 20],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-8" y="4" width="16" height="12"/><text x="0" y="12.7" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">DO</text>`,
  },

  /* ══════════ アウトプット機器 ══════════ */
  {
    id: "lamp", cat: "output", letter: "P", name: "表示灯 (PL)", nameEn: "Indicator lamp",
    desc: "パイロットランプ X1-X2", typ: "XB4-BVB3", pins: [{x:0,y:0,n:"X1"},{x:0,y:20,n:"X2"}],
    sim: "load", bounds: [-7,0, 14, 20],
    body: `<path d="M0,0 V4.5 M0,20 V15.5"/><circle cx="0" cy="10" r="5.5"/><path d="M-3.9,6.1 L3.9,13.9 M-3.9,13.9 L3.9,6.1"/>`,
  },
  {
    id: "buzzer", cat: "output", letter: "P", name: "ブザー", nameEn: "Buzzer",
    desc: "警報音響機器", jis: "08-10-10", typ: "M2BJ-B24", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "load", bounds: [-8,0, 16, 20],
    // 08-10-10: 上辺が直線・下側が半円のお椀形。引出線は両端から下へ
    body: `<path d="M0,0 V7"/><path d="M-6,7 H6"/><path d="M-6,7 A6,6 0 0 0 6,7"/><path d="M0,13 V20"/>`,
  },
  {
    id: "sol_valve", cat: "output", letter: "Y", name: "電磁弁 (SV)", nameEn: "Solenoid valve",
    desc: "ソレノイドバルブ", typ: "SY5120-5LZ", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "load", bounds: [-7,0, 14, 20],
    body: `<path d="M0,0 V6 M0,20 V14"/><rect x="-5" y="6" width="10" height="8"/><path d="M-5,14 L5,6"/>`,
  },
  {
    id: "heater", cat: "output", letter: "E", name: "ヒータ", nameEn: "Heater",
    desc: "電熱器", typ: "空間ヒータ 100W", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "load", bounds: [-6,0, 12, 20],
    body: `<path d="M0,0 V4 M0,20 V16"/><rect x="-4" y="4" width="8" height="12"/><path d="M-4,8 H4 M-4,12 H4"/>`,
  },
  {
    id: "motor3", cat: "output", letter: "M", name: "三相モータ", nameEn: "3-phase motor",
    desc: "誘導電動機 3φ", typ: "0.75kW 4P 200V", horizontalPins: true,
    pins: [{x:-10,y:0,n:"U1"},{x:0,y:0,n:"V1"},{x:10,y:0,n:"W1"},{x:0,y:35,n:"PE"}],
    sim: "load3", bounds: [-13,0, 26, 35],
    body: `<path d="M-10,0 V8 M0,0 V11.5 M10,0 V8"/><path d="M-10,8 L-6,13.5 M10,8 L6,13.5"/><circle cx="0" cy="21" r="9.5"/><path d="M0,30.5 V35"/><text x="0" y="20.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">M</text><text x="0" y="27" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">3~</text>`,
  },
  {
    id: "motor1", cat: "output", letter: "M", name: "単相モータ", nameEn: "1-phase motor",
    desc: "誘導電動機 1φ (主回路を自動生成)", typ: "0.2kW 100V", horizontalPins: true,
    pins: [{x:-5,y:0,n:"U1"},{x:5,y:0,n:"U2"},{x:0,y:35,n:"PE"}],
    sim: "load", bounds: [-11,0, 22, 35],
    body: `<path d="M-5,0 V11.9 M5,0 V11.9"/><circle cx="0" cy="20" r="9.5"/><path d="M0,29.5 V35"/><text x="0" y="19.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">M</text><text x="0" y="26" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">1~</text>`,
  },
  {
    id: "main_cont", cat: "output", letter: "Q", name: "主接点 (3極)", nameEn: "Main contacts 3P",
    desc: "電磁接触器の主メーク接点 3極", jis: "07-13-02", typ: "SD-T21", linked: true,
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "contact3_no", bounds: [-6,-2, 29, 24],
    body: `<g>${G_NO_CONT}</g><g transform="translate(10,0)">${G_NO_CONT}</g><g transform="translate(20,0)">${G_NO_CONT}</g><path d="M-2.4,9 L17.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },

  /* ══════════ 電源・保護 ══════════ */
  {
    id: "mcb1", cat: "power", letter: "F", name: "配線用遮断器 (NFB) 1P", nameEn: "MCCB 1-pole",
    desc: "モールドケース遮断器", typ: "CP30-BA 1P 5A", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "breaker", bounds: [-9,-2, 12, 24],
    body: G_CB,
  },
  {
    id: "mcb3", cat: "power", letter: "F", name: "配線用遮断器 (MCCB/NFB) 3P", nameEn: "MCCB 3-pole",
    desc: "モールドケース遮断器 3極", typ: "NF63-CV 3P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "breaker3", bounds: [-8,-2, 31, 24],
    body: `<g>${G_CB}</g><g transform="translate(10,0)">${G_CB}</g><g transform="translate(20,0)">${G_CB}</g><path d="M-2.4,9 L17.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "ol3", cat: "power", letter: "F", name: "サーマルリレー 3極", nameEn: "Thermal overload 3P",
    desc: "モータ過負荷保護", typ: "TH-T18 5A", mirror: true, maxContacts: 2,
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"},{x:20,y:0,n:"5"},{x:20,y:20,n:"6"}],
    sim: "passthru3", bounds: [-7,-2, 34, 24],
    body: `<g>${G_OL}</g><g transform="translate(10,0)">${G_OL}</g><g transform="translate(20,0)">${G_OL}</g><rect x="-5" y="5" width="30" height="10" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "ol_nc", cat: "power", letter: "F", name: "サーマル接点 (95-96)", nameEn: "Thermal OL contact NC",
    desc: "過負荷時に開くb接点", linked: true, pins: [{x:0,y:0,n:"95"},{x:0,y:20,n:"96"}],
    sim: "contact_nc", bounds: [-12,-2, 15, 24],
    body: G_NC + `<path d="M-10,7 H-7 V13 H-10" transform="translate(0,0)"/><path d="M-10.2,10 H-1.5" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "ol_no", cat: "power", letter: "F", name: "サーマル接点 (97-98)", nameEn: "Thermal OL contact NO",
    desc: "過負荷時に閉じるa接点 (警報用)", linked: true, pins: [{x:0,y:0,n:"97"},{x:0,y:20,n:"98"}],
    sim: "contact_no", bounds: [-12,-2, 15, 24],
    body: G_NO + `<path d="M-10,7 H-7 V13 H-10"/><path d="M-10.2,10 H-1.5" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "fuse", cat: "power", letter: "F", name: "ヒューズ", nameEn: "Fuse",
    desc: "溶断保護", typ: "ガラス管ヒューズ 250V 2A", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "fuse", bounds: [-5,0, 10, 20],
    body: `<path d="M0,0 V20"/><rect x="-3" y="5" width="6" height="10"/>`,
  },
  {
    id: "psu24", cat: "power", letter: "G", name: "電源ユニット 24VDC", nameEn: "PSU 24VDC",
    desc: "AC100/200V → DC24V", typ: "S8FS-G10024CD", horizontalPins: true,
    pins: [{x:-10,y:0,n:"L"},{x:10,y:0,n:"N"},{x:-10,y:30,n:"+V"},{x:10,y:30,n:"-V"}],
    sim: "psu", bounds: [-17,0, 34, 30],
    body: `<path d="M-10,0 V5 M10,0 V5 M-10,30 V25 M10,25 V30"/><rect x="-15" y="5" width="30" height="20"/><path d="M15,5 L-15,25"/><text x="-7" y="12.5" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">AC</text><text x="7" y="22.5" font-size="5" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">DC</text>`,
  },
  {
    id: "supply3", cat: "power", letter: "W", name: "三相電源 L1/L2/L3", nameEn: "3-phase supply",
    desc: "AC200V 三相電源引込", horizontalPins: true,
    pins: [{x:-10,y:10,n:""},{x:0,y:10,n:""},{x:10,y:10,n:""}],
    sim: "source3", bounds: [-15,-2, 30, 13],
    body: `<path d="M-10,2 V6 M0,2 V6 M10,2 V6"/><path d="M-11.8,6 L-10,10 L-8.2,6 Z M-1.8,6 L0,10 L1.8,6 Z M8.2,6 L10,10 L11.8,6 Z" fill="currentColor"/>`,
  },
  {
    id: "supply1", cat: "power", letter: "W", name: "単相電源 L/N", nameEn: "1-phase supply",
    desc: "AC100/200V 単相電源引込", horizontalPins: true,
    pins: [{x:-5,y:10,n:""},{x:5,y:10,n:""}],
    sim: "source1", bounds: [-10,-2, 20, 13],
    body: `<path d="M-5,2 V6 M5,2 V6"/><path d="M-6.8,6 L-5,10 L-3.2,6 Z M3.2,6 L5,10 L6.8,6 Z" fill="currentColor"/>`,
  },
  {
    id: "mcb2", cat: "power", letter: "F", name: "配線用遮断器 (MCCB/NFB) 2P", nameEn: "MCCB 2-pole",
    desc: "モールドケース遮断器 2極 (単相用)", typ: "NF32-SV 2P",
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "breaker2", bounds: [-8,-2, 21, 24],
    body: `<g>${G_CB}</g><g transform="translate(10,0)">${G_CB}</g><path d="M-2.4,9 L7.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "main_cont2", cat: "output", letter: "Q", name: "主接点 (2極)", nameEn: "Main contacts 2P",
    desc: "電磁接触器の主接点 (単相用)", linked: true,
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "contact2_no", bounds: [-8,-2, 21, 24],
    body: `<g>${G_NO_CONT}</g><g transform="translate(10,0)">${G_NO_CONT}</g><path d="M-2.4,9 L7.6,9" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "ol2", cat: "power", letter: "F", name: "サーマルリレー 2極", nameEn: "Thermal overload 2P",
    desc: "モータ過負荷保護 (単相用)", typ: "TH-T18 3.6A", mirror: true, maxContacts: 2,
    pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "passthru2", bounds: [-7,-2, 24, 24],
    body: `<g>${G_OL}</g><g transform="translate(10,0)">${G_OL}</g><rect x="-5" y="5" width="20" height="10" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "trafo", cat: "power", letter: "T", name: "変圧器 (シールド付)", nameEn: "Shielded transformer",
    desc: "制御トランス 2巻線+静電遮蔽", jis: "06-10-02", typ: "PT-100E", horizontalPins: true,
    pins: [{x:-10,y:0,n:"1"},{x:10,y:0,n:"2"},{x:-10,y:40,n:"3"},{x:10,y:40,n:"4"},{x:-20,y:20,n:"S"}],
    sim: "trafo", bounds: [-22,0, 37, 40],
    body: `<path d="M-10,0 V16 M10,0 V16 M-10,40 V24 M10,24 V40"/>` +
      // 一次巻線: 4コブ (凸側を遮蔽側へ向ける)
      `<path d="M-10,16 A2.5,2.5 0 0 0 -5,16 A2.5,2.5 0 0 0 0,16 A2.5,2.5 0 0 0 5,16 A2.5,2.5 0 0 0 10,16"/>` +
      // 二次巻線: 4コブ
      `<path d="M-10,24 A2.5,2.5 0 0 1 -5,24 A2.5,2.5 0 0 1 0,24 A2.5,2.5 0 0 1 5,24 A2.5,2.5 0 0 1 10,24"/>` +
      // 静電遮蔽 (破線) — 06-10-02 は遮蔽のみを描く
      `<path d="M-12.75,20 H12.75" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>` +
      `<path d="M-20,20 H-12.75"/>`,   // 遮蔽の接地引出し (端子 S)
  },
  {
    id: "earth", cat: "power", letter: "E", name: "接地 (一般)", nameEn: "Earth",
    desc: "一般接地 (JIS C 0617 03-02-01)。保護接地はDBの保護接地(PE)を使用", pins: [{x:0,y:0,n:""}],
    sim: "none", bounds: [-7,0, 14, 12],
    body: `<path d="M0,0 V5 M-6,5 H6 M-4,8 H4 M-2,11 H2"/>`,
  },

  /* ══════════ 端子・その他 ══════════ */
  {
    id: "terminal", cat: "misc", letter: "X", name: "端子", nameEn: "Terminal",
    desc: "端子台の1点", typ: "UK-2.5N", pins: [{x:0,y:0,n:""},{x:0,y:20,n:""}],
    sim: "passthru", bounds: [-4,0, 8, 20],
    body: `<path d="M0,0 V7.8 M0,20 V12.2"/><circle cx="0" cy="10" r="2.2"/>`,
  },
  {
    id: "link", cat: "misc", letter: "W", name: "電位リンク", nameEn: "Potential link",
    desc: "ページ間の電位接続点 (タグ一致で接続)", pins: [{x:0,y:0,n:""}],
    sim: "link", bounds: [-10,0, 20, 8],
    body: `<path d="M0,0 V3 M-7,3 L0,8 L7,3 Z"/>`,
  },
  {
    id: "generic2", cat: "misc", letter: "U", name: "汎用機器 (2端子)", nameEn: "Generic device 2-pin",
    desc: "未登録機器用の箱。名称/型式はプロパティで設定", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"}],
    sim: "none", bounds: [-8,0, 16, 20],
    body: `<path d="M0,0 V5 M0,20 V15"/><rect x="-7" y="5" width="14" height="10"/><path d="M-4,10 H4" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
  {
    id: "generic4", cat: "misc", letter: "U", name: "汎用機器 (4端子)", nameEn: "Generic device 4-pin",
    desc: "未登録機器用の箱。名称/型式はプロパティで設定", pins: [{x:0,y:0,n:"1"},{x:0,y:20,n:"2"},{x:10,y:0,n:"3"},{x:10,y:20,n:"4"}],
    sim: "none", bounds: [-8,0, 26, 20],
    body: `<path d="M0,0 V5 M0,20 V15 M10,0 V5 M10,20 V15"/><rect x="-7" y="5" width="24" height="10"/><path d="M-3,10 H13" stroke-dasharray="3 0.75" stroke-width="0.25" stroke-linecap="butt"/>`,
  },
];

const SYMBOLS_BY_ID = {};
SYMBOLS.forEach(s => SYMBOLS_BY_ID[s.id] = s);

/** シンボルの描画SVG文字列 (ローカル座標系) */
function symBodySVG(sym, opts = {}) {
  const sw = opts.strokeWidth || SYM_STROKE;
  const body = opts.textScale ? scaleSymbolGeom(sym.body, opts.textScale) : sym.body;
  return `<g fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

/** シンボル内の文字・線幅・破線を尺度に追従させる。
    文字は用紙上 2.5mm 以上 (JIS Z 8313)、線幅と破線要素は用紙上一定 (JIS Z 8312)。 */
function scaleSymbolGeom(body, f) {
  let out = body;
  if (f !== 1) {
    out = out
      .replace(/font-size="([\d.]+)"/g, (m, v) => `font-size="${Math.max(parseFloat(v) * f, 2.5)}"`)
      .replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${parseFloat(v) * f}"`);
  }
  /* 破線は「線素で始まり線素で終わる」(JIS Z 8312)。線素:すき間 = 4:1 を保ったまま
     線の実長に合わせて周期を伸縮する。path / rect / circle に対応。 */
  return out.replace(/<(path|rect|circle)([^>]*?)stroke-dasharray="([^"]+)"([^>]*?)\/>/g, (tag, el, a, dash, b) => {
    const attrs = a + b;
    const len = dashTargetLength(el, attrs);
    const base = dash.trim().split(/[\s,]+/).map(n => parseFloat(n) * f);
    let e = base[0] || 3 * f, g = base[1] || 0.75 * f;
    if (len > 0) {
      const per = e + g;
      const n = Math.max(1, Math.round((len - e) / per));
      const k = len / (n * per + e);
      e *= k; g *= k;                       // 比を保ったまま端数をゼロにする
    }
    return `<${el}${a}stroke-dasharray="${+e.toFixed(3)} ${+g.toFixed(3)}"${b}/>`;
  });
}

/** 破線を掛ける図形の実長 (mm)。path=折線長 / rect=周長 / circle=円周 */
function dashTargetLength(el, attrs) {
  const num = name => {
    const m = new RegExp(name + '="(-?[\\d.]+)"').exec(attrs);
    return m ? parseFloat(m[1]) : 0;
  };
  if (el === "rect") return 2 * (num("width") + num("height"));
  if (el === "circle") return 2 * Math.PI * num("r");
  const d = (/ d="([^"]+)"/.exec(attrs) || [])[1];
  return d ? pathLengthMM(d) : 0;
}

/** 直線のみで構成された path の長さ (mm)。M/L/H/V に対応 */
function pathLengthMM(d) {
  const t = d.match(/[MLHVmlhvZz]|-?\d*\.?\d+/g) || [];
  let i = 0, x = 0, y = 0, len = 0;
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    const c = t[i++];
    if (c === "M" || c === "m") { const nx = num(), ny = num(); x = c === "M" ? nx : x + nx; y = c === "M" ? ny : y + ny; }
    else if (c === "L" || c === "l") { const nx = num(), ny = num(); const ax = c === "L" ? nx : x + nx, ay = c === "L" ? ny : y + ny; len += Math.hypot(ax - x, ay - y); x = ax; y = ay; }
    else if (c === "H" || c === "h") { const nx = num(); const ax = c === "H" ? nx : x + nx; len += Math.abs(ax - x); x = ax; }
    else if (c === "V" || c === "v") { const ny = num(); const ay = c === "V" ? ny : y + ny; len += Math.abs(ay - y); y = ay; }
  }
  return len;
}

/** サムネイル用SVG (ライブラリパレット / プロパティ表示用) */
function symThumbSVG(sym, size = 46) {
  const [bx, by, bw, bh] = sym.bounds;
  const pad = 3;
  const vb = `${bx - pad} ${by - pad} ${bw + pad * 2} ${bh + pad * 2}`;
  // 個別指定の線幅・破線もサムネイル倍率で拡大する (連結破線が消えないように)。
  // 文字はそのままにして、はみ出しを防ぐ。
  const k = 1.1 / 0.5;
  const body = sym.body
    .replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${(parseFloat(v) * k).toFixed(3)}"`)
    .replace(/stroke-dasharray="([\d. ]+)"/g, (m, v) => `stroke-dasharray="${v.trim().split(/\s+/).map(n => (parseFloat(n) * k).toFixed(3)).join(" ")}"`);
  return `<svg viewBox="${vb}" width="${size}" height="${size * (bh + pad * 2) / (bw + pad * 2)}" style="max-height:100%">` +
    `<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}
