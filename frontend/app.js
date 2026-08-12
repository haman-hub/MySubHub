// app.js
const TG = window.Telegram.WebApp;
TG.ready();
TG.expand();

const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'eyJh...';  // public anon key
const API_BASE = 'https://your-backend.onrender.com/api'; // Express API

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let isOwner = false;
let isAdmin = false;
const ADMIN_TELEGRAM_ID = '123456789'; // set to your admin telegram ID

// TON Connect setup
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl: 'https://yourusername.github.io/ton-subscription-app/manifest.json',
  buttonRootId: 'ton-connect-button'
});

// Utility: fetch with initData in header
async function apiFetch(url, options = {}) {
  const initData = TG.initData;
  const headers = { 'x-telegram-initdata': initData, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers: { ...headers, ...options.headers } });
  return res.json();
}

// Show page by ID
function showPage(pageId) {
  document.querySelectorAll('.hidden-page').forEach(el => el.classList.add('hidden-page'));
  document.getElementById(`page-${pageId}`).classList.remove('hidden-page');
}

// Initialize app
async function init() {
  try {
    const res = await apiFetch('/auth/validate', { method: 'POST', body: JSON.stringify({}) });
    if (res.user) {
      currentUser = res.user;
      document.getElementById('nav-bar').classList.remove('hidden');
      // Check if user owns channels
      const channelsRes = await apiFetch('/channels/my');
      isOwner = Array.isArray(channelsRes) && channelsRes.length > 0;
      if (isOwner) document.getElementById('nav-owner').style.display = 'inline-block';
      if (currentUser.id.toString() === ADMIN_TELEGRAM_ID) {
        isAdmin = true;
        document.getElementById('nav-admin').style.display = 'inline-block';
      }

      const startParam = TG.initDataUnsafe?.start_param;
      if (startParam && /^[0-9a-fA-F-]{36}$/.test(startParam)) {
        loadPurchasePage(startParam);
        showPage('purchase');
      } else if (startParam === 'owner' && isOwner) {
        loadOwnerDashboard();
        showPage('owner');
      } else if (startParam === 'admin' && isAdmin) {
        loadAdminDashboard();
        showPage('admin');
      } else {
        loadSubscriptions();
        showPage('subscriptions');
      }
    }
  } catch (err) {
    console.error('Auth error:', err);
  }
}

// ---------- PURCHASE PAGE ----------
async function loadPurchasePage(channelId) {
  const { data, error } = await supabase.from('channels').select('*').eq('id', channelId).single();
  if (error || !data) {
    document.getElementById('purchase-card').innerHTML = '<p class="text-red-400">Channel not found.</p>';
    return;
  }
  const ch = data;
  document.getElementById('purchase-card').innerHTML = `
    <h2 class="text-2xl font-bold">${ch.channel_name}</h2>
    <p class="text-slate-400 mt-2">Subscription: <strong class="text-white">${ch.subscription_price} TON</strong> / ${ch.duration_days} days</p>
    <button id="btn-pay" class="mt-6 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-500/20 transition">Pay with TON</button>
  `;
  document.getElementById('btn-pay').addEventListener('click', () => initiatePayment(ch.id, ch.subscription_price));
}

async function initiatePayment(channelId, price) {
  const initRes = await apiFetch('/subscriptions/initiate', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channelId })
  });
  if (!initRes.wallet) return alert('Failed to initiate payment');

  try {
    // Build comment cell using TonWeb
    const tonweb = new TonWeb();
    const commentCell = new TonWeb.boc.Cell();
    commentCell.bits.writeUint(0, 32); // op: 0 for text comment
    commentCell.bits.writeString(initRes.memo);
    const payloadBoc = await commentCell.toBoc();
    const payloadBase64 = TonWeb.utils.bytesToBase64(payloadBoc);

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 360,
      messages: [{
        address: initRes.wallet,
        amount: initRes.amountNano,
        payload: payloadBase64
      }]
    };
    const result = await tonConnectUI.sendTransaction(transaction);
    const boc = result.boc;
    const confirmRes = await apiFetch('/subscriptions/confirm', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, boc })
    });
    if (confirmRes.success) {
      alert('Subscription activated! Check your Telegram for the invite link.');
      showPage('subscriptions');
      loadSubscriptions();
    } else {
      alert('Payment verification failed. Please try again.');
    }
  } catch (e) {
    alert('Transaction failed: ' + e.message);
  }
}

// ---------- SUBSCRIPTIONS ----------
async function loadSubscriptions() {
  const subs = await apiFetch('/subscriptions/my');
  const list = document.getElementById('subscriptions-list');
  if (!subs || !subs.length) {
    list.innerHTML = '<p class="text-slate-500">No subscriptions yet.</p>';
    return;
  }

  // Update stats
  const activeCount = subs.filter(s => s.status === 'active').length;
  const expiringCount = subs.filter(s => s.status === 'active' && new Date(s.end_date) < new Date(Date.now() + 7*86400000)).length;
  document.getElementById('stat-active').innerText = activeCount;
  document.getElementById('stat-expiring').innerText = expiringCount;

  list.innerHTML = subs.map(s => {
    const statusClass = s.status === 'active'
      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      : 'bg-red-500/10 text-red-400 border border-red-500/20';
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:bg-slate-800/30 transition">
        <div class="flex justify-between items-start">
          <h3 class="font-semibold text-white">${s.channel?.channel_name || 'Channel'}</h3>
          <span class="${statusClass} px-2 py-0.5 rounded text-xs font-medium">${s.status}</span>
        </div>
        <p class="text-slate-400 text-sm mt-1">Expires: ${new Date(s.end_date).toLocaleDateString()}</p>
        <div class="flex gap-2 mt-3">
          <button onclick="openRating('${s.channel_id}')" class="text-sm text-amber-400 hover:text-amber-300">⭐ Rate</button>
          <button onclick="openReport('${s.channel_id}')" class="text-sm text-red-400 hover:text-red-300">🚩 Report</button>
        </div>
        ${s.status !== 'active' ? `<button onclick="renewSubscription('${s.id}')" class="mt-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-xl w-full">Renew</button>` : ''}
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

async function renewSubscription(subId) {
  // Simplified: same flow as purchase but using existing subscription
  // For production, extend backend logic to extend end_date
  alert('Renewal flow not implemented in this MVP. Please purchase again.');
}

// ---------- OWNER DASHBOARD ----------
async function loadOwnerDashboard() {
  const channels = await apiFetch('/channels/my');
  const container = document.getElementById('channels-list');
  container.innerHTML = channels.map(ch => `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <h3 class="font-semibold text-white">${ch.channel_name}</h3>
      <p class="text-slate-400 text-sm mt-1">${ch.subscription_price} TON / ${ch.duration_days} days</p>
      <div class="flex items-center gap-4 mt-3">
        <label class="flex items-center gap-2 text-sm text-slate-300">
          Active:
          <input type="checkbox" ${ch.is_active?'checked':''} onchange="toggleChannel('${ch.id}', this.checked)" class="accent-blue-500">
        </label>
        <button onclick="openEditModal('${ch.id}')" class="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
      </div>
    </div>
  `).join('');

  // Wallet section
  const walletDiv = document.getElementById('wallet-section');
  walletDiv.innerHTML = `
    <h3 class="text-lg font-semibold text-white mb-2">Payout Wallet</h3>
    <p id="current-wallet" class="text-slate-400 font-mono text-sm break-all">Not set</p>
    <button id="btn-connect-wallet" class="mt-3 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm">Connect TON Wallet</button>
  `;
  document.getElementById('btn-connect-wallet').onclick = async () => {
    try {
      const connected = await tonConnectUI.connectWallet();
      const rawAddress = connected.account.address;
      const friendly = rawAddress.toString(true, true, true);
      await apiFetch('/auth/wallet', { method: 'POST', body: JSON.stringify({ wallet_address: friendly }) });
      document.getElementById('current-wallet').innerText = friendly;
      alert('Wallet saved!');
    } catch (e) {
      alert('Connection failed');
    }
  };

  loadWithdrawalSection();
  lucide.createIcons();
}

// Edit Modal Logic
let editingChannelId = null;
function openEditModal(channelId) {
  editingChannelId = channelId;
  // Fetch current channel data
  supabase.from('channels').select('*').eq('id', channelId).single().then(({ data }) => {
    document.getElementById('edit-price').value = data.subscription_price;
    document.getElementById('edit-duration').value = data.duration_days;
    document.getElementById('edit-renewal').checked = data.auto_renewal_reminders;
    document.getElementById('edit-modal').classList.remove('hidden');
  });
}
document.getElementById('modal-cancel').onclick = () => {
  document.getElementById('edit-modal').classList.add('hidden');
  editingChannelId = null;
};
document.getElementById('modal-save').onclick = async () => {
  const price = parseFloat(document.getElementById('edit-price').value);
  const duration = parseInt(document.getElementById('edit-duration').value);
  const renewal = document.getElementById('edit-renewal').checked;
  await apiFetch(`/channels/${editingChannelId}`, {
    method: 'PUT',
    body: JSON.stringify({ subscription_price: price, duration_days: duration, auto_renewal_reminders: renewal })
  });
  document.getElementById('edit-modal').classList.add('hidden');
  loadOwnerDashboard();
};

async function toggleChannel(channelId, isActive) {
  await apiFetch(`/channels/${channelId}`, { method: 'PUT', body: JSON.stringify({ is_active: isActive }) });
}

// ---------- WITHDRAWALS ----------
async function loadWithdrawalSection() {
  const data = await apiFetch('/withdrawals/my');
  const section = document.getElementById('withdrawal-section');
  section.innerHTML = `
    <h3 class="text-lg font-semibold text-white mb-2">Earnings</h3>
    <p class="text-slate-400">Pending: <strong class="text-white">${data.pendingEarnings.toFixed(6)} TON</strong></p>
    <button onclick="requestWithdrawal()" class="mt-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-sm">Request Withdrawal</button>
    <div class="mt-4">${data.withdrawals?.map(w => `<p class="text-sm text-slate-400">${w.amount} TON - <span class="text-amber-400">${w.status}</span></p>`).join('')}</div>
  `;
}
async function requestWithdrawal() {
  const amount = prompt('Enter amount in TON to withdraw:');
  if (!amount) return;
  const res = await apiFetch('/withdrawals/request', { method: 'POST', body: JSON.stringify({ amount: parseFloat(amount) }) });
  if (res.success) {
    alert('Withdrawal requested.');
    loadOwnerDashboard();
  } else {
    alert('Error: ' + res.error);
  }
}

// ---------- RATING & REPORTING ----------
let ratingChannelId = null, reportChannelId = null, selectedRating = 0;

function openRating(channelId) {
  ratingChannelId = channelId;
  document.getElementById('rating-modal').classList.remove('hidden');
  const container = document.getElementById('star-rating');
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.textContent = i <= selectedRating ? '★' : '☆';
    star.className = 'cursor-pointer text-amber-400';
    star.onclick = () => { selectedRating = i; openRating(channelId); };
    container.appendChild(star);
  }
}
function closeRating() {
  document.getElementById('rating-modal').classList.add('hidden');
  ratingChannelId = null; selectedRating = 0;
}
async function submitRating() {
  if (!selectedRating) return alert('Select a rating');
  const comment = document.getElementById('rating-comment').value;
  await apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ channel_id: ratingChannelId, rating: selectedRating, comment }) });
  closeRating();
  alert('Review submitted!');
}

function openReport(channelId) {
  reportChannelId = channelId;
  document.getElementById('report-modal').classList.remove('hidden');
}
function closeReport() {
  document.getElementById('report-modal').classList.add('hidden');
  reportChannelId = null;
}
async function submitReport() {
  const reason = document.getElementById('report-reason').value;
  const description = document.getElementById('report-description').value;
  await apiFetch('/reports', { method: 'POST', body: JSON.stringify({ channel_id: reportChannelId, reason, description }) });
  closeReport();
  alert('Report submitted.');
}

// ---------- ADMIN DASHBOARD ----------
async function loadAdminDashboard() {
  loadAdminReports();
  loadAdminWithdrawals();
}
async function loadAdminReports() {
  const reports = await apiFetch('/admin/reports');
  const container = document.getElementById('admin-reports');
  container.innerHTML = reports.map(r => `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <p><strong class="text-white">Channel:</strong> ${r.channel?.channel_name}</p>
      <p><strong class="text-slate-400">Reporter:</strong> ${r.reporter?.first_name} (@${r.reporter?.username})</p>
      <p><strong class="text-slate-400">Reason:</strong> ${r.reason} - ${r.description}</p>
      <div class="flex gap-2 mt-2">
        <button onclick="reviewReport('${r.id}', 'ban')" class="bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-xl text-sm">Ban Channel</button>
        <button onclick="reviewReport('${r.id}', 'dismiss')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl text-sm">Dismiss</button>
      </div>
    </div>
  `).join('');
}
async function reviewReport(reportId, action) {
  await apiFetch(`/admin/reports/${reportId}/review`, { method: 'POST', body: JSON.stringify({ action }) });
  loadAdminReports();
}
async function loadAdminWithdrawals() {
  const withdrawals = await apiFetch('/admin/withdrawals');
  const container = document.getElementById('admin-withdrawals');
  container.innerHTML = withdrawals.map(w => `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <p class="text-white">Owner: ${w.owner?.first_name} (${w.owner?.wallet_address})</p>
      <p class="text-slate-400">Amount: ${w.amount} TON</p>
      <button onclick="approveWithdrawal('${w.id}')" class="mt-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-sm">Approve & Pay</button>
    </div>
  `).join('');
}
async function approveWithdrawal(id) {
  const res = await apiFetch(`/admin/withdrawals/${id}/approve`, { method: 'POST' });
  if (res.success) {
    alert('Withdrawal processed.');
    loadAdminWithdrawals();
  } else {
    alert('Failed: ' + res.error);
  }
}

window.onload = init;