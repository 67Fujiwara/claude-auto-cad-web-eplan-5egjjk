/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — コアエンジン
   データモデル / ネットリスト解析 / 通電シミュレーション / DRC / 部品表
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const GRID = 5;              // スナップグリッド 5mm
const SHEET = { w: 420, h: 297, margin: 10, cols: 10, rows: 6 }; // 既定 A3横 (図枠設定で変わる)

/* 用紙 (横置き実寸 mm) と尺度。図面の作図領域は 用紙 × 尺度分母/分子 になる。
   例: A3 (420×297) を 1:2 で描くと作図領域は 840×594 となり、実物の
   2倍の範囲を1枚に収められる (印刷時は用紙サイズに縮小される)。 */
const PAPERS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
};
const SCALES = ["2:1", "1:1", "1:2", "1:5", "1:10", "1:20", "1:50", "1:100"];
function scaleFactor(scale) {
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
/** meta (用紙・尺度) から作図領域 SHEET を再計算する */
function applySheet() {
  const m = projectMeta();
  const [pw, ph] = PAPERS[m.paper] || PAPERS.A3;
  const f = scaleFactor(m.scale);
  SHEET.w = Math.round(pw * f);
  SHEET.h = Math.round(ph * f);
  SHEET.margin = Math.round(10 * f * 10) / 10;
  SHEET.cols = Math.max(4, Math.min(24, Math.round(10 * pw / 420)));
  SHEET.rows = Math.max(3, Math.min(16, Math.round(6 * ph / 297)));
  return SHEET;
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
    meta: {
      paper: "A3", scale: "1:1", dwgNo: "", rev: "0",
      designer: "", checker: "", date: todayStr(), author: "ElectraCAD Studio",
    },
    pages: [newPage("メイン回路", 1)],
  };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function newPage(name, no) {
  return { id: uid("p"), no, name, devices: [], wires: [], texts: [], zones: [] };
}
/** 旧データ互換: zones が無いページに追加 */
function pageZones(page) {
  if (!page.zones) page.zones = [];
  return page.zones;
}
function curPage() { return App.project.pages[App.pageIdx]; }

/* ══════════════ デバイス ══════════════ */
function pinAbs(dev, pin) {
  const r = (dev.rot || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: dev.x + pin.x * c - pin.y * s, y: dev.y + pin.x * s + pin.y * c };
}
function devPins(dev) {
  const sym = SYMBOLS_BY_ID[dev.sym];
  return sym.pins.map((p, i) => ({ ...pinAbs(dev, p), name: p.n, idx: i }));
}
function devBounds(dev) {
  const sym = SYMBOLS_BY_ID[dev.sym];
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
  const sym = SYMBOLS_BY_ID[symId];
  const dev = {
    id: uid("d"), sym: symId, x: snap(x), y: snap(y), rot: opts.rot || 0,
    tag: opts.tag !== undefined ? opts.tag : (sym.letter ? nextTag(sym.letter) : ""),
    desc: opts.desc || "", typeRef: opts.typeRef !== undefined ? opts.typeRef : (sym.typ || ""), linkTo: opts.linkTo || null,
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

/** シート上の列番号 (クロスリファレンス用 "ページ.列") */
function sheetCol(x) {
  const inner = SHEET.w - SHEET.margin * 2;
  return Math.max(0, Math.min(SHEET.cols - 1, Math.floor((x - SHEET.margin) / (inner / SHEET.cols))));
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
   端子表・接続リストのいずれからも除外する。 */
const WIRE_STYLES = {
  solid:   { name: "実線 (配線)",     dash: "" },
  dash:    { name: "破線 (作図線)",   dash: "4 2.2" },
  dashdot: { name: "一点鎖線 (作図線)", dash: "8 2 1.4 2" },
};
function isWireConductive(w) { return !w.style || w.style === "solid"; }
/** 電気的に有効な (実線の) 配線だけを返す */
function condWires(page) { return page.wires.filter(isWireConductive); }

function addWire(page, pts, opts = {}) {
  const wire = { id: uid("w"), pts: pts.map(p => [snap(p[0]), snap(p[1])]), num: opts.num || null };
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
function conductivePairs(dev, mode = "closed") {
  const sym = SYMBOLS_BY_ID[dev.sym];
  switch (sym.sim) {
    case "contact_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1]] : [];
    case "contact_nc":
      if (mode === "open" || mode === "split") return [];
      if (mode === "sim") return simActiveState(dev) ? [] : [[0, 1]];
      return [[0, 1]];
    case "contact2_no":
      if (mode === "open" || mode === "split") return [];
      return (mode === "sim" ? simActiveState(dev) : true) ? [[0, 1], [2, 3]] : [];
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
  if (["+24V", "24V", "L+", "P24"].includes(t)) return "P";
  if (["0V", "M", "N", "-V", "GND"].includes(t)) return "N";
  return null;
}

/**
 * ページ間電位リンクの伝播: 同じタグの電位リンクは全ページで同一電位。
 * pagesData: [{ page, pinNet, pNets, nNets, acNets }]
 * いずれかのページでリンクのネットが P/N/AC なら、同タグ全リンクのネットにも付与。
 */
function propagateLinkGroups(pagesData) {
  const groups = new Map(); // tag → [{pd, net}]
  pagesData.forEach(pd => {
    pd.page.devices.forEach(dev => {
      if (SYMBOLS_BY_ID[dev.sym].sim !== "link" || !dev.tag) return;
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
      ["pNets", "nNets", "acNets"].forEach(kind => {
        const hot = list.some(({ pd, net }) => pd[kind].has(net));
        if (hot) list.forEach(({ pd, net }) => {
          if (!pd[kind].has(net)) { pd[kind].add(net); moved = true; }
        });
      });
    });
    if (!moved) break;
  }
}

/** 連動接点の実効端子番号: 同一コイル配下の n 番目の接点は 13/14 → n3/n4 に採番 */
function effectivePinName(dev, idx) {
  const sym = SYMBOLS_BY_ID[dev.sym];
  const base = sym.pins[idx] ? sym.pins[idx].n : "";
  if (!dev.linkTo || !/^[1-8][1-8]$/.test(base)) return base;
  const f = findDevice(dev.linkTo);
  if (!f) return base;
  const siblings = linkedContacts(f.dev).filter(c => /^[1-8][1-8]$/.test((SYMBOLS_BY_ID[c.sym].pins[0] || {}).n || ""));
  const pos = siblings.findIndex(c => c.id === dev.id);
  if (pos < 0) return base;
  return String(pos + 1) + base[1];
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
function junctionDots(page) {
  const dots = [];
  const endpointCount = new Map(); // 同一点に3本以上の端点が集まる場合
  const wires = condWires(page); // 作図線には接続ドットを打たない
  wires.forEach(w => {
    [w.pts[0], w.pts[w.pts.length - 1]].forEach(ep => {
      const k = ptKey(ep[0], ep[1]);
      endpointCount.set(k, (endpointCount.get(k) || 0) + 1);
      // 他ワイヤの区間中点に載る端点
      wires.forEach(w2 => {
        if (w === w2) return;
        for (let i = 0; i < w2.pts.length - 1; i++) {
          if (ptOnSeg(ep[0], ep[1], w2.pts[i][0], w2.pts[i][1], w2.pts[i + 1][0], w2.pts[i + 1][1])) {
            dots.push([ep[0], ep[1]]);
          }
        }
      });
    });
  });
  endpointCount.forEach((n, k) => {
    if (n >= 3) { const [x, y] = k.split(",").map(v => v / 10); dots.push([x, y]); }
  });
  return dots;
}

/* ══════════════ 配線番号の自動付与 ══════════════ */
function autoNumberWires() {
  let n = 10;
  App.project.pages.forEach(page => {
    // "open" モード: 接点・コイルを跨いで番号が伝播しない (実務どおり区間ごとに採番)
    const { pinNet, wireNet } = computeNets(page, "open");
    const netNum = new Map();
    // 1) 電源系ネット・電位リンクには電位名を付ける
    page.devices.forEach(dev => {
      const sym = SYMBOLS_BY_ID[dev.sym];
      if (sym.sim === "psu") {
        const pNet = pinNet(dev, 2), nNet = pinNet(dev, 3);
        if (pNet) netNum.set(pNet, "+24V");
        if (nNet) netNum.set(nNet, "0V");
      }
      if (sym.sim === "link" && dev.tag) {
        const net = pinNet(dev, 0);
        if (net) netNum.set(net, dev.tag.replace(/^-/, ""));
      }
    });
    // 2) 固定番号 (主回路の相名 L1/U1 等、手動で付けた線番) を尊重
    const wires = condWires(page); // 作図線には線番を付けない
    wires.forEach(w => {
      if (w.fixed && w.num) netNum.set(wireNet.get(w.id), w.num);
    });
    // 3) 残りに連番を振り、ネットごとに最長区間のワイヤ1本にだけラベルを表示
    const bestOfNet = new Map();
    wires.forEach(w => {
      const net = wireNet.get(w.id);
      if (!netNum.has(net)) netNum.set(net, String(n++));
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
  });
}

/* ══════════════ 通電シミュレーション ══════════════ */
function simActiveState(dev) {
  const sym = SYMBOLS_BY_ID[dev.sym];
  if (sym.sim === "contact_no" || sym.sim === "contact_nc" || sym.sim === "contact2_no" || sym.sim === "contact3_no") {
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
    const sym = SYMBOLS_BY_ID[dev.sym];
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
        const sym = SYMBOLS_BY_ID[dev.sym];
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
    const sym = SYMBOLS_BY_ID[dev.sym];
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
const DRC_RULES = [
  "未接続ピン", "宙吊り配線端点", "デバイスタグ重複", "コイル未リンク接点",
  "接点なしコイル", "接点数超過", "電源未到達負荷", "無開閉直結コイル", "電源短絡",
  "自動生成時の警告",
];

function drcSources(page, pinNet) {
  const pNets = new Set(), nNets = new Set();
  page.devices.forEach(d => {
    const s = SYMBOLS_BY_ID[d.sym];
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
  return { page, pinNet, wireNet, pNets, nNets, acNets: new Set() };
}

function runDRC() {
  const issues = [];
  const tagSeen = new Map();
  // 全ページのネットを先に解析し、電位リンク(同タグ)でページ間の電位を伝播させる
  const closedData = App.project.pages.map(p => drcCollect(p, "closed"));
  propagateLinkGroups(closedData);
  const openData = App.project.pages.map(p => drcCollect(p, "open"));
  propagateLinkGroups(openData);
  App.project.pages.forEach((page, pageIdx) => {
    const closed = closedData[pageIdx];
    const open = openData[pageIdx];
    const srcClosed = { pNets: closed.pNets, nNets: closed.nNets };
    const srcOpen = { pNets: open.pNets, nNets: open.nNets };

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

    // 電源短絡 (+24V と 0V が閉状態で同一ネット)
    for (const p of srcClosed.pNets) {
      if (p && srcClosed.nNets.has(p)) {
        issues.push({ sev: "err", msg: "+24V と 0V が短絡しています (接点閉時)", page: page.no, target: null, loc: `${page.no}.-` });
        break;
      }
    }

    // 宙吊り配線端点 (ピンにも他ワイヤにも接続しない末端)。stub=意図的な引込線/レール端は除外
    drcWires.forEach(w => {
      if (w.stub) return;
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
      const sym = SYMBOLS_BY_ID[dev.sym];
      // 未接続ピン
      devPins(dev).forEach(pin => {
        const onWire = wireEndpoints.has(ptKey(pin.x, pin.y)) ||
          wireSegs.some(([a, b]) => ptOnSeg(pin.x, pin.y, a[0], a[1], b[0], b[1])) ||
          page.devices.some(d2 => d2 !== dev && devPins(d2).some(p2 => Math.abs(p2.x - pin.x) < .01 && Math.abs(p2.y - pin.y) < .01));
        if (!onWire) {
          issues.push({ sev: "warn", msg: `${displayTag(dev) || sym.name} のピン ${pin.name || pin.idx + 1} が未接続です`, page: page.no, target: dev.id, loc: devLocation(dev) });
        }
      });
      // タグ重複 (電位リンクは同タグで対にするのが仕様なので除外)
      if (dev.tag && !dev.linkTo && sym.sim !== "link") {
        if (tagSeen.has(dev.tag)) {
          issues.push({ sev: "err", msg: `デバイスタグ ${dev.tag} が重複しています`, page: page.no, target: dev.id, loc: devLocation(dev) });
        } else tagSeen.set(dev.tag, dev.id);
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
          const ok = (srcClosed.pNets.has(a) && srcClosed.nNets.has(b)) || (srcClosed.pNets.has(b) && srcClosed.nNets.has(a));
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
  return issues;
}

/* ══════════════ 部品表 (BOM) ══════════════ */
const BOM_EXCLUDE = new Set(["link", "supply3", "supply1", "earth"]); // 購買部品でないもの
function buildBOM() {
  const rows = new Map();
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    if (dev.linkTo) return; // 連動接点は親デバイスの一部
    const sym = SYMBOLS_BY_ID[dev.sym];
    if (BOM_EXCLUDE.has(sym.id)) return;
    // 端子は本数だけ数える (タグ -X1:n を -X1 に集約)
    const baseTag = sym.id === "terminal" ? (dev.tag || "-X1").split(":")[0] : null;
    const key = sym.id === "terminal" ? "terminal|" + baseTag : dev.sym + "|" + (dev.typeRef || "");
    if (!rows.has(key)) rows.set(key, { name: sym.name, typeRef: dev.typeRef || "—", tags: [] });
    rows.get(key).tags.push(displayTag(dev) || "—");
  }));
  return [...rows.values()].sort((a, b) => (a.tags[0] || "").localeCompare(b.tags[0] || ""));
}

function bomCSV() {
  const rows = buildBOM();
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return "﻿名称,型式,数量,デバイスタグ\n" +
    rows.map(r => [esc(r.name), esc(r.typeRef), r.tags.length, esc(r.tags.join(" "))].join(",")).join("\n");
}

/** PLC アドレス一覧 */
function buildPLCList() {
  const rows = [];
  App.project.pages.forEach(page => page.devices.forEach(dev => {
    if (dev.sym === "plc_di" || dev.sym === "plc_do") {
      rows.push({ tag: dev.tag, addr: dev.desc || "—", kind: dev.sym === "plc_di" ? "入力" : "出力", loc: devLocation(dev) });
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
        const sym = SYMBOLS_BY_ID[dev.sym];
        const label = dev.sym === "terminal" || sym.sim === "link"
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
      const s = SYMBOLS_BY_ID[d.sym];
      if (d.sym === "terminal" || s.sim === "link") return d.tag || s.name;
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
  App.undoStack.push(JSON.stringify(App.project));
  if (App.undoStack.length > 100) App.undoStack.shift();
  App.redoStack.length = 0;
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
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  retainSelection();
  saveLocal();
  return true;
}
function redo() {
  if (App.sim.running) return false;
  if (!App.redoStack.length) return false;
  App.undoStack.push(JSON.stringify(App.project));
  App.project = JSON.parse(App.redoStack.pop());
  App.pageIdx = Math.min(App.pageIdx, App.project.pages.length - 1);
  retainSelection();
  saveLocal();
  return true;
}

/* ══════════════ 保存 / 読込 ══════════════ */
const LS_KEY = "electracad.project.v1";
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(App.project)); } catch (e) { /* 容量超過等は無視 */ }
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
