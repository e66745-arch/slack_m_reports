export default function handler(req, res) {
  // POST以外は405
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;

  // Slack Events API URL検証用
  if (body.type === 'url_verification') {
    console.log('URL verification received:', body.challenge);
    return res.status(200).send(body.challenge);
  }

  // ボタン押下（Interactive Component）の場合
  const payload = body.payload ? JSON.parse(body.payload) : null;
  if (payload && payload.type === 'block_actions') {
    console.log('Button pressed, trigger_id:', payload.trigger_id);
    // とりあえず200だけ返す
    return res.status(200).json({ message: 'Button payload received' });
  }

  console.log('Other payload:', body);
  res.status(200).json({ message: 'Received' });
}
