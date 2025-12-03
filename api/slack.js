export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Slack challenge
  if (req.body?.type === "url_verification") {
    return res.status(200).send(req.body.challenge);
  }

  return res.status(200).send("OK");
}
