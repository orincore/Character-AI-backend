import { chatCompletion } from '../config/together.js';
import supabase from '../config/supabaseClient.js';
import { humanizeResponse } from '../utils/humanizeResponses.js';
import { prompts, getPersonalityDescription } from '../config/prompts.js';
import { enqueueRequest } from '../utils/requestQueue.js';
import { RateLimitError } from '../middleware/errorHandler.js';

import { formatCharacterData } from '../utils/characterUtils.js';

/**
 * Builds the system prompt for the AI based on character settings
 */
function buildSystemPrompt(character) {
  // Format character data to ensure all fields have proper defaults
  const formattedChar = formatCharacterData(character);
  
  // Get personality description from centralized prompts
  const personalityDesc = getPersonalityDescription(formattedChar);
  
  // Get appropriate content guidelines based on NSFW setting
  const contentGuidelines = formattedChar.nsfw_enabled 
    ? prompts.contentGuidelines.nsfw 
    : prompts.contentGuidelines.sfw;
  
  // Get the combined description (already handled in formatCharacterData)
  const fullDescription = formattedChar.full_description;
  
  // Build the complete system prompt using the template
  return prompts.character.base(
    formattedChar.name,
    fullDescription,
    personalityDesc,
    contentGuidelines,
    formattedChar.character_type,
    formattedChar.character_gender
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
/**
 * Gets a chat session by ID with complete character details
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

  // Format character data using our utility
  if (session.characters) {
    session.characters = formatCharacterData(session.characters);
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
 * Formats raw database messages to the expected frontend format
 */
function formatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  
  return messages.map(msg => ({
    id: msg.id,
    session_id: msg.session_id,
    content: msg.content,
    sender_type: msg.role === 'assistant' ? 'ai' : 'user',
    created_at: msg.created_at,
    is_ai_typing: false,
    metadata: msg.metadata || {}
  }));
}

/**
 * Gets chat history for a session using only session_id
 * @param {string} sessionId - The session ID
 * @param {string} userId - The user ID (for authorization)
 * @param {Object} options - Pagination options
 * @param {number} [options.limit=50] - Number of messages to return
 * @param {number} [options.offset=0] - Number of messages to skip
 * @returns {Promise<{messages: Array, total: number}>} - Messages and total count
 */
export async function getSessionMessages(sessionId, userId, { limit = 50, offset = 0 } = {}) {
  console.log('Service: Getting messages for session', { 
    sessionId,
    limit,
    offset
  });

  try {
    console.log('Fetching messages with Supabase query...');
    console.log('Supabase URL:', process.env.SUPABASE_URL);
    
    // 1. First, verify the session_id is a valid UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new Error('Invalid session_id format');
    }
    
    // 1. First, verify the table is accessible
    console.log('Checking if chat_messages table is accessible...');
    
    // 2. Get the count of messages for this session
    const { count, error: countError } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);
      
    if (countError) {
      console.error('Error getting message count:', countError);
      throw new Error('Failed to get message count');
    }
    
    console.log(`Found ${count} total messages for session ${sessionId}`);
    
    // 3. Get the actual messages with pagination
    const { data: messages, error: queryError, count: total } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false }) // Get newest first for chat
      .range(offset, offset + limit - 1);

    if (queryError) {
      console.error('Error fetching messages:', queryError);
      throw new Error('Failed to fetch messages');
    }
    
    console.log(`Retrieved ${messages.length} messages (${offset} - ${offset + messages.length - 1} of ${total})`);
    
    // 4. Format the messages for the frontend
    const formattedMessages = formatMessages(messages);
    
    // Return both messages and pagination info
    return {
      messages: formattedMessages,
      pagination: {
        total,
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0,
        hasMore: offset + formattedMessages.length < total
      }
    };
  } catch (error) {
    console.error('Error in getSessionMessages service:', {
      error: error.message,
      stack: error.stack,
      sessionId,
      userId
    });
    throw error; // Re-throw to be handled by the controller
  }
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
