export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const body = req.body;

      // Slack URL verification
      if (body.type === "url_verification") {
        return res.status(200).send(body.challenge);
      }

      // Slack event callback
      if (body.type === "event_callback") {
        console.log("Slack Event:", body.event);
        return res.status(200).send("ok");
      }

      return res.status(200).send("ignored");
    } catch (e) {
      console.error(e);
      return res.status(500).send("error");
    }
  }

  return res.status(405).send("Method Not Allowed");
}
