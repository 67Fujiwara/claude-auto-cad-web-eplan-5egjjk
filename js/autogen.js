/* ═══════════════════════════════════════════════════════════════
   ElectraCAD Studio — AI 自動作図エンジン
   インプット機器 / ロジック機器 / アウトプット機器の選択から、
   電気設計のセオリー(JIS/IEC)に基づいた制御回路を自動合成する。
   ─ 安全チェーン(非常停止・サーモ)は電源直下に直列配置
   ─ 停止入力は直列 / 起動入力は並列(自己保持) / センサ類は運転条件として直列
   ─ 入力なしのコイルは前段コイルの接点でカスケード駆動 (無接点直結を作らない)
   ─ コイルごとの接点数(実装可能数)を管理し、超過割付をしない
   ─ ラングが図枠に収まらない場合はページを自動分割し、電位リンクで接続
   ─ 三相モータ: 主回路ページ + 遮断器 + 接触器 + サーマルリレー + 接地、
     サーマルb接点(95-96)を接触器コイル直列に挿入、相番号(L1/1L1/2L1/U1)
   ─ 端子台オプション: 現場機器との境界に -X1:n を自動挿入
   すべての座標は 5mm グリッドに整列させる。
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const AI_L = {
  psuX: 55, psuY: 30,      // 電源ユニット (ピンは x±10, 下端 y+30)
  topRailY: 65,            // +24V レール y
  botRailY: 235,           // 0V レール y
  safetyX: 95,             // 安全チェーンの x
  rungX0: 125,             // 最初のラングの x (1ページ目)
  contX0: 75,              // 継続ページの最初のラング x
  rungGapMin: 45,          // ラング最小間隔
  bodyTopY: 195,           // 標準負荷(高さ20)の上端 y → 下端215 → 0Vへ
  xLimit: 393,             // これを超えるラングは次ページへ
};

const AI_SAFETY_IDS = new Set(["estop", "thermo"]);
const AI_STOP_IDS = new Set(["pb_nc"]);
const AI_START_IDS = new Set(["pb_no", "sel_sw"]);
// それ以外の入力(センサ類)は「運転条件」として直列に入る

function aiExpand(list) {
  const out = [];
  (list || []).forEach(it => { for (let i = 0; i < (it.qty || 1); i++) out.push(it.id); });
  return out;
}

function symExtents(symId) {
  const s = SYMBOLS_BY_ID[symId];
  const [bx, , bw] = s.bounds;
  return { left: Math.max(0, -bx), right: Math.max(0, bx + bw) };
}
function gridUp(v) { return Math.ceil(v / GRID) * GRID; }

function aiGenerate(sel) {
  const report = [];
  const L = AI_L;
  const project = App.project;
  // 生成前が「空のページ1枚だけ」なら、生成後にその空ページを取り除く
  const removeEmptyFirst = project.pages.length === 1 &&
    !project.pages[0].devices.length && !project.pages[0].wires.length && !project.pages[0].texts.length;

  const inputs = aiExpand(sel.inputs);
  const logics = aiExpand(sel.logics);
  const outputs = aiExpand(sel.outputs);
  const opts = sel.opts || {};

  const safeties = inputs.filter(id => AI_SAFETY_IDS.has(id));
  const stops = inputs.filter(id => AI_STOP_IDS.has(id));
  const starts = inputs.filter(id => AI_START_IDS.has(id));
  const conditions = inputs.filter(id => !AI_SAFETY_IDS.has(id) && !AI_STOP_IDS.has(id) && !AI_START_IDS.has(id));

  const motors3 = outputs.filter(id => id === "motor3");
  const motors1 = outputs.filter(id => id === "motor1");
  // モータは主回路ページで扱う (単相/三相とも遮断器+接触器+サーマル+接地を自動生成)
  const motorsAll = [...motors3.map(() => 3), ...motors1.map(() => 1)];
  const ctrlOutputs = outputs.filter(id => id !== "motor3" && id !== "motor1");

  const plcMode = logics.some(id => id === "plc_di" || id === "plc_do");
  const coilSyms = logics.filter(id => ["coil", "cont_coil", "timer_on", "timer_off", "safety_relay"].includes(id));

  // ── AI 設計判断 ──
  if (motorsAll.length && !plcMode && coilSyms.filter(s => s === "cont_coil").length < motorsAll.length) {
    const add = motorsAll.length - coilSyms.filter(s => s === "cont_coil").length;
    for (let i = 0; i < add; i++) coilSyms.push("cont_coil");
    report.push(`モータ検出 (三相${motors3.length}/単相${motors1.length}) → 電磁接触器コイルを ${add} 台自動追加`);
  }
  if (safeties.length) report.push(`安全機器 ${safeties.length} 点を電源直下の安全チェーンに直列配置`);
  if (conditions.length) report.push(`センサ入力 ${conditions.length} 点を運転条件として直列配置 (自動再起動を防止)`);
  if (opts.selfHold && (coilSyms.length || plcMode)) report.push("自己保持回路(3ワイヤ制御)を適用 — 起動は並列・停止は直列");

  // ── ページ名の一意化 ──
  const usedNames = project.pages.map(p => p.name);
  const pageName = base => {
    if (!usedNames.includes(base)) { usedNames.push(base); return base; }
    let k = 2;
    while (usedNames.includes(`${base} ${k}`)) k++;
    usedNames.push(`${base} ${k}`);
    return `${base} ${k}`;
  };

  // ── 端子番号 (既存の続きから) ──
  let termN = 1;
  project.pages.forEach(pg => pg.devices.forEach(d => {
    const m = /^-X1:(\d+)$/.exec(d.tag || "");
    if (m) termN = Math.max(termN, +m[1] + 1);
  }));
  const useTerm = opts.terminals !== false;

  // ── 接点リソース管理 (コイルごとの実装可能接点数) ──
  const contactBudget = new Map();
  const regCoil = dev => contactBudget.set(dev.id, SYMBOLS_BY_ID[dev.sym].maxContacts || 4);
  const takeContact = id => {
    const b = contactBudget.get(id) || 0;
    if (b > 0) { contactBudget.set(id, b - 1); return true; }
    return false;
  };
  /** カスケード末尾側から、接点残数のあるコイルを探して1点消費する */
  const coils = [];
  function allocDriveCoil(preferIdx) {
    const order = [];
    for (let i = coils.length - 1; i >= 0; i--) order.push(i);
    if (preferIdx !== undefined && preferIdx >= 0) order.unshift(preferIdx);
    for (const i of order) {
      if (takeContact(coils[i].id)) return coils[i];
    }
    return null;
  }
  function driveContactFor(coilDev) {
    return (coilDev.sym === "timer_on" || coilDev.sym === "timer_off") ? "aux_ton_no" : "aux_no";
  }

  /* ── 制御回路シート管理 (図枠に収まらなければ自動分割) ── */
  const ctrlTag = safeties.length ? "1L+" : "+24V";
  const sheets = [];
  let cur = null;
  const pageIdxs = [];

  function openSheet() {
    const first = sheets.length === 0;
    const page = newPage(pageName("制御回路"), project.pages.length + 1);
    project.pages.push(page);
    pageIdxs.push(project.pages.length - 1);
    let ctrlRailY = L.topRailY;
    let ctrlStartX = 45;
    let inLinks = [];
    if (first) {
      // 電源ユニット + AC引込 (L相に一次側保護ヒューズ)
      addDevice(page, "psu24", L.psuX, L.psuY, { desc: "制御電源" });
      addDevice(page, "fuse", L.psuX - 10, 22, { rot: 90, desc: "" }); // pins (45,22),(25,22)
      const s1 = addWire(page, [[15, 22], [L.psuX - 30, 22]]);
      addWire(page, [[L.psuX - 10, 22], [L.psuX - 10, L.psuY]]);
      const s2 = addWire(page, [[L.psuX + 10, L.psuY - 10], [L.psuX + 10, L.psuY]]);
      if (s1) s1.stub = true;
      if (s2) s2.stub = true;
      page.texts.push({ id: uid("t"), x: 12, y: 24, text: "L", size: 3.4 });
      page.texts.push({ id: uid("t"), x: L.psuX + 10, y: L.psuY - 13, text: "N", size: 3.4 });
      page.texts.push({ id: uid("t"), x: L.psuX + 13, y: 15, text: "AC100V", size: 3.6, anchor: "start" });
      // 24V 分岐保護を +24V レール横引きに挿入 (0V縦引き x=psuX+10 を跨がない位置)
      addWire(page, [[L.psuX - 10, L.psuY + 30], [L.psuX - 10, L.topRailY], [L.psuX + 15, L.topRailY]]);
      addDevice(page, "fuse", L.psuX + 35, L.topRailY, { rot: 90, desc: "" }); // pins (90,65),(70,65)
      ctrlStartX = L.psuX + 35;
      // 安全チェーン (横型: 何点あっても縦スペースを消費しない)
      if (safeties.length) {
        const chainY = L.topRailY + 15;
        addWire(page, [[L.safetyX, L.topRailY], [L.safetyX, chainY]]);
        let sx = L.safetyX;
        safeties.forEach(id => {
          addDevice(page, id, sx, chainY, { rot: 270, desc: id === "estop" ? "非常停止" : "温度異常" });
          sx += 20;
        });
        ctrlRailY = chainY + 25; // = topRailY + 40 → ラング縦許容 80mm (端子込み4スロット)
        addWire(page, [[sx, chainY], [sx, ctrlRailY]]);
        page.texts.push({ id: uid("t"), x: L.safetyX, y: ctrlRailY + 5, text: "安全回路", size: 3.4, anchor: "start" });
        ctrlStartX = sx;
      }
    } else {
      // 継続ページ: 電位リンクで受電
      inLinks = [
        addDevice(page, "link", 45, L.topRailY, { tag: ctrlTag, desc: "" }),
        addDevice(page, "link", 45, L.botRailY, { tag: "0V", desc: "" }),
      ];
    }
    cur = {
      page, first, ctrlRailY, ctrlStartX, inLinks, outLinks: [], endX: 0,
      xCursor: first ? Math.max(L.rungX0, ctrlStartX + 30) : L.contX0,
      prevRightAbs: first ? ctrlStartX + 5 : 55,
    };
    sheets.push(cur);
    return cur;
  }

  function closeSheet(sheet, hasNext) {
    const pg = sheet.page;
    // スナップ済みの値を使う (リンクデバイスの実配置位置と列参照を一致させる)
    const endX = snap(Math.min(400, Math.max(sheet.prevRightAbs + 20, sheet.first ? 200 : 140)));
    sheet.endX = endX;
    if (sheet.first) {
      if (safeties.length) {
        // +24V レール: DCヒューズ以降、安全チェーンのドロップまで
        const w1 = addWire(pg, [[L.psuX + 35, L.topRailY], [Math.max(L.safetyX + 10, L.psuX + 55), L.topRailY]]);
        if (w1) w1.stub = true;
        const wc = addWire(pg, [[sheet.ctrlStartX, sheet.ctrlRailY], [endX, sheet.ctrlRailY]]);
        if (wc && !hasNext) wc.stub = true;
      } else {
        const wc = addWire(pg, [[L.psuX + 35, L.topRailY], [endX, L.topRailY]]);
        if (wc && !hasNext) wc.stub = true;
      }
      const wn = addWire(pg, [[L.psuX + 10, L.psuY + 30], [L.psuX + 10, L.botRailY], [endX, L.botRailY]]);
      if (wn && !hasNext) wn.stub = true;
      pg.texts.push({ id: uid("t"), x: L.psuX - 24, y: L.topRailY - 3, text: "+24V", size: 4.2 });
      pg.texts.push({ id: uid("t"), x: L.psuX + 24, y: L.botRailY - 3, text: "0V", size: 4.2 });
    } else {
      const wc = addWire(pg, [[45, sheet.ctrlRailY], [endX, sheet.ctrlRailY]]);
      const wn = addWire(pg, [[45, L.botRailY], [endX, L.botRailY]]);
      if (wc && !hasNext) wc.stub = true;
      if (wn && !hasNext) wn.stub = true;
    }
    if (hasNext) {
      // 右端に送り側の電位リンク (行先参照は全シート確定後に付与)
      sheet.outLinks = [
        addDevice(pg, "link", endX, sheet.ctrlRailY, { tag: ctrlTag, desc: "" }),
        addDevice(pg, "link", endX, L.botRailY, { tag: "0V", desc: "" }),
      ];
    }
  }

  /* ── ラング構築 ── */
  const overflowNotes = [];
  let termSkipped = 0;
  function buildRung(spec, retried) {
    const { series = [], startGroup = [], body, funcText = "" } = spec;
    // 図枠に収まらなければ次のシートへ
    const estRight = 20 + (startGroup.length > 1 ? (startGroup.length - 1) * 20 + 10 : 0);
    if (!cur || cur.xCursor + estRight > L.xLimit) openSheet();
    {
      // 左張り出し分のシフト後にも図枠チェック (シート先頭のラングは強制配置)
      const leftNeed0 = Math.max(20, ...series.map(e => symExtents(e.id).left + 14),
        ...startGroup.map(e => symExtents(e.id).left + 14), symExtents(body.id).left + 14);
      const x0 = Math.max(cur.xCursor, gridUp(cur.prevRightAbs + leftNeed0 + 3));
      const atStart = cur.xCursor === (cur.first ? L.rungX0 : L.contX0);
      if (!retried && !atStart && x0 + estRight > L.xLimit) {
        openSheet();
        return buildRung(spec, true);
      }
    }
    const page = cur.page;
    const ctrlRailY = cur.ctrlRailY;
    const bodyH = body.h || 20;
    const bodyTop = L.bodyTopY - (bodyH - 20);
    let els = [...series];
    const avail = bodyTop - ctrlRailY - 10;
    const fieldFirst = els.length && SYMBOLS_BY_ID[els[0].id].cat === "input";
    let nSlots = els.length + (startGroup.length ? 1 : 0);
    let withTerm = useTerm && (fieldFirst || (!els.length && startGroup.length));
    if (withTerm && (nSlots + 1) * 20 <= avail) {
      els = [{ id: "terminal", tag: `-X1:${termN++}`, desc: "" }, ...els];
      nSlots++;
    } else {
      if (withTerm) termSkipped++; // 省略した端子は無音にせず件数を報告する
      withTerm = false;
    }
    let pitch = 30;
    if (nSlots * 30 > avail) pitch = 25;
    if (nSlots * 25 > avail) pitch = 20;
    while (nSlots * pitch > avail && els.length > (startGroup.length ? 0 : 1)) {
      // 端子以外を落とすことは許さない: 発注機器の無音欠落は検図エラーに直結させる
      const dropIdx = els.findIndex(e => e.id === "terminal");
      const dropped = dropIdx >= 0 ? els.splice(dropIdx, 1)[0] : els.pop();
      if (dropped.id !== "terminal") {
        const nm = SYMBOLS_BY_ID[dropped.id] ? SYMBOLS_BY_ID[dropped.id].name : dropped.id;
        overflowNotes.push(nm);
        page.genWarnings = page.genWarnings || [];
        page.genWarnings.push(`スペース不足のため ${nm} を配置できませんでした — 手動で追加してください`);
      }
      nSlots--;
    }
    const leftNeed = Math.max(20, ...els.map(e => symExtents(e.id).left + 14),
      ...startGroup.map(e => symExtents(e.id).left + 14),
      symExtents(body.id).left + 14);
    const x = Math.max(cur.xCursor, gridUp(cur.prevRightAbs + leftNeed + 3));

    const slotY = i => bodyTop - pitch * (nSlots - i);
    const firstY = nSlots ? slotY(0) : bodyTop;
    addWire(page, [[x, ctrlRailY], [x, firstY]]);

    let rightMost = 6;
    els.forEach((el, i) => {
      const y = slotY(i);
      addDevice(page, el.id, x, y, { tag: el.tag, linkTo: el.linkTo || null, desc: el.desc || "" });
      if (pitch > 20) addWire(page, [[x, y + 20], [x, y + pitch]]);
    });
    if (startGroup.length) {
      const gy = slotY(nSlots - 1);
      let off = 0, prevRight = 0, prevOff = 0;
      startGroup.forEach((el, k) => {
        if (k > 0) {
          const ext = symExtents(el.id);
          off = gridUp(off + Math.max(15, prevRight + ext.left + 4));
          addWire(page, [[prevOff === 0 ? x : x + prevOff, gy], [x + off, gy]]);
          addWire(page, [[x + off, gy + 20], [prevOff === 0 ? x : x + prevOff, gy + 20]]);
          prevOff = off;
        }
        addDevice(page, el.id, x + off, gy, { tag: el.tag, linkTo: el.linkTo || null, desc: el.desc || "" });
        prevRight = symExtents(el.id).right;
        rightMost = Math.max(rightMost, off + prevRight);
      });
      if (pitch > 20) addWire(page, [[x, gy + 20], [x, gy + pitch]]);
    }
    const bd = addDevice(page, body.id, x, bodyTop, { desc: body.desc || "", linkTo: body.linkTo || null, tag: body.tag });
    rightMost = Math.max(rightMost, symExtents(body.id).right);
    if (useTerm && SYMBOLS_BY_ID[body.id].cat === "output") {
      addDevice(page, "terminal", x, bodyTop + bodyH, { tag: `-X1:${termN++}`, desc: "" });
      if (bodyTop + bodyH + 20 < L.botRailY) addWire(page, [[x, bodyTop + bodyH + 20], [x, L.botRailY]]);
    } else {
      addWire(page, [[x, bodyTop + bodyH], [x, L.botRailY]]);
    }
    if (funcText) page.texts.push({ id: uid("t"), x, y: L.botRailY + 10, text: funcText, size: 3.8 });

    cur.prevRightAbs = x + rightMost;
    cur.xCursor = x + Math.max(L.rungGapMin, gridUp(rightMost + 25));
    return bd;
  }

  openSheet();

  // ── ロジック段 / 出力段 ──
  const startQueue = [...starts];
  const stopQueue = [...stops];
  const condQueue = [...conditions];
  const inputDescs = { pb_no: "起動", pb_nc: "停止", sel_sw: "切替", limit_sw: "位置検出", prox: "在荷検出", photo: "通過検出", press_sw: "圧力検出", float_sw: "レベル検出", thermo: "温度異常" };
  let contIdx = 0;

  if (plcMode) {
    let di = 0, qo = 0;
    inputs.filter(id => !AI_SAFETY_IDS.has(id)).forEach(id => {
      const addr = "I0." + (di++);
      buildRung({
        startGroup: [{ id, desc: inputDescs[id] || "" }],
        body: { id: "plc_di", desc: addr }, funcText: addr,
      });
    });
    ctrlOutputs.forEach(id => {
      const addr = "Q0." + (qo++);
      buildRung({
        series: [{ id: "plc_do", desc: addr }],
        body: { id, h: id === "motor1" ? 40 : 20 }, funcText: addr,
      });
    });
    motorsAll.forEach(() => {
      const addr = "Q0." + (qo++);
      const q = buildRung({
        series: [{ id: "plc_do", desc: addr }, { id: "ol_nc", tag: "", linkTo: `__ol${contIdx}__`, desc: "過負荷" }],
        body: { id: "cont_coil", desc: "モータ運転" }, funcText: addr,
      });
      contIdx++;
      coils.push(q); regCoil(q);
    });
    report.push(`PLC入出力を自動割付 (入力 ${di} 点 / 出力 ${qo} 点)`);
  } else {
    const funcNames = { coil: "制御リレー", cont_coil: "モータ運転", timer_on: "遅延制御", timer_off: "遅延復帰", safety_relay: "安全リレー" };
    /** リレー系コイルのラングを1本生成し、自己保持・予算を登録する共通処理 */
    function makeCoilRung(symId, series, startGroup, descOverride) {
      const body = buildRung({
        series, startGroup,
        body: { id: symId, desc: descOverride || funcNames[symId] || "" },
        funcText: descOverride || funcNames[symId] || "",
      });
      regCoil(body);
      let hadSelfHold = false;
      App.project.pages.forEach(pg => pg.devices.forEach(d => {
        if (d.linkTo === "__self__") { d.linkTo = body.id; hadSelfHold = true; }
      }));
      if (hadSelfHold) takeContact(body.id);
      coils.push(body);
      return body;
    }
    coilSyms.forEach(symId => {
      let series = [];
      if (stopQueue.length) series.push({ id: stopQueue.shift(), desc: "停止" });
      // 運転条件センサはスロットが許す限り直列に消費する (中継リレー行きを最小化)
      const availSlots = Math.floor((L.bodyTopY - cur.ctrlRailY - 10) / 20);
      const condCap = Math.max(1, availSlots - 1 /*start*/ - (useTerm ? 1 : 0) - series.length);
      for (let c = 0; c < condCap && condQueue.length; c++) {
        const cid = condQueue.shift();
        series.push({ id: cid, desc: inputDescs[cid] || "条件" });
      }
      let startGroup = [];
      if (startQueue.length) startGroup.push({ id: startQueue.shift() });
      startGroup.forEach(el => el.desc = inputDescs[el.id] || "起動");
      if (opts.selfHold && startGroup.length) startGroup.push({ id: "aux_no", tag: "", linkTo: "__self__", desc: "" });
      // タイマ/接触器は現場入力を直接受けない: 制御リレーを先に立てて吸収する
      // (H3Y-2 に存在しない瞬時接点での自己保持や、接触器コイルのスロット超過を防ぐ)
      const isAbsorberTarget = ["timer_on", "timer_off", "cont_coil"].includes(symId);
      if (isAbsorberTarget && (series.length || startGroup.length)) {
        const abs = makeCoilRung("coil", series, startGroup, "制御リレー");
        report.push(`${funcNames[symId]} の入力受けに制御リレー ${abs.tag} を自動追加 (実装接点仕様を守るため)`);
        series = [];
        startGroup = [];
      }
      // 入力が何もないコイル → 前段コイルの接点でカスケード駆動 (接点残数を消費)
      if (!series.length && !startGroup.length && coils.length) {
        const drv = allocDriveCoil(coils.length - 1);
        if (drv) series.push({ id: driveContactFor(drv), tag: "", linkTo: drv.id, desc: "" });
      }
      if (symId === "cont_coil" && motorsAll.length) {
        series.push({ id: "ol_nc", tag: "", linkTo: `__ol${contIdx}__`, desc: "過負荷" });
        contIdx++;
      }
      const body = makeCoilRung(symId, series, startGroup);
      // 接触器は主回路の主接点で1点消費する分を予約
      if (symId === "cont_coil" && motorsAll.length) takeContact(body.id);
    });
    let extra = 0;
    while (startQueue.length || condQueue.length) {
      const isCond = !startQueue.length;
      const id = startQueue.length ? startQueue.shift() : condQueue.shift();
      const body = buildRung({
        startGroup: [{ id, desc: inputDescs[id] || "入力" }],
        body: { id: "coil", desc: "入力中継" }, funcText: "入力中継",
      });
      regCoil(body);
      coils.push(body); extra++;
      if (isCond) {
        // 条件センサを中継に落とした場合、主回路の直列条件から漏れている
        // ことを検図で必ず可視化する
        cur.page.genWarnings = cur.page.genWarnings || [];
        cur.page.genWarnings.push(`条件センサ ${SYMBOLS_BY_ID[id].name} (${body.tag} 経由) が運転条件に組み込まれていません — ${body.tag} の接点を主回路の直列に手動追加してください`);
      }
    }
    if (extra) report.push(`未割付の入力 ${extra} 点に中継リレーを自動追加`);

    // ── 接点需要の事前計画 ──
    const baseCoils = [...coils];
    // 動作表示灯はコイルごとに1点を先に予約する (合計だけ見ると特定コイルが枯渇するため)
    const lampFbReserved = [];
    if (opts.lampFb) {
      baseCoils.forEach(coil => { if (takeContact(coil.id)) lampFbReserved.push(coil); });
    }
    if (coils.length) {
      const demand = ctrlOutputs.length;
      let supply = [...contactBudget.values()].reduce((a, b) => a + b, 0);
      let added = 0;
      while (demand > supply && added < 4) {
        const drv = allocDriveCoil(coils.length - 1);
        if (!drv) break;
        makeCoilRung("coil", [{ id: driveContactFor(drv), tag: "", linkTo: drv.id, desc: "" }], [], "接点増設");
        added++;
        supply = [...contactBudget.values()].reduce((a, b) => a + b, 0);
      }
      if (added) report.push(`接点需要が実装数を超えるため増設リレーを ${added} 台自動追加`);
    }

    // ── 出力段: 機能に合った駆動源を選ぶ ──
    //  ランプ(運転表示) → 接触器優先 / ブザー(警報) → サーマルの97-98 (過負荷警報) /
    //  その他 → カスケード末尾
    const outNames = { lamp: "運転表示", buzzer: "警報", sol_valve: "バルブ開閉", heater: "加熱", motor1: "モータ運転" };
    const lastContIdx = coils.map(c => c.sym).lastIndexOf("cont_coil");
    let alarmOl = 0; // 過負荷警報に使ったサーマル数 (97-98 は各1点まで)
    const lampDriven = new Set(); // 既に運転表示灯が付いたコイル (動作表示灯の重複を防ぐ)
    let starved = 0;
    ctrlOutputs.forEach((id, i) => {
      const bodyH = id === "motor1" ? 40 : 20;
      if (id === "buzzer" && motorsAll.length && alarmOl < motorsAll.length) {
        // 警報ブザーは運転系ではなく過負荷警報 (サーマル 97-98) で鳴らす
        buildRung({
          series: [{ id: "ol_no", tag: "", linkTo: `__ol${alarmOl}__` }],
          body: { id, h: bodyH }, funcText: "過負荷警報",
        });
        alarmOl++;
        return;
      }
      if (id === "buzzer" && !motorsAll.length) {
        // 警報源 (サーマル等) が構成にない: 運転状態で鳴る配線になることを検図で可視化
        cur.page.genWarnings = cur.page.genWarnings || [];
        cur.page.genWarnings.push("ブザーの警報源 (サーマルリレー等) が構成にありません — このままでは運転状態で鳴る配線です。警報接点に手動で繋ぎ替えてください");
      }
      if (coils.length) {
        const prefer = (id === "lamp" && lastContIdx >= 0)
          ? lastContIdx
          : (coils.length - 1 - (i % coils.length) + coils.length) % coils.length;
        const drv = allocDriveCoil(prefer);
        if (drv) {
          const fn = (id === "lamp" && drv.sym !== "cont_coil" && lastContIdx >= 0) ? "動作表示" : (outNames[id] || "");
          if (id === "lamp") lampDriven.add(drv.id);
          buildRung({
            series: [{ id: driveContactFor(drv), tag: "", linkTo: drv.id }],
            body: { id, h: bodyH }, funcText: fn,
          });
        } else {
          // 全コイルの接点が枯渇: 超過リンクはせず、DRCで必ず可視化される警告として残す
          starved++;
          const last = coils[coils.length - 1];
          buildRung({
            series: [{ id: driveContactFor(last), tag: "", linkTo: last.id }],
            body: { id, h: bodyH }, funcText: outNames[id] || "",
          });
          cur.page.genWarnings = cur.page.genWarnings || [];
          cur.page.genWarnings.push(`${SYMBOLS_BY_ID[id].name} の駆動接点が ${last.tag} の実装可能数を超えています — リレー型式の見直しが必要`);
        }
      } else {
        const drv = starts.length ? starts[i % starts.length] : (conditions[i % Math.max(1, conditions.length)] || null);
        if (!drv) report.push(`注意: ${SYMBOLS_BY_ID[id].name} を駆動する入力がありません`);
        buildRung({
          startGroup: drv ? [{ id: drv, desc: inputDescs[drv] || "" }] : [],
          body: { id, h: bodyH }, funcText: outNames[id] || "",
        });
      }
    });
    if (starved) report.push(`⚠ 接点数が不足しています (${starved} 点超過) — リレーを多接点型式に変更するか中継リレーを追加してください`);

    if (opts.lampFb) {
      let added = 0;
      lampFbReserved.forEach(coil => {
        if (lampDriven.has(coil.id)) {
          // 既に運転表示灯が付いているコイルには重複させず、予約した接点を返却
          contactBudget.set(coil.id, (contactBudget.get(coil.id) || 0) + 1);
          return;
        }
        buildRung({
          series: [{ id: driveContactFor(coil), tag: "", linkTo: coil.id }],
          body: { id: "lamp", desc: "動作表示" }, funcText: "動作表示",
        });
        added++;
      });
      const skipped = baseCoils.length - lampFbReserved.length;
      if (added) report.push(`動作表示灯を ${added} 灯自動追加`);
      if (skipped) report.push(`接点残数のないコイル ${skipped} 台は表示灯を省略 (接点数を守るため)`);
    }
  }
  if (overflowNotes.length) report.push(`スペース不足のため直列要素 ${overflowNotes.length} 点を省略しました (手動で追加してください)`);
  if (useTerm && termN > 1) report.push(`現場機器との境界に端子 -X1:1〜${termN - 1} を自動挿入`);
  if (termSkipped) report.push(`スペース不足のため端子 ${termSkipped} 点を省略しました (必要なら手動で挿入してください)`);

  // ── 空の初期ページはここで除去する ──
  // (電位リンクの行先参照・主回路のページ番号が確定する前に再採番しないと 1 ずれる)
  if (removeEmptyFirst) {
    project.pages.shift();
    project.pages.forEach((p, i) => p.no = i + 1);
    for (let i = 0; i < pageIdxs.length; i++) pageIdxs[i]--;
  }

  // ── 各シートのレールを引き、電位リンクに行先クロスリファレンスを付与 ──
  sheets.forEach((s, i) => closeSheet(s, i < sheets.length - 1));
  for (let i = 0; i < sheets.length - 1; i++) {
    const from = sheets[i], to = sheets[i + 1];
    from.outLinks.forEach(d => d.desc = `/${to.page.no}.0`);
    to.inLinks.forEach(d => d.desc = `/${from.page.no}.${sheetCol(from.endX)}`);
  }
  if (sheets.length > 1) report.push(`図枠に収まらないため制御回路を ${sheets.length} ページに自動分割 (電位リンク ${ctrlTag}/0V で接続)`);

  // ── 主回路ページ (三相 / 単相モータ) ──
  if (motorsAll.length) {
    const pw = newPage(pageName("主回路"), project.pages.length + 1);
    project.pages.push(pw);
    pageIdxs.push(project.pages.length - 1);
    const contCoils = coils.filter(c => c.sym === "cont_coil");
    const olIds = [];
    const fixWire = (pg, pts, num) => { const w = addWire(pg, pts); if (w) { w.num = num; w.fixed = true; } };
    let bx = 70;
    motorsAll.forEach((phase, mi) => {
      const mp = mi === 0 ? "" : `${mi + 1}`;
      const coil = contCoils[mi % Math.max(1, contCoils.length)] || null;
      if (phase === 3) {
        // ── 三相ブロック (3極) ──
        addDevice(pw, "supply3", bx + 10, 25, { tag: "", desc: "" });
        pw.texts.push({ id: uid("t"), x: bx + 10, y: 16, text: "AC200V 3φ", size: 4 });
        [["L1", 0], ["L2", 10], ["L3", 20]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 35], [bx + o, 55]], mp + ph));
        addDevice(pw, "mcb3", bx, 55, { desc: "主回路保護" });
        [["1L1", 0], ["1L2", 10], ["1L3", 20]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 75], [bx + o, 100]], mp + ph));
        addDevice(pw, "main_cont", bx, 100, { tag: "", linkTo: coil ? coil.id : null, desc: "" });
        [["2L1", 0], ["2L2", 10], ["2L3", 20]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 120], [bx + o, 140]], mp + ph));
        const ol = addDevice(pw, "ol3", bx, 140, { desc: "過負荷保護" });
        olIds.push(ol.id);
        [["U1", 0], ["V1", 10], ["W1", 20]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 160], [bx + o, 180]], mp + ph));
        addDevice(pw, "motor3", bx + 10, 180, { desc: "電動機" });
        addDevice(pw, "earth", bx + 10, 215, { tag: "", desc: "" });
        pw.texts.push({ id: uid("t"), x: bx + 10, y: 240, text: `モータ回路 ${mi + 1} (3φ)`, size: 3.8 });
        bx += 85;
      } else {
        // ── 単相ブロック (2極: L/N) ──
        addDevice(pw, "supply1", bx + 5, 25, { tag: "", desc: "" });
        pw.texts.push({ id: uid("t"), x: bx + 5, y: 16, text: "AC100V 1φ", size: 4 });
        [["L", 0], ["N", 10]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 35], [bx + o, 55]], mp + ph));
        addDevice(pw, "mcb2", bx, 55, { desc: "主回路保護" });
        [["1L", 0], ["1N", 10]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 75], [bx + o, 100]], mp + ph));
        addDevice(pw, "main_cont2", bx, 100, { tag: "", linkTo: coil ? coil.id : null, desc: "" });
        [["2L", 0], ["2N", 10]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 120], [bx + o, 140]], mp + ph));
        const ol = addDevice(pw, "ol2", bx, 140, { desc: "過負荷保護" });
        olIds.push(ol.id);
        [["U1", 0], ["U2", 10]].forEach(([ph, o]) => fixWire(pw, [[bx + o, 160], [bx + o, 180]], mp + ph));
        addDevice(pw, "motor1", bx + 5, 180, { desc: "電動機" });
        addDevice(pw, "earth", bx + 5, 215, { tag: "", desc: "" });
        pw.texts.push({ id: uid("t"), x: bx + 5, y: 240, text: `モータ回路 ${mi + 1} (1φ)`, size: 3.8 });
        bx += 70;
      }
    });
    project.pages.forEach(pg => pg.devices.forEach(d => {
      const m = /^__ol(\d+)__$/.exec(d.linkTo || "");
      if (m) d.linkTo = olIds[+m[1] % olIds.length] || null;
    }));
    report.push(`主回路ページを自動生成 (三相${motors3.length}/単相${motors1.length}: 遮断器 + 接触器 + サーマルリレー + 接地、相番号を付与)`);
  } else {
    project.pages.forEach(pg => pg.devices.forEach(d => {
      if (/^__ol\d+__$/.test(d.linkTo || "")) d.linkTo = null;
    }));
  }

  // ── 仕上げ ──
  if (opts.autoNum !== false) {
    autoNumberWires();
    report.push("配線番号を自動付与 (接点を跨がない区間採番・主回路は相名)");
  }
  const totalDevs = pageIdxs.reduce((n, i) => n + project.pages[i].devices.length, 0);
  const totalWires = pageIdxs.reduce((n, i) => n + project.pages[i].wires.length, 0);
  report.push(`生成完了: ${pageIdxs.length} ページ / デバイス ${totalDevs} 点 / 配線 ${totalWires} 本`);
  return { report, pageIdxs };
}
