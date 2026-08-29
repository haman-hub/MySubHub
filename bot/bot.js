bot.start(async (ctx) => {
  const from = ctx.from;
  await supabase.from('users').upsert({
    telegram_id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username
  }, { onConflict: 'telegram_id' });

  const payload = ctx.startPayload;
  let url = process.env.WEBAPP_URL; // base URL
  let text = `Welcome, ${from.first_name}! Use the button below to open the dashboard.`;

  if (payload) {
    if (payload === 'owner') {
      url += '?startapp=owner';
      text = `Welcome, ${from.first_name}! Manage your channels:`;
    } else if (payload === 'admin') {
      url += '?startapp=admin';
      text = `Admin panel access.`;
    } else {
      url += `?startapp=${payload}`;
      text = `Subscribe to this channel:`;
    }
  }

  // Add debug line
  text += `\n\nDebug URL: ${url}`;

  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open', web_app: { url } }]]
    }
  });
});
