// api/test.js
export default function handler(req, res) {
  console.log('Request received:', req.method, req.body);
  res.status(200).json({ message: 'Vercel server is working!' });
}
