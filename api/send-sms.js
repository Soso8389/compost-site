// api/send-sms.js
// Vercel serverless function — holds the Textbelt key server-side.

export default async function handler(req, res) {
  // CORS headers — allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phones, message } = req.body;

  if (!phones || !Array.isArray(phones) || !message) {
    return res.status(400).json({ error: 'phones (array) and message are required' });
  }

  const key = process.env.TEXTBELT_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Textbelt key not configured' });
  }

  const results = await Promise.all(phones.map(async phone => {
    try {
      const r = await fetch('https://textbelt.com/text', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, message, key })
      });
      const data = await r.json();
      return { phone, success: data.success, error: data.error };
    } catch (e) {
      return { phone, success: false, error: e.message };
    }
  }));

  const failed = results.filter(r => !r.success);
  res.status(200).json({
    sent:   results.length - failed.length,
    failed: failed.length,
    results
  });
}