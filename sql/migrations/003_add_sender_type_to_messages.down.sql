-- Remove sender_type column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'sender_type'
  ) THEN
    ALTER TABLE public.chat_messages
    DROP COLUMN sender_type;
  END IF;
END $$;
