-- Fix chat_messages table and stored procedure to properly handle role column

-- Drop existing function
DROP FUNCTION IF EXISTS public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
);

-- Recreate the function with proper role handling
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
AS $$
DECLARE
  v_user_message_id UUID;
  v_ai_message_id UUID;
  v_session_exists BOOLEAN;
BEGIN
  -- Check if session exists and belongs to user
  SELECT EXISTS(
    SELECT 1 FROM public.chat_sessions 
    WHERE id = p_session_id AND user_id = p_user_id
  ) INTO v_session_exists;
  
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found or access denied'
    );
  END IF;

  -- Insert user message with proper role
  INSERT INTO public.chat_messages (
    session_id,
    content,
    role,
    metadata
  ) VALUES (
    p_session_id,
    p_user_message,
    'user',
    jsonb_build_object('character_id', p_character_id)
  )
  RETURNING id INTO v_user_message_id;

  -- Insert AI response with proper role
  INSERT INTO public.chat_messages (
    session_id,
    content,
    role,
    metadata
  ) VALUES (
    p_session_id,
    p_ai_response,
    'assistant',
    jsonb_build_object('character_id', p_character_id)
  )
  RETURNING id INTO v_ai_message_id;

  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'user_message_id', v_user_message_id,
    'ai_message_id', v_ai_message_id,
    'message', 'Messages saved successfully'
  );
  
EXCEPTION WHEN OTHERS THEN
  -- Return detailed error information
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'detail', 'Error occurred while saving chat messages'
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

-- Grant execute permission to authenticated role
GRANT EXECUTE ON FUNCTION public.create_chat_messages(
  p_session_id UUID,
  p_user_id UUID,
  p_character_id UUID,
  p_user_message TEXT,
  p_ai_response TEXT
) TO authenticated;
