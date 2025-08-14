-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
);

-- Create a minimal function with hardcoded values for testing
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
AS $$
DECLARE
  v_user_message_id UUID;
  v_ai_message_id UUID;
BEGIN
  -- First, let's just try to insert into the table with minimal columns
  INSERT INTO public.chat_messages (
    session_id,
    content
  ) VALUES (
    p_session_id,
    'TEST USER MESSAGE: ' || p_user_message
  )
  RETURNING id INTO v_user_message_id;

  -- Insert AI response
  INSERT INTO public.chat_messages (
    session_id,
    content
  ) VALUES (
    p_session_id,
    'TEST AI RESPONSE: ' || p_ai_response
  )
  RETURNING id INTO v_ai_message_id;

  -- Update session's updated_at if the column exists
  BEGIN
    UPDATE public.chat_sessions
    SET updated_at = NOW()
    WHERE id = p_session_id;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore errors for this part
  END;

  -- Return the message IDs
  RETURN QUERY
  SELECT v_user_message_id, v_ai_message_id;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Include the column information in the error
    DECLARE
      v_columns TEXT;
    BEGIN
      SELECT string_agg(column_name, ', ')
      INTO v_columns
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'chat_messages';
        
      RAISE EXCEPTION 'Error in create_chat_messages: % (Table columns: %)', SQLERRM, v_columns;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Error in create_chat_messages: % (Failed to get column info: %)', SQLERRM, SQLERRM;
    END;
END;
$$;
