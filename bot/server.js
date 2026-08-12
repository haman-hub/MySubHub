// bot/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const bot = require('./bot');
const apiAuth = require('./api/auth');
const channelsApi = require('./api/channels');
const subscriptionsApi = require('./api/subscriptions');
const adminApi = require('./api/admin');
const reviewsApi = require('./api/reviews');
const withdrawalsApi = require('./api/withdrawals');
const reportsApi = require('./api/reports'); // NEW

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', apiAuth);
app.use('/api/channels', channelsApi);
app.use('/api/subscriptions', subscriptionsApi);
app.use('/api/admin', adminApi);
app.use('/api/reviews', reviewsApi);
app.use('/api/withdrawals', withdrawalsApi);
app.use('/api/reports', reportsApi); // NEW

app.get('/', (req, res) => res.send('TON Subscription Bot API is running.'));

app.use(bot.webhookCallback('/bot-webhook'));

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  const webhookUrl = `${process.env.WEBHOOK_URL}/bot-webhook`;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook set to ${webhookUrl}`);
  } catch (e) {
    console.error('Failed to set webhook:', e);
  }
});