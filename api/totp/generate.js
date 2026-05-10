import { createHmac } from 'crypto';

function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  base32 = base32.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secretBase32) {
  const secretBuf = base32ToBuffer(secretBase32);
  const epoch = Math.floor(Date.now() / 1000);
  const time = Math.floor(epoch / 30);
  const timeBuf = Buffer.alloc(8);
  timeBuf.writeUInt32BE(0, 0);
  timeBuf.writeUInt32BE(time, 4);
  const hmac = createHmac('sha1', secretBuf).update(timeBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { secret } = req.body || {};
  if (!secret) return res.status(400).json({ error: 'secret is required' });
  try {
    const code = generateTOTP(secret);
    return res.json({ code });
  } catch {
    return res.status(500).json({ error: 'Failed to generate TOTP' });
  }
}
