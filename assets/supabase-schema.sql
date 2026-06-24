-- Phrase Learner — Supabase Schema
-- Run this in your Supabase project's SQL Editor (sql.new)

-- 1. Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    streak_days INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    last_study_date DATE
);

-- 2. Phrase progress (one row per user per phrase)
CREATE TABLE IF NOT EXISTS phrase_progress (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    phrase_id        INTEGER NOT NULL,
    remember_count   INTEGER DEFAULT 0,
    learn_state      INTEGER DEFAULT 0,   -- 0=new, 1=learning, 2=mastered
    next_review      DATE,
    last_reviewed    DATE,
    consecutive_wrong INTEGER DEFAULT 0,
    mastery_score    REAL DEFAULT 50.0,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, phrase_id)
);

-- 3. Daily stats
CREATE TABLE IF NOT EXISTS daily_stats (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    date         DATE NOT NULL,
    points       INTEGER DEFAULT 0,
    reviewed     INTEGER DEFAULT 0,
    correct      INTEGER DEFAULT 0,
    wrong        INTEGER DEFAULT 0,
    new_learned  INTEGER DEFAULT 0,

    UNIQUE(user_id, date)
);

-- Row-level security: users can only see their own data
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE phrase_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own
CREATE POLICY "profiles_self" ON profiles
    FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Progress: users CRUD their own
CREATE POLICY "progress_self" ON phrase_progress
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Stats: users CRUD their own
CREATE POLICY "stats_self" ON daily_stats
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, created_at)
    VALUES (NEW.id, NEW.email, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
