import { App, ExpressReceiver } from "@slack/bolt";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Slack URL 認証
receiver.router.post("/", (req, res) => {
  if (req.body.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }
  res.status(200).send("OK");
});

export default receiver.router;
