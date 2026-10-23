-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.users (
  telegram_id bigint NOT NULL,
  first_name text,
  last_name text,
  username text,
  wallet_address text,
  role text DEFAULT 'user'::text CHECK (role = ANY (ARRAY['user'::text, 'owner'::text, 'admin'::text])),
  created_at timestamp with time zone DEFAULT now(),
  language_code text,
  is_banned boolean DEFAULT false,
  ban_reason text,
  referral_code text UNIQUE,
  referred_by bigint,
  banned_at timestamp with time zone,
  banned_reason text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (telegram_id)
);
CREATE TABLE public.channels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id bigint,
  channel_name text NOT NULL,
  channel_chat_id bigint,
  channel_invite_link text,
  subscription_price numeric NOT NULL CHECK (subscription_price > 0::numeric),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  is_active boolean DEFAULT true,
  auto_renewal_reminders boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  avg_rating numeric DEFAULT 0,
  total_reviews integer DEFAULT 0,
  total_subscribers integer DEFAULT 0,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  verification_notes text,
  channel_type text DEFAULT 'channel'::text CHECK (channel_type = ANY (ARRAY['channel'::text, 'group'::text])),
  auto_post_enabled boolean DEFAULT false,
  auto_post_template text,
  last_posted_at timestamp with time zone,
  description text,
  total_earnings numeric DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  category text DEFAULT 'other'::text,
  CONSTRAINT channels_pkey PRIMARY KEY (id),
  CONSTRAINT channels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint,
  channel_id uuid,
  start_date timestamp with time zone DEFAULT now(),
  end_date timestamp with time zone NOT NULL,
  transaction_hash text,
  amount numeric,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text])),
  auto_renew boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  reminder_count integer DEFAULT 0,
  renewed_from uuid,
  credits_used numeric DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id),
  CONSTRAINT subscriptions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id),
  CONSTRAINT subscriptions_renewed_from_fkey FOREIGN KEY (renewed_from) REFERENCES public.subscriptions(id)
);
CREATE TABLE public.platform_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid,
  user_id bigint,
  channel_id uuid,
  channel_owner_id bigint,
  amount_total numeric,
  owner_share numeric,
  platform_fee numeric,
  transaction_hash text,
  owner_paid_out boolean DEFAULT false,
  paid_out_tx_hash text,
  created_at timestamp with time zone DEFAULT now(),
  network_fee numeric DEFAULT 0,
  withdrawal_id uuid,
  CONSTRAINT platform_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT platform_transactions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id),
  CONSTRAINT platform_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id),
  CONSTRAINT platform_transactions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id),
  CONSTRAINT platform_transactions_channel_owner_id_fkey FOREIGN KEY (channel_owner_id) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.withdrawals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel_owner_id bigint,
  amount numeric NOT NULL,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'processed'::text])),
  request_date timestamp with time zone DEFAULT now(),
  processed_date timestamp with time zone,
  payout_tx_hash text,
  admin_notes text,
  rejection_reason text,
  processed_by bigint,
  wallet_address text,
  CONSTRAINT withdrawals_pkey PRIMARY KEY (id),
  CONSTRAINT withdrawals_channel_owner_id_fkey FOREIGN KEY (channel_owner_id) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id bigint,
  reported_channel_id uuid,
  reason text NOT NULL,
  description text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text, 'banned'::text, 'resolved'::text])),
  reviewed_by bigint,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  admin_notes text,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(telegram_id),
  CONSTRAINT reports_reported_channel_id_fkey FOREIGN KEY (reported_channel_id) REFERENCES public.channels(id),
  CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint,
  channel_id uuid,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone DEFAULT now(),
  is_hidden boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id),
  CONSTRAINT reviews_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id)
);
CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id bigint NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL UNIQUE,
  theme text DEFAULT 'dark'::text CHECK (theme = ANY (ARRAY['dark'::text, 'light'::text, 'system'::text])),
  tutorial_completed boolean DEFAULT false,
  notifications_enabled boolean DEFAULT true,
  language text DEFAULT 'en'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_preferences_pkey PRIMARY KEY (id)
);
CREATE TABLE public.verification_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL,
  owner_id bigint NOT NULL,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  evidence text,
  admin_notes text,
  reviewed_by bigint,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT verification_requests_pkey PRIMARY KEY (id),
  CONSTRAINT verification_requests_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id)
);
CREATE TABLE public.referrals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  referrer_id bigint NOT NULL,
  referred_id bigint NOT NULL,
  subscription_id uuid,
  subscription_amount numeric NOT NULL,
  credits_earned numeric NOT NULL,
  status text DEFAULT 'completed'::text CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT referrals_pkey PRIMARY KEY (id),
  CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(telegram_id),
  CONSTRAINT referrals_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES public.users(telegram_id),
  CONSTRAINT referrals_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id)
);
CREATE TABLE public.referral_credits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  total_used numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT referral_credits_pkey PRIMARY KEY (id),
  CONSTRAINT referral_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.credit_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['earned'::text, 'used'::text, 'expired'::text])),
  amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  description text,
  reference_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT credit_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id)
);
CREATE TABLE public.withdrawal_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  withdrawal_id uuid,
  platform_transaction_id uuid,
  amount numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT withdrawal_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT withdrawal_transactions_withdrawal_id_fkey FOREIGN KEY (withdrawal_id) REFERENCES public.withdrawals(id),
  CONSTRAINT withdrawal_transactions_platform_transaction_id_fkey FOREIGN KEY (platform_transaction_id) REFERENCES public.platform_transactions(id)
);
CREATE TABLE public.payment_nonces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint,
  channel_id uuid,
  nonce text NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payment_nonces_pkey PRIMARY KEY (id),
  CONSTRAINT payment_nonces_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(telegram_id),
  CONSTRAINT payment_nonces_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
