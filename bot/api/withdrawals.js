// bot/api/withdrawals.js
const express = require('express');
const router = express.Router();
const { validateInitData } = require('./auth');
const supabase = require('../utils/supabase');

router.use(validateInitData);

// GET my pending earnings and withdrawal requests
router.get('/my', async (req, res) => {
  const ownerId = req.telegramUser.id;
  // Sum of owner_share where owner_paid_out = false
  const { data, error } = await supabase
    .from('platform_transactions')
    .select('owner_share')
    .eq('channel_owner_id', ownerId)
    .eq('owner_paid_out', false);
  if (error) return res.status(500).json({ error: error.message });

  const pendingEarnings = data.reduce((sum, row) => sum + parseFloat(row.owner_share), 0);
  // Also fetch withdrawal requests
  const { data: withdrawals } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('channel_owner_id', ownerId)
    .order('request_date', { ascending: false });

  res.json({ pendingEarnings, withdrawals });
});

// POST request withdrawal
router.post('/request', async (req, res) => {
  const ownerId = req.telegramUser.id;
  const { amount } = req.body;

  // Validate amount does not exceed pending earnings
  const { data: unpaid } = await supabase
    .from('platform_transactions')
    .select('owner_share')
    .eq('channel_owner_id', ownerId)
    .eq('owner_paid_out', false);
  const total = unpaid.reduce((s, r) => s + parseFloat(r.owner_share), 0);
  if (amount > total) return res.status(400).json({ error: 'Insufficient balance' });

  const { error } = await supabase
    .from('withdrawals')
    .insert({ channel_owner_id: ownerId, amount, status: 'pending' });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

module.exports = router;