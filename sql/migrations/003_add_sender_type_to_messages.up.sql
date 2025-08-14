-- Add sender_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'sender_type'
  ) THEN
    ALTER TABLE public.chat_messages
    ADD COLUMN sender_type TEXT NOT NULL DEFAULT 'user' CHECK (sender_type IN ('user', 'ai'));
    
    -- Update existing records to have a default sender_type
    UPDATE public.chat_messages
    SET sender_type = 'user'
    WHERE sender_type IS NULL;
  END IF;
END $$;
