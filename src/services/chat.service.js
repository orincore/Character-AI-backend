import { chatCompletion } from '../config/together.js';
import supabase from '../config/supabaseClient.js';
import { humanizeResponse } from '../utils/humanizeResponses.js';
import { prompts, getPersonalityDescription } from '../config/prompts.js';
import { enqueueRequest } from '../utils/requestQueue.js';
import { RateLimitError } from '../middleware/errorHandler.js';

/**
 * Builds the system prompt for the AI based on character settings
 */
function buildSystemPrompt(character) {
  const { name, description, personality_traits = {}, nsfw_enabled } = character;
  
  // Get personality description from centralized prompts
  const personalityDesc = getPersonalityDescription(personality_traits);
  
  // Get appropriate content guidelines based on NSFW setting
  const contentGuidelines = nsfw_enabled 
    ? prompts.contentGuidelines.nsfw 
    : prompts.contentGuidelines.sfw;
  
  // Build the complete system prompt using the template
  return prompts.character.base(
    name,
    description,
    personalityDesc,
    contentGuidelines
  );
}

/**
 * Gets chat history for a session
 */
async function getChatHistory(sessionId, limit = 10) {
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }

  // Format messages for the AI
  return messages.reverse().map(msg => ({
    role: msg.sender_type === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));
}

/**
 * Creates a new chat session
 */
export async function createSession(userId, characterId, title = 'New Chat') {
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .insert([
      {
        user_id: userId,
        character_id: characterId,
        title: title
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Error creating chat session:', error);
    throw new Error('Failed to create chat session');
  }

  return session;
}

/**
 * Gets a chat session by ID with character details
 */
export async function getSession(sessionId, userId) {
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select(`
      *,
      characters (*)
    `)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching session:', error);
    throw new Error('Session not found or access denied');
  }

  return session;
}

/**
 * Sends a message and gets a response from the AI
 */
export async function sendMessage(sessionId, userId, message) {
  try {
    // 1. Get session with character details
    const session = await getSession(sessionId, userId);
    if (!session) {
      throw new Error('Session not found or access denied');
    }

    const character = session.characters;

    // 2. Get chat history
    const history = await getChatHistory(sessionId);

    // 3. Build system prompt
    const systemPrompt = buildSystemPrompt(character);

    // 4. Prepare messages for the AI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    // 5. Get AI response with rate limiting
    let aiResponse;
    try {
      const response = await enqueueRequest(
        () => chatCompletion(messages),
        userId
      );
      
      if (!response?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from AI service');
      }
      
      aiResponse = response.choices[0].message.content;
    } catch (error) {
      console.error('Error getting AI response:', error);
      throw new RateLimitError(error.message || 'Too many requests to the AI service');
    }
    
    // 5.1. Humanize the AI response
    try {
      const characterContext = {
        emotion: character.personality?.emotion || 'neutral',
        intensity: character.personality?.intensity || 3,
        traits: character.personality?.traits || []
      };
      aiResponse = humanizeResponse(aiResponse, characterContext);
      console.log('Response humanized successfully');
    } catch (humanizeError) {
      console.warn('Failed to humanize response:', humanizeError.message);
      // Continue with original response if humanization fails
    }

    // 6. Save messages to database
    let data;
    try {
      console.log('Saving chat messages...');
      
      // Call the stored procedure with explicit type casting
      const { data: result, error } = await supabase.rpc('create_chat_messages', {
        p_session_id: sessionId,
        p_user_id: userId,
        p_character_id: character.id,
        p_user_message: message.substring(0, 1000), // Limit message length
        p_ai_response: aiResponse.substring(0, 1000) // Limit response length
      }).select('*').single();
      
      console.log('Database result:', JSON.stringify(result, null, 2));
      
      if (error) {
        console.error('Database error:', error);
        throw new Error(`Database error: ${error.message}`);
      }
      
      if (!result) {
        throw new Error('No data returned from database function');
      }
      
      if (result.success === false) {
        console.error('Function execution failed:', result);
        throw new Error(`Database function error: ${result.error || 'Unknown error'}`);
      }
      
      data = result;
    } catch (dbError) {
      console.error('Error saving messages:', {
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        code: dbError.code
      });
      
      // If it's a database error about missing column, provide more specific error
      if (dbError.code === '42703') { // Undefined column
        throw new Error('Database schema mismatch. Please run database migrations.');
      }
      throw new Error(`Failed to save chat messages: ${dbError.message}`);
    }

    // 7. Return the AI response and updated session info
    return {
      response: aiResponse,
      session: {
        id: session.id,
        title: session.title,
        updated_at: new Date().toISOString()
      },
      character: {
        id: character.id,
        name: character.name,
        avatar_url: character.avatar_url
      }
    };

  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
}

/**
 * Gets chat history for a session
 */
export async function getSessionMessages(sessionId, userId, limit = 50) {
  // Verify user has access to this session
  const { count } = await supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (count === 0) {
    throw new Error('Session not found or access denied');
  }

  // Get messages
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Error fetching messages:', error);
    throw new Error('Failed to fetch messages');
  }

  return messages;
}

/**
 * Lists all chat sessions for a user
 */
export async function listUserSessions(userId, limit = 50) {
  const { data: sessions, error } = await supabase
    .from('chat_sessions')
    .select(`
      *,
      characters (id, name, avatar_url)
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching sessions:', error);
    throw new Error('Failed to fetch chat sessions');
  }

  return sessions;
}

/**
 * Updates a chat session (e.g., title)
 */
export async function updateSession(sessionId, userId, updates) {
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating session:', error);
    throw new Error('Failed to update session');
  }

  return session;
}

/**
 * Deletes a chat session and its messages
 */
export async function deleteSession(sessionId, userId) {
  // First delete messages (due to foreign key constraint)
  const { error: messagesError } = await supabase
    .from('chat_messages')
    .delete()
    .eq('session_id', sessionId);

  if (messagesError) {
    console.error('Error deleting messages:', messagesError);
    throw new Error('Failed to delete chat messages');
  }

  // Then delete the session
  const { error: sessionError } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (sessionError) {
    console.error('Error deleting session:', sessionError);
    throw new Error('Failed to delete session');
  }

  return { success: true };
}
