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

  return ctx.reply(`Welcome, ${from.first_name}! Use the button below to open the subscription dashboard.`, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Dashboard', web_app: { url: process.env.WEBAPP_URL } }]]
    }
  });
});

// When bot is added to a channel/group as admin
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  if (update.new_chat_member.status === 'administrator' && update.chat.type !== 'private') {
    const chat = update.chat;
    const ownerId = ctx.from.id; // The user who added the bot (should be owner)

    // Generate a permanent invite link (requires admin rights)
    let inviteLink = '';
    try {
      const link = await ctx.telegram.createChatInviteLink(chat.id, { member_limit: 0 });
      inviteLink = link.invite_link;
    } catch (e) {
      console.error('Could not create invite link:', e);
      // fallback: try exportChatInviteLink
      try {
        inviteLink = await ctx.telegram.exportChatInviteLink(chat.id);
      } catch (_) {
        inviteLink = 'No link available';
      }
    }

    // Save channel to DB
    const { data, error } = await supabase.from('channels').upsert({
      channel_chat_id: chat.id,
      owner_id: ownerId,
      channel_name: chat.title,
      channel_invite_link: inviteLink,
      is_active: false,   // not yet configured
    }, { onConflict: 'channel_chat_id' });

    if (error) console.error('Error saving channel:', error);

    // Notify the owner with a link to configure pricing
    ctx.telegram.sendMessage(ownerId, 
      `✅ Bot added to "${chat.title}".\nNow set your subscription price and duration using the dashboard.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Configure Channel', web_app: { url: `${process.env.WEBAPP_URL}?start=owner` } }]]
        }
      }
    );
  }
});

// Handle deep-linking (when user opens bot via t.me/YourBot?start=uuid)
// This gets passed to the Mini App as start_param; we just ignore here
bot.on('message', async (ctx) => {
  // Could be used for other commands, ignore
});

module.exports = bot;