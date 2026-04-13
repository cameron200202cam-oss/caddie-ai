-- ═══════════════════════════════════════════════════
-- CADDIE AI — Supabase Database Setup
-- ═══════════════════════════════════════════════════
-- Go to: supabase.com → your project → SQL Editor
-- Paste ALL of this and click Run
-- ═══════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS TABLE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name                  TEXT NOT NULL,
  email                 TEXT UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  is_pro                BOOLEAN DEFAULT FALSE,
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── QUESTIONS TABLE ──────────────────────────────────
-- Logs every question asked (for free tier counting + analytics)
CREATE TABLE IF NOT EXISTS questions (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  response    TEXT,
  club        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES (makes queries faster) ──────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_questions_user_id ON questions(user_id);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions(created_at);

-- ── ROW LEVEL SECURITY ───────────────────────────────
-- Locks down the DB so users can only see their own data
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- Service key bypasses RLS (your backend uses this)
-- Frontend never touches DB directly

-- ── AUTO UPDATE updated_at ───────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── VERIFY SETUP ─────────────────────────────────────
-- Run this after to confirm tables were created:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
