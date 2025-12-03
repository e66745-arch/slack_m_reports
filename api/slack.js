import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

export const config = {
  api: {
    bodyParser: false, //Boltが自分でパースするので無効化
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  // Slack の challenge リクエスト対応
  if (req.body?.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }

  try {
    await  app.processEvent({
      body: req.body,
      headers:req.headers,
    });
    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error processing event");
  }
}