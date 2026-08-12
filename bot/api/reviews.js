// bot/api/reviews.js
const express = require('express');
const router = express.Router();
const { validateInitData } = require('./auth');
const supabase = require('../utils/supabase');

router.use(validateInitData);

// POST review
router.post('/', async (req, res) => {
  const { channel_id, rating, comment } = req.body;
  const userId = req.telegramUser.id;
  // Optional: check if user has active subscription to channel (or past)
  const { error } = await supabase
    .from('reviews')
    .insert({ user_id: userId, channel_id, rating, comment });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET reviews for a channel (public, no auth needed)
router.get('/:channel_id', async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, user:users(first_name, username)')
    .eq('channel_id', req.params.channel_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;