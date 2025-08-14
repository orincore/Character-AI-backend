-- Create user_profiles table if not exists
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  phone TEXT UNIQUE,
  password TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create characters table with personality attributes
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  persona TEXT NOT NULL,
  avatar_url TEXT,
  character_type TEXT NOT NULL CHECK (character_type IN ('girlfriend', 'boyfriend', 'friend', 'therapist', 'other')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shareable')),
  nsfw_enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Personality sliders (0.0 to 1.0)
  flirtiness FLOAT NOT NULL DEFAULT 0.5 CHECK (flirtiness >= 0 AND flirtiness <= 1),
  shyness FLOAT NOT NULL DEFAULT 0.5 CHECK (shyness >= 0 AND shyness <= 1),
  kindness FLOAT NOT NULL DEFAULT 0.7 CHECK (kindness >= 0 AND kindness <= 1),
  rudeness FLOAT NOT NULL DEFAULT 0.3 CHECK (rudeness >= 0 AND rudeness <= 1),
  confidence FLOAT NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1),
  intelligence FLOAT NOT NULL DEFAULT 0.7 CHECK (intelligence >= 0 AND intelligence <= 1),
  empathy FLOAT NOT NULL DEFAULT 0.7 CHECK (empathy >= 0 AND empathy <= 1),
  humor FLOAT NOT NULL DEFAULT 0.5 CHECK (humor >= 0 AND humor <= 1),
  aggression FLOAT NOT NULL DEFAULT 0.2 CHECK (aggression >= 0 AND aggression <= 1),
  openness FLOAT NOT NULL DEFAULT 0.7 CHECK (openness >= 0 AND openness <= 1),
  extroversion FLOAT NOT NULL DEFAULT 0.6 CHECK (extroversion >= 0 AND extroversion <= 1),
  patience FLOAT NOT NULL DEFAULT 0.7 CHECK (patience >= 0 AND patience <= 1),
  
  -- Additional metadata
  tags TEXT[],
  first_message TEXT,
  example_conversations JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create character_shares table for explicit sharing
CREATE TABLE IF NOT EXISTS character_shares (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  can_write BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, user_id)
);

-- Create chat_sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_characters_creator_id ON characters(creator_id);
CREATE INDEX IF NOT EXISTS idx_characters_visibility ON characters(visibility);
CREATE INDEX IF NOT EXISTS idx_character_shares_user_id ON character_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_character_id ON chat_sessions(character_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to update updated_at timestamps
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_characters_updated_at
BEFORE UPDATE ON characters
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_sessions_updated_at
BEFORE UPDATE ON chat_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a function to search characters
CREATE OR REPLACE FUNCTION search_characters(search_term TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  character_type TEXT,
  avatar_url TEXT,
  creator_id UUID,
  visibility TEXT,
  nsfw_enabled BOOLEAN,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.description,
    c.character_type,
    c.avatar_url,
    c.creator_id,
    c.visibility,
    c.nsfw_enabled,
    GREATEST(
      similarity(c.name, search_term),
      similarity(c.description, search_term),
      similarity(c.persona, search_term)
    ) as similarity
  FROM 
    characters c
  WHERE 
    c.name % search_term OR
    c.description % search_term OR
    c.persona % search_term
  ORDER BY 
    similarity DESC;
END;
$$ LANGUAGE plpgsql;
