// bot/api/channels.js
const express = require('express');
const router = express.Router();
const { validateInitData } = require('./auth');
const supabase = require('../utils/supabase');

router.use(validateInitData);

// GET my channels
router.get('/my', async (req, res) => {
  const ownerId = req.telegramUser.id;
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('owner_id', ownerId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT update channel (price, duration, etc.)
router.put('/:id', async (req, res) => {
  const ownerId = req.telegramUser.id;
  const channelId = req.params.id;
  // Verify ownership
  const { data: channel } = await supabase
    .from('channels')
    .select('owner_id')
    .eq('id', channelId)
    .single();
  if (!channel || channel.owner_id !== ownerId) return res.status(403).json({ error: 'Not allowed' });

  const { subscription_price, duration_days, is_active, auto_renewal_reminders } = req.body;
  const updates = {};
  if (subscription_price !== undefined) updates.subscription_price = subscription_price;
  if (duration_days !== undefined) updates.duration_days = duration_days;
  if (is_active !== undefined) updates.is_active = is_active;
  if (auto_renewal_reminders !== undefined) updates.auto_renewal_reminders = auto_renewal_reminders;

  const { error } = await supabase
    .from('channels')
    .update(updates)
    .eq('id', channelId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;