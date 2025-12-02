import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Slackからのイベントを受信
app.event("app_mention", async ({ say }) => {
  await say("Hello from Vercel!");
});

export default async function handler(req, res) {
  // challenge リクエストの確認
  if (req.body?.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }

  // Bolt のリクエスト処理
  await app.processEvent({
    body: req.body,
    headers: req.headers
  });

  res.status(200).send("OK");
}
