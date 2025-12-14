import fetch from "node-fetch";
import crypto from "crypto";
export const config = {
  api: {
    bodyParser: false,  
  },
};


// 環境変数
const GAS_URL = process.env.GAS_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// ---------------------------
// 初期データロード
// ---------------------------
let commonData = null;
let machineDataMap = {};

async function loadInitialData() {
  console.log("=== loadInitialData START ===");

  try {
    const commonRes = await fetch(`${GAS_URL}?action=getCommonLists`);
    commonData = await commonRes.json();

    const factories = ["1a_machine", "1b_machine", "d2_machine"];
    for (let sheet of factories) {
      const res = await fetch(`${GAS_URL}?action=getMachineProducts&sheet=${sheet}`);
      console.log("Fetch from GAS:", GAS_URL + "?action=getMachineProducts&sheet=" + sheet);

      const data = await res.json();
      console.log("Fetch result:", data);
      machineDataMap[sheet] = data;
    }
    console.log("Initial data loaded");
    console.log("machineDataMap:", machineDataMap);
  } catch (e) {
    console.error("Failed to load initial data:", e);
    commonData = { names: [], defects: [] };
    machineDataMap = {};
  }
}

function verifySlackRequest(req, signingSecret) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  const body = req.rawBody;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(baseString);
  const mySig = "v0=" + hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on("data", chunk => data.push(chunk));
    req.on("end", () => resolve(Buffer.concat(data)));
    req.on("error", reject);
  });
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

  if (!Array.isArray(historyList)) {
      console.log("historyList invalid → reset:", historyList);
      historyList = [];
    }


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
//   - 1台目は最初から展開（機械選択＋製品選択ブロック）
//   - 2〜10台は toggle（開くボタン） を作る（B仕様）
// ---------------------------
function createReportModal(factorySheet) {
  const names = commonData?.names?.map(n => ({ text: { type: "plain_text", text: n }, value: n })) || [];
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];
  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));
  const blocks = [];
  console.log(`>>> createReportModal called for sheet: ${factorySheet}`);
  console.log(">>> machineDataMap[factorySheet]:", machineDataMap[factorySheet]);
  console.log(">>> machine list:", machines);
  // 各成形機の製品名一覧を確認
  machines.forEach(m => {
    console.log(`>>> Products for machine ${m}:`, machineDataMap[factorySheet][m]);
  });


  // reporter
  blocks.push({
    type: "input",
    block_id: "reporter",
    label: { type: "plain_text", text: "報告者" },
    element: { type: "static_select", action_id: "name", options: names }
  });

  // 1 台目は展開済み（機械選択 + 製品選択）
  {
    const i = 0;
    const indexText = ` (${i + 1}台目)`;
    blocks.push(
      { type: "section", text: { type: "mrkdwn", text: `*1台目（デフォルト表示）*` } },
      {
        type: "input",
        block_id: `machine_${i}`,
        label: { type: "plain_text", text: `成形機番号${indexText}` },
        element: {
          type: "static_select",
          action_id: `machine_select_${i}`,
          placeholder: { type: "plain_text", text: "選択してください" },
          options: machines /* --- CHANGED: ensure machine options present --- */
        }
      },
      {
        type: "input",
        block_id: `product_${i}`,
        label: { type: "plain_text", text: `製品名${indexText}` },
        element: {
          type: "static_select",
          action_id: `product_select_${i}`,
          placeholder: { type: "plain_text", text: "成形機選択後に製品を選択できます" },
          options: [] // 初期は空、選択時に update で埋める
        }
      },
      {
        type: "input",
        block_id: `defect_${i}`,
        optional: true,
        label: { type: "plain_text", text: `不良内容${indexText}` },
        element: { type: "multi_static_select", action_id: `defects_${i}`, options: defects }
      },
      {
        type: "input",
        block_id: `details_${i}`,
        optional: true,
        label: { type: "plain_text", text: `詳細${indexText}` },
        element: { type: "plain_text_input", action_id: `details_${i}` }
      }
    );
  }

  // 2〜10 台目は toggle（開くボタン）を表示する（押したら展開）
  for (let i = 1; i < 10; i++) {
    blocks.push({
      type: "section",
      block_id: `toggle_${i}`,
      text: { type: "mrkdwn", text: `*${i + 1}台目を入力する*` },
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
    blocks: blocks
  };
}

/* --- CHANGED ---
   updateProductDropdown: (view, factorySheet, selectedMachine, index)
   - view を受け取って該当 product_{index} ブロックだけ書き換えて更新する
   - views.update では view_id, hash, view を送る
*/
async function updateProductDropdown(view, factorySheet, selectedMachine, index) {
  if (!view || !view.id) return;

  const products = machineDataMap[factorySheet]?.[selectedMachine] || [];
  console.log("updateProductDropdown called", { viewId: view.id, factorySheet, selectedMachine, index, products });

  const productOptions = products.map(p => ({ text: { type: "plain_text", text: p }, value: p }));

  // build updated blocks: replace block with block_id === `product_{index}`
  const updatedBlocks = view.blocks.map(b => {
    if (b.block_id === `product_${index}`) {
      // keep block label etc, only replace element
      return {
        ...b,
        element: {
          type: "static_select",
          action_id: `product_select_${index}`,
          placeholder: { type: "plain_text", text: "製品を選択してください" },
          options: productOptions
        }
      };
    }
    return b;
  });

  // views.update: include hash from view if available
  const body = {
    view_id: view.id,
    hash:view.hash,
    view: {
      type:view.type,
      callback_id: view.callback_id,
      private_metadata: view.private_metadata,
      title: view.title,
      submit: view.submit,
      close: view.close,
      blocks: updatedBlocks
    }
  };
  if (view.hash) body.view.hash = view.hash;

  const resp = await fetch("https://slack.com/api/views.update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body)
  });

  const json = await resp.json();
  if (!json.ok) console.error("views.update failed:", json);
}

/* --- CHANGED ---
   expandMachineBlock: when user presses "開く" (open_machine_block)
   - locate toggle_{idx} block and replace it with the expanded blocks for that index
   - use the existing view (so state is preserved)
*/
async function expandMachineBlock(view, factorySheet, index) {
  if (!view || !view.id) return;

  const machines = Object.keys(machineDataMap[factorySheet] || {}).map(m => ({ text: { type: "plain_text", text: m }, value: m }));
  const defects = commonData?.defects?.map(d => ({ text: { type: "plain_text", text: d }, value: d })) || [];

  // construct expanded blocks for index
  const i = Number(index);
  const indexText = ` (${i + 1}台目)`;
  const expanded = [
    { type: "section", text: { type: "mrkdwn", text: `*${i + 1}台目（入力）*` } },
    {
      type: "input",
      block_id: `machine_${i}`,
      label: { type: "plain_text", text: `成形機番号${indexText}` },
      element: {
        type: "static_select",
        action_id: `machine_select_${i}`,
        placeholder: { type: "plain_text", text: "選択してください" },
        options: machines
      }
    },
    {
      type: "input",
      block_id: `product_${i}`,
      label: { type: "plain_text", text: `製品名${indexText}` },
      element: {
        type: "static_select",
        action_id: `product_select_${i}`,
        placeholder: { type: "plain_text", text: "成形機選択後に製品を選択できます" },
        options: [{ text: { type: "plain_text", text: "—" }, value: "none" }]
      }
    },
    {
      type: "input",
      block_id: `defect_${i}`,
      optional: true,
      label: { type: "plain_text", text: `不良内容${indexText}` },
      element: { type: "multi_static_select", action_id: `defects_${i}`, options: defects }
    },
    {
      type: "input",
      block_id: `details_${i}`,
      optional: true,
      label: { type: "plain_text", text: `詳細${indexText}` },
      element: { type: "plain_text_input", action_id: `details_${i}` }
    }
  ];

  // build new blocks: replace the toggle_{i} block with expanded array
  const newBlocks = [];
  for (const b of view.blocks) {
    if (b.block_id === `toggle_${i}`) {
      // insert expanded blocks instead of the toggle
      expanded.forEach(x => newBlocks.push(x));
    } else {
      newBlocks.push(b);
    }
  }

  const body = {
    view_id: view.id,
    hash: view.hash,
    view: {
      type: view.type,
      callback_id: view.callback_id,
      private_metadata: view.private_metadata,
      title: view.title,
      submit: view.submit,
      close: view.close,
      blocks: newBlocks 
    }
  };

  const resp = await fetch("https://slack.com/api/views.update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body)
  });

  const json = await resp.json();
  if (!json.ok) console.error("views.update failed (expand):", json);
}

// ---------------------------
// メインハンドラ
// ---------------------------
export default async function handler(req, res) {
  // 必ず POST のみ受ける
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const rawBody = await getRawBody(req);
  req.rawBody = rawBody.toString("utf8");


  // 署名検証（verifySlackRequest は外部実装）
  if (!verifySlackRequest(req, process.env.SLACK_SIGNING_SECRET)) {
    console.warn("Slack signature verification failed");
    return res.status(401).send("invalid signature");
  }

  // payload を一箇所で正規化（body.payload が string の場合は parse）
  let body = req.body;
  if (typeof body.payload === "string") {
    try {
      body = JSON.parse(body.payload);
    } catch (e) {
      console.error("JSON parse error (payload):", e);
      return res.status(400).send("invalid payload");
    }
  }

  try {
    // 初期データを確実に用意（ensureInitialData 等を推奨）
    if (!commonData) await loadInitialData();

    console.log("Incoming Slack body type:", body.type);

    // URL verification
    if (body.type === "url_verification") return res.status(200).send(body.challenge);

    // App Home opened
    if (body.type === "event_callback" && body.event && body.event.type === "app_home_opened") {
      const userId = body.event.user;
      try {
        const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=1a_reports`);
        const historyList = await resHistory.json();
        await publishHomeView(userId, historyList);
      } catch (err) {
        console.error("Failed to fetch/publish home view:", err);
      }
      return res.status(200).send("ok");
    }

    // block_actions / shortcut
    if (body.type === "block_actions" || body.type === "shortcut") {
      const action = (body.actions && body.actions[0]) || null;
      if (!action) {
        // 安全に空応答を返す（typo に注意）
        return res.status(200).send("");
      }

      // ----- machine_select_{i} 選択（製品ドロップダウン更新） -----
      const aid = action.action_id || "";
      const mMatch = aid.match(/^machine_select_(\d+)$/);
      if (mMatch) {
        const index = Number(mMatch[1]);
        const selectedMachine = action.selected_option?.value;
        const view = body.view;
        // factorySheet は action.value ではなく action の value、もしくは view.private_metadata を優先
        const factorySheet = (view && view.private_metadata) || action.value || "1a_machine";
        if (view && selectedMachine) {
          try {
            await updateProductDropdown(view, factorySheet, selectedMachine, index);
          } catch (err) {
            console.error("updateProductDropdown error:", err);
          }
        }
        return res.status(200).send("");
      }

      // ----- 開くボタン（open_machine_block） -----
      if (action.action_id === "open_machine_block") {
        const idx = Number(action.value);
        const view = body.view;
        const factorySheet = (view && view.private_metadata) || "1a_machine";
        if (view) {
          try {
            await expandMachineBlock(view, factorySheet, idx);
          } catch (err) {
            console.error("expandMachineBlock error:", err);
          }
        }
        return res.status(200).send("");
      }

      // ----- App Home のボタン等でモーダルを開く -----
      if (action.action_id === "open_daily_report") {
        const factorySheet = action.value || "1a_machine";
        const modal = createReportModal(factorySheet);

        try {
          const r = await fetch("https://slack.com/api/views.open", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            },
            body: JSON.stringify({
              trigger_id: body.trigger_id,
              view: modal,
            }),
          });

          // fetch の結果を一度だけパースして扱う（r が undefined の可能性をガード）
          if (!r) {
            console.error("views.open fetch returned undefined");
          } else {
            const json = await r.json();
            console.log("views.open result:", json);
            if (!json.ok) {
              console.error("views.open error:", json.error || json);
            }
          }
        } catch (err) {
          console.error("views.open fetch error:", err);
        }

        return res.status(200).send("");
      }

      // Shortcut handling (例: global shortcut)
      if (body.type === "shortcut" && body.callback_id === "daily_report") {
        const factorySheet = "1a_machine";
        try {
          const r = await fetch("https://slack.com/api/views.open", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            },
            body: JSON.stringify({ trigger_id: body.trigger_id, view: createReportModal(factorySheet) })
          });
          if (r) {
            const json = await r.json();
            if (!json.ok) console.error("views.open (shortcut) error:", json);
          }
        } catch (err) {
          console.error("views.open (shortcut) fetch error:", err);
        }
        return res.status(200).send("");
      }

      return res.status(200).send("");
    }

    // view_submission（モーダル送信）
    if (body.type === "view_submission" && body.view && body.view.callback_id === "daily_report_modal") {
      const values = body.view.state.values || {};
      const factorySheet = body.view.private_metadata || "1a_machine";
      const reporter = values.reporter?.name?.selected_option?.value || "不明";

      const reports = [];

      for (let i = 0; i < 10; i++) {
        const machineBlock = values[`machine_${i}`];
        const productBlock = values[`product_${i}`];
        const defectBlock = values[`defect_${i}`];
        const detailsBlock = values[`details_${i}`];

        const machineVal = machineBlock?.[`machine_select_${i}`]?.selected_option?.value;
        const productVal = productBlock?.[`product_select_${i}`]?.selected_option?.value || productBlock?.[`product_${i}`]?.value;
        const defectsVal = (defectBlock?.[`defects_${i}`]?.selected_options || []).map(d => d.value).join(", ");
        const detailsVal = detailsBlock?.[`details_${i}`]?.value || "";

        if (machineVal || productVal || defectsVal || detailsVal) {
          reports.push({
            machineNo: machineVal || "",
            productName: productVal || "",
            defect: defectsVal,
            details: detailsVal
          });
        }
      }

      // GAS へ送信
      if (reports.length > 0) {
        try {
          await fetch(GAS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ factory: factorySheet, reporter, reports })
          });
        } catch (err) {
          console.error("Failed to post reports to GAS:", err);
        }
      }

      // 履歴再取得して App Home 更新
      try {
        const historySheet = `${factorySheet.split("_")[0]}_reports`;
        const resHistory = await fetch(`${GAS_URL}?action=getReports&sheet=${historySheet}`);
        const historyList = await resHistory.json();
        // ビュー送信ユーザは body.user.id（view_submission のペイロードに user が入る）
        const userId = body.user?.id || body.user || null;
        if (userId) await publishHomeView(userId, historyList);
      } catch (err) {
        console.error("Failed to refresh/publish history:", err);
      }

      return res.status(200).json({ response_action: "clear" });
    }

    // 他のイベントは無視
    return res.status(200).send("ignored");

  } catch (err) {
    console.error("handler error:", err);
    return res.status(500).send("error");
  }
}
