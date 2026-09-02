// bot/bot.js
const { Telegraf } = require('telegraf');
const supabase = require('./utils/supabase');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Handle /start
bot.start(async (ctx) => {
  const from = ctx.from;
  // Upsert user
  await supabase.from('users').upsert({
    telegram_id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username
  }, { onConflict: 'telegram_id' });

  const payload = ctx.startPayload; // e.g., "9d288842-..." or "owner" or "admin"
  let url = process.env.WEBAPP_URL; // base URL without query
  let text = `Welcome, ${from.first_name}! Use the button below to open the subscription dashboard.`;

  if (payload) {
    if (payload === 'owner') {
      url += '?startapp=owner';
      text = `Welcome, ${from.first_name}! Use the button below to manage your channels.`;
    } else if (payload === 'admin') {
      url += '?startapp=admin';
      text = `Admin panel access.`;
    } else {
      // Assume it's a channel UUID
      url += `?startapp=${payload}`;
      text = `Subscribe to this channel:`;
    }
  }

  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open', web_app: { url } }]]
    }
  });
});

// When bot is added to a channel/group as admin
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  if (update.new_chat_member.status === 'administrator' && update.chat.type !== 'private') {
    const chat = update.chat;
    const ownerId = ctx.from.id;

    let inviteLink = '';
    try {
      const link = await ctx.telegram.createChatInviteLink(chat.id, { member_limit: 0 });
      inviteLink = link.invite_link;
    } catch (e) {
      console.error('Could not create invite link:', e);
      try {
        inviteLink = await ctx.telegram.exportChatInviteLink(chat.id);
      } catch (_) {
        inviteLink = 'No link available';
      }
    }

    const { data, error } = await supabase.from('channels').upsert({
      channel_chat_id: chat.id,
      owner_id: ownerId,
      channel_name: chat.title,
      channel_invite_link: inviteLink,
      is_active: false,
    }, { onConflict: 'channel_chat_id' });

    if (error) console.error('Error saving channel:', error);

    ctx.telegram.sendMessage(ownerId,
      `✅ Bot added to "${chat.title}".\nNow set your subscription price and duration using the dashboard.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Configure Channel', web_app: { url: `${process.env.WEBAPP_URL}?startapp=owner` } }]]
        }
      }
    );
  }
});

module.exports = bot;
