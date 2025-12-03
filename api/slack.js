import { buffer } from "micro";
import axios from "axios";

export const config = {
  api: {
    bodyParser: false,
  },
};

const GAS_URL = process.env.GAS_URL; // ← Vercelで設定する

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const buf = await buffer(req);
  const body = JSON.parse(buf.toString());

  // Slack URL verification
  if (body.type === "url_verification") {
    return res.status(200).send(body.challenge);
  }

  // ブロック操作が行われた時
  if (body.type === "block_actions") {
    const user = body.user.id;
    const action = body.actions[0].action_id;
    const value = body.actions[0].selected_option?.value || "";

    // Apps Script へ転送するデータ
    await axios.post(GAS_URL, {
      user,
      action,
      value,
      raw: body,
    });

    return res.status(200).send(""); // Slackには即返す
  }

  return res.status(200).send("OK");
}
