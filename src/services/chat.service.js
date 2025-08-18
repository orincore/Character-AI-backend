import { chatCompletion } from '../config/together.js';
import supabase from '../config/supabaseClient.js';
import { buildMessagesForSession } from './messageBuilder.js';

// Removed system prompt builder to send only raw user messages to the model

// Extract a lightweight topic focus from the user's latest message
function extractTopic(text) {
  try {
    const raw = (text || '').trim();
    const lastSentence = (raw.match(/[^.!?]+[.!?]?$/) || [''])[0];
    const lowered = lastSentence.toLowerCase();
    const stop = new Set(['the','a','an','and','or','but','with','for','to','of','in','on','at','is','are','am','be','it','this','that','you','me','my','your','we','our','us']);
    const words = lowered.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
    const unique = Array.from(new Set(words));
    const keywords = unique.slice(0, 5);
    return { focus: lastSentence.slice(0, 120), keywords };
  } catch {
    return { focus: '', keywords: [] };
  }
}

// Basic flirtation detector to reduce topic drift in NSFW mode
function detectFlirt(text) {
  try {
    const t = (text || '').toLowerCase();
    const keywords = [
      'flirt', 'kiss', 'hot', 'cute', 'sexy', 'attractive', 'date', 'romantic',
      'hold hands', 'cuddle', 'blush', 'wink', 'crush', 'turn on', 'spicy', 'seduce',
      'horny', 'aroused', 'nsfw', 'explicit', 'erotic', 'sex', 'sexual', 'fuck', 'suck',
      'lick', 'naughty', 'lewd', 'fetish', 'dirty talk', 'make love', 'roleplay', 'rp'
    ];
    return keywords.some(k => t.includes(k));
  } catch {
    return false;
  }
}

// Try to get the user's plan; default to 'free' on failure
async function getUserPlan(userId) {
  try {
    // Attempt to read from a plausible profile table; fall back to free if not present
    const { data, error } = await supabase
      .from('user_profiles')
      .select('plan')
      .eq('id', userId)
      .single();
    if (error || !data || !data.plan) return 'free';
    return (data.plan || 'free').toLowerCase();
  } catch {
    return 'free';
  }
}

function determineMessageType(userText) {
  const text = (userText || '').toLowerCase();
  const longKeywords = ['story', 'describe', 'detail', 'roleplay', 'scenario', 'imagine'];
  const isQuestion = /\?\s*$/.test(text);
  const hasLongKeyword = longKeywords.some(k => text.includes(k));
  const isLongByLength = text.length > 140;
  if (hasLongKeyword || isLongByLength) return 'long';
  if (isQuestion) return 'short';
  return 'short';
}

function applyResponseLengthPolicy(text, { plan, messageType }) {
  try {
    if (!text || typeof text !== 'string') return text;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length === 0) return text;
    const isPaid = plan === 'pro' || plan === 'paid' || plan === 'premium' || plan === 'plus';

    if (!isPaid) {
      // Free: cap to 3 sentences
      return sentences.slice(0, 3).join(' ');
    }

    // Paid: allow short or long based on message type
    if (messageType === 'long') {
      // Allow up to 5 sentences to deepen engagement
      return sentences.slice(0, 5).join(' ');
    }
    // Short mode: 2–3 sentences
    return sentences.slice(0, Math.min(3, Math.max(2, sentences.length))).join(' ');
  } catch {
    return text;
  }
}

// Ensure the reply contains 1–2 **action** markers and not more.
// Keeps actions SFW-safe regardless of mode.
function enforceActionFormatting(text) {
  try {
    if (!text || typeof text !== 'string') return text;
    const safeActions = [
      '**smiles**',
      '**nods**',
      '**laughs softly**',
      '**tilts head**',
      '**leans closer**',
      '**grins**',
      '**blushes**',
      '**waves**'
    ];
    const markerRegex = /\*\*[^*][\s\S]*?\*\*/g;
    const matches = text.match(markerRegex) || [];

    // Cap to two markers by removing asterisks from extras
    if (matches.length > 2) {
      let seen = 0;
      text = text.replace(markerRegex, (m) => {
        seen += 1;
        return seen <= 2 ? m : m.replace(/\*\*/g, '');
      });
    }

    // Ensure at least one marker exists
    const updatedMatches = (text.match(markerRegex) || []);
    if (updatedMatches.length === 0) {
      const action = safeActions[Math.floor(Math.random() * safeActions.length)];
      // Insert before final punctuation if present, else append
      if (/[.!?]$/.test(text.trim())) {
        text = text.replace(/[.!?]$/, (p) => ` ${action}${p}`);
      } else {
        text = `${text} ${action}`;
      }
    }
    return text;
  } catch {
    return text;
  }
}

/**
 * Gets chat history for a session
 */
async function getChatHistory(sessionId, limit = 10) {
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    // Fetch newest first, then reverse to chronological for AI context
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }

  // Format messages for the AI in chronological order (oldest -> newest)
  return messages.reverse().map(msg => ({
    role: msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'),
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

  return session;
}

/**
* Sends a message and gets a response from the AI
*/
export async function sendMessage(sessionId, userId, message) {
  try {
    // 1) Load session and character
    const session = await getSession(sessionId, userId);
    if (!session) throw new Error('Session not found or access denied');
    const character = session.characters;

    // 2) Build messages using Supabase character/session data
    const { messages, character: builtCharacter, usedNSFW } = await buildMessagesForSession(sessionId, userId, message);
    // IMPORTANT: Persist the CURRENT user message, not an older one from history
    const userText = String(message ?? '').slice(0, 2000);
    const currentNSFW = !!(character?.nsfw_enabled === true || character?.nsfw_enabled === 'true' || character?.nsfw_enabled === 1 || character?.nsfw_enabled === '1');
    const turnNSFW = usedNSFW ?? currentNSFW;

    // 3) Determine sequential order_index for this turn (user then assistant)
    let nextUserIndex = null;
    let nextAssistantIndex = null;
    try {
      const { data: ordRows } = await supabase
        .from('chat_messages')
        .select('order_index')
        .eq('session_id', sessionId)
        .order('order_index', { ascending: false, nullsFirst: false })
        .limit(1);
      const baseIndex = Number(ordRows?.[0]?.order_index ?? 0);
      nextUserIndex = baseIndex + 1;
      nextAssistantIndex = baseIndex + 2;
    } catch (e) {
      console.warn('order_index fetch failed, defaulting to timestamp ordering', e);
    }

    // 4) Log final payload and call Together AI
    try {
      console.log('Together AI payload:', JSON.stringify({ sessionId, messages }, null, 2));
    } catch {}
    const resp = await chatCompletion(messages);
    const aiResponse = resp?.choices?.[0]?.message?.content?.trim() || '';

    // Helper: find mirror session linked via system MIRROR_LINK
    async function getMirrorSessionId(primaryId) {
      try {
        const { data: sys } = await supabase
          .from('chat_messages')
          .select('content')
          .eq('session_id', primaryId)
          .eq('role', 'system')
          .ilike('content', 'MIRROR_LINK:%')
          .limit(1);
        const content = Array.isArray(sys) && sys[0]?.content;
        if (!content || typeof content !== 'string') return null;
        const m = content.match(/^MIRROR_LINK:([0-9a-fA-F-]{36})$/);
        return m ? m[1] : null;
      } catch {
        return null;
      }
    }

    const mirrorSessionId = await getMirrorSessionId(sessionId);

    // 4) Persist both user and assistant messages to Supabase
    let savedUser = false;
    let savedAssistant = false;
    if (userText) {
      const { error: userErr } = await supabase
        .from('chat_messages')
        .insert([{ session_id: sessionId, role: 'user', content: userText, is_nsfw: turnNSFW, order_index: nextUserIndex }]);
      if (userErr) {
        console.error('Failed to save user message:', { sessionId, userId, error: userErr, contentLen: userText.length });
      } else {
        savedUser = true;
        // Mirror to linked session (best-effort)
        if (mirrorSessionId) {
          try {
            // compute order_index for mirror session
            let mirrorUserIndex = null;
            try {
              const { data: ordRowsM } = await supabase
                .from('chat_messages')
                .select('order_index')
                .eq('session_id', mirrorSessionId)
                .order('order_index', { ascending: false, nullsFirst: false })
                .limit(1);
              const baseM = Number(ordRowsM?.[0]?.order_index ?? 0);
              mirrorUserIndex = baseM + 1;
            } catch {}
            await supabase
              .from('chat_messages')
              .insert([{ session_id: mirrorSessionId, role: 'user', content: userText, is_nsfw: turnNSFW, order_index: mirrorUserIndex, metadata: { mirrored_from: sessionId } }]);
          } catch (e) {
            console.warn('Failed to mirror user message', { sessionId, mirrorSessionId, error: e?.message || e });
          }
        }
      }
    }

    if (aiResponse) {
      const { error: aiErr } = await supabase
        .from('chat_messages')
        .insert([{ session_id: sessionId, role: 'assistant', content: aiResponse, is_nsfw: turnNSFW, order_index: nextAssistantIndex }]);
      if (aiErr) {
        console.error('Failed to save assistant message:', { sessionId, userId, error: aiErr, contentLen: aiResponse.length });
      } else {
        savedAssistant = true;
        // Mirror to linked session (best-effort)
        if (mirrorSessionId) {
          try {
            // compute order_index for mirror session
            let mirrorAssistantIndex = null;
            try {
              const { data: ordRowsM2 } = await supabase
                .from('chat_messages')
                .select('order_index')
                .eq('session_id', mirrorSessionId)
                .order('order_index', { ascending: false, nullsFirst: false })
                .limit(1);
              const baseM2 = Number(ordRowsM2?.[0]?.order_index ?? 0);
              mirrorAssistantIndex = baseM2 + 1;
            } catch {}
            await supabase
              .from('chat_messages')
              .insert([{ session_id: mirrorSessionId, role: 'assistant', content: aiResponse, is_nsfw: turnNSFW, order_index: mirrorAssistantIndex, metadata: { mirrored_from: sessionId } }]);
          } catch (e) {
            console.warn('Failed to mirror assistant message', { sessionId, mirrorSessionId, error: e?.message || e });
          }
        }
      }
    }

    // 6) Touch session updated_at
    await supabase
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId);

    // Touch mirror session as well
    if (mirrorSessionId) {
      try {
        await supabase
          .from('chat_sessions')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', mirrorSessionId);
      } catch {}
    }

    // 8) Return the AI response and updated session info
    return {
      response: aiResponse,
      isNSFW: turnNSFW,
      session: { id: session.id, title: session.title, updated_at: new Date().toISOString() },
      character: { id: character.id, name: character.name, avatar_url: character.avatar_url },
      persisted: { user: savedUser, assistant: savedAssistant }
    };

  } catch (error) {
    console.error('Error in sendMessage (simple):', error);
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
    created_at: msg.created_at ? new Date(msg.created_at).toISOString() : null,
    order_index: typeof msg.order_index === 'number' ? msg.order_index : (msg.order_index != null ? Number(msg.order_index) : null),
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
  try {
    // Verify session ownership
    const { data: session, error: sessErr } = await supabase
      .from('chat_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();
    if (sessErr || !session) {
      throw new Error('Session not found or access denied');
    }

    // Fetch messages with deterministic ordering and pagination
    const { data, error, count } = await supabase
      .from('chat_messages')
      .select('id, session_id, role, content, created_at, order_index, is_nsfw, metadata', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('order_index', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, Math.max(offset, 0) + Math.max(limit, 1) - 1);

    if (error) {
      throw new Error('Failed to fetch messages');
    }

    const messages = Array.isArray(data) ? data : [];
    const formattedMessages = formatMessages(messages);
    return { messages: formattedMessages, total: typeof count === 'number' ? count : messages.length };
  } catch (err) {
    throw err;
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

  // Attach last_message for each session
  const withLast = await Promise.all((sessions || []).map(async (s) => {
    try {
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, session_id, role, content, created_at, order_index, is_nsfw, metadata')
        .eq('session_id', s.id)
        .order('order_index', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1);
      const m = Array.isArray(msgs) && msgs[0] ? msgs[0] : null;
      const last_message = m ? {
        id: m.id,
        session_id: m.session_id,
        content: m.content,
        sender_type: m.role === 'assistant' ? 'ai' : 'user',
        created_at: m.created_at ? new Date(m.created_at).toISOString() : null,
        order_index: typeof m.order_index === 'number' ? m.order_index : (m.order_index != null ? Number(m.order_index) : null),
        is_nsfw: !!m.is_nsfw,
        is_ai_typing: false,
        metadata: m.metadata || {}
      } : null;
      const last_activity_at = last_message?.created_at || (s.updated_at ? new Date(s.updated_at).toISOString() : null);
      return { ...s, last_message, last_activity_at };
    } catch {
      const last_activity_at = s.updated_at ? new Date(s.updated_at).toISOString() : null;
      return { ...s, last_message: null, last_activity_at };
    }
  }));

  // Sort by most recent activity at the top
  withLast.sort((a, b) => {
    const ta = a.last_activity_at ? Date.parse(a.last_activity_at) : 0;
    const tb = b.last_activity_at ? Date.parse(b.last_activity_at) : 0;
    return tb - ta;
  });

  return withLast;
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

/**
 * Clears all messages in a single session (keeps the session)
 */
export async function clearSessionMessages(sessionId, userId) {
  // Verify session ownership
  const { data: session, error: sessErr } = await supabase
    .from('chat_sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .single();
  if (sessErr || !session || session.user_id !== userId) {
    throw new Error('Not authorized to clear this session');
  }

  const { error: delErr } = await supabase
    .from('chat_messages')
    .delete()
    .eq('session_id', sessionId);
  if (delErr) {
    throw new Error('Failed to clear session messages');
  }
  return { success: true };
}

/**
 * Deletes all sessions and their messages for the user
 */
export async function deleteAllUserSessions(userId) {
  // Get all sessions for user
  const { data: sessions, error: sessErr } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId);
  if (sessErr) {
    throw new Error('Failed to list user sessions');
  }
  const sessionIds = (sessions || []).map(s => s.id);
  if (sessionIds.length === 0) return { success: true, deleted_sessions: 0, deleted_messages: 0 };

  // Delete messages
  const { error: delMsgErr } = await supabase
    .from('chat_messages')
    .delete()
    .in('session_id', sessionIds);
  if (delMsgErr) {
    throw new Error('Failed to delete chat messages');
  }

  // Delete sessions
  const { error: delSessErr } = await supabase
    .from('chat_sessions')
    .delete()
    .in('id', sessionIds)
    .eq('user_id', userId);
  if (delSessErr) {
    throw new Error('Failed to delete chat sessions');
  }

  return { success: true, deleted_sessions: sessionIds.length };
}

/**
 * Deletes a single message by id after verifying the session belongs to the user
 */
export async function deleteMessage(messageId, userId) {
  // Get the message to identify its session
  const { data: msg, error: msgErr } = await supabase
    .from('chat_messages')
    .select('id, session_id')
    .eq('id', messageId)
    .single();
  if (msgErr || !msg) {
    throw new Error('Message not found');
  }

  // Verify the session belongs to the user
  const { data: session, error: sessErr } = await supabase
    .from('chat_sessions')
    .select('id, user_id')
    .eq('id', msg.session_id)
    .eq('user_id', userId)
    .single();
  if (sessErr || !session) {
    throw new Error('Not authorized to delete this message');
  }

  // Delete the message
  const { error: delErr } = await supabase
    .from('chat_messages')
    .delete()
    .eq('id', messageId);
  if (delErr) {
    throw new Error('Failed to delete message');
  }
  return { success: true };
}

/**
 * Clears all messages for the user's sessions with a specific character
 */
export async function clearChatWithCharacter(userId, characterId) {
  // Find sessions for this user and character
  const { data: sessions, error: sessErr } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('character_id', characterId);
  if (sessErr) {
    throw new Error('Failed to lookup sessions');
  }
  const sessionIds = (sessions || []).map(s => s.id);
  if (sessionIds.length === 0) return { success: true, deleted: 0 };

  // Delete messages for these sessions
  const { error: delErr } = await supabase
    .from('chat_messages')
    .delete()
    .in('session_id', sessionIds);
  if (delErr) {
    throw new Error('Failed to clear messages');
  }
  return { success: true };
}

/**
 * Deletes all messages, sessions for a character and the character itself (owner only)
 */
export async function deleteCharacterWithSessions(userId, characterId) {
  // Verify ownership of character
  const { data: character, error: charErr } = await supabase
    .from('characters')
    .select('id, creator_id')
    .eq('id', characterId)
    .single();
  if (charErr || !character) {
    throw new Error('Character not found');
  }
  if (character.creator_id !== userId) {
    throw new Error('Not authorized to delete this character');
  }

  // Get all sessions for this user+character
  const { data: sessions, error: sessErr } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('character_id', characterId);
  if (sessErr) {
    throw new Error('Failed to lookup sessions');
  }
  const sessionIds = (sessions || []).map(s => s.id);

  // Delete messages first
  if (sessionIds.length > 0) {
    const { error: delMsgErr } = await supabase
      .from('chat_messages')
      .delete()
      .in('session_id', sessionIds);
    if (delMsgErr) {
      throw new Error('Failed to delete chat messages');
    }

    // Delete sessions
    const { error: delSessErr } = await supabase
      .from('chat_sessions')
      .delete()
      .in('id', sessionIds)
      .eq('user_id', userId);
    if (delSessErr) {
      throw new Error('Failed to delete chat sessions');
    }
  }

  // Finally delete the character
  const { error: delCharErr } = await supabase
    .from('characters')
    .delete()
    .eq('id', characterId)
    .eq('creator_id', userId);
  if (delCharErr) {
    throw new Error('Failed to delete character');
  }

  return { success: true };
}
