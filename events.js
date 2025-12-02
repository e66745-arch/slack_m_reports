// .envファイルはVercelの環境変数で管理するため、ここでは不要
const { App, ExpressReceiver } = require('@slack/bolt');
const { createServer, IncomingMessage, ServerResponse } = require('http');

// ExpressReceiver を使って、Vercelのサーバーレス環境に対応
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Slackからのリクエストを受け付けるルートパス
  // このパスがRequest URLの末尾になります
  endpoint: '/slack/events', 
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver,
});

// メンションイベントのリスナー（例: @bot こんにちは と送られた時）
app.event('app_mention', async ({ event, say }) => {
  try {
    await say(`Vercel経由で応答しています！<@${event.user}>さん、メッセージを受け付けました。`);
  } catch (error) {
    console.error(error);
  }
});

// Vercelが呼び出すハンドラー関数
module.exports = async (req, res) => {
  const handler = receiver.requestListener();
  
  // Express/BoltのハンドラーをVercelのサーバーレス関数として実行
  await handler(req, res);
};

// Boltアプリの起動処理 (app.start) は、サーバーレス環境では不要です。
// リクエストのたびにハンドラーが実行されます。