// bot/api/auth.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../utils/supabase');

// Middleware to verify Telegram WebApp initData
async function validateInitData(req, res, next) {
  const initData = req.headers['x-telegram-initdata'] || req.body.initData;
  if (!initData) return res.status(401).json({ error: 'Missing initData' });

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const vals = new URLSearchParams(initData);
  const hash = vals.get('hash');
  vals.delete('hash');
  vals.sort();
  const dataCheckString = Array.from(vals.entries()).map(([k, v]) => `${k}=${v}`).join('\n');
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (hmac !== hash) return res.status(403).json({ error: 'Invalid initData' });

  const user = JSON.parse(vals.get('user'));
  req.telegramUser = user; // { id, first_name, ... }
  next();
}

// POST /api/auth/validate
router.post('/validate', validateInitData, (req, res) => {
  res.json({ user: req.telegramUser });
});

// NEW: POST /api/auth/wallet – save owner's TON wallet address
router.post('/wallet', validateInitData, async (req, res) => {
  const { wallet_address } = req.body;
  if (!wallet_address) return res.status(400).json({ error: 'Missing wallet_address' });
  const { error } = await supabase
    .from('users')
    .update({ wallet_address })
    .eq('telegram_id', req.telegramUser.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
module.exports.validateInitData = validateInitData;