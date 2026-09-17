/**
 * Notify.gs — 管理者への通知（人 / AI の切り替え口）
 *
 * 管理者への通知はすべて notifyManager(event) を通す。ここが唯一の窓口。
 *   設定シート manager_type = 'human' → HumanManager.handle(event) （メール送信）
 *   設定シート manager_type = 'ai'    → AiManager.handle(event)    （Ai.gs）
 *
 * event の形:
 *   {
 *     type:        'request' | 'overdue' | 'extend' | 'return',
 *     tool:        { id, name },
 *     tools:       [{ id, name }, ...],      // まとめ貸出・まとめ返却のとき（request / return）。tool は先頭と同じ
 *     user:        { name, email },
 *     dueDate:     'yyyy-MM-dd',            // 返却日（延長後は新しい返却日）
 *     startDate:   'yyyy-MM-dd',            // request のみ
 *     oldDueDate:  'yyyy-MM-dd',            // extend のみ
 *     returnDate:  'yyyy-MM-dd',            // return のみ
 *     overdueDays: 3,                       // overdue のみ
 *     comment:     '3階の現場で使用',        // 申請時のコメント（任意・空のことがある）
 *     comment:     '3階の現場で使用',        // 申請時のコメント（任意・空のことがある）
 *     note:        '申請画面' など,
 *     links:       { request, list, return, extend3, extend7 }  // 未設定なら自動補完
 *   }
 *
 * 使用者本人への催促メール（sendOverdueMailToUser）もこのファイルに置く。
 */

/**
 * 管理者へ通知する（唯一の入口）。
 */
function notifyManager(event) {
  if (!event || !event.type || !event.tool) throw new Error('notifyManager: event が不正です');
  const settings = getSettings();

  // 貸出（request）の通知は設定シート notify_on_request = 'off' でオフにできる。
  // 返却日超過（overdue）・延長・返却は常に通知する。
  if (event.type === 'request' && settings.notify_on_request === 'off') {
    Logger.log('notify_on_request=off のため貸出通知をスキップ: ' + event.tool.id);
    return;
  }

  event.links = event.links || buildLinks_(event.tool.id);

  if (settings.manager_type === 'ai') {
    return AiManager.handle(event, settings);
  }
  return HumanManager.handle(event, settings);
}

/**
 * 人の管理者: メールで通知する。
 */
const HumanManager = {
  handle: function (event, settings) {
    if (!settings.manager_email) {
      Logger.log('manager_email が未設定のため管理者通知をスキップ: ' + event.type + ' ' + event.tool.id);
      return;
    }
    const mail = buildManagerMail_(event);
    MailApp.sendEmail({
      to: settings.manager_email,
      subject: mail.subject,
      body: mail.body,
      name: '工具貸出管理',
    });
  },
};

/** 管理者向けメールの件名・本文 */
function buildManagerMail_(event) {
  const t = event.tool, u = event.user || {}, l = event.links || {};
  let subject, lines;
  switch (event.type) {
    case 'request':
      if (event.tools && event.tools.length > 1) {
        subject = '【工具貸出】' + u.name + ' さんが ' + event.tools.length + ' 点借りました（返却 ' + fmtMd_(event.dueDate) + '）';
        lines = [u.name + ' さんが工具をまとめて借りました。', ''];
        event.tools.forEach(x => lines.push('・' + x.name + '（' + x.id + '）'));
        lines.push('', '使用者: ' + u.name, '開始日: ' + (event.startDate || ''), '返却日: ' + event.dueDate, 'コメント: ' + (event.comment || '（なし）'));
        break;
      }
      subject = '【工具貸出】' + t.name + ' を ' + u.name + ' さんが借りました（返却 ' + fmtMd_(event.dueDate) + '）';
      lines = [
        u.name + ' さんが工具を借りました。',
        '',
        '工具名: ' + t.name + '（' + t.id + '）',
        '使用者: ' + u.name + (u.email ? ' <' + u.email + '>' : ''),
        '開始日: ' + (event.startDate || ''),
        '返却日: ' + event.dueDate,
        'コメント: ' + (event.comment || '（なし）'),
      ];
      break;
    case 'return':
      if (event.tools && event.tools.length > 1) {
        subject = '【工具返却】' + u.name + ' さんが ' + event.tools.length + ' 点返却しました';
        lines = [u.name + ' さんが工具をまとめて返却しました。', ''];
        event.tools.forEach(x => lines.push('・' + x.name + '（' + x.id + '）'));
        lines.push('', '返却日: ' + (event.returnDate || ''), '操作元: ' + (event.note || ''));
        break;
      }
      subject = '【工具返却】' + t.name + ' が返却されました（' + u.name + ' さん）';
      lines = [
        u.name + ' さんが工具を返却しました。',
        '',
        '工具名: ' + t.name + '（' + t.id + '）',
        '返却予定日: ' + (event.dueDate || ''),
        '返却日: ' + (event.returnDate || ''),
        '操作元: ' + (event.note || ''),
      ];
      break;
    case 'extend':
      subject = '【工具延長】' + t.name + ' の返却日が ' + fmtMd_(event.dueDate) + ' に延長されました（' + u.name + ' さん）';
      lines = [
        u.name + ' さんが返却日を延長しました。',
        '',
        '工具名: ' + t.name + '（' + t.id + '）',
        '変更前: ' + (event.oldDueDate || ''),
        '変更後: ' + event.dueDate,
        '操作元: ' + (event.note || ''),
      ];
      break;
    case 'overdue':
      subject = '【工具返却】' + t.name + ' の返却日を過ぎています';
      lines = [
        '返却日を過ぎている工具があります。' + (u.email ? '使用者にも同じ内容を送信済みです。' : '使用者に声をかけてください。'),
        '',
        '工具名: ' + t.name + '（' + t.id + '）',
        '使用者: ' + u.name + (u.email ? ' <' + u.email + '>' : ''),
        '返却予定日: ' + event.dueDate,
        '超過日数: ' + event.overdueDays + ' 日',
        'コメント: ' + (event.comment || '（なし）'),
        '',
        '返却にする: ' + l.return,
        '+3日延長: ' + l.extend3,
        '+7日延長: ' + l.extend7,
      ];
      break;
    default:
      subject = '【工具貸出管理】' + event.type + ' ' + t.name;
      lines = [JSON.stringify(event, null, 2)];
  }
  lines.push('', '一覧: ' + (l.list || ''));
  return { subject: subject, body: lines.join('\n') };
}

/**
 * 使用者本人への催促メール（dailyCheck から、使用者メールがある場合だけ呼ばれる）。
 */
function sendOverdueMailToUser(event) {
  const t = event.tool, u = event.user || {}, l = event.links || buildLinks_(t.id);
  if (!isEmail_(u.email)) throw new Error('使用者メールが不正: ' + u.email);
  const body = [
    u.name + ' さん',
    '',
    '工具「' + t.name + '」の返却日を過ぎています。返却するか、延長してください。',
    '',
    '工具名: ' + t.name + '（' + t.id + '）',
    '返却予定日: ' + event.dueDate,
    '超過日数: ' + event.overdueDays + ' 日',
    (event.comment ? 'コメント: ' + event.comment : ''),
    '',
    '▼ 返却した（返却済みにする）',
    l.return,
    '',
    '▼ 返却日を延長する',
    '+3日: ' + l.extend3,
    '+7日: ' + l.extend7,
    '',
    '▼ 一覧（日付指定の延長もこちら）',
    l.list,
    '',
    '※このメールは返却されるまで毎朝自動送信されます。',
  ].join('\n');
  MailApp.sendEmail({
    to: u.email,
    subject: '【工具返却】' + t.name + ' の返却日を過ぎています',
    body: body,
    name: '工具貸出管理',
  });
}

/** イベントを人間向けの短い文章にする（AI へのプロンプトにも使う） */
function describeEvent_(event) {
  const t = event.tool, u = event.user || {};
  const typeLabel = { request: '貸出申請', overdue: '返却日超過', extend: '延長', return: '返却' }[event.type] || event.type;
  const parts = [
    '種別: ' + typeLabel,
    (event.tools && event.tools.length > 1)
      ? '工具: ' + event.tools.map(x => x.name + '（' + x.id + '）').join('、')
      : '工具: ' + t.name + '（' + t.id + '）',
    '使用者: ' + (u.name || '') + (u.email ? ' <' + u.email + '>' : ''),
  ];
  if (event.startDate) parts.push('開始日: ' + event.startDate);
  if (event.oldDueDate) parts.push('変更前の返却日: ' + event.oldDueDate);
  if (event.dueDate) parts.push('返却日: ' + event.dueDate);
  if (event.returnDate) parts.push('返却された日: ' + event.returnDate);
  if (event.overdueDays !== undefined) parts.push('超過日数: ' + event.overdueDays + ' 日');
  if (event.comment) parts.push('コメント: ' + event.comment);
  if (event.note) parts.push('操作元: ' + event.note);
  return parts.join('\n');
}
