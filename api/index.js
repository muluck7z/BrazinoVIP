module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'online',
    name: 'BrazinoVIP API',
    version: '1.0.0',
    endpoints: [
      'POST /api/totp/generate',
      'POST /api/email/create',
      'POST /api/email/check-inbox',
      'GET  /api/ip/check',
      'GET  /api/proxy/list'
    ]
  });
};
