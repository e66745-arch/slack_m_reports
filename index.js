import fetch from "node-fetch";
import crypto from "crypto";
import { text } from "stream/consumers";

// ---------------------------
// 環境変数
// ---------------------------
const GAS_URL = process.env.GAS_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// ---------------------------
// 初期データ
// ---------------------------
let commonData = null;
let machineDataMap = {};

// ---------------------------
// 初期データロード
// ---------------------------
async function loadInitialData() {
  if (commonData) return;
  try {
    const commonRes = await fetch(`${GAS_URL}?action=getCommonLists`);
    commonData = await commonRes.json();
    const factories = ["1a_machine", "1b_machine", "d2_machine"];
    for (let sheet of factories) {
      const res = await fetch(`${GAS_URL}?action=getMachineProducts&sheet=${sheet}`);
      const data = await res.json();
      machineDataMap[sheet] = data || {};
    }
    console.log("Initial data loaded");
  } catch (e) {
    console.error("Failed to load initial data:", e);
    commonData = { names: [], defects: [] };
    machineDataMap = {};
  }
}

// ---------------------------
// Slack署名検証
// ---------------------------
function verifySlackRequest(req) {
  if (!SLACK_SIGNING_SECRET) return true; // 無効化可
  const ts = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!ts || !sig) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 60 * 5) return false;
  const bodyRaw = req.rawBody && req.rawBody.length ? req.rawBody.toString() :
  (req.headers['content-type'] && req.headers['content-type'].includes('application/json') ? JSON.stringify(req.body) : require('querystring').stringify(req.body));
  
  const basestring = `v0:${ts}:${bodyRaw}`;
  const mySig = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(basestring).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
  } catch(e) {
    return false;
  }
}

// ---------------------------
// Slack body パース
// ---------------------------
function parseSlackBody(req) {
  if (req.body?.payload && typeof req.body.payload === "string") {
    try { return JSON.parse(req.body.payload); } 
    catch(e) { console.error("Failed to parse payload", e); }
  }
  return req.body || {};
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
        { type: "button", text: { type: "plain_text", text: "日報入力" }, action_id: "open_daily_report", value: "1a_machine" }
      ]
    }
  ];

  if (!Array.isArray(historyList)) historyList = [];

  historyList.forEach(item => {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*報告者:* ${item.reporter}\n*送信:* ${item.timestamp}\n*成型機:* ${item.machineNo}\n*製品名:* ${item.productName}\n*不良内容:* ${item.defect}\n*詳細:* ${item.details}`
        }
      }
    );
  });

  const resp = await fetch("https://slack.com/api/views.publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ user_id: userId, view: { type: "home", blocks } })
  });
  const json = await resp.json();
  if (!json.ok) console.error("views.publish failed:", json);
}

// ---------------------------
// 日報モーダル作成
// ---------------------------
function createReportModal(factorySheet) {
  // reporter
  const names = commonData?.names?.length
    ? commonData.names.map(n => ({ text: { type: "plain_text", text: n }, value: n }))
    : [{ text: { type: "plain_text", text: "データなし" }, value: "none" }];

  // defects
  const defects = commonData?.defects?.length
    ? commonData.defects.map(d => ({ text: { type: "plain_text", text: d }, value: d }))
    : [{ text: { type: "plain_text", text: "なし" }, value: "none" }];

  // machines
  const machineList = Object.keys(machineDataMap[factorySheet] || []);
  const machines = machineList.length
    ? machineList.map(m => ({ text: { type: "plain_text", text: m }, value: m }))
    : [{ text: { type: "plain_text", text: "データなし" }, value: "none" }];

  const blocks = [];

  // reporter
  blocks.push({
    type: "input",
    block_id: "reporter",
    label: { type: "plain_text", text: "報告者" },
    element: {
      type: "static_select",
      action_id: "name",
      options: names
    }
  });

  // 1台目展開
  blocks.push(
    { type: "section", text: { type: "mrkdwn", text: "*1台目（デフォルト表示）*" } },

    {
      type: "input",
      block_id: "machine_0",
      dispatch_action: true,
      label: { type: "plain_text", text: "成形機番号 (1台目)" },
      element: {
        type: "static_select",
        action_id: "machine_select_0",
        placeholder: { type: "plain_text", text: "選択してください" },
        options: machines          // ← 1件保証済み
      }
    },

    {
      type: "input",
      block_id: "product_0",
      label: { type: "plain_text", text: "製品名 (1台目)" },
      element: {
        type: "static_select",
        action_id: "product_select_0",
        placeholder: { type: "plain_text", text: "成形機選択後に製品を選択" },
        options: [{
          text: { type: "plain_text", text: "未選択" },
          value: "none"
        }]                  // ★ 空を許可しない！必ず1件入れる
      }
    },

    {
      type: "input",
      block_id: "defect_0",
      optional: true,
      label: { type: "plain_text", text: "不良内容 (1台目)" },
      element: {
        type: "multi_static_select",
        action_id: "defects_0",
        options: defects    // ← 1件保証済み
      }
    },

    {
      type: "input",
      block_id: "details_0",
      optional: true,
      label: { type: "plain_text", text: "詳細 (1台目)" },
      element: { type: "plain_text_input", action_id: "details_0" }
    }
  );

  // 2～10台 toggle
  for (let i = 1; i < 10; i++) {
    blocks.push({
      type: "section",
      block_id: `toggle_${i}`,
      text: { type: "mrkdwn", text: `*${i+1}台目を入力する*` },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "開く" },
        action_id: "open_machine_block",
        value: String(i)
      }
    });
  }

  return {
    type: "modal",
    callback_id: "daily_report_modal",
    private_metadata: factorySheet,
    title: { type: "plain_text", text: "日報入力" },
    submit: { type: "plain_text", text: "送信" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks
  };
}


// ---------------------------
// Product dropdown更新
// ---------------------------
async function updateProductDropdown(view, factorySheet, selectedMachine, index) {
  console.log(
  "[updateProductDropdown]",
  "factory:", factorySheet,
  "machine:", selectedMachine,
  "idx:", index
);

  const products = machineDataMap[factorySheet]?.[selectedMachine] || [];
  const options = (products.length > 0)
    ? products.map(p => ({ 
        text: { type: "plain_text", text: p }, 
        value: p 
      }))
    : [{ text: { type: "plain_text", text: "該当製品なし" }, value: "none" }];
  const newBlocks = view.blocks.map(b => b.block_id === `product_${index}` ? { ...b, element: { type: "static_select", action_id: `product_select_${index}`, placeholder: { type: "plain_text", text: "製品を選択してください" }, options } } : b);
  const body = { 
    view_id: view.id, 
    hash: view.hash,
    view: { 
      type: "modal",
      callback_id: view.callback_id, 
      private_metadata: view.private_metadata,
      title: view.title,
      submit: view.submit,
      close: view.close,
      blocks: newBlocks
    } 
  };
  const resp = await fetch("https://slack.com/api/views.update", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` }, body: JSON.stringify(body) });
  const json = await resp.json();
  if (!json.ok) console.error("views.update failed:", json);
}

// ---------------------------
// Toggle 開くボタン
// ---------------------------
async function expandMachineBlock(view, factorySheet, index) {
  const i = Number(index);
  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];
  const indexText = ` (${i+1}台目)`;

  const expanded = [
    { type: "section", text: { type: "mrkdwn", text: `*${i+1}台目（入力）*` } },
    { type: "input", block_id: `machine_${i}`, dispatch_action: true, label: { type: "plain_text", text: `成形機番号${indexText}` }, element: { type: "static_select", action_id: `machine_select_${i}`, placeholder: { type: "plain_text", text: "選択してください" }, options: machines } },
    { type: "input", block_id: `product_${i}`, label: { type: "plain_text", text: `製品名${indexText}` }, element: { type: "static_select", action_id: `product_select_${i}`, placeholder: { type: "plain_text", text: "製品を選択" }, options: [{ text: { type: "plain_text", text: "—" }, value: "none" }] } },
    { type: "input", block_id: `defect_${i}`, optional: true, label: { type: "plain_text", text: `不良内容${indexText}` }, element: { type: "multi_static_select", action_id: `defects_${i}`, options: defects } },
    { type: "input", block_id: `details_${i}`, optional: true, label: { type: "plain_text", text: `詳細${indexText}` }, element: { type: "plain_text_input", action_id: `details_${i}` } }
  ];

  const newBlocks = [];
  for (const b of view.blocks) {
    if (b.block_id === `toggle_${i}`) expanded.forEach(x => newBlocks.push(x));
    else newBlocks.push(b);
  }

  const body = { view_id: view.id, view: { ...view, blocks: newBlocks, hash: view.hash } };
  const resp = await fetch("https://slack.com/api/views.update", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` }, body: JSON.stringify(body) });
  const json = await resp.json();
  if (!json.ok) console.error("views.update failed (expand):", json);
}

// ---------------------------
// メインハンドラ
// ---------------------------
export const slackHandler = async (req, res) => {
  console.log("ENV: GAS_URL present:", !!GAS_URL);
  console.log("ENV: SLACK_BOT_TOKEN present:", !!SLACK_BOT_TOKEN, "prefix:", SLACK_BOT_TOKEN?.slice(0,12));
  console.log("ENV: SLACK_SIGNING_SECRET present:", !!SLACK_SIGNING_SECRET);

  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!verifySlackRequest(req)) return res.status(401).send("Unauthorized");

  if (!commonData) await loadInitialData();
  const body = parseSlackBody(req);

  try {
    // URL verification
    if (body.type === "url_verification")
      return res.status(200).send(body.challenge);

    // App Home opened
    if (body.type === "event_callback" && body.event?.type === "app_home_opened") {
      const userId = body.event.user;
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=1a_reports`);
      const historyList = await resHistory.json();
      await publishHomeView(userId, historyList);
      return res.status(200).send("ok");
    }


    // ---------------------------------------
    // block_actions
    // ---------------------------------------
    if (body.type === "block_actions") {
      console.log("BLOCK_ACTION:", body.actions[0].action_id);
    
      const action = body.actions?.[0];
      if (!action) return res.status(200).send("");

      const actionId = action.action_id;
      const view = body.view;

      console.log("---- BLOCK IDS ----");
      view?.blocks?.forEach(b => console.log(b.block_id));

      // 成形機選択→製品一覧を更新
      const mMatch = actionId.match(/^machine_select_(\d+)$/);
      if (mMatch) {
        const idx = Number(mMatch[1]);
        const view = body.view;
        const factorySheet = view?.private_metadata || "1a_machine";
        const selectedMachine = action.selected_option?.value;

        if (!view || !selectedMachine) {
          return res.status(200).send("");
        }

        await updateProductDropdown(view, factorySheet, selectedMachine, idx);

        return res.status(200).send("");        
       
      }

      // 追加ブロック展開
      if (actionId === "open_machine_block") {
        const view = body.view;
        const factorySheet = view.private_metadata || "1a_machine";
        const idx = Number(action.value);

        const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({
          text: { type: "plain_text", text: m },
          value: m
        }));

        const defects = commonData.defects.map(d => ({
          text: { type: "plain_text", text: d },
          value: d
        }));

        const expanded = [
          { type: "section", text: { type: "mrkdwn", text: `*${idx+1}台目（入力）*` } },
          {
            type: "input",
            block_id: `machine_${idx}`,
            dispatch_action: true,
            label: { type: "plain_text", text: `成型機番号 (${idx+1}台目)` },
            element: {
              type: "static_select",
              action_id: `machine_select_${idx}`,
              options: machines
            }
          },
          {
            type: "input",
            block_id: `product_${idx}`,
            label: { type: "plain_text", text: `製品名 (${idx+1}台目)` },
            element: {
              type: "static_select",
              action_id: `product_select_${idx}`,
              options: [{ text: { type: "plain_text", text: "未登録" }, value: "none" }]
            }
          },
          {
            type: "input",
            block_id: `defect_${idx}`,
            label: { type: "plain_text", text: `不良区分 (${idx+1}台目)` },
            element: {
              type: "static_select",
              action_id: `defect_select_${idx}`,
              options: defects
            }
          },
          {
            type: "input",
            block_id: `details_${idx}`,
            label: { type: "plain_text", text: `詳細 (${idx+1}台目)` },
            element: { 
              type: "plain_text_input", 
              action_id: `details_${idx}`
            }
          }
        ];

        const newBlocks = [];
        for (const b of view.blocks) {
          if (b.block_id === `toggle_${idx}`){
            newBlocks.push(...expanded);
          } else {
            newBlocks.push(b);
          }
        }

        await fetch("https://slack.com/api/views.update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`
          },
          body: JSON.stringify({
            view_id: view.id,
            hash: view.hash,
            view: {
              type:"modal",
              callback_id: view.callback_id,
              private_metadata: view.private_metadata,
              title: view.title,
              submit: view.submit,
              close: view.close,
              blocks: newBlocks
            }
          })
        });

        return res.status(200).send("");
      }

      // App Home の「日報入力」button
      if (actionId === "open_daily_report") {
        if (!body.trigger_id)
          return res.status(400).send("missing trigger_id");

        const modal = createReportModal(action.value || "1a_machine");

        await fetch("https://slack.com/api/views.open", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Bearer ${SLACK_BOT_TOKEN}`
          },
          body: JSON.stringify({
            trigger_id: body.trigger_id,
            view: modal
          }),
        });

        return res.status(200).send("");
      }

      return res.status(200).send("");
    }


    // ---------------------------------------
    //  Shortcut（日報入力）
    // ---------------------------------------
    if (body.type === "shortcut" && body.callback_id === "daily_report") {

      if (!body.trigger_id) {
        console.error("Shortcut missing trigger_id:", body);
        return res.status(400).send("missing trigger_id");
      }

      const modal = createReportModal("1a_machine");

      const openRes = await fetch("https://slack.com/api/views.open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
          trigger_id: body.trigger_id,
          view: modal
        })
      });

      const result = await openRes.json();
      console.log("views.open result (shortcut):", result);

      return res.status(200).send("");
    }


    // ---------------------------------------
    // view_submission
    // ---------------------------------------
    if (body.type === "view_submission" && body.view?.callback_id === "daily_report_modal") {
      const values = body.view.state.values;
      const factorySheet = body.view.private_metadata || "1a_machine";
      const reporter = values.reporter?.name?.selected_option?.value || "不明";

      const reports = [];
      for (let i = 0; i < 10; i++) {
        const m = values[`machine_${i}`];
        const p = values[`product_${i}`];
        const d = values[`defect_${i}`];
        const dt = values[`details_${i}`];

        const machineVal = m?.[`machine_select_${i}`]?.selected_option?.value;
        const productVal = p?.[`product_select_${i}`]?.selected_option?.value || p?.[`product_${i}`]?.value;
        const defectsVal = (d?.[`defects_${i}`]?.selected_options || []).map(x => x.value).join(", ");
        const detailsVal = dt?.[`details_${i}`]?.value || "";

        if (machineVal || productVal || defectsVal || detailsVal)
          reports.push({
            machineNo: machineVal || "",
            productName: productVal || "",
            defect: defectsVal,
            details: detailsVal
          });
      }

      if (reports.length > 0)
        await fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factory: factorySheet, reporter, reports })
        });

      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=${factorySheet.split("_")[0]}_reports`);
      const historyList = await resHistory.json();
      await publishHomeView(body.user.id, historyList);

      return res.status(200).json({ response_action: "clear" });
    }


    return res.status(200).send("ignored");

  } catch (err) {
    console.error(err);
    return res.status(500).send("error");
  }
};
