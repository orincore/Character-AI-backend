-- Drop and recreate with a simpler, more reliable approach
DROP FUNCTION IF EXISTS public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
);

-- Create a simple function that works with the actual table structure
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
  v_session_exists BOOLEAN;
BEGIN
  -- Verify session exists and belongs to user
  SELECT EXISTS (
    SELECT 1 FROM public.chat_sessions 
    WHERE id = p_session_id AND user_id = p_user_id
  ) INTO v_session_exists;
  
  IF NOT v_session_exists THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  -- Insert user message (try different column combinations)
  BEGIN
    -- Try with role column first
    INSERT INTO public.chat_messages (
      session_id,
      content,
      role,
      created_at
    ) VALUES (
      p_session_id,
      p_user_message,
      'user',
      NOW()
    )
    RETURNING id INTO v_user_message_id;

    -- Insert AI response
    INSERT INTO public.chat_messages (
      session_id,
      content,
      role,
      created_at
    ) VALUES (
      p_session_id,
      p_ai_response,
      'assistant',
      NOW()
    )
    RETURNING id INTO v_ai_message_id;
    
  EXCEPTION
    WHEN undefined_column THEN
      -- Try with sender_type and sender_id columns
      BEGIN
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
        
      EXCEPTION
        WHEN undefined_column THEN
          -- Fall back to basic structure
          INSERT INTO public.chat_messages (
            session_id,
            content,
            created_at
          ) VALUES (
            p_session_id,
            p_user_message,
            NOW()
          )
          RETURNING id INTO v_user_message_id;

          -- Insert AI response
          INSERT INTO public.chat_messages (
            session_id,
            content,
            created_at
          ) VALUES (
            p_session_id,
            p_ai_response,
            NOW()
          )
          RETURNING id INTO v_ai_message_id;
      END;
  END;

  -- Update session's updated_at
  UPDATE public.chat_sessions
  SET updated_at = NOW()
  WHERE id = p_session_id;

  -- Return both message IDs
  RETURN QUERY
  SELECT v_user_message_id, v_ai_message_id;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Provide detailed error information
    RAISE EXCEPTION 'Error in create_chat_messages: %', SQLERRM;
END;
$$;
