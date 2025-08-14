-- Drop triggers first
DROP TRIGGER IF EXISTS update_chat_messages_updated_at ON public.chat_messages;
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON public.chat_sessions;

-- Drop functions
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.create_chat_messages(UUID, UUID, UUID, TEXT, TEXT) CASCADE;

-- Drop tables
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;

-- Drop indexes
DROP INDEX IF EXISTS idx_chat_sessions_user_id;
DROP INDEX IF EXISTS idx_chat_sessions_character_id;
DROP INDEX IF EXISTS idx_chat_messages_session_id;
DROP INDEX IF EXISTS idx_chat_messages_created_at;
