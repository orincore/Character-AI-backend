-- Drop existing table if it exists
DROP TABLE IF EXISTS public.chat_messages CASCADE;

-- Recreate the table with a minimal structure
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at);

-- Add comments
COMMENT ON TABLE public.chat_messages IS 'Stores chat messages between users and AI';
COMMENT ON COLUMN public.chat_messages.session_id IS 'Reference to the chat session';
COMMENT ON COLUMN public.chat_messages.content IS 'The message content';

-- Grant permissions
GRANT ALL ON public.chat_messages TO anon, authenticated, service_role;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_chat_messages_updated_at
BEFORE UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Drop and recreate the function to match the new table structure
DROP FUNCTION IF EXISTS public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
);

CREATE OR REPLACE FUNCTION public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_message_id UUID;
  v_ai_message_id UUID;
BEGIN
  -- Insert user message
  INSERT INTO public.chat_messages (
    session_id,
    content
  ) VALUES (
    p_session_id,
    'USER: ' || p_user_message
  )
  RETURNING id INTO v_user_message_id;

  -- Insert AI response
  INSERT INTO public.chat_messages (
    session_id,
    content
  ) VALUES (
    p_session_id,
    'AI: ' || p_ai_response
  )
  RETURNING id INTO v_ai_message_id;

  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'user_message_id', v_user_message_id,
    'ai_message_id', v_ai_message_id
  );
  
EXCEPTION WHEN OTHERS THEN
  -- Return error information
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

-- Grant execute permission to anonymous role
GRANT EXECUTE ON FUNCTION public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
) TO anon;
