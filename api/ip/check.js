export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const apis = [
    { url: 'https://api.ipify.org?format=json',  json: true,  key: 'ip' },
    { url: 'https://api64.ipify.org?format=json', json: true,  key: 'ip' },
    { url: 'https://freeipapi.com/api/json',      json: true,  key: 'ipAddress' },
    { url: 'https://ip4.seeip.org/json',          json: true,  key: 'ip' },
    { url: 'https://checkip.amazonaws.com/',      json: false },
  ];
  for (const api of apis) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 5000);
      const r    = await fetch(api.url, { signal: ctrl.signal });
      clearTimeout(tid);
      const val  = api.json ? await r.json() : await r.text();
      const ip   = api.json ? val[api.key] : val.trim();
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.json({ ip });
    } catch { /* tenta próxima */ }
  }
  return res.status(502).json({ error: 'All IP APIs failed' });
}
