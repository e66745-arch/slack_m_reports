import fetch from "node-fetch";
import crypto from "crypto";

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
  const bodyRaw = req.rawBody ? req.rawBody.toString() : (req.body && typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  const basestring = `v0:${ts}:${bodyRaw}`;
  const mySig = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(basestring).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
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
  const names = commonData?.names?.map(n => ({ text: { type: "plain_text", text: n }, value: n })) || [];
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];
  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));
  const blocks = [];

  // reporter
  blocks.push({ type: "input", block_id: "reporter", label: { type: "plain_text", text: "報告者" }, element: { type: "static_select", action_id: "name", options: names } });

  // 1台目展開
  blocks.push(
    { type: "section", text: { type: "mrkdwn", text: "*1台目（デフォルト表示）*" } },
    {
      type: "input", block_id: "machine_0", label: { type: "plain_text", text: "成形機番号 (1台目)" }, element: { type: "static_select", action_id: "machine_select_0", placeholder: { type: "plain_text", text: "選択してください" }, options: machines }
    },
    {
      type: "input", block_id: "product_0", label: { type: "plain_text", text: "製品名 (1台目)" }, element: { type: "static_select", action_id: "product_select_0", placeholder: { type: "plain_text", text: "成形機選択後に製品を選択" }, options: [] }
    },
    {
      type: "input", block_id: "defect_0", optional: true, label: { type: "plain_text", text: "不良内容 (1台目)" }, element: { type: "multi_static_select", action_id: "defects_0", options: defects }
    },
    {
      type: "input", block_id: "details_0", optional: true, label: { type: "plain_text", text: "詳細 (1台目)" }, element: { type: "plain_text_input", action_id: "details_0" }
    }
  );

  // 2～10台 toggle
  for (let i = 1; i < 10; i++) {
    blocks.push({ type: "section", block_id: `toggle_${i}`, text: { type: "mrkdwn", text: `*${i+1}台目を入力する*` }, accessory: { type: "button", text: { type: "plain_text", text: "開く" }, action_id: "open_machine_block", value: String(i) } });
  }

  return { type: "modal", callback_id: "daily_report_modal", private_metadata: factorySheet, title: { type: "plain_text", text: "日報入力" }, submit: { type: "plain_text", text: "送信" }, close: { type: "plain_text", text: "キャンセル" }, blocks };
}

// ---------------------------
// Product dropdown更新
// ---------------------------
async function updateProductDropdown(view, factorySheet, selectedMachine, index) {
  const products = machineDataMap[factorySheet]?.[selectedMachine] || [];
  const options = products.map(p => ({ text: { type: "plain_text", text: p }, value: p }));
  const newBlocks = view.blocks.map(b => b.block_id === `product_${index}` ? { ...b, element: { type: "static_select", action_id: `product_select_${index}`, placeholder: { type: "plain_text", text: "製品を選択してください" }, options } } : b);
  const body = { view_id: view.id, view: { ...view, blocks: newBlocks, hash: view.hash } };
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
    { type: "input", block_id: `machine_${i}`, label: { type: "plain_text", text: `成形機番号${indexText}` }, element: { type: "static_select", action_id: `machine_select_${i}`, placeholder: { type: "plain_text", text: "選択してください" }, options: machines } },
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
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!verifySlackRequest(req)) return res.status(401).send("Unauthorized");

  if (!commonData) await loadInitialData();
  const body = parseSlackBody(req);

  try {
    // URL verification
    if (body.type === "url_verification") return res.status(200).send(body.challenge);

    // App Home opened
    if (body.type === "event_callback" && body.event?.type === "app_home_opened") {
      const userId = body.event.user;
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=1a_reports`);
      const historyList = await resHistory.json();
      await publishHomeView(userId, historyList);
      return res.status(200).send("ok");
    }

    // block_actions / shortcut
    if (body.type === "block_actions" || body.type === "shortcut") {
      const action = (body.actions || [])[0];
      if (action) {
        const mMatch = (action.action_id || "").match(/^machine_select_(\d+)$/);
        if (mMatch) { const idx = Number(mMatch[1]); const view = body.view; const factorySheet = view?.private_metadata || action.value || "1a_machine"; if (view && action.selected_option?.value) await updateProductDropdown(view, factorySheet, action.selected_option.value, idx); return res.status(200).send(""); }
        if (action.action_id === "open_machine_block") { const view = body.view; const factorySheet = view?.private_metadata || "1a_machine"; if (view) await expandMachineBlock(view, factorySheet, Number(action.value)); return res.status(200).send(""); }
        if (action.action_id === "open_daily_report") { const modal = createReportModal(action.value || "1a_machine"); await fetch("https://slack.com/api/views.open",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SLACK_BOT_TOKEN}`},body:JSON.stringify({trigger_id:body.trigger_id,view:modal})}); return res.status(200).send(""); }
      }
    }

    // view_submission
    if (body.type === "view_submission" && body.view?.callback_id === "daily_report_modal") {
      const values = body.view.state.values;
      const factorySheet = body.view.private_metadata || "1a_machine";
      const reporter = values.reporter?.name?.selected_option?.value || "不明";
      const reports = [];
      for (let i=0;i<10;i++){
        const m=values[`machine_${i}`], p=values[`product_${i}`], d=values[`defect_${i}`], dt=values[`details_${i}`];
        const machineVal=m?.[`machine_select_${i}`]?.selected_option?.value;
        const productVal=p?.[`product_select_${i}`]?.selected_option?.value||p?.[`product_${i}`]?.value;
        const defectsVal=(d?.[`defects_${i}`]?.selected_options||[]).map(x=>x.value).join(", ");
        const detailsVal=dt?.[`details_${i}`]?.value||"";
        if(machineVal||productVal||defectsVal||detailsVal) reports.push({machineNo:machineVal||"",productName:productVal||"",defect:defectsVal,details:detailsVal});
      }
      if(reports.length>0) await fetch(GAS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({factory:factorySheet,reporter,reports})});
      const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=${factorySheet.split("_")[0]}_reports`);
      const historyList = await resHistory.json();
      await publishHomeView(body.user.id, historyList);
      return res.status(200).json({ response_action: "clear" });
    }

    return res.status(200).send("ignored");
  } catch(err) { console.error(err); return res.status(500).send("error"); }
};
