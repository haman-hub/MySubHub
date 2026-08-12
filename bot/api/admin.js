// bot/api/admin.js
const express = require('express');
const router = express.Router();
const { validateInitData } = require('./auth');
const supabase = require('../utils/supabase');
const { payout } = require('../utils/ton');

// Ensure user is admin
router.use(validateInitData, (req, res, next) => {
  if (req.telegramUser.id.toString() !== process.env.ADMIN_TELEGRAM_ID) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
});

// GET all reports
router.get('/reports', async (req, res) => {
  const { data, error } = await supabase
    .from('reports')
    .select('*, reporter:users(first_name, username), channel:channels(channel_name)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Review a report (approve/ban)
router.post('/reports/:id/review', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'ban' or 'dismiss'
  const report = await supabase.from('reports').select('*').eq('id', id).single();
  if (!report.data) return res.status(404).json({ error: 'Report not found' });

  if (action === 'ban') {
    // Deactivate channel
    await supabase.from('channels').update({ is_active: false }).eq('id', report.data.reported_channel_id);
    // Optionally revoke invite links, etc.
  }
  await supabase.from('reports').update({ status: 'reviewed', reviewed_by: req.telegramUser.id }).eq('id', id);
  res.json({ success: true });
});

// GET pending withdrawals
router.get('/withdrawals', async (req, res) => {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*, owner:users(first_name, username, wallet_address)')
    .eq('status', 'pending')
    .order('request_date');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Approve & process withdrawal
router.post('/withdrawals/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { data: withdrawal } = await supabase
    .from('withdrawals')
    .select('*, owner:users(wallet_address, telegram_id)')
    .eq('id', id)
    .single();
  if (!withdrawal || withdrawal.status !== 'pending') return res.status(400).json({ error: 'Invalid request' });

  const ownerWallet = withdrawal.owner.wallet_address;
  if (!ownerWallet) return res.status(400).json({ error: 'Owner wallet not set' });

  // Perform payout using admin wallet
  const amountNano = TonWeb.utils.toNano(withdrawal.amount.toString());
  const txHash = await payout(ownerWallet, amountNano);
  if (!txHash) return res.status(500).json({ error: 'Payout failed' });

  // Mark platform_transactions as paid
  await supabase
    .from('platform_transactions')
    .update({ owner_paid_out: true, paid_out_tx_hash: txHash })
    .eq('channel_owner_id', withdrawal.channel_owner_id)
    .eq('owner_paid_out', false);

  await supabase
    .from('withdrawals')
    .update({ status: 'processed', processed_date: new Date(), payout_tx_hash: txHash })
    .eq('id', id);

  res.json({ success: true, txHash });
});

module.exports = router;