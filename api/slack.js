export const config = {
  api: {
    bodyParser: true, // 普通のPOSTテストでは必要
  },
};

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  console.log("POST received:", req.body);

  res.status(200).json({
    message: "POST OK",
    received: req.body,
  });
}
