# TON Subscription Manager – Telegram Mini App

A complete subscription management system for Telegram channels/groups, powered by TON blockchain payments. 
- **Channel owners** monetize access via TON subscriptions, set pricing, and manage users.
- **Users** subscribe using TON Connect and get automatically invited.
- **Super admin** collects a 1% platform fee and handles reports and withdrawals.

## Features
- Telegram Web App (Mini App) with beautiful Tailwind CSS UI.
- TON Connect wallet integration for payments (no custodial risk).
- Automatic platform fee split (1% to admin, 99% to channel owner).
- Subscription life‑cycle management (purchase, renewal, expiration reminders).
- Review and rating system.
- Reporting and admin ban capabilities.
- Withdrawal request and admin payout flow.
- Fully serverless‑friendly: static frontend on GitHub Pages, Express backend on Render (free), PostgreSQL on Supabase (free).

---

## Prerequisites
- A [Telegram Bot](https://core.telegram.org/bots#6-botfather) (get token from @BotFather).
- [Supabase](https://supabase.com) account (free project).
- [Render](https://render.com) account (or Railway) for backend hosting.
- [GitHub](https://github.com) account for frontend hosting (GitHub Pages).
- A TON wallet (e.g., Tonkeeper) for the platform admin (to receive fees and pay owners). You will need its raw address (e.g., `UQ...`).

---

## Step‑by‑Step Setup

### 1. Database (Supabase)
1. Create a new project on Supabase. Note the `Project URL` and `anon public key` (found in Project Settings > API).
2. Go to SQL Editor and run the entire SQL from `supabase-schema.sql` to create all tables, types, and Row Level Security policies.
3. Keep your `service_role` key (secret) handy – we’ll need it for the backend.

### 2. Telegram Bot
1. Create a bot with [@BotFather](https://t.me/BotFather) and obtain the **token**.
2. Set the bot's menu button (optional) to point to your Mini App URL later.
3. Enable inline mode if you want, but not required.
4. **Important:** Enable the bot to be added to groups/channels. Send `/setjoingroups` to BotFather and enable. Also set `/setprivacy` to **Disabled** so it can see all messages.

### 3. Backend Deployment (Render)
1. Fork/clone this repository.
2. In Render, create a new **Web Service** and connect your repo.
   - Build Command: `npm install` (run inside `/bot` directory)
   - Start Command: `node server.js`
   - Set the root directory to `bot`.
3. Add environment variables in Render (or use a `.env` file – ignore for production):