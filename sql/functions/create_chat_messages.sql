-- Function to create both user and AI messages in a single transaction
CREATE OR REPLACE FUNCTION public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
)
RETURNS TABLE(
  user_message_id UUID,
  ai_message_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_message_id UUID;
  v_ai_message_id UUID;
BEGIN
  -- Insert user message
  INSERT INTO public.chat_messages (
    session_id,
    content,
    sender_type,
    sender_id,
    created_at
  ) VALUES (
    p_session_id,
    p_user_message,
    'user',
    p_user_id,
    NOW()
  )
  RETURNING id INTO v_user_message_id;

  -- Insert AI response
  INSERT INTO public.chat_messages (
    session_id,
    content,
    sender_type,
    sender_id,
    created_at
  ) VALUES (
    p_session_id,
    p_ai_response,
    'ai',
    p_character_id,
    NOW()
  )
  RETURNING id INTO v_ai_message_id;

  -- Update session's updated_at
  UPDATE public.chat_sessions
  SET updated_at = NOW()
  WHERE id = p_session_id;

  -- Return both message IDs
  RETURN QUERY
  SELECT v_user_message_id, v_ai_message_id;
END;
$$;
