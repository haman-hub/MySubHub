// bot/api/reports.js
const express = require('express');
const router = express.Router();
const { validateInitData } = require('./auth');
const supabase = require('../utils/supabase');

router.use(validateInitData);

// POST a report (any authenticated user)
router.post('/', async (req, res) => {
  const reporterId = req.telegramUser.id;
  const { channel_id, reason, description } = req.body;
  if (!channel_id || !reason) return res.status(400).json({ error: 'Missing fields' });
  const { error } = await supabase
    .from('reports')
    .insert({
      reporter_id: reporterId,
      reported_channel_id: channel_id,
      reason,
      description
    });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;