import { App, ExpressReceiver } from "@slack/bolt";

// --- Receiver を使って Express をラップ（Vercelで必須） ---
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// --- Bolt アプリ ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// --- コマンド例 ---
app.event("app_mention", async ({ say }) => {
  await say("Hello from Vercel!");
});

// --- Slack の URL チャレンジに対応（必須） ---
receiver.router.post("/", async (req, res) => {
  if (req.body.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }
  return res.status(200).send("OK");
});

// --- Vercel 用エクスポート ---
export default receiver.router;
