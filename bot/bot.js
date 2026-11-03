// bot/bot.js
const { Telegraf } = require('telegraf');
const supabase = require('./utils/supabase');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Handle /start and record first-touch referral attribution.
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
    .select('telegram_id')
    .single();
  if (upsertError) {
    console.error('Could not create/update Telegram user:', upsertError);
    return ctx.reply('MySubHub could not load your account. Please try again shortly.');
  }

  const payload = String(ctx.startPayload || '');
  let referralRecorded = false;
  if (/^ref_[A-Za-z0-9]{8}$/.test(payload)) {
    try {
      const { data, error } = await supabase.rpc('set_referral_attribution', {
        p_referred_user_id: from.id,
        p_referral_code: payload.slice(4),
      });
      if (error) throw error;
      referralRecorded = data === true;
      if (!referralRecorded) {
        console.info(`Referral link was not applied for Telegram user ${from.id}; existing attribution or eligibility rules may apply.`);
      }
    } catch (error) {
      console.error('Referral attribution RPC failed:', error);
    }
  }

  let url = process.env.WEBAPP_URL; // base URL without query
  let text = `Welcome, ${from.first_name}! Use the button below to open the subscription dashboard.`;

  if (payload === 'owner') {
    url += '?startapp=owner';
    text = `Welcome, ${from.first_name}! Use the button below to manage your channels.`;
  } else if (payload === 'admin') {
    url += '?startapp=admin';
    text = 'Admin panel access.';
  } else if (payload.startsWith('ref_')) {
    url += '?startapp=referral';
    text = referralRecorded
      ? 'Welcome to MySubHub! Your referral attribution has been recorded.'
      : 'Welcome to MySubHub! Referral rewards apply only when the link is valid and your account is eligible. Existing referral attribution cannot be replaced.';
  } else if (payload) {
    // Assume any other payload is a channel UUID; the app validates it again.
    url += `?startapp=${encodeURIComponent(payload)}`;
    text = 'Subscribe to this channel:';
  }

  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open', web_app: { url } }]],
    },
  });
});

// When bot is added to a channel/group as administrator.
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  const chat = update.chat;
  const newStatus = update.new_chat_member?.status;
  const ownerId = update.from?.id;
  if (newStatus !== 'administrator' || !['channel', 'group', 'supergroup'].includes(chat.type)) return;
  if (!ownerId) return;

  try {
    let inviteLink = '';
    try {
      const created = await ctx.telegram.createChatInviteLink(chat.id);
      inviteLink = created.invite_link;
    } catch (error) {
      console.warn('Could not create a managed invite link:', error.message);
    }

    const { data: existing, error: lookupError } = await supabase
      .from('channels')
      .select('id, owner_id, subscription_price, duration_days, is_active')
      .eq('channel_chat_id', chat.id)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let channelId;
    if (existing) {
      if (existing.owner_id && Number(existing.owner_id) !== Number(ownerId)) {
        if (inviteLink) {
          await ctx.telegram.revokeChatInviteLink(chat.id, inviteLink).catch(() => {});
        }
        await ctx.telegram.sendMessage(ownerId,
          `MySubHub is already registered to another manager for "${chat.title}". Contact the existing channel owner or platform support.`
        ).catch(() => {});
        await ctx.telegram.leaveChat(chat.id).catch(() => {});
        return;
      }
      const updates = {
        owner_id: ownerId,
        channel_name: chat.title || 'Unknown',
        channel_type: chat.type === 'channel' ? 'channel' : 'group',
        ...(inviteLink ? { channel_invite_link: inviteLink } : {}),
      };
      // Compare-and-set ownership: an unclaimed row can be claimed once, while
      // a row already owned by this manager can be refreshed. This prevents two
      // concurrent add-admin updates from transferring an unclaimed row.
      let updateQuery = supabase
        .from('channels')
        .update(updates)
        .eq('id', existing.id);
      updateQuery = existing.owner_id
        ? updateQuery.eq('owner_id', ownerId)
        : updateQuery.is('owner_id', null);
      const { data: updatedChannel, error: updateError } = await updateQuery
        .select('id')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedChannel) {
        if (inviteLink) {
          await ctx.telegram.revokeChatInviteLink(chat.id, inviteLink).catch(() => {});
        }
        await ctx.telegram.sendMessage(ownerId,
          `The channel "${chat.title || 'this channel'}" was registered by another manager. Contact platform support if you believe this is an error.`
        ).catch(() => {});
        await ctx.telegram.leaveChat(chat.id).catch(() => {});
        return;
      }
      channelId = existing.id;
    } else {
      const { count: ownedChannelCount, error: countError } = await supabase
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId);
      if (countError) throw countError;
      if ((ownedChannelCount || 0) >= 5) {
        if (inviteLink) {
          await ctx.telegram.revokeChatInviteLink(chat.id, inviteLink).catch(() => {});
        }
        await ctx.telegram.sendMessage(
          ownerId,
          'Your MySubHub account already manages five channels. Remove the bot from this chat or contact platform support before adding another channel.'
        ).catch(() => {});
        await ctx.telegram.leaveChat(chat.id).catch(() => {});
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('channels')
        .insert({
          owner_id: ownerId,
          channel_name: chat.title || 'Unknown',
          channel_type: chat.type === 'channel' ? 'channel' : 'group',
          channel_chat_id: chat.id,
          channel_invite_link: inviteLink || null,
          subscription_price: 0.1,
          duration_days: 30,
          is_active: false,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      channelId = inserted.id;
    }

    const shareLink = `https://t.me/${process.env.BOT_USERNAME || 'MySubsHub_bot'}?start=${channelId}`;
    const message = [
      `MySubHub was added to "${chat.title || 'your channel'}".`,
      inviteLink ? `Managed invite link (for owner setup): ${inviteLink}` : 'The bot could not create an invite link. Check its administrator permissions.',
      'Open the dashboard to set your subscription price and duration. The channel stays inactive until configured.',
      `Subscription link: ${shareLink}`,
    ].join('\n\n');
    await ctx.telegram.sendMessage(ownerId, message, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Configure channel', web_app: { url: `${process.env.WEBAPP_URL}?startapp=owner` } }]],
      },
    }).catch((error) => console.warn('Could not DM channel manager (they may need to start the bot):', error.message));
  } catch (error) {
    console.error('Channel registration event failed:', error);
  }
});

module.exports = bot;
