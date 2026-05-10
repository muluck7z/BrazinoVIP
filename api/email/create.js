export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const domainsRes = await fetch('https://api.mail.tm/domains');
    const domainsData = await domainsRes.json();
    const domain = domainsData['hydra:member'][0].domain;
    const user = Math.random().toString(36).substring(2, 12);
    const address = `${user}@${domain}`;
    const password = Math.random().toString(36).substring(2, 15);
    await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password })
    });
    const tokenRes = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password })
    });
    const { token } = await tokenRes.json();
    return res.json({ address, token });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create email', detail: e.message });
  }
}
