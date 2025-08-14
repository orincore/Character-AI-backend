-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
);

-- Create a function that works with anonymous role
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
  v_result JSONB;
  v_columns TEXT;
BEGIN
  -- Get table columns for debugging
  SELECT string_agg(column_name, ', ')
  INTO v_columns
  FROM information_schema.columns 
  WHERE table_schema = 'public' 
    AND table_name = 'chat_messages';

  -- Try to insert with minimal required columns
  BEGIN
    -- First insert user message
    INSERT INTO public.chat_messages (
      session_id,
      content,
      created_at
    ) VALUES (
      p_session_id::uuid,
      'USER: ' || p_user_message,
      NOW()
    )
    RETURNING id INTO v_user_message_id;

    -- Then insert AI response
    INSERT INTO public.chat_messages (
      session_id,
      content,
      created_at
    ) VALUES (
      p_session_id::uuid,
      'AI: ' || p_ai_response,
      NOW()
    )
    RETURNING id INTO v_ai_message_id;

    -- Update session's updated_at if the column exists
    BEGIN
      UPDATE public.chat_sessions
      SET updated_at = NOW()
      WHERE id = p_session_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      -- Ignore errors for this part
      RAISE NOTICE 'Could not update session timestamp: %', SQLERRM;
    END;

    -- Return success response
    v_result := jsonb_build_object(
      'success', true,
      'user_message_id', v_user_message_id,
      'ai_message_id', v_ai_message_id,
      'columns', v_columns
    );
    
  EXCEPTION WHEN OTHERS THEN
    -- Return detailed error information
    v_result := jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'sqlstate', SQLSTATE,
      'schema', current_schema(),
      'columns', v_columns,
      'parameters', jsonb_build_object(
        'p_session_id', p_session_id,
        'p_user_id', p_user_id,
        'p_character_id', p_character_id,
        'p_user_message_length', length(p_user_message),
        'p_ai_response_length', length(p_ai_response)
      )
    );
  END;

  RETURN v_result;
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
