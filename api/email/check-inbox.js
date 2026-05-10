module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token, lastMsgId } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const msgsRes = await fetch('https://api.mail.tm/messages', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const msgsData = await msgsRes.json();
    const msgs = msgsData['hydra:member'];
    if (!msgs || !msgs.length) return res.json({ action: 'none' });
    if (msgs[0].id === lastMsgId) return res.json({ action: 'none' });
    const md = await fetch('https://api.mail.tm/messages/' + msgs[0].id, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json());
    const txt  = md.text || '';
    const full = txt + (md.html ? md.html.join('') : '');
    const verifyRe = /https?:\/\/(www\.)?roblox\.com\/[^\s"'>]+verify[^\s"'>]*/i;
    const revertRe = /https?:\/\/(www\.)?roblox\.com\/[^\s"'>]+revert[^\s"'>]*/i;
    const codeRe   = /\b\d{6}\b/;
    const vm = full.match(verifyRe);
    const rm = full.match(revertRe);
    const cm = txt.match(codeRe);
    if (vm) return res.json({ action: 'verify', link: vm[0].replace(/&amp;/g, '&'), msgId: msgs[0].id });
    if (rm) return res.json({ action: 'revert', link: rm[0].replace(/&amp;/g, '&'), msgId: msgs[0].id });
    if (cm) return res.json({ action: 'code', code: cm[0], msgId: msgs[0].id });
    return res.json({ action: 'none', msgId: msgs[0].id });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to check inbox', detail: e.message });
  }
};
