// MySubHub Telegram bot service v1.2.2
// Telegram channel linking is a single draft-first flow:
// my_chat_member -> one channels row -> owner configures that row by UUID in the Mini App.
const { Telegraf } = require('telegraf');
const supabase = require('./utils/supabase');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBAPP_URL = String(process.env.WEBAPP_URL || '').replace(/\/$/, '');
const BOT_USERNAME = String(process.env.BOT_USERNAME || 'MySubsHub_bot').replace(/^@/, '');
const MAX_CHANNELS_PER_OWNER = 5;

if (!WEBAPP_URL) throw new Error('WEBAPP_URL is required');

function isTelegramAdmin(member) {
  return ['creator', 'administrator'].includes(String(member?.status || ''));
}

function missingBotPermissions(member) {
  if (member?.status === 'creator') return [];
  const missing = [];
  if (member?.can_invite_users !== true) missing.push('Invite users via links');
  if (member?.can_restrict_members !== true) missing.push('Ban users / Restrict members');
  return missing;
}

async function sendOwnerMessage(telegram, ownerId, channelId, channelTitle, alreadyPublished, permissionWarnings = []) {
  const cleanTitle = String(channelTitle || 'your channel').slice(0, 120);
  const messageLines = alreadyPublished
    ? [`MySubHub admin access has been restored for "${cleanTitle}". Your existing listing remains published. Open My Channels to manage it.`]
    : [
        `MySubHub has been added to "${cleanTitle}" and linked it to your Telegram account as a setup draft.`,
        'Open MySubHub and configure this draft. Set the subscription price, duration, category, description, and Discovery visibility, then publish it.',
        'You do not need to paste an invite link, register the channel again, or use a second Add Channel form.',
      ];
  messageLines.push(...permissionWarnings);
  const message = messageLines.join('\n\n');

  const startApp = alreadyPublished ? 'owner' : `configure_${channelId}`;
  await telegram.sendMessage(ownerId, message, {
    reply_markup: {
      inline_keyboard: [[{
        text: alreadyPublished ? 'Open My Channels' : 'Configure this channel',
        web_app: { url: `${WEBAPP_URL}?startapp=${encodeURIComponent(startApp)}` },
      }]],
    },
  });
}

// /start creates/refreshes the MySubHub user record. It deliberately does not
// create a channel: channel ownership is established by Telegram's membership update.
bot.start(async (ctx) => {
  const from = ctx.from;
  const { data: userRow, error: upsertError } = await supabase
    .from('users')
    .upsert({
      telegram_id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    }, { onConflict: 'telegram_id' })
    .select('telegram_id, referred_by')
    .single();
  if (upsertError) {
    console.error('Could not create/update Telegram user:', upsertError);
    return ctx.reply('MySubHub could not load your account. Please try again shortly.');
  }

  const payload = String(ctx.startPayload || '');
  if (/^ref_[A-Za-z0-9]{8}$/.test(payload) && !userRow.referred_by) {
    const referralCode = payload.slice(4);
    try {
      const { data: referrer, error: referrerError } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('referral_code', referralCode)
        .maybeSingle();
      if (referrerError) throw referrerError;
      if (referrer && Number(referrer.telegram_id) !== Number(from.id)) {
        const { error: attributionError } = await supabase
          .from('users')
          .update({ referred_by: referrer.telegram_id })
          .eq('telegram_id', from.id)
          .is('referred_by', null);
        if (attributionError) throw attributionError;
      }
    } catch (error) {
      console.error('Referral attribution failed:', error);
    }
  }

  let url = WEBAPP_URL;
  let text = `Welcome, ${from.first_name || 'there'}! Open MySubHub to explore and manage your subscriptions.`;
  if (payload === 'owner') {
    url += '?startapp=owner';
    text = 'Open My Channels to manage your Telegram channel listings.';
  } else if (payload === 'admin') {
    url += '?startapp=admin';
    text = 'Open the MySubHub admin panel.';
  } else if (payload.startsWith('ref_')) {
    url += '?startapp=referral';
    text = 'Welcome to MySubHub! Your referral will be credited when eligible.';
  } else if (payload) {
    // Other payloads are channel UUIDs; the Mini App validates them again.
    url += `?startapp=${encodeURIComponent(payload)}`;
    text = 'Open this MySubHub channel listing.';
  }

  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open MySubHub', web_app: { url } }]],
    },
  });
});

// Link a Telegram channel/group to exactly one MySubHub owner when the bot is
// promoted to administrator. We create/update a draft only; pricing and publishing
// happen later in the Mini App against this exact channel UUID.
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  const chat = update?.chat;
  const oldStatus = String(update?.old_chat_member?.status || 'left');
  const newStatus = String(update?.new_chat_member?.status || '');
  const ownerId = Number(update?.from?.id);
  const supportedChat = ['channel', 'group', 'supergroup'].includes(String(chat?.type || ''));
  const wasAlreadyAdmin = ['administrator', 'creator'].includes(oldStatus);

  // Only process the actual promotion. Permission updates on an existing admin
  // must not create duplicate rows or repeatedly send setup DMs.
  if (!supportedChat || newStatus !== 'administrator' || wasAlreadyAdmin ||
      !Number.isSafeInteger(Number(chat?.id)) || !Number.isSafeInteger(ownerId) || ownerId <= 0) return;

  const chatId = Number(chat.id);
  const chatTitle = String(chat.title || 'Untitled channel');

  try {
    // Telegram's `from` identifies the account that performed the promotion.
    // Confirm that this account still has channel admin rights before linking ownership.
    const [actorMember, botIdentity] = await Promise.all([
      ctx.telegram.getChatMember(chatId, ownerId),
      ctx.telegram.getMe(),
    ]);
    if (!isTelegramAdmin(actorMember)) {
      console.warn(`Ignoring bot-admin event: actor ${ownerId} is not an admin of ${chatId}`);
      return;
    }

    const botMember = await ctx.telegram.getChatMember(chatId, botIdentity.id);
    if (!isTelegramAdmin(botMember)) {
      console.warn(`Telegram reported admin promotion but bot membership check failed for ${chatId}`);
      return;
    }
    const missingPermissions = missingBotPermissions(botMember);

    const { data: existing, error: lookupError } = await supabase
      .from('channels')
      .select('id, owner_id, is_active, channel_name, channel_type')
      .eq('channel_chat_id', chatId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let channelId;
    let alreadyPublished = false;

    if (existing) {
      if (existing.owner_id && Number(existing.owner_id) !== ownerId) {
        await ctx.telegram.sendMessage(ownerId,
          `The Telegram channel "${chatTitle}" is already linked to another MySubHub account. Contact the existing channel manager or MySubHub support if you believe this is incorrect.`
        ).catch((error) => console.warn('Could not notify different manager:', error.message));
        return;
      }

      // Claim an unowned historical row using compare-and-set; never steal an owned row.
      let updateQuery = supabase
        .from('channels')
        .update({
          owner_id: ownerId,
          channel_name: chatTitle.slice(0, 100),
          channel_type: chat.type === 'channel' ? 'channel' : 'group',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      updateQuery = existing.owner_id
        ? updateQuery.eq('owner_id', ownerId)
        : updateQuery.is('owner_id', null);
      const { data: updated, error: updateError } = await updateQuery
        .select('id, is_active')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        await ctx.telegram.sendMessage(ownerId,
          `The channel "${chatTitle}" was linked to another MySubHub account at the same time. Refresh My Channels or contact support.`
        ).catch(() => {});
        return;
      }
      channelId = updated.id;
      alreadyPublished = updated.is_active === true;
    } else {
      const { count: ownedChannelCount, error: countError } = await supabase
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId);
      if (countError) throw countError;
      if ((ownedChannelCount || 0) >= MAX_CHANNELS_PER_OWNER) {
        await ctx.telegram.sendMessage(ownerId,
          `MySubHub allows up to ${MAX_CHANNELS_PER_OWNER} channels per account. Deactivate or remove a listing before linking another channel.`
        ).catch(() => {});
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('channels')
        .insert({
          owner_id: ownerId,
          channel_name: chatTitle.slice(0, 100),
          channel_type: chat.type === 'channel' ? 'channel' : 'group',
          channel_chat_id: chatId,
          // Do not create or store a reusable channel-wide invite link here.
          // The Edge Function issues one-person expiring links per paid subscription.
          channel_invite_link: null,
          subscription_price: 0.1,
          duration_days: 30,
          is_active: false,
          is_discoverable: true,
        })
        .select('id, is_active')
        .single();
      if (insertError) throw insertError;
      channelId = inserted.id;
    }

    if (!channelId) throw new Error('Could not resolve the MySubHub channel record ID');

    const warnings = missingPermissions.length
      ? [`The bot is installed, but publishing is blocked until these Telegram administrator permissions are enabled: ${missingPermissions.join(' and ')}. Open Channel Settings → Administrators → @${BOT_USERNAME} and enable them, then return to Configure channel.`]
      : [];

    await sendOwnerMessage(
      ctx.telegram,
      ownerId,
      channelId,
      chatTitle,
      alreadyPublished,
      warnings,
    );
    console.log(`Linked Telegram chat ${chatId} to MySubHub owner ${ownerId} as channel ${channelId}`);
  } catch (error) {
    console.error('Channel auto-link failed:', error);
    await ctx.telegram.sendMessage(ownerId,
      `MySubHub received the administrator update for "${chatTitle}", but could not finish linking it. Keep the bot in the channel and retry by removing and adding it again, or contact support. No subscription or financial records were changed.`
    ).catch(() => {});
  }
});

module.exports = bot;
