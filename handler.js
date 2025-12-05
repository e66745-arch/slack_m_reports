import fetch from "node-fetch";

let commonData = null; // 名前・不良リスト
let machineDataMap = {}; // 工場 -> 成型機 -> 製品
//let localHistory = []; //Slack履歴

const GAS_URL = process.env.GAS_URL; // GAS WebApp URL
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// ---------------------------
// Google Apps Script からデータ取得
// ---------------------------
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
// Home表示更新 共通処理
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
  // 初期値が取れていなければ空で返す
  const names = commonData?.names?.map(n => ({ text: { type: "plain_text", text: n }, value: n })) || [];
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];
  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));

  //製品初期要素（機種が選ばれていない状態では、plain_text_input にする)
  const productElement = {
    type: "plain_text_input",
    action_id: "product",
    placeholder: { type: "plain_text", text: "成形機選択後に選択可" }
  };

  return {
    type: "modal",
    callback_id: "daily_report_modal",
    private_metadata: factorySheet, //ここでfactory保存
    title: { type: "plain_text", text: "日報入力" },
    submit: { type: "plain_text", text: "送信" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "reporter",
        label: { type: "plain_text", text: "報告者" },
        element: {
          type: "static_select",
          action_id: "name",
          options: names
        }
      },
      {
        type: "input",
        block_id: "machine",
        label: { type: "plain_text", text: "成型機番号" },
        element: {
          type: "static_select",
          action_id: "machine",
          options: machines
        }
      },
      {
        type: "input",
        block_id: "product_input_block",
        label: { type: "plain_text", text: "製品名" },
        element: {
          type: "plain_text_input",
          action_id: "product_input",
          placeholder: { type: "plain_text", text: "成形機選択後に選択可" }
        }
      },
      {
        type: "input",
        block_id: "defect",
        label: { type: "plain_text", text: "不良内容" },
        element: {
          type: "multi_static_select",
          action_id: "defects",
          options: defects
        },
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
  //viewId無しなら何もしない
  if (!viewId){
    console.warn("updateProductDropdown: missing viewId");
    return;
  }
  
  //factorysheetが未設定の場合、空の配列に
  const products = machineDataMap[factorySheet] && machineDataMap[factorySheet][selectedMachine] || [];
  const productOptions = products.map(p => ({ text: { type: "plain_text", text: p }, value: p }));

  //新規modal組立(createReportModalで作る＝＞そのproductブロックを置換)
  const modal = createReportModal(factorySheet);

  // product ブロックを置換(element = static_select)
  modal.blocks = modal.blocks.map(block => {
    if (block.block_id === "product_input_block") {
      //static_select用のelementを新しく作る
      block.element = {
        type: "static_select",
        action_id: "product_select",
        placeholder: {type: "plain_text", text: "製品を選択してください" },
        options: productOptions
      };
    }
    return block;
  });

  //view.updateはview_idにviewId(body.view.id)を渡す
  const resp = await fetch("https://slack.com/api/views.update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      view_id: viewId, 
      view: modal,
    }),
  });

  const json = await resp.json();
  if (!json.ok){
    console.error("views.update failed:", json);
  }
}


// ---------------------------
// Slack イベントハンドラ
// ---------------------------
export default async function handler(req, res) {
  try {
    if (!commonData) await loadInitialData();

    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    let body = req.body || {};
    if (body.payload) body = JSON.parse(body.payload);

    // ---- URL verification ----
    if (body.type === "url_verification") return res.status(200).send(body.challenge);

    // ---- Home opened ----
    if (body.type === "event_callback" && body.event.type === "app_home_opened") {
      const userId = body.event.user;

      // GAS から履歴取得
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=1a_reports`);
      const historyList = await resHistory.json(); // [{reporter, timestamp, machineNo, productName, defect, details}, ...]

      //publishHomeViewを一度だけ呼ぶ
      await publishHomeView(userId, historyList);

      return res.status(200).send("ok");
    }

    // ---- Button or Shortcut ----
    if (body.type === "block_actions" || body.type === "shortcut") {

      const actions = body.actions ||[];
      

      //モーダル内で成形機が選択された場合(machine actionの処理)
      if (body.type === "block_actions" && actions.length > 0 && actions[0].action_id === "machine") {
        // viewIdはモーダルのview.id(body.view.id)にある
        const viewId = body.view?.id;
        if (!viewId) return res.status(200).send("");

        const selectedMachine = actions[0].selected_option?.value;
        if (!selectedMachine) return res.status(200).send("");

        //factoはモーダルのprivate_metadataから取得（なければボタンのvalueなどでフォールバック)
        const factorySheet = (body.view && body.view.private_metadata) || actions[0]?.value || "1a_machine";
        await updateProductDropdown(viewId, factorySheet, selectedMachine);
        return res.status(200).send(""); 
      }

      //通常ボタン/ショートカットでモーダルを開くケース
      //block_actions内のbutton(open_daily_report）またはshortcutの場合
      const isOpenButton = body.type === "block_actions" && actions.length > 0 && actions[0].action_id === "open_daily_report";
      const isShortcut = body.type === "shortcut" && body.callback_id === "open_daily_report";

      if (isOpenButton || isShortcut){ 
        const factorySheet = (actions[0] && actions[0].value) || "1a_machine";
        await fetch("https://slack.com/api/views.open", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`
          },
          body: JSON.stringify({
            trigger_id: body.trigger_id,
            view: createReportModal(factorySheet)
          })
        });
        return res.status(200).send("");
      }
      //それ以外のblock_actionsは無視
      return res.status(200).send("");
    }

    // ---- モーダル送信 ----
    if (body.type === "view_submission" && body.view.callback_id === "daily_report_modal") {
      const values = body.view.state.values;

      //----入力取得処理----
      const reporter = values.reporter.name.selected_option?.value || "不明";
      const machineNo = values.machine.machine.selected_option?.value || "";

      //製品名（static_select　または　plain_text_input)
      let productName = "";
      
      if (values.product_select_block && values.product_select_block.product_select && values.product_select_block.product_select.selected_option) {
        productName = values.product_select_block.product_select.selected_option.value;
      } else if (values.product_input_block && values.product_input_block.product_input && values.product_input_block.product_input.value) {
        productName = values.product_input_block.product_input.value;
      }
      
      const defects = (values.defect.defects.selected_options || []).map(d => d.value).join(", ");
      const details = values.details.details.value || "";
      //factorySheetはprivate_metadataから取得
      const factorySheet = body.view.private_metadata || "1a_machine";

      // ----GAS 送信 ----
      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factory: factorySheet,
          reporter,
          reports: [{ machineNo, productName, defect: defects, details }]
        })
      });

      //送信後履歴再取得後更新
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
