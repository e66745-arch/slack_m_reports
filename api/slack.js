import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

export default async function handler(req, res) {
  // --- Slack URL verification（最重要） ---
  if (req.body?.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }

  // --- Slack events handling ---
  try {
    await app.processEvent({
      body: req.body,
      headers: req.headers
    });

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Error processing event:", err);
    return res.status(500).send("Error");
  }
}
