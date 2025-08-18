-- Popularity metrics for characters
-- 1) Add counters and a physical popularity_score column for simple ordering
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS popularity_score DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2) Per-user like registry (prevents double-like)
CREATE TABLE IF NOT EXISTS character_likes (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, user_id)
);

-- 3) Optional event logs for shares and uses (for analytics)
CREATE TABLE IF NOT EXISTS character_share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_use_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_character_likes_character_id ON character_likes(character_id);
CREATE INDEX IF NOT EXISTS idx_character_share_events_character_id ON character_share_events(character_id);
CREATE INDEX IF NOT EXISTS idx_character_use_events_character_id ON character_use_events(character_id);
