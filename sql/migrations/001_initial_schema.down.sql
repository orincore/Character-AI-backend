-- Drop triggers first to avoid dependency issues
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS update_characters_updated_at ON characters;
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON chat_sessions;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS search_characters(TEXT);

-- Drop indexes
DROP INDEX IF EXISTS idx_characters_creator_id;
DROP INDEX IF EXISTS idx_characters_visibility;
DROP INDEX IF EXISTS idx_character_shares_user_id;
DROP INDEX IF EXISTS idx_chat_sessions_character_id;
DROP INDEX IF EXISTS idx_chat_sessions_user_id;
DROP INDEX IF EXISTS idx_chat_messages_session_id;

-- Drop tables in reverse order of creation to handle foreign key constraints
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_sessions;
DROP TABLE IF EXISTS character_shares;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS user_profiles;
