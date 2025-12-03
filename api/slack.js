export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // ---- body の安全取得 ----
    const body = req.body || JSON.parse(req.rawBody || "{}");

    // ---- Slack URL verification ----
    if (body.type === "url_verification") {
      return res.status(200).send(body.challenge);
    }

    // ---- Slack event ----
    if (body.type === "event_callback") {
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

    return res.status(200).send("ignored");
  } catch (e) {
    console.error("Slack handler error:", e);
    return res.status(500).send("error");
  }
}
