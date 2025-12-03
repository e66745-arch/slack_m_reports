import { buffer } from "micro";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  let rawBody;
  try {
    const buf = await buffer(req);
    rawBody = buf.toString();
  } catch (e) {
    console.error("Buffer error:", e);
    return res.status(500).send("Buffer error");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("JSON parse error:", e);
    return res.status(200).send(""); // Slack はエラーに弱いので 200 を返す
  }

  // 🔥 これが超重要
  if (payload.type === "url_verification") {
    return res.status(200).send(payload.challenge);
  }

  // その他の場合
  return res.status(200).send("ok");
}
