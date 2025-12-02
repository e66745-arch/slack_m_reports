import dotenv from 'dotenv';
dotenv.config();

import { App, ExpressReceiver } from '@slack/bolt';
import fetch from 'node-fetch';

// ExpressReceiver（Vercel用の最重要ポイント）
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
});

// Bolt App 本体
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// --- 事前にGASからFabrik_reportのデータを取得 ---
async function fetchReportData() {
  const res = await fetch(`${process.env.GAS_URL}?action=getFabrikReport`);
  const data = await res.json();
  return data;
}

// --- /dailyreport コマンド ---
app.command('/dailyreport', async ({ ack, body, client }) => {
  await ack();
  const reportData = await fetchReportData();

  const blocks = [];
  for (let i = 0; i < 10; i++) {
    blocks.push(
      { type: 'header', text: { type: 'plain_text', text: `レポート ${i + 1}` } },
      {
        type: 'input',
        block_id: `name_block_${i}`,
        label: { type: 'plain_text', text: '作業者名' },
        element: {
          type: 'static_select',
          action_id: 'name_select',
          options: reportData.names.map(n => ({
            text: { type: 'plain_text', text: n },
            value: n
          }))
        }
      },
      {
        type: 'input',
        block_id: `machine_block_${i}`,
        label: { type: 'plain_text', text: '成型機番号' },
        element: {
          type: 'static_select',
          action_id: 'machine_select',
          options: Object.keys(reportData.machines).map(m => ({
            text: { type: 'plain_text', text: m },
            value: m
          }))
        }
      },
      {
        type: 'input',
        block_id: `product_block_${i}`,
        label: { type: 'plain_text', text: '製品名' },
        element: { type: 'plain_text_input', action_id: 'product_input' }
      },
      {
        type: 'input',
        block_id: `defect_block_${i}`,
        label: { type: 'plain_text', text: '不良内容' },
        element: {
          type: 'multi_static_select',
          action_id: 'defect_select',
          options: reportData.defects.map(d => ({
            text: { type: 'plain_text', text: d },
            value: d
          }))
        }
      },
      {
        type: 'input',
        block_id: `details_block_${i}`,
        label: { type: 'plain_text', text: '詳細情報' },
        element: {
          type: 'plain_text_input',
          action_id: 'details_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: '必要に応じて記入' }
        }
      }
    );
  }

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'daily_report_modal',
      title: { type: 'plain_text', text: '日報入力' },
      submit: { type: 'plain_text', text: '送信' },
      close: { type: 'plain_text', text: 'キャンセル' },
      blocks
    }
  });
});

// --- モーダル送信処理 ---
app.view('daily_report_modal', async ({ ack, view, body, client }) => {
  await ack();
  const reports = [];

  for (let i = 0; i < 10; i++) {
    const values = view.state.values;
    const nameBlock = values[`name_block_${i}`];
    const machineBlock = values[`machine_block_${i}`];
    const productBlock = values[`product_block_${i}`];
    const defectBlock = values[`defect_block_${i}`];
    const detailsBlock = values[`details_block_${i}`];

    const reporter = nameBlock?.name_select?.selected_option?.value;
    const machineNo = machineBlock?.machine_select?.selected_option?.value;
    const productName = productBlock?.product_input?.value;
    const defects =
      defectBlock?.defect_select?.selected_options?.map(o => o.value) || [];
    const details = detailsBlock?.details_input?.value;

    if (!reporter && !machineNo && !productName && defects.length === 0 && !details)
      continue;

    reports.push({
      reporter,
      machineNo,
      productName,
      defect: defects.join(','),
      details
    });
  }

  if (reports.length === 0) return;

  try {
    const payload = {
      factory: 'slack_report',
      timestamp: new Date().toISOString(),
      reports
    };

    const res = await fetch(process.env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: `日報 ${reports.length}件を送信しました。`
    });
  } catch (e) {
    console.error(e);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '日報の送信に失敗しました。'
    });
  }
});

// --- Vercel では app.start() を禁止！ ---
// 代わりに Receiver の Express app を export
export default receiver.app;
