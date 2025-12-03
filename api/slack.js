import { WebClient } from '@slack/web-api';
import { google } from 'googleapis';

const token = process.env.SLACK_BOT_TOKEN;
const client = new WebClient(token);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;

  // Slack Events APIのURL検証
  if (body.type === 'url_verification') {
    return res.status(200).send(body.challenge);
  }

  // Interactive Component (ボタン押下)
  const payload = body.payload ? JSON.parse(body.payload) : null;
  if (payload && payload.type === 'block_actions') {
    const trigger_id = payload.trigger_id;

    const options = await getDropdownOptionsFromSheet();

    await client.views.open({
      trigger_id,
      view: {
        type: 'modal',
        callback_id: 'my_modal',
        title: { type: 'plain_text', text: '入力フォーム' },
        submit: { type: 'plain_text', text: '送信' },
        blocks: [
          {
            type: 'input',
            block_id: 'dropdown_block',
            label: { type: 'plain_text', text: '選択してください' },
            element: {
              type: 'static_select',
              action_id: 'dropdown_action',
              options
            }
          }
        ]
      }
    });
    return res.status(200).send('');
  }

  res.status(200).send('');
}

// Google Sheets APIで選択肢を取得
async function getDropdownOptionsFromSheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'シート名!A2:A'
  });

  const rows = res.data.values || [];
  return rows.map(row => ({
    text: { type: 'plain_text', text: row[0] },
    value: row[0]
  }));
}
