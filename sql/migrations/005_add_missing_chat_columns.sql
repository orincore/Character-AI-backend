-- Add missing columns to chat_messages table
DO $$
BEGIN
  -- Add sender_type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'sender_type'
  ) THEN
    ALTER TABLE public.chat_messages
    ADD COLUMN sender_type TEXT NOT NULL DEFAULT 'user' CHECK (sender_type IN ('user', 'ai'));
    
    RAISE NOTICE 'Added sender_type column to chat_messages';
  ELSE
    RAISE NOTICE 'sender_type column already exists in chat_messages';
  END IF;

  -- Add sender_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'sender_id'
  ) THEN
    ALTER TABLE public.chat_messages
    ADD COLUMN sender_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
    
    RAISE NOTICE 'Added sender_id column to chat_messages';
  ELSE
    RAISE NOTICE 'sender_id column already exists in chat_messages';
  END IF;

  -- Update existing records to have proper sender_id values
  -- This assumes existing messages are user messages
  UPDATE public.chat_messages
  SET sender_type = 'user'
  WHERE sender_type IS NULL OR sender_type = '';

  -- Set sender_id to session's user_id for existing messages
  UPDATE public.chat_messages cm
  SET sender_id = cs.user_id
  FROM public.chat_sessions cs
  WHERE cm.session_id = cs.id
    AND cm.sender_id = '00000000-0000-0000-0000-000000000000';

END $$;
