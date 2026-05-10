# BrazinoVIP API

Backend da extensão BrazinoVIP. Hospedado no Vercel como funções serverless.

## Deploy no Vercel

1. Importe este repositório no [vercel.com](https://vercel.com)
2. Deploy automático — nenhuma variável de ambiente necessária
3. Copie a URL gerada (ex: `https://brazino-vip.vercel.app`)
4. Cole a URL no arquivo `config.js` da extensão

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/totp/generate` | Gera código TOTP a partir de uma chave secreta |
| POST | `/api/email/create` | Cria email temporário via mail.tm |
| POST | `/api/email/check-inbox` | Verifica inbox e retorna ação detectada |
| GET  | `/api/ip/check` | Verifica IP público atual |
| GET  | `/api/proxy/list` | Busca lista de proxies ao vivo |
