export const config = {
  api: {
    bodyParser: true,  // ← まずは JSON を普通に受け取る
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const body = req.body;

  // Slack の URL確認
  if (body?.type === "url_verification") {
    return res.status(200).send(body.challenge);
  }

  return res.status(200).send("OK");
}
