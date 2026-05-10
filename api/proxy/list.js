export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const protocol = req.query.protocol || 'http,https,socks5,socks4';
  let proxies = [];

  const tryGeoNode = async () => {
    const url = `https://proxylist.geonode.com/api/proxy-list?limit=20&page=1&sort_by=lastChecked&sort_type=desc&protocols=${encodeURIComponent(protocol)}`;
    const d = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    return (d.data || []).map(p => ({
      ip: p.ip, port: p.port,
      protocols: p.protocols || ['http'],
      country: p.country || ''
    }));
  };

  const tryProxyScrape = async (proto) => {
    const url = `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=${proto}&timeout=5000&country=all&ssl=all&anonymity=all`;
    const txt = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => r.text());
    return txt.trim().split('\n').filter(l => l.includes(':')).slice(0, 20).map(line => {
      const [ip, port] = line.trim().split(':');
      return { ip, port, protocols: [proto], country: '' };
    });
  };

  const tryProxyListTxt = async (proto) => {
    const url = `https://www.proxy-list.download/api/v1/get?type=${proto}`;
    const txt = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => r.text());
    return txt.trim().split('\n').filter(l => l.includes(':')).slice(0, 20).map(line => {
      const [ip, port] = line.trim().split(':');
      return { ip, port, protocols: [proto], country: '' };
    });
  };

  const protos = protocol === 'http,https,socks5,socks4' ? ['http', 'socks5'] : [protocol.split(',')[0]];

  try { proxies = await tryGeoNode(); } catch {}
  if (!proxies.length) {
    for (const proto of protos) {
      try { proxies.push(...(await tryProxyScrape(proto))); } catch {}
    }
  }
  if (!proxies.length) {
    for (const proto of protos) {
      try { proxies.push(...(await tryProxyListTxt(proto))); } catch {}
    }
  }

  return res.json({ proxies: proxies.slice(0, 15) });
}
