// MySubHub Telegram bot service.
// The Mini App REST API is served by the Supabase Edge Function `mainbot`.
// This process only receives Telegram updates and must not mount the legacy REST routers.
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port');
if (!WEBHOOK_URL) throw new Error('WEBHOOK_URL is required');
let webhookBase;
try { webhookBase = new URL(WEBHOOK_URL); } catch { throw new Error('WEBHOOK_URL must be a valid public HTTPS URL'); }
if (webhookBase.protocol !== 'https:') throw new Error('WEBHOOK_URL must use HTTPS');
if (!/^[A-Za-z0-9_-]{16,256}$/.test(WEBHOOK_SECRET)) {
  throw new Error('WEBHOOK_SECRET must be 16-256 characters using letters, digits, underscore or hyphen');
}

// Load clients only after required configuration has been validated.
const bot = require('./bot');
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb', strict: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mysubhub-telegram-bot' });
});

app.post('/bot-webhook', (req, res, next) => {
  const supplied = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const expectedBuffer = Buffer.from(WEBHOOK_SECRET);
  const suppliedBuffer = Buffer.from(supplied);
  const valid = suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!valid) return res.status(401).send('Unauthorized');
  next();
}, bot.webhookCallback('/bot-webhook'));

const server = app.listen(PORT, async () => {
  console.log(`MySubHub Telegram webhook listening on ${PORT}`);
  try {
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/bot-webhook`, {
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message', 'my_chat_member'],
    });
    console.log(`Telegram webhook configured: ${WEBHOOK_URL}/bot-webhook`);
  } catch (error) {
    console.error('Failed to configure Telegram webhook:', error);
    server.close(() => process.exit(1));
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
