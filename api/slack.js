import fetch from "node-fetch";

// 環境変数
const GAS_URL = process.env.GAS_URL; 
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// ---------------------------
// 初期データロード
// ---------------------------
let commonData = null;
let machineDataMap = {};

async function loadInitialData() {
  try {
    const commonRes = await fetch(`${GAS_URL}?action=getCommonLists`);
    commonData = await commonRes.json();

    const factories = ["1a_machine", "1b_machine", "d2_machine"];
    for (let sheet of factories) {
      const res = await fetch(`${GAS_URL}?action=getMachineProducts&sheet=${sheet}`);
      const data = await res.json();
      machineDataMap[sheet] = data;
    }
    console.log("Initial data loaded");
  } catch (e) {
    console.error("Failed to load initial data:", e);
    commonData = { names: [], defects: [] };
    machineDataMap = {};
  }
}

// ---------------------------
// App Home 更新
// ---------------------------
async function publishHomeView(userId, historyList) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "日報アプリ" } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "日報入力" },
          action_id: "open_daily_report",
          value: "1a_machine"
        }
      ]
    },
  ];

  historyList.forEach(item => {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*報告者:* ${item.reporter}\n` +
            `*送信:* ${item.timestamp}\n` +
            `*成型機:* ${item.machineNo}\n` +
            `*製品名:* ${item.productName}\n` +
            `*不良内容:* ${item.defect}\n` +
            `*詳細:* ${item.details}`
        }
      }
    );
  });

  const resp = await fetch("https://slack.com/api/views.publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`
    },
    body: JSON.stringify({
      user_id: userId,
      view: { type: "home", blocks }
    })
  });

  const json = await resp.json();
  if (!json.ok) console.error("views.publish failed:", json);
}

// ---------------------------
// モーダル作成
// ---------------------------
function createReportModal(factorySheet) {
  const names = commonData?.names?.map(n => ({ text: { type: "plain_text", text: n }, value: n })) || [];
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];
  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));

  return {
    type: "modal",
    callback_id: "daily_report_modal",
    private_metadata: factorySheet,
    title: { type: "plain_text", text: "日報入力" },
    submit: { type: "plain_text", text: "送信" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "reporter",
        label: { type: "plain_text", text: "報告者" },
        element: { type: "static_select", action_id: "name", options: names }
      },
      {
        type: "input",
        block_id: "machine",
        label: { type: "plain_text", text: "成型機番号" },
        element: { type: "static_select", action_id: "machine", options: machines }
      },
      {
        type: "input",
        block_id: "product_input_block",
        label: { type: "plain_text", text: "製品名" },
        element: { type: "plain_text_input", action_id: "product_input", placeholder: { type: "plain_text", text: "成形機選択後に選択可" } }
      },
      {
        type: "input",
        block_id: "defect",
        label: { type: "plain_text", text: "不良内容" },
        element: { type: "multi_static_select", action_id: "defects", options: defects },
        optional: true
      },
      {
        type: "input",
        block_id: "details",
        label: { type: "plain_text", text: "設備情報・詳細" },
        element: { type: "plain_text_input", action_id: "details" },
        optional: true
      }
    ]
  };
}

// ---------------------------
// 成型機変更時に製品リスト更新
// ---------------------------
async function updateProductDropdown(viewId, factorySheet, selectedMachine) {
  if (!viewId) return;

  const products = machineDataMap[factorySheet] && machineDataMap[factorySheet][selectedMachine] || [];
  const productOptions = products.map(p => ({ text: { type: "plain_text", text: p }, value: p }));

  const modal = createReportModal(factorySheet);
  modal.blocks = modal.blocks.map(block => {
    if (block.block_id === "product_input_block") {
      block.element = { type: "static_select", action_id: "product_select", placeholder: { type: "plain_text", text: "製品を選択してください" }, options: productOptions };
    }
    return block;
  });

  const resp = await fetch("https://slack.com/api/views.update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ view_id: viewId, view: modal })
  });

  const json = await resp.json();
  if (!json.ok) console.error("views.update failed:", json);
}

// ---------------------------
// メインハンドラ
// ---------------------------
export default async function handler(req, res) {
  try {
    if (!commonData) await loadInitialData();
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    let body = req.body || {};
    if (body.payload) body = JSON.parse(body.payload);

    // URL verification
    if (body.type === "url_verification") return res.status(200).send(body.challenge);

    // App Home opened
    if (body.type === "event_callback" && body.event.type === "app_home_opened") {
      const userId = body.event.user;
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=1a_reports`);
      const historyList = await resHistory.json();
      await publishHomeView(userId, historyList);
      return res.status(200).send("ok");
    }

    // block_actions / shortcut
    if (body.type === "block_actions" || body.type === "shortcut") {
      const actions = body.actions || [];

      // 成型機選択
      if (body.type === "block_actions" && actions.length > 0 && actions[0].action_id === "machine") {
        const viewId = body.view?.id;
        const selectedMachine = actions[0].selected_option?.value;
        const factorySheet = (body.view && body.view.private_metadata) || actions[0]?.value || "1a_machine";
        if (viewId && selectedMachine) await updateProductDropdown(viewId, factorySheet, selectedMachine);
        return res.status(200).send("");
      }

      // 日報入力ボタン or ショートカット
      const isOpenButton = body.type === "block_actions" && actions.length > 0 && actions[0].action_id === "open_daily_report";
      const isShortcut = body.type === "shortcut" && body.callback_id === "daily_report";
      if (isOpenButton || isShortcut) {
        const factorySheet = (actions[0]?.value) || "1a_machine";
        await fetch("https://slack.com/api/views.open", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({ trigger_id: body.trigger_id, view: createReportModal(factorySheet) })
        });
        return res.status(200).send("");
      }

      return res.status(200).send("");
    }

    // モーダル送信
    if (body.type === "view_submission" && body.view.callback_id === "daily_report_modal") {
      const values = body.view.state.values;
      const reporter = values.reporter.name.selected_option?.value || "不明";
      const machineNo = values.machine.machine.selected_option?.value || "";

      let productName = "";
      if (values.product_select_block?.product_select?.selected_option) productName = values.product_select_block.product_select.selected_option.value;
      else if (values.product_input_block?.product_input?.value) productName = values.product_input_block.product_input.value;

      const defects = (values.defect.defects.selected_options || []).map(d => d.value).join(", ");
      const details = values.details.details.value || "";
      const factorySheet = body.view.private_metadata || "1a_machine";

      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factory: factorySheet,
          reporter,
          reports: [{ machineNo, productName, defect: defects, details }]
        })
      });

      // 履歴再取得
      const historySheet = `${factorySheet.split("_")[0]}_reports`;
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=${historySheet}`);
      const historyList = await resHistory.json();
      await publishHomeView(body.user.id, historyList);

      return res.status(200).json({ response_action: "clear" });
    }

    return res.status(200).send("ignored");

  } catch (err) {
    console.error(err);
    return res.status(500).send("error");
  }
}
