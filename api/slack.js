export default async function handler(req, res) {
  console.log("Incoming Slack request:", req.body || req.rawBody);

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  //payload => JSON.parse
  let body = req.body || {};
  if (body.payload) {
    body = JSON.parse(body.payload);
  } else if (req.rawBody) {
    body = JSON.parse(req.rawBody);
  }
    
  try {
    // ---- body の安全取得 ----
    const body = req.body || JSON.parse(req.rawBody || "{}");

    // ---- Slack URL verification ----
    if (body.type === "url_verification") {
      return res.status(200).send(body.challenge);
    }

    // ショートカットを受け取る
    if (body.type === "shortcut" && body.callback_id === "daily_report") {

      //debug
      console.log("Shortcut received:", {
        callback_id: body.callback_id,
        trigger_id: body.trigger_id,
        user: body.user,
        body: body
      });



      // modal open
      await fetch("https://slack.com/api/views.open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            callback_id: "daily_report_modal",
            title: { type: "plain_text", text: "日報入力" },
            submit: { type: "plain_text", text: "送信" },
            close: { type: "plain_text", text: "キャンセル" },
            blocks: [
              {
                type: "input",
                block_id: "qty",
                label: { type: "plain_text", text: "生産数" },
                element: {
                  type: "plain_text_input",
                  action_id: "value",
                  placeholder: { type: "plain_text", text: "例: 120" }
                }
              },
              {
                type: "input",
                block_id: "ng",
                label: { type: "plain_text", text: "不良数" },
                element: {
                  type: "plain_text_input",
                  action_id: "value",
                  placeholder: { type: "plain_text", text: "例: 5" }
                }
              }
            ]
          }
        })
      });

      return res.status(200).send("");
    }

    // ---- Slack event ----
    if (body.type === "event_callback") {

      //debug
      console.log("Event received:", {
        type: body.event.type,
        user: body.event.user,
        text: body.event.text
      });

      const event = body.event;

      console.log("Received Slack event:", event.type, event.ts);

      // ---- message event ----
      if (event.type === "message" && !event.bot_id) {
        // ---- Send to Apps Script ----
        await fetch(process.env.GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: event.text,
            user: event.user,
            timestamp: event.ts
          })
        });

        console.log("Sent to GAS:", event.text);
      }

      return res.status(200).send("ok");
    }

    //modal送信を受け取る
    if (body.type === "view_submission" && body.view.callback_id === "daily_report_modal"){

      //debug
      console.log("Model submitted:", {
        user: body.user.id,
        value: body.view.state.values
      });

      const qty = body.view.state.values?.qty?.value?.value || "";
      const ng = body.view.state.values?.ng?.value?.value || "";

      //Apps Scriptに送信
      await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "daily_report",
          qty,
          ng,
          user: body.user.id,
          timestamp:Date.now()
        })
      });

      return res.status(200).json({ response_action: "clear"});

    }

    return res.status(200).send("ignored");
  } catch (e) {
    console.error("Slack handler error:", e);
    return res.status(500).send("error");
  }
}
