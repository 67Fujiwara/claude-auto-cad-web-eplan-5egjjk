/**
 * Code.gs — 工具貸出管理 Web アプリ本体
 *
 * 役割:
 *   - setup()            : スプレッドシートの初期化（シート作成・見出し・設定初期値・タイムゾーン）
 *   - installTriggers()  : 毎朝8時に dailyCheck() を動かすトリガーを登録
 *   - doGet()            : 画面のルーティング（申請 / 一覧 / 管理 / 印刷 / メールリンク操作）
 *   - api*()  / admin*() : 各画面から google.script.run で呼ばれるサーバー関数
 *   - rentTool_ / returnTool_ / extendTool_ : 貸出・返却・延長のコア処理（LockService で二重貸出を防止）
 *   - 端末ID: 申請画面が localStorage に持つ擬似ID。返却は借りた端末からのみ（管理画面・メールリンクは例外）
 *   - dailyCheck()       : 返却日超過の催促（管理者へ notifyManager。使用者メールがあれば本人にも）
 *
 * 管理者への通知は Notify.gs の notifyManager(event) に集約している（human: メール / ai: Ai.gs）。
 * 末尾が _ の関数は内部用（画面から google.script.run では呼べない）。
 */

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const TZ = 'Asia/Tokyo';
const SHEET_TOOLS = '工具';
const SHEET_LOG = '貸出ログ';
const SHEET_SETTINGS = '設定';

const TOOL_HEADERS = ['tool_id', '工具名', '状態', '使用者名', '使用者メール', '返却日', 'コメント', '端末ID'];
const LOG_HEADERS = ['日時', 'tool_id', '工具名', '使用者名', '使用者メール', '開始日', '返却日', '操作', '備考', '端末ID'];
const SETTING_KEYS = ['manager_type', 'manager_email', 'app_url', 'admin_pin', 'claude_api_key', 'notify_on_request'];

const STATUS_FREE = '空き';
const STATUS_USED = '使用中';

/** tool_id の接頭辞（ID001, ID002 …）。変えるときはここだけ */
const TOOL_ID_PREFIX = 'ID';

// ---------------------------------------------------------------------------
// 初期化（エディタから手動で1回実行する）
// ---------------------------------------------------------------------------

/**
 * スプレッドシートを初期化する。何度実行しても既存データは壊さない。
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  const tools = getOrCreateSheet_(ss, SHEET_TOOLS, TOOL_HEADERS);
  tools.getRange('A:H').setNumberFormat('@'); // 日付は yyyy-MM-dd のテキストとして扱う
  tools.setColumnWidth(2, 200);
  tools.setColumnWidth(7, 300);

  const log = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  log.getRange('A:A').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  log.getRange('B:J').setNumberFormat('@');
  log.setColumnWidth(1, 150);

  const settings = getOrCreateSheet_(ss, SHEET_SETTINGS, ['key', 'value']);
  settings.getRange('A:B').setNumberFormat('@');
  settings.setColumnWidth(2, 400);

  const existing = getSettings();
  const defaults = {
    manager_type: 'human',
    manager_email: '', // 管理画面または設定シートで入力する
    app_url: '',
    admin_pin: randomPin_(),
    claude_api_key: '',
    notify_on_request: 'on', // 貸出時に管理者へ通知するか（on / off）。管理画面のチェックで切り替え
  };
  SETTING_KEYS.forEach(key => {
    if (!(key in existing)) settings.appendRow([key, defaults[key]]);
  });

  const s = getSettings();
  Logger.log('setup 完了。設定シートを確認してください。 admin_pin=' + s.admin_pin + ' manager_email=' + s.manager_email);
}

/**
 * 毎朝8時（日本時間）に dailyCheck を実行するトリガーを登録する（既存の同名トリガーは削除）。
 */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(8).inTimezone(TZ).create();
  Logger.log('トリガー登録完了: dailyCheck 毎日 8時台（' + TZ + '）');
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.every(v => v === '')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 既存シートに列が増えた場合（例: コメント列）は見出しだけ補う
    headers.forEach((h, i) => {
      if (String(first[i] || '').trim() === '') sh.getRange(1, i + 1, 1, 1).setValue(h);
    });
  }
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function randomPin_() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ---------------------------------------------------------------------------
// 画面ルーティング
// ---------------------------------------------------------------------------

/**
 * Web アプリの入口。
 *   ?tool=ID001                    申請画面
 *   ?view=list                     一覧画面（パラメータなしも一覧）
 *   ?view=admin                    管理画面
 *   ?view=print&pin=1234           QR 一括印刷
 *   ?action=return&tool=ID001      返却（メールリンク用）
 *   ?action=extend&tool=ID001&days=3        延長（+N日）
 *   ?action=extend&tool=ID001&date=2026-09-30  延長（日付指定）
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action) return handleAction_(p);
    if (p.view === 'admin') {
      const today = today_();
      return render_('Admin', { today: today, defaultDue: addDays_(today, 7) }, '管理');
    }
    if (p.view === 'print') {
      checkPin_(p.pin);
      return render_('Print', { tools: readTools_().map(fullTool_) }, 'QR印刷');
    }
    if (p.tool) {
      const tool = findTool_(p.tool);
      const today = today_();
      return render_('Request', {
        toolId: p.tool,
        tool: tool ? publicTool_(tool) : null,
        today: today,
        defaultDue: addDays_(today, 7),
      }, '貸出申請');
    }
    return render_('List', {}, '工具一覧');
  } catch (err) {
    return render_('Result', { ok: false, title: 'エラー', message: err.message }, 'エラー');
  }
}

/** メール内リンク（GET）からの返却・延長 */
function handleAction_(p) {
  try {
    if (p.action === 'return') {
      const t = returnTool_(p.tool, 'メールリンク', { force: true });
      return render_('Result', { ok: true, title: '返却しました', message: t.name + ' を返却済みにしました。' }, '返却');
    }
    if (p.action === 'extend') {
      const t = extendTool_(p.tool, { days: p.days ? Number(p.days) : null, date: p.date || null }, 'メールリンク');
      return render_('Result', { ok: true, title: '延長しました', message: t.name + ' の返却日を ' + fmtMd_(t.due) + ' に変更しました。' }, '延長');
    }
    throw new Error('不明な操作です: ' + p.action);
  } catch (err) {
    return render_('Result', { ok: false, title: '処理できませんでした', message: err.message }, 'エラー');
  }
}

/** テンプレートを描画する共通処理 */
function render_(name, data, title) {
  const t = HtmlService.createTemplateFromFile(name);
  t.data = data || {};
  t.appUrl = getAppUrl_();
  t.pageTitle = title || '工具貸出';
  return t.evaluate()
    .setTitle(t.pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 共通パーツ（CSS・上部リンク・JS）を差し込む。テンプレート変数も渡せる */
function include_(name, vars) {
  const t = HtmlService.createTemplateFromFile(name);
  Object.keys(vars || {}).forEach(k => { t[k] = vars[k]; });
  return t.evaluate().getContent();
}

/** テンプレートに JSON を安全に埋め込む（</script> 対策） */
function toJson_(obj) {
  return JSON.stringify(obj === undefined ? null : obj).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// 画面から呼ばれる API（一般利用者）
// ---------------------------------------------------------------------------

function apiGetTool(toolId, deviceId) {
  const t = findTool_(toolId);
  if (!t) throw new Error('工具が見つかりません: ' + toolId);
  return publicTool_(t, deviceId);
}

/** deviceId を渡すと、各工具に「この端末から返却できるか」(canReturn) が付く */
function apiListTools(deviceId) {
  return { today: today_(), tools: readTools_().map(t => publicTool_(t, deviceId)) };
}

/** 申請画面から。メール欄は無いので userEmail は空で呼ばれる。comment は任意。deviceId は端末の擬似ID */
function apiRequest(toolId, userName, userEmail, due, comment, deviceId) {
  return rentTool_(toolId, userName, userEmail || '', due, '申請画面', comment, deviceId);
}

/** 一覧画面から。借りた端末（deviceId 一致）だけ返却できる */
function apiReturn(toolId, deviceId) {
  return returnTool_(toolId, '一覧画面', { deviceId: deviceId });
}

function apiExtend(toolId, days, date) {
  return extendTool_(toolId, { days: days ? Number(days) : null, date: date || null }, '一覧画面');
}

// ---------------------------------------------------------------------------
// 画面から呼ばれる API（管理者・PIN 必須）
// ---------------------------------------------------------------------------

function adminVerifyPin(pin) {
  checkPin_(pin);
  return true;
}

function adminGetData(pin) {
  const s = checkPin_(pin);
  return {
    appUrl: getAppUrl_(),
    tools: readTools_().map(fullTool_),
    settings: {
      manager_type: s.manager_type || 'human',
      manager_email: s.manager_email || '',
      admin_pin: s.admin_pin || '',
      app_url: s.app_url || '',
      notify_on_request: s.notify_on_request !== 'off',
      claude_api_key_set: !!s.claude_api_key,
    },
    logs: readRecentLogs_(50),
  };
}

/** 管理画面から代理で貸す。端末IDは記録しないので、誰の端末からでも返却できる */
function adminRentTool(pin, toolId, userName, due, comment) {
  checkPin_(pin);
  return fullTool_(findTool_(rentTool_(toolId, userName, '', due, '管理画面', comment, '').id));
}

/** 管理画面から返却。端末IDに関係なく返却できる */
function adminReturnTool(pin, toolId) {
  checkPin_(pin);
  returnTool_(toolId, '管理画面', { force: true });
  return fullTool_(findTool_(toolId));
}

function adminAddTool(pin, name) {
  checkPin_(pin);
  name = String(name || '').trim();
  if (!name) throw new Error('工具名を入力してください');
  return withLock_(() => {
    const id = nextToolId_();
    getSheet_(SHEET_TOOLS).appendRow([id, name, STATUS_FREE, '', '', '', '', '']);
    return fullTool_({ id: id, name: name, status: STATUS_FREE, user: '', email: '', due: '', comment: '', device: '' });
  });
}

function adminUpdateTool(pin, toolId, name) {
  checkPin_(pin);
  name = String(name || '').trim();
  if (!name) throw new Error('工具名を入力してください');
  return withLock_(() => {
    const t = findTool_(toolId);
    if (!t) throw new Error('工具が見つかりません: ' + toolId);
    t.name = name;
    writeTool_(t);
    return fullTool_(t);
  });
}

function adminDeleteTool(pin, toolId) {
  checkPin_(pin);
  return withLock_(() => {
    const t = findTool_(toolId);
    if (!t) throw new Error('工具が見つかりません: ' + toolId);
    if (t.status === STATUS_USED) throw new Error('使用中の工具は削除できません（先に返却してください）');
    getSheet_(SHEET_TOOLS).deleteRow(t.row);
    return true;
  });
}

/** 設定の更新。patch = { manager_email?, manager_type?, admin_pin?, app_url? } */
function adminSaveSettings(pin, patch) {
  checkPin_(pin);
  patch = patch || {};
  if ('manager_type' in patch) {
    if (patch.manager_type !== 'human' && patch.manager_type !== 'ai') throw new Error('manager_type は human か ai です');
    setSetting_('manager_type', patch.manager_type);
  }
  if ('manager_email' in patch) {
    const v = String(patch.manager_email || '').trim();
    if (v && !isEmail_(v)) throw new Error('メールアドレスの形式が正しくありません');
    setSetting_('manager_email', v);
  }
  if ('admin_pin' in patch) {
    const v = String(patch.admin_pin || '').trim();
    if (!/^\d{4,6}$/.test(v)) throw new Error('PIN は 4〜6 桁の数字にしてください');
    setSetting_('admin_pin', v);
  }
  if ('app_url' in patch) {
    setSetting_('app_url', String(patch.app_url || '').trim());
  }
  if ('notify_on_request' in patch) {
    setSetting_('notify_on_request', patch.notify_on_request ? 'on' : 'off');
  }
  const s = getSettings();
  return {
    manager_type: s.manager_type,
    manager_email: s.manager_email,
    admin_pin: s.admin_pin,
    app_url: s.app_url,
    notify_on_request: s.notify_on_request !== 'off',
  };
}

function checkPin_(pin) {
  const s = getSettings();
  if (!s.admin_pin) throw new Error('admin_pin が設定されていません（設定シートを確認）');
  if (String(pin || '').trim() !== s.admin_pin) throw new Error('PIN が違います');
  return s;
}

// ---------------------------------------------------------------------------
// コア処理（貸出・返却・延長）
// ---------------------------------------------------------------------------

/**
 * 一覧画面から複数の工具をまとめて借りる。
 * 1 件ずつ rentTool_ を通し、成功分だけをまとめて管理者に 1 通通知する。
 * 戻り値: { ok: [借りられた工具], failed: [{ id, name, message }] }
 */
function apiRequestMany(toolIds, userName, due, comment, deviceId) {
  const ids = Array.from(new Set((toolIds || []).map(v => String(v || '').trim()).filter(Boolean)));
  if (!ids.length) throw new Error('工具を選択してください');
  userName = String(userName || '').trim();
  if (!userName) throw new Error('名前を入力してください');
  const dueYmd = normYmd_(due);
  if (!dueYmd) throw new Error('返却日を選んでください');
  if (dueYmd < today_()) throw new Error('返却日は今日以降を選んでください');

  const ok = [], failed = [];
  ids.forEach(id => {
    try {
      ok.push(rentTool_(id, userName, '', dueYmd, '一覧画面', comment, deviceId, { skipNotify: true }));
    } catch (err) {
      const t = findTool_(id);
      failed.push({ id: id, name: t ? t.name : id, message: err.message });
    }
  });
  if (ok.length) {
    safeNotify_({
      type: 'request',
      tool: { id: ok[0].id, name: ok[0].name },
      tools: ok.map(t => ({ id: t.id, name: t.name })),
      user: { name: userName, email: '' },
      startDate: today_(),
      dueDate: dueYmd,
      comment: String(comment || '').trim().slice(0, 200),
      note: '一覧画面',
    });
  }
  return { ok: ok, failed: failed };
}

function rentTool_(toolId, userName, userEmail, due, note, comment, deviceId, opt) {
  opt = opt || {};
  userName = String(userName || '').trim();
  userEmail = String(userEmail || '').trim();
  if (!userName) throw new Error('名前を入力してください');
  // メールは任意（社内運用のため申請画面には入力欄がない）。入っていれば形式だけ確認する
  if (userEmail && !isEmail_(userEmail)) throw new Error('メールアドレスの形式が正しくありません');
  comment = String(comment || '').trim().slice(0, 200);
  deviceId = normDevice_(deviceId);
  const dueYmd = normYmd_(due);
  if (!dueYmd) throw new Error('返却日を選んでください');
  const today = today_();
  if (dueYmd < today) throw new Error('返却日は今日以降を選んでください');

  const result = withLock_(() => {
    const t = findTool_(toolId);
    if (!t) throw new Error('工具が見つかりません: ' + toolId);
    if (t.status === STATUS_USED) {
      throw new Error(t.user + ' さんが ' + fmtMd_(t.due) + ' まで使用中です');
    }
    t.status = STATUS_USED;
    t.user = userName;
    t.email = userEmail;
    t.due = dueYmd;
    t.comment = comment;
    t.device = deviceId;
    writeTool_(t);
    appendLog_(t, '貸出', { start: today, due: dueYmd, note: joinNote_(note, comment) });
    return t;
  });

  if (!opt.skipNotify) {
    safeNotify_({
      type: 'request',
      tool: { id: result.id, name: result.name },
      user: { name: userName, email: userEmail },
      startDate: today,
      dueDate: dueYmd,
      comment: comment,
      note: note,
    });
  }
  return publicTool_(result, deviceId);
}

/**
 * 返却。opt = { deviceId: '端末ID', force: true|false }
 *   借りたときの端末IDが記録されている工具は、同じ端末IDからしか返却できない。
 *   force=true（管理画面・メールリンク）なら端末に関係なく返却できる。
 */
function returnTool_(toolId, note, opt) {
  opt = opt || {};
  const deviceId = normDevice_(opt.deviceId);
  let ev = null;
  const result = withLock_(() => {
    const t = findTool_(toolId);
    if (!t) throw new Error('工具が見つかりません: ' + toolId);
    if (t.status !== STATUS_USED) throw new Error(t.name + ' はすでに返却済みです');
    if (!opt.force && t.device && t.device !== deviceId) {
      throw new Error('この工具は別の端末から借りられています。借りた端末で返却するか、管理者に返却を依頼してください');
    }
    ev = {
      type: 'return',
      tool: { id: t.id, name: t.name },
      user: { name: t.user, email: t.email },
      dueDate: t.due,
      returnDate: today_(),
      comment: t.comment,
      note: note,
    };
    appendLog_(t, '返却', { start: '', due: t.due, note: joinNote_(note, t.comment), device: opt.force ? (deviceId || t.device) : deviceId });
    t.status = STATUS_FREE;
    t.user = '';
    t.email = '';
    t.due = '';
    t.comment = '';
    t.device = '';
    writeTool_(t);
    return t;
  });
  safeNotify_(ev);
  return publicTool_(result);
}

/**
 * 延長。opt = { days: 3 } または { date: 'yyyy-MM-dd' }
 * +N日 は「元の返却日」が基準。ただし既に超過している場合は「今日」を基準にする。
 */
function extendTool_(toolId, opt, note) {
  opt = opt || {};
  const today = today_();
  let ev = null;
  const result = withLock_(() => {
    const t = findTool_(toolId);
    if (!t) throw new Error('工具が見つかりません: ' + toolId);
    if (t.status !== STATUS_USED) throw new Error(t.name + ' は貸出中ではありません');

    let newDue;
    if (opt.date) {
      newDue = normYmd_(opt.date);
      if (!newDue) throw new Error('日付の形式が正しくありません');
    } else {
      const days = Number(opt.days);
      if (!days || days < 1 || days > 365) throw new Error('延長日数が正しくありません');
      const base = (t.due && t.due >= today) ? t.due : today;
      newDue = addDays_(base, days);
    }
    if (newDue < today) throw new Error('返却日は今日以降を選んでください');

    const oldDue = t.due;
    t.due = newDue;
    writeTool_(t);
    appendLog_(t, '延長', { start: '', due: newDue, note: (note || '') + '（' + fmtMd_(oldDue) + '→' + fmtMd_(newDue) + '）' });
    ev = {
      type: 'extend',
      tool: { id: t.id, name: t.name },
      user: { name: t.user, email: t.email },
      oldDueDate: oldDue,
      dueDate: newDue,
      comment: t.comment,
      note: note,
    };
    return t;
  });
  safeNotify_(ev);
  return publicTool_(result);
}

/** 同時アクセスによる二重貸出を防ぐ */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('混み合っています。少し待ってからやり直してください');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 通知失敗で本処理を失敗させない */
function safeNotify_(event) {
  if (!event) return;
  try {
    notifyManager(event);
  } catch (err) {
    Logger.log('notifyManager 失敗: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// 催促（毎朝8時のトリガーで実行）
// ---------------------------------------------------------------------------

/**
 * 返却日 < 今日 の工具について、使用者と管理者にメールする。返却されるまで毎日送る。
 * エディタから手動実行してもよい。
 */
function dailyCheck() {
  const today = today_();
  const overdue = readTools_().filter(t => t.status === STATUS_USED && t.due && t.due < today);
  overdue.forEach(t => {
    const ev = {
      type: 'overdue',
      tool: { id: t.id, name: t.name },
      user: { name: t.user, email: t.email },
      dueDate: t.due,
      overdueDays: diffDays_(today, t.due),
      comment: t.comment,
      links: buildLinks_(t.id),
    };
    // 使用者メールがある場合だけ本人にも催促する（申請画面にはメール欄がないので通常は管理者のみ）
    if (t.email) {
      try {
        sendOverdueMailToUser(ev);
      } catch (err) {
        Logger.log('使用者への催促メール失敗 (' + t.id + '): ' + err.message);
      }
    }
    safeNotify_(ev);
  });
  Logger.log('dailyCheck: 超過 ' + overdue.length + ' 件（' + today + '）');
  return overdue.length;
}

/** メール等に載せるリンク一式 */
function buildLinks_(toolId) {
  const base = getAppUrl_();
  const id = encodeURIComponent(toolId);
  return {
    request: base + '?tool=' + id,
    list: base + '?view=list',
    return: base + '?action=return&tool=' + id,
    extend3: base + '?action=extend&tool=' + id + '&days=3',
    extend7: base + '?action=extend&tool=' + id + '&days=7',
  };
}

// ---------------------------------------------------------------------------
// データアクセス（シート）
// ---------------------------------------------------------------------------

function getSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。setup() を実行してください');
  return sh;
}

/** 工具シートを全件読む。{row, id, name, status, user, email, due} の配列 */
function readTools_() {
  const values = getSheet_(SHEET_TOOLS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const id = String(r[0] || '').trim();
    if (!id) continue;
    out.push({
      row: i + 1,
      id: id,
      name: String(r[1] || '').trim(),
      status: String(r[2] || '').trim() === STATUS_USED ? STATUS_USED : STATUS_FREE,
      user: String(r[3] || '').trim(),
      email: String(r[4] || '').trim(),
      due: normYmd_(r[5]) || '',
      comment: String(r[6] || '').trim(),
      device: String(r[7] || '').trim(),
    });
  }
  return out;
}

function findTool_(toolId) {
  toolId = String(toolId || '').trim();
  if (!toolId) return null;
  return readTools_().find(t => t.id === toolId) || null;
}

function writeTool_(t) {
  getSheet_(SHEET_TOOLS).getRange(t.row, 1, 1, 8)
    .setValues([[t.id, t.name, t.status, t.user, t.email, t.due, t.comment || '', t.device || '']]);
}

function nextToolId_() {
  let max = 0;
  readTools_().forEach(t => {
    const m = /^[A-Za-z]+(\d+)$/.exec(t.id); // 旧形式 T001 も含めて最大番号を取る
    if (m) max = Math.max(max, Number(m[1]));
  });
  return TOOL_ID_PREFIX + String(max + 1).padStart(3, '0');
}

/**
 * 旧形式の tool_id（T001 など）を現在の接頭辞（ID001 など）に一括で書き換える。
 * 「工具」シートと「貸出ログ」シートの両方を直す。エディタから手動で1回実行する。
 * ※ 印刷済みの QR は旧 ID のままなので、実行後は QR を印刷し直すこと。
 */
function migrateToolIds() {
  const conv = v => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(String(v || '').trim());
    return (m && m[1] !== TOOL_ID_PREFIX) ? TOOL_ID_PREFIX + m[2] : null;
  };
  let count = 0;
  withLock_(() => {
    [[SHEET_TOOLS, 1], [SHEET_LOG, 2]].forEach(([name, col]) => {
      const sh = getSheet_(name);
      const last = sh.getLastRow();
      if (last < 2) return;
      const range = sh.getRange(2, col, last - 1, 1);
      const values = range.getValues();
      let changed = false;
      values.forEach(r => {
        const n = conv(r[0]);
        if (n) { r[0] = n; changed = true; count++; }
      });
      if (changed) range.setValues(values);
    });
  });
  Logger.log('migrateToolIds: ' + count + ' 件を ' + TOOL_ID_PREFIX + '### 形式に変更しました');
  return count;
}

function appendLog_(t, op, opt) {
  opt = opt || {};
  getSheet_(SHEET_LOG).appendRow([
    new Date(), t.id, t.name, t.user, t.email, opt.start || '', opt.due || '', op, opt.note || '', opt.device !== undefined ? opt.device : (t.device || ''),
  ]);
}

/** 直近 n 件のログ（新しい順） */
function readRecentLogs_(n) {
  const sh = getSheet_(SHEET_LOG);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const count = Math.min(n, last - 1);
  const values = sh.getRange(last - count + 1, 1, count, LOG_HEADERS.length).getValues();
  return values.reverse().map(r => ({
    at: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy/MM/dd HH:mm') : String(r[0] || ''),
    id: String(r[1] || ''),
    name: String(r[2] || ''),
    user: String(r[3] || ''),
    email: String(r[4] || ''),
    start: normYmd_(r[5]) || String(r[5] || ''),
    due: normYmd_(r[6]) || String(r[6] || ''),
    op: String(r[7] || ''),
    note: String(r[8] || ''),
    device: String(r[9] || ''),
  }));
}

/** 設定シートを { key: value } で返す */
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_SETTINGS);
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().forEach((r, i) => {
    if (i === 0) return;
    const k = String(r[0] || '').trim();
    if (k) out[k] = String(r[1] === undefined || r[1] === null ? '' : r[1]).trim();
  });
  return out;
}

function setSetting_(key, value) {
  const sh = getSheet_(SHEET_SETTINGS);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

/** メール内リンクや画面遷移に使う Web アプリ URL（設定 > なければ現在のデプロイ URL） */
function getAppUrl_() {
  const s = getSettings();
  if (s.app_url) return s.app_url;
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 画面に返すデータ形
// ---------------------------------------------------------------------------

/** 一般利用者向け（メールアドレス・端末IDそのものは含めない）。deviceId を渡すと canReturn を判定する */
function publicTool_(t, deviceId) {
  const today = today_();
  const inUse = t.status === STATUS_USED;
  const dev = normDevice_(deviceId);
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    inUse: inUse,
    user: inUse ? t.user : '',
    due: inUse ? t.due : '',
    dueLabel: inUse ? fmtMd_(t.due) : '',
    overdue: inUse && !!t.due && t.due < today,
    comment: inUse ? (t.comment || '') : '',
    // 端末IDが未記録（管理者代理・旧データ）なら誰でも返却可。記録があれば一致した端末のみ
    canReturn: inUse && (!t.device || t.device === dev),
  };
}

/** 管理者向け（全項目） */
function fullTool_(t) {
  const p = publicTool_(t);
  p.email = t.status === STATUS_USED ? t.email : '';
  p.device = t.status === STATUS_USED ? (t.device || '') : '';
  p.qrUrl = getAppUrl_() + '?tool=' + encodeURIComponent(t.id);
  return p;
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ（すべて日本時間・yyyy-MM-dd 文字列で扱う）
// ---------------------------------------------------------------------------

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' / 'yyyy/M/d' / Date を正規化して 'yyyy-MM-dd' にする。無効なら null */
function normYmd_(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(String(v).trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

function ymdToUtc_(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays_(ymd, days) {
  return Utilities.formatDate(new Date(ymdToUtc_(ymd) + days * 86400000), 'UTC', 'yyyy-MM-dd');
}

/** a - b の日数 */
function diffDays_(a, b) {
  return Math.round((ymdToUtc_(a) - ymdToUtc_(b)) / 86400000);
}

/** 'yyyy-MM-dd' → '9/20' */
function fmtMd_(ymd) {
  const n = normYmd_(ymd);
  if (!n) return String(ymd || '');
  return Utilities.formatDate(new Date(ymdToUtc_(n)), 'UTC', 'M/d');
}

/** 端末IDを正規化（英数字のみ・最大 64 文字）。不正な値は空にする */
function normDevice_(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
}

/** ログの備考欄に「操作元」とコメントを併記する */
function joinNote_(note, comment) {
  return comment ? (note ? note + ' / ' + comment : comment) : (note || '');
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}
