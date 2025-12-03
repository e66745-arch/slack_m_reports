import { WebClient } from '@slack/web-api';
import { buffer } from 'micro';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false, // Slackの署名検証のためにraw bodyが必要
  },
};

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(slackBotToken);

// Google Sheets設定
const sheets = google.sheets({ version: 'v4' });
const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account.json', // Vercelにアップロード済み
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const buf = await buffer(req);
  const bodyRaw = buf.toString();

  // ここで署名検証（省略可、開発段階は無視可）

  const payload = JSON.parse(bodyRaw);

  // URL verification (Slack設定時)
  if (payload.type === 'url_verification') {
    return res.status(200).send(payload.challenge);
  }

  // ボタン押下イベント
  if (payload.type === 'block_actions') {
    const userId = payload.user.id;

    // Google Sheets からデータ取得
    const client = await auth.getClient();
    const response = await sheets.spreadsheets.values.get({
      auth: client,
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!A1:A10', // 取得範囲
    });

    const options = response.data.values.map(v => ({
      text: { type: 'plain_text', text: v[0] },
      value: v[0],
    }));

    // Slack モーダルを開く
    await web.views.open({
      trigger_id: payload.trigger_id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '選択フォーム' },
        close: { type: 'plain_text', text: '閉じる' },
        blocks: [
          {
            type: 'input',
            block_id: 'dropdown_block',
            label: { type: 'plain_text', text: '選択してください' },
            element: {
              type: 'static_select',
              action_id: 'select_action',
              options: options,
            },
          },
        ],
      },
    });

    return res.status(200).send('');
  }

  res.status(200).send('');
}
