/**
 * Ai.gs — AI 管理者（スタブ）
 *
 * 設定シート manager_type = 'ai' のとき、Notify.gs の notifyManager(event) から
 * AiManager.handle(event, settings) が呼ばれる。
 *
 * 現在の動き（スタブ）:
 *   1. event を文章にして Claude API（https://api.anthropic.com/v1/messages）に送る
 *   2. 返ってきた文章を manager_email に転送する
 *   3. API キー（設定シート claude_api_key）が空なら、人の管理者と同じメールにフォールバック
 *
 * 将来ここを育てて「AI が判断して使用者へ返信する」「延長を自動承認する」などに置き換える。
 * 貸出データの読み書きは Code.gs の関数（readTools_ / extendTool_ など）をそのまま使える。
 */

const AiManager = {
  /** 使うモデル。変更したいときはここだけ書き換える */
  MODEL: 'claude-opus-5',
  API_URL: 'https://api.anthropic.com/v1/messages',
  API_VERSION: '2023-06-01',

  /**
   * 通知イベントを処理する。
   * @param {Object} event   Notify.gs の event（type, tool, user, dueDate, links ...）
   * @param {Object} settings 設定シートの内容（claude_api_key, manager_email ...）
   */
  handle: function (event, settings) {
    if (!settings.claude_api_key) {
      Logger.log('AiManager: claude_api_key が未設定のため人の管理者へフォールバック');
      return HumanManager.handle(event, settings);
    }
    let reply;
    try {
      reply = this.ask(event, settings.claude_api_key);
    } catch (err) {
      Logger.log('AiManager: API 呼び出し失敗 → 人の管理者へフォールバック: ' + err.message);
      return HumanManager.handle(event, settings);
    }
    if (!settings.manager_email) {
      Logger.log('AiManager: manager_email 未設定。AI の返答: ' + reply);
      return;
    }
    const base = buildManagerMail_(event);
    MailApp.sendEmail({
      to: settings.manager_email,
      subject: '【AI管理者】' + base.subject,
      body: ['■ AI管理者の判断', reply, '', '■ 元のイベント', describeEvent_(event), '', '一覧: ' + event.links.list].join('\n'),
      name: '工具貸出管理（AI）',
    });
  },

  /** Claude に問い合わせて、返答テキストを返す */
  ask: function (event, apiKey) {
    const system = [
      'あなたは作業場の工具貸出を管理する担当者です。',
      '通知イベントを読み、管理者に転送する短い日本語のメモを書いてください。',
      '内容: 状況の要約（1〜2文）、気になる点（あれば）、推奨する対応（1つ）。',
      '箇条書きで簡潔に。挨拶や前置きは不要です。',
    ].join('\n');
    const user = [
      '以下の工具貸出イベントについてメモを書いてください。',
      '',
      describeEvent_(event),
      '',
      '操作リンク:',
      '返却: ' + event.links.return,
      '+3日延長: ' + event.links.extend3,
      '+7日延長: ' + event.links.extend7,
    ].join('\n');

    const payload = {
      model: this.MODEL,
      max_tokens: 4096,
      system: system,
      messages: [{ role: 'user', content: user }],
      // 安全分類器で拒否された場合に、他モデルへサーバー側で自動フォールバックする（β機能）。
      // 不要なら fallbacks と anthropic-beta ヘッダーの2行を削除してよい。
      fallbacks: 'default',
    };
    const res = UrlFetchApp.fetch(this.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': this.API_VERSION,
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error('Claude API エラー HTTP ' + code + ': ' + text.slice(0, 500));
    }
    const json = JSON.parse(text);
    if (json.stop_reason === 'refusal') {
      return '（AI が応答を控えました）' + (json.stop_details && json.stop_details.explanation ? ' ' + json.stop_details.explanation : '');
    }
    const out = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!out) throw new Error('Claude API から本文が返りませんでした');
    return out;
  },
};

/**
 * 動作確認用: エディタから実行すると、ダミーの貸出申請イベントで AiManager を試せる。
 * manager_type に関係なく AiManager を直接呼ぶ。
 */
function testAiManager() {
  const settings = getSettings();
  const ev = {
    type: 'request',
    tool: { id: 'T000', name: 'テスト用ドリル' },
    user: { name: 'テスト太郎', email: settings.manager_email || 'test@example.com' },
    startDate: today_(),
    dueDate: addDays_(today_(), 3),
    note: 'testAiManager',
    links: buildLinks_('T000'),
  };
  AiManager.handle(ev, settings);
  Logger.log('testAiManager 完了（manager_email 宛にメールが届いているか確認）');
}
