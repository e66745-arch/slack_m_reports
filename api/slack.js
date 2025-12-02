export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  let body = req.body;
  // JSON 文字列として送られてきた場合の対応
  if (typeof body === "string") body = JSON.parse(body);

  // challenge リクエストの確認
  if (body?.type === "url_verification") {
    return res.status(200).send(body.challenge);
  }

  // Bolt のリクエスト処理
  await app.processEvent({
    body,
    headers: req.headers
  });

  res.status(200).send("OK");
}
