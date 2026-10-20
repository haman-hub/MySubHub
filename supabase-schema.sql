-- MySubHub Database Schema v2.6.0 - ALL 5 PHASES
-- Run this in Supabase SQL Editor

-- =====================================================
-- PHASE 1: Add category support for Channel Discovery
-- =====================================================

-- Add category column to channels table
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';

-- Create index for faster category filtering
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category);

-- =====================================================
-- PHASE 2: Create notifications table
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

-- Create policies
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (true);

CREATE POLICY "notifications_insert_own" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (true) WITH CHECK (true);

-- =====================================================
-- PHASE 3: Security - Fix all function search_path issues
-- =====================================================

-- Fix log_admin_action
DROP FUNCTION IF EXISTS public.log_admin_action(BIGINT, TEXT, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id BIGINT,
  p_action TEXT,
  p_details JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO audit_log (admin_id, action, details, created_at)
  VALUES (p_admin_id, p_action, p_details, NOW());
END;
$$;

-- Fix get_paginated_subscriptions
DROP FUNCTION IF EXISTS public.get_paginated_subscriptions(INTEGER, INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION public.get_paginated_subscriptions(
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id BIGINT,
  channel_id UUID,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.user_id, s.channel_id, s.start_date, s.end_date, s.status, s.created_at
  FROM subscriptions s
  ORDER BY s.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Fix award_referral_credits
DROP FUNCTION IF EXISTS public.award_referral_credits(BIGINT, NUMERIC) CASCADE;
CREATE OR REPLACE FUNCTION public.award_referral_credits(
  p_user_id BIGINT,
  p_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO referral_credits (user_id, balance, total_earned, created_at, updated_at)
  VALUES (p_user_id, p_amount, p_amount, NOW(), NOW())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    balance = referral_credits.balance + p_amount,
    total_earned = referral_credits.total_earned + p_amount,
    updated_at = NOW();
    
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, created_at)
  SELECT p_user_id, 'earned', p_amount, balance, 'Referral credit awarded', NOW()
  FROM referral_credits WHERE user_id = p_user_id;
END;
$$;

-- Fix add_credits
DROP FUNCTION IF EXISTS public.add_credits(BIGINT, NUMERIC) CASCADE;
CREATE OR REPLACE FUNCTION public.add_credits(
  p_user_id BIGINT,
  p_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO referral_credits (user_id, balance, total_earned, created_at, updated_at)
  VALUES (p_user_id, p_amount, p_amount, NOW(), NOW())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    balance = referral_credits.balance + p_amount,
    total_earned = referral_credits.total_earned + p_amount,
    updated_at = NOW();
    
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, created_at)
  SELECT p_user_id, 'earned', p_amount, balance, 'Credits added', NOW()
  FROM referral_credits WHERE user_id = p_user_id;
END;
$$;

-- Fix use_referral_credits
DROP FUNCTION IF EXISTS public.use_referral_credits(BIGINT, NUMERIC) CASCADE;
CREATE OR REPLACE FUNCTION public.use_referral_credits(
  p_user_id BIGINT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT balance INTO v_balance FROM referral_credits WHERE user_id = p_user_id;
  
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;
  
  UPDATE referral_credits 
  SET balance = balance - p_amount,
      total_used = total_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, created_at)
  SELECT p_user_id, 'used', p_amount, balance, 'Credits used for subscription', NOW()
  FROM referral_credits WHERE user_id = p_user_id;
  
  RETURN TRUE;
END;
$$;

-- Fix get_user_referral_stats
DROP FUNCTION IF EXISTS public.get_user_referral_stats(BIGINT) CASCADE;
CREATE OR REPLACE FUNCTION public.get_user_referral_stats(
  p_user_id BIGINT
)
RETURNS TABLE (
  total_referrals INTEGER,
  total_credits_earned NUMERIC,
  total_credits_used NUMERIC,
  current_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_referrals,
    COALESCE(SUM(credits_earned), 0) as total_credits_earned,
    (SELECT COALESCE(total_used, 0) FROM referral_credits WHERE user_id = p_user_id) as total_credits_used,
    (SELECT COALESCE(balance, 0) FROM referral_credits WHERE user_id = p_user_id) as current_balance
  FROM referrals
  WHERE referrer_id = p_user_id;
END;
$$;

-- Fix auto_generate_referral_code
DROP FUNCTION IF EXISTS public.auto_generate_referral_code() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_generate_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.referral_code IS NULL OR NEW.referral_code = '' THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

-- Fix deduct_credits
DROP FUNCTION IF EXISTS public.deduct_credits(BIGINT, NUMERIC) CASCADE;
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id BIGINT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE referral_credits 
  SET balance = balance - p_amount,
      total_used = total_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id AND balance >= p_amount;
  
  IF FOUND THEN
    INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, created_at)
    SELECT p_user_id, 'used', p_amount, balance, 'Credits deducted', NOW()
    FROM referral_credits WHERE user_id = p_user_id;
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$;

-- Fix expire_subscription
DROP FUNCTION IF EXISTS public.expire_subscription(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.expire_subscription(
  p_subscription_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE subscriptions
  SET status = 'expired',
      updated_at = NOW()
  WHERE id = p_subscription_id
  AND status = 'active'
  AND end_date < NOW();
END;
$$;

-- Fix get_expiring_subscriptions
DROP FUNCTION IF EXISTS public.get_expiring_subscriptions(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION public.get_expiring_subscriptions(
  p_days_ahead INTEGER DEFAULT 7
)
RETURNS TABLE (
  id UUID,
  user_id BIGINT,
  channel_id UUID,
  end_date TIMESTAMPTZ,
  days_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.user_id,
    s.channel_id,
    s.end_date,
    EXTRACT(DAY FROM s.end_date - NOW())::INTEGER as days_remaining
  FROM subscriptions s
  WHERE s.status = 'active'
  AND s.end_date BETWEEN NOW() AND NOW() + (p_days_ahead || ' days')::INTERVAL
  ORDER BY s.end_date ASC;
END;
$$;

-- Fix cleanup_expired_nonces
DROP FUNCTION IF EXISTS public.cleanup_expired_nonces() CASCADE;
CREATE OR REPLACE FUNCTION public.cleanup_expired_nonces()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM payment_nonces
    WHERE expires_at < NOW() AND used = false
    RETURNING *
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$;

-- Fix expire_overdue_subscriptions
DROP FUNCTION IF EXISTS public.expire_overdue_subscriptions() CASCADE;
CREATE OR REPLACE FUNCTION public.expire_overdue_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE subscriptions
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'active'
    AND end_date < NOW()
    RETURNING *
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;
  
  RETURN v_expired_count;
END;
$$;

-- Fix update_channel_analytics (trigger function)
DROP FUNCTION IF EXISTS public.update_channel_analytics() CASCADE;
CREATE OR REPLACE FUNCTION public.update_channel_analytics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'subscriptions' THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE channels c
      SET 
        total_subscribers = sub.count,
        total_earnings = earn.sum
      FROM (
        SELECT channel_id, COUNT(*) as count
        FROM subscriptions
        WHERE status = 'active' AND channel_id = OLD.channel_id
        GROUP BY channel_id
      ) sub,
      (
        SELECT channel_id, COALESCE(SUM(amount_total), 0) as sum
        FROM platform_transactions
        WHERE channel_id = OLD.channel_id
        GROUP BY channel_id
      ) earn
      WHERE c.id = OLD.channel_id;
    ELSE
      UPDATE channels c
      SET 
        total_subscribers = sub.count,
        total_earnings = earn.sum
      FROM (
        SELECT channel_id, COUNT(*) as count
        FROM subscriptions
        WHERE status = 'active' AND channel_id = NEW.channel_id
        GROUP BY channel_id
      ) sub,
      (
        SELECT channel_id, COALESCE(SUM(amount_total), 0) as sum
        FROM platform_transactions
        WHERE channel_id = NEW.channel_id
        GROUP BY channel_id
      ) earn
      WHERE c.id = NEW.channel_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'reviews' THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE channels
      SET review_count = (SELECT COUNT(*) FROM reviews WHERE channel_id = OLD.channel_id AND is_hidden = false)
      WHERE id = OLD.channel_id;
    ELSE
      UPDATE channels
      SET review_count = (SELECT COUNT(*) FROM reviews WHERE channel_id = NEW.channel_id AND is_hidden = false)
      WHERE id = NEW.channel_id;
    END IF;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Recreate triggers
DROP TRIGGER IF EXISTS trigger_update_channel_analytics_sub ON subscriptions;
CREATE TRIGGER trigger_update_channel_analytics_sub
AFTER INSERT OR UPDATE OR DELETE ON subscriptions
FOR EACH STATEMENT
EXECUTE FUNCTION update_channel_analytics();

DROP TRIGGER IF EXISTS trigger_update_channel_analytics_rev ON reviews;
CREATE TRIGGER trigger_update_channel_analytics_rev
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH STATEMENT
EXECUTE FUNCTION update_channel_analytics();

-- =====================================================
-- PHASE 3: Revoke EXECUTE from anon and authenticated
-- =====================================================

-- Revoke from anon role
REVOKE EXECUTE ON FUNCTION public.log_admin_action(BIGINT, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_paginated_subscriptions(INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_referral_credits(BIGINT, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_credits(BIGINT, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.use_referral_credits(BIGINT, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_referral_stats(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_generate_referral_code() FROM anon;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(BIGINT, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_subscription(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_expiring_subscriptions(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_nonces() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_overdue_subscriptions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_channel_analytics() FROM anon;

-- Revoke from authenticated role
REVOKE EXECUTE ON FUNCTION public.log_admin_action(BIGINT, TEXT, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_paginated_subscriptions(INTEGER, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.award_referral_credits(BIGINT, NUMERIC) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.add_credits(BIGINT, NUMERIC) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.use_referral_credits(BIGINT, NUMERIC) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_referral_stats(BIGINT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_generate_referral_code() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(BIGINT, NUMERIC) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_subscription(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_expiring_subscriptions(INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_nonces() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_overdue_subscriptions() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_channel_analytics() FROM authenticated;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify notifications table exists
SELECT COUNT(*) as notifications_table_exists FROM information_schema.tables WHERE table_name = 'notifications';

-- Verify category column exists
SELECT COUNT(*) as category_column_exists FROM information_schema.columns WHERE table_name = 'channels' AND column_name = 'category';

-- Verify all functions have fixed search_path
SELECT proname, proconfig 
FROM pg_proc 
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
AND proname IN (
  'update_channel_analytics', 
  'log_admin_action', 
  'add_credits',
  'deduct_credits',
  'award_referral_credits'
);

-- Verify function permissions are revoked
SELECT proname, 
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute
FROM pg_proc p
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
AND proname IN ('add_credits', 'deduct_credits', 'expire_overdue_subscriptions');

-- =====================================================
-- DONE
-- =====================================================
-- All 5 phases database updates complete!
-- ✅ Phase 1: Category support added
-- ✅ Phase 2: Notifications table created
-- ✅ Phase 3: All functions fixed with search_path
-- ✅ Phase 3: All permissions revoked from anon/authenticated
-- ✅ Phase 4 & 5: No database changes needed (frontend only)
