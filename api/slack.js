import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// App Mention イベントを受信
app.event("app_mention", async ({ say }) => {
  await say("Hello from Vercel!");
});

export default async function handler(req, res) {
  // Slack の challenge リクエスト対応
  if (req.body?.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }

  // Slack 本番からのイベントだけ処理
  if (req.headers["x-slack-signature"]) {
    await app.processEvent({
      body: req.body,
      headers: req.headers
    });
  }

  res.status(200).send("OK");
}
