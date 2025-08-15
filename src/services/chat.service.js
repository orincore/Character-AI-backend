import { chatCompletion } from '../config/together.js';
import supabase from '../config/supabaseClient.js';
import { humanizeResponse } from '../utils/humanizeResponses.js';
import { prompts, getPersonalityDescription } from '../config/prompts.js';
import { enqueueRequest } from '../utils/requestQueue.js';
import { RateLimitError } from '../middleware/errorHandler.js';

import { formatCharacterData } from '../utils/characterUtils.js';
import { moderateContent, stripNSFW } from '../utils/moderation.js';
import { redisClient } from '../config/redis.js';
import crypto from 'crypto';

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
      'hold hands', 'cuddle', 'blush', 'wink', 'crush', 'turn on', 'spicy', 'seduce'
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

    // 1.1 Prevent duplicate sends: if last user message equals incoming and next is assistant, reuse it
    const { data: lastTwo, error: lastErr } = await supabase
      .from('chat_messages')
      .select('id, sender_type, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(2);
    if (!lastErr && Array.isArray(lastTwo) && lastTwo.length >= 2) {
      const [latest, previous] = lastTwo; // newest first
      // Pattern: previous user == incoming, latest assistant => duplicate
      if (
        previous?.sender_type === 'user' &&
        typeof previous?.content === 'string' &&
        previous.content.trim() === String(message).trim() &&
        latest?.sender_type === 'assistant'
      ) {
        // Return existing AI response without creating duplicates
        return {
          response: latest.content,
          session: { id: session.id, title: session.title, updated_at: new Date().toISOString() },
          character: { id: character.id, name: character.name, avatar_url: character.avatar_url }
        };
      }
    }

    // 2. Get chat history
    const history = await getChatHistory(sessionId);

    // 3. Build system prompt
    const systemPrompt = buildSystemPrompt(character);

    // 3.1 Capture raw user input and prepare a model-facing copy
    const rawUserMsg = String(message ?? '').slice(0, 2000);
    let modelUserMsg = rawUserMsg;
    const nsfwEnabled = !!character?.nsfw_enabled;

    // Count user turns to gate escalation in 18+ mode
    let userTurns = 0;
    try {
      const { count: turnCount } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('sender_type', 'user');
      userTurns = turnCount || 0;
    } catch {}

    // Threshold before allowing explicit content even if NSFW enabled
    const minTurnsForExplicit = 8;

    // Determine if the user message is explicit via SFW moderation check
    const explicitCheck = moderateContent(modelUserMsg, false);

    // Apply moderation behavior
    const userModeration = moderateContent(modelUserMsg, nsfwEnabled);
    if (!userModeration.allowed && !nsfwEnabled) {
      // SFW mode: sanitize text for the model, but preserve raw for storage/rendering
      modelUserMsg = stripNSFW(modelUserMsg);
    } else if (nsfwEnabled && userTurns < minTurnsForExplicit && !explicitCheck.allowed) {
      // NSFW enabled but too early: deflect model input, preserve raw
      modelUserMsg = "Let's take it slow—tell me something you enjoy or a fun memory.";
    }

    // 3.2 Idempotency: prevent rapid duplicate submissions (e.g., retries) for same session+input
    // Idempotency based on raw input to match user perception
    const idemHash = crypto.createHash('sha256').update(`${sessionId}:${rawUserMsg}`).digest('hex').slice(0, 16);
    const idemKey = `idem:chat:${sessionId}:${idemHash}`;
    const setOk = await redisClient.set(idemKey, '1', 15); // 15s window, NX inside set()
    if (!setOk) {
      // Within idempotency window; return last assistant if exists
      if (lastTwo && lastTwo[0]?.sender_type && (lastTwo[0].sender_type === 'assistant' || lastTwo[0].sender_type === 'ai')) {
        return {
          response: lastTwo[0].content,
          session: { id: session.id, title: session.title, updated_at: new Date().toISOString() },
          character: { id: character.id, name: character.name, avatar_url: character.avatar_url }
        };
      }
    }

    // 4. Prepare messages for the AI
    // Fetch plan early to guide model length via system instruction (verbatim output preserved)
    const userPlan = await getUserPlan(userId).catch(() => 'free');
    console.log('sendMessage plan check:', { userId, userPlan });
    const messageType = determineMessageType(rawUserMsg);
    const safetyGuard = !nsfwEnabled
      ? { role: 'system', content: 'Safety Policy: NSFW is disabled. You must strictly avoid explicit sexual content, graphic nudity, pornographic language, or fetish content. Keep all responses SFW and decline such requests politely.' }
      : null;

    // Pacing guard for early conversation in NSFW mode
    const pacingGuard = nsfwEnabled && userTurns < minTurnsForExplicit
      ? { role: 'system', content: `PACING: Early-stage conversation (user turns: ${userTurns}). Keep replies general, playful, and non-explicit. Build chemistry gradually with teasing warmth, small hooks, and curiosity. Do not provide explicit sexual descriptions yet.` }
      : null;

    // Flirt mirroring guard to keep responses on-topic when user flirts
    const flirtGuard = nsfwEnabled && detectFlirt(rawUserMsg)
      ? { role: 'system', content: 'ON-TOPIC: Respond directly to the user\'s last line first (one short sentence), mirroring their playful/flirty tone without changing the subject. Then add at most one tiny follow-up hook or question. Avoid lecturing or shifting topics.' }
      : null;

    // Topic guard: pin current topic focus and keywords to prevent drift
    const topic = extractTopic(rawUserMsg);
    const topicGuard = nsfwEnabled && (topic.focus || (topic.keywords && topic.keywords.length))
      ? { role: 'system', content: `TOPIC FOCUS: Stay strictly on this topic unless the user changes it. Focus: "${topic.focus}". Keywords: ${topic.keywords.join(', ')}. Do not introduce unrelated subjects. Build tension slowly and escalate only after trust is built.` }
      : null;

    // Direct answer guard: instruct to answer the user's last sentence explicitly
    const directAnswerGuard = nsfwEnabled && (topic.focus || (topic.keywords && topic.keywords.length))
      ? { role: 'system', content: `DIRECT ANSWER: First, answer this exact line in one short sentence without changing subject: "${topic.focus}". Then add only one tiny hook or micro-question. Include at least one of these keywords if natural: ${topic.keywords.join(', ')}.` }
      : null;

    // Depth guard: encourage multi-sentence, textured replies in NSFW mode
    const isEarlyPhase = nsfwEnabled && (detectFlirt(rawUserMsg) || userTurns < minTurnsForExplicit);
    // Plan flag (paid vs free) used for length guidance
    const isPaidPlan = (userPlan === 'pro' || userPlan === 'paid' || userPlan === 'premium' || userPlan === 'plus');
    const depthGuard = nsfwEnabled
      ? { role: 'system', content: `DEPTH: Avoid one-liners. ${
          isPaidPlan
            ? (isEarlyPhase
                ? 'Use 2–3 sentences with subtle attraction, micro-reactions, and curiosity.'
                : 'Use 3–5 sentences with richer detail, sensory cues, and emotional subtext.')
            : 'Use 3–4 sentences in a single paragraph with engaging detail, micro-reactions, and a gentle hook. No lists, no headings, no line breaks.'
        } Include a gentle micro-hook at the end.` }
      : null;

    // Plan-based length guard to avoid local trimming while keeping output verbatim
    const planGuard = {
      role: 'system',
      content: isPaidPlan
        ? 'LENGTH POLICY: Paid tier. No sentence limit—respond as long as needed to feel natural and engaging while staying on-topic.'
        : 'LENGTH POLICY: Free tier. Provide exactly 3–4 sentences in one single paragraph (about 60–80 words). Do not insert any line breaks, bullet points, or lists.'
    };

    // For free plan, add a strict length guard up-front to maximize adherence
    const initialStrictGuard = !isPaidPlan ? {
      role: 'system',
      content: 'FORMAT: Output must be exactly 3–4 sentences in ONE paragraph, around 60–80 words. No line breaks, no lists, no headings, no emojis.'
    } : null;

    const messages = [
      { role: 'system', content: systemPrompt },
      planGuard,
      ...(initialStrictGuard ? [initialStrictGuard] : []),
      ...(directAnswerGuard ? [directAnswerGuard] : []),
      ...(safetyGuard ? [safetyGuard] : []),
      ...(pacingGuard ? [pacingGuard] : []),
      ...(flirtGuard ? [flirtGuard] : []),
      ...(topicGuard ? [topicGuard] : []),
      ...(depthGuard ? [depthGuard] : []),
      ...history,
      { role: 'user', content: rawUserMsg }
    ];

    // 5. Get AI response with uniqueness guarantees and rate limiting
    let aiResponse;
    const antiRepeatNudge = { role: 'system', content: 'Do not repeat prior assistant messages verbatim. Provide a novel, contextually appropriate response.' };
    // last assistant content if available
    const lastAssistantContent = (lastTwo && (lastTwo[0]?.sender_type === 'assistant' || lastTwo[0]?.sender_type === 'ai')) ? lastTwo[0].content?.trim() : null;
    const tryMessages = [...messages];
    tryMessages.splice(1, 0, antiRepeatNudge); // after main system prompt

    // Fetch last few assistant replies to compare for uniqueness
    let lastAssistantSet = new Set();
    try {
      const { data: recent, error: recErr } = await supabase
        .from('chat_messages')
        .select('content, sender_type')
        .eq('session_id', sessionId)
        .in('sender_type', ['assistant', 'ai'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(5);
      if (!recErr && Array.isArray(recent)) {
        recent.forEach(r => {
          if (typeof r?.content === 'string') {
            lastAssistantSet.add(r.content.replace(/\s+/g, ' ').trim());
          }
        });
      }
    } catch {}

    const maxAttempts = 3;
    let attempt = 0;
    let previousOutputs = new Set();
    while (attempt < maxAttempts) {
      try {
        // Dynamic decoding for natural, engaging responses
        const earlyPhase = nsfwEnabled && (detectFlirt(rawUserMsg) || userTurns < minTurnsForExplicit);
        
        // More creative settings for natural flow
        const baseTemp = earlyPhase ? 0.85 : (nsfwEnabled ? 1.1 : 0.8);
        const baseTopP = earlyPhase ? 0.92 : (nsfwEnabled ? 0.98 : 0.92);
        const baseRep = nsfwEnabled ? 1.03 : 1.05; // Lower penalty for more natural repetition
        const presence = nsfwEnabled ? (earlyPhase ? 0.4 : 0.3) : 0.2; // Lower presence for more novelty
        const frequency = nsfwEnabled ? (earlyPhase ? 0.6 : 0.5) : 0.4; // Lower frequency for more varied word choice
        
        // Flow enhancer - adds context about natural conversation pacing
        const flowEnhancer = {
          role: 'system',
          content: 'FLOW: Respond naturally as if in a real conversation. Vary sentence length and structure. ' +
                   'Use contractions, interjections, and natural pauses. Show, don\'t tell. ' +
                   'Balance dialogue with action. Reference previous messages organically.'
        };

        // Insert flowEnhancer AFTER planGuard/initialStrictGuard so length policy remains highest-priority
        let enhancedMessages;
        if (tryMessages.length > 1 && tryMessages[1]?.role === 'system') {
          // If second item is the planGuard (system), place flow after all leading system guards (first non-system index)
          const firstNonSystemIdx = tryMessages.findIndex(m => m.role !== 'system');
          const insertAfter = firstNonSystemIdx > 0 ? firstNonSystemIdx : 1;
          enhancedMessages = [
            ...tryMessages.slice(0, insertAfter),
            flowEnhancer,
            ...tryMessages.slice(insertAfter)
          ];
        } else {
          // Fallback: just after the first item
          enhancedMessages = [
            tryMessages[0],
            flowEnhancer,
            ...tryMessages.slice(1)
          ];
        }

        // Adjust decoding for free plan to reduce verbosity and multi-paragraph drift
        const adjTemp = !isPaidPlan ? Math.max(0.7, (attempt === 0 ? baseTemp : baseTemp + 0.04 * attempt) - 0.15) : (attempt === 0 ? baseTemp : baseTemp + 0.05 * attempt);
        const adjTopP = !isPaidPlan ? Math.min(0.93, (attempt === 0 ? baseTopP : Math.min(0.98, baseTopP + 0.01 * attempt)) - 0.03) : (attempt === 0 ? baseTopP : Math.min(0.98, baseTopP + 0.01 * attempt));
        const adjRep = !isPaidPlan ? (attempt === 0 ? Math.max(baseRep, 1.04) : Math.max(baseRep + 0.04 * attempt, 1.06)) : (attempt === 0 ? baseRep : baseRep + 0.05 * attempt);

        const response = await enqueueRequest(
          () => chatCompletion(enhancedMessages, {
            // Nudge decoding params; slightly stricter for free plans
            temperature: adjTemp,
            top_p: adjTopP,
            repetition_penalty: adjRep,
            presence_penalty: presence,
            frequency_penalty: frequency,
            ...(isPaidPlan ? {} : {
              // Prevent lists and multi-paragraph drift for free tier
              stop: ['\n\n', '\r\n\r\n', '\n- ', '\n* ', '\n1. ', '\n2. '],
              max_tokens: 220
            })
          }),
          userId
        );
        const content = response?.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error('Invalid response from AI service');
        }

        // Check against last assistant and prior attempts
        const normalized = content.replace(/\s+/g, ' ').trim();
        const lastNorm = lastAssistantContent ? lastAssistantContent.replace(/\s+/g, ' ').trim() : null;
        if (lastNorm && normalized === lastNorm) {
          attempt += 1;
          continue; // regenerate
        }
        if (previousOutputs.has(normalized) || lastAssistantSet.has(normalized)) {
          attempt += 1;
          continue; // regenerate
        }

        // On-topic + depth validation for NSFW flirt/early pacing
        if (nsfwEnabled && (detectFlirt(rawUserMsg) || userTurns < minTurnsForExplicit)) {
          const lower = normalized.toLowerCase();
          const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
          const firstLower = firstSentence.toLowerCase();
          const hasTopicAny = Array.isArray(topic.keywords) && topic.keywords.some(k => k && lower.includes(k.toLowerCase()));
          const hasTopicFirst = Array.isArray(topic.keywords) && topic.keywords.some(k => k && firstLower.includes(k.toLowerCase()));
          const shiftPhrases = ['anyway', 'by the way', 'speaking of', "let's talk about", 'different topic', 'unrelated'];
          const hasShift = shiftPhrases.some(p => lower.includes(p));
          // Enforce minimum sentence count in early phase
          const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
          const minSentences = 2;
          // Require first sentence to include a topic keyword; disallow shift phrases if no topic present
          if ((topic.keywords && topic.keywords.length > 0) && (!hasTopicFirst || (hasShift && !hasTopicAny) || (sentences.length < minSentences))) {
            attempt += 1;
            continue; // off-topic, regenerate
          }
        }

        // After bond built: enforce richer multi-sentence output in NSFW mode
        if (nsfwEnabled && !(detectFlirt(rawUserMsg) || userTurns < minTurnsForExplicit)) {
          const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
          if (sentences.length < 3) {
            attempt += 1;
            continue; // too short, regenerate
          }
        }
        previousOutputs.add(normalized);
        aiResponse = content;
        break;
      } catch (error) {
        console.error('Error getting AI response (attempt ' + (attempt+1) + '):', error?.message || error);
        if (attempt === maxAttempts - 1) {
          throw new RateLimitError(error.message || 'Too many requests to the AI service');
        }
        attempt += 1;
      }
    }

    // Final emergency retry if still no content
    if (!aiResponse || (typeof aiResponse === 'string' && aiResponse.trim().length === 0)) {
      try {
        const fallbackResp = await enqueueRequest(
          () => chatCompletion(tryMessages, {
            temperature: 0.85,
            top_p: 0.92,
            repetition_penalty: 1.05,
            presence_penalty: 0.2,
            frequency_penalty: 0.4
          }),
          userId
        );
        const fallbackContent = fallbackResp?.choices?.[0]?.message?.content?.trim();
        if (fallbackContent) {
          aiResponse = fallbackContent;
        }
      } catch (e) {
        console.warn('Final emergency retry failed:', e?.message || e);
      }
    }

    // Free-plan strict length validator: if outside 3–4 sentences, re-prompt once with stricter guard (no local editing)
    if (!isPaidPlan && aiResponse && typeof aiResponse === 'string') {
      // Detect lists and multiple paragraphs
      const hasLineBreak = /[\r\n]/.test(aiResponse);
      const multiParagraph = /\n\s*\n/.test(aiResponse) || (aiResponse.match(/\n/g) || []).length > 0;
      const hasList = /(^|\n)\s*([\-*•]|\d+\.)\s+/m.test(aiResponse);
      // Count sentences robustly
      const sentenceArr = aiResponse.split(/(?<=[.!?])\s+|[\r\n]+/).filter(Boolean);
      const wordCount = (aiResponse.trim().match(/\S+/g) || []).length;
      if (hasList || multiParagraph || sentenceArr.length < 3 || sentenceArr.length > 4 || wordCount < 40 || wordCount > 90) {
        try {
          const strictLengthGuard = {
            role: 'system',
            content: 'STRICT LENGTH: Respond in EXACTLY 3–4 FULL sentences as ONE paragraph, target 60–80 words (min 40, max 90). Do NOT use line breaks, lists, or headings.'
          };
          const strictMessages = [
            tryMessages[0],
            planGuard,
            strictLengthGuard,
            ...tryMessages.slice(1)
          ];
          console.log('Free plan strict re-prompt triggered for user:', userId);
          const strictResp = await enqueueRequest(
            () => chatCompletion(strictMessages, {
              temperature: 0.85,
              top_p: 0.93,
              repetition_penalty: 1.02,
              presence_penalty: 0.3,
              frequency_penalty: 0.3,
              stop: ['\n\n', '\r\n\r\n', '\n- ', '\n* ', '\n1. ', '\n2. '],
              max_tokens: 220
            }),
            userId
          );
          const strictContent = strictResp?.choices?.[0]?.message?.content?.trim();
          if (strictContent) {
            aiResponse = strictContent;
          }
          // Validate again; if still outside range, try a final stricter re-prompt once
          const hasLineBreak2 = /[\r\n]/.test(aiResponse);
          const multiParagraph2 = /\n\s*\n/.test(aiResponse) || (aiResponse.match(/\n/g) || []).length > 0;
          const hasList2 = /(^|\n)\s*([\-*•]|\d+\.)\s+/m.test(aiResponse);
          const sentenceArr2 = (aiResponse || '').split(/(?<=[.!?])\s+|[\r\n]+/).filter(Boolean);
          const wordCount2 = ((aiResponse || '').trim().match(/\S+/g) || []).length;
          if (hasList2 || multiParagraph2 || sentenceArr2.length < 3 || sentenceArr2.length > 4 || wordCount2 < 40 || wordCount2 > 90) {
            const strictestGuard = {
              role: 'system',
              content: 'FINAL ATTEMPT: Output MUST be EXACTLY 3–4 FULL sentences in ONE single paragraph, ~60–80 words (min 40, max 90). NO line breaks, NO lists, NO headings, NO emojis. Stop once you reach 4 sentences.'
            };
            const strictestMessages = [
              tryMessages[0],
              planGuard,
              strictestGuard,
              ...tryMessages.slice(1)
            ];
            const strictestResp = await enqueueRequest(
              () => chatCompletion(strictestMessages, {
                temperature: 0.8,
                top_p: 0.92,
                repetition_penalty: 1.03,
                presence_penalty: 0.25,
                frequency_penalty: 0.35,
                stop: ['\n\n', '\r\n\r\n', '\n- ', '\n* ', '\n1. ', '\n2. '],
                max_tokens: 220
              }),
              userId
            );
            const strictestContent = strictestResp?.choices?.[0]?.message?.content?.trim();
            if (strictestContent) {
              aiResponse = strictestContent;
            }
          }
        } catch (e) {
          console.warn('Strict length re-prompt failed:', e?.message || e);
        }
      }
    }

    // 5.x. VERBATIM MODE: return the model output without any post-processing
    const VERBATIM_MODEL_OUTPUT = true; // do not edit the model's response
    if (!VERBATIM_MODEL_OUTPUT) {
      // 5.0. If NSFW and still off-topic after retries, gently ground to topic with natural phrasing
      if (nsfwEnabled && (detectFlirt(rawUserMsg) || userTurns < minTurnsForExplicit)) {
        const lower = (aiResponse || '').toLowerCase();
        const hasTopic = Array.isArray(topic.keywords) && topic.keywords.some(k => k && lower.includes(k.toLowerCase()));
        if (!hasTopic && topic.keywords && topic.keywords.length > 0) {
          const kw = String(topic.keywords[0] || '').trim();
          const templates = [
            `About ${kw}—`,
            `On ${kw},`,
            `Thinking about ${kw}…`,
            `You mentioned ${kw}—`,
            `Circling back to ${kw}:`,
            `Right, ${kw}—`,
            `As for ${kw},`,
          ];
          const opener = templates[Math.floor(Math.random() * templates.length)] + ' ';
          aiResponse = opener + (aiResponse || '');
        }
      }

      // 5.1. Natural-language detox before humanization
      try {
        if (typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
          let cleaned = aiResponse.trim();
          // Replace robotic openers
          cleaned = cleaned.replace(/^got it about\s+([^.!?]+)[.!?]?\s*/i, (m, kw) => {
            const k = String(kw || '').trim();
            const opts = [
              `About ${k}— `,
              `On ${k}, `,
              `You mentioned ${k}— `,
              `Circling back to ${k}: `,
              `Right, ${k}— `,
              `As for ${k}, `
            ];
            return opts[Math.floor(Math.random() * opts.length)];
          });
          aiResponse = cleaned;
        }
      } catch {}

      // 5.1. Humanize the AI response
      try {
        const characterContext = {
          emotion: character.personality?.emotion || 'neutral',
          intensity: character.personality?.intensity || 3,
          traits: character.personality?.traits || []
        };
        aiResponse = humanizeResponse(aiResponse, characterContext);
      } catch {}

      // 5.2. Moderation post-check for AI response in SFW mode
      if (!nsfwEnabled) {
        const aiModeration = moderateContent(aiResponse, false);
        if (!aiModeration.allowed) {
          aiResponse = aiModeration.sanitized;
        }
      }

      // 5.3. Enforce action formatting (**action**) 1–2 markers
      aiResponse = enforceActionFormatting(aiResponse);

      // 5.4. Apply plan-based response length policy (free vs paid)
      const plan = await getUserPlan(userId);
      const messageType = determineMessageType(rawUserMsg);
      aiResponse = applyResponseLengthPolicy(aiResponse, { plan, messageType });
    }

    // 6. Validate and save messages to database
    // Ensure we have a non-empty AI response before persisting
    if (typeof aiResponse !== 'string' || aiResponse.trim().length === 0) {
      throw new Error('Empty AI response from model');
    }

    // Guard against undefined values before substring
    const safeUserMsg = typeof rawUserMsg === 'string' ? rawUserMsg : String(rawUserMsg ?? '');
    const safeAiMsg = typeof aiResponse === 'string' ? aiResponse : String(aiResponse ?? '');
    let data;
    try {
      console.log('Saving chat messages...');

      // Call the stored procedure; do not chain select/single on RPC
      const { data: result, error } = await supabase.rpc('create_chat_messages', {
        p_session_id: sessionId,
        p_user_id: userId,
        p_character_id: character.id,
        p_user_message: safeUserMsg.slice(0, 1000), // Save exactly what user sent
        p_ai_response: safeAiMsg.slice(0, 1000) // Limit response length
      });

      if (error) {
        console.error('Database error:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      console.log('Database result:', JSON.stringify(result, null, 2));

      if (!result) {
        throw new Error('No data returned from database function');
      }

      if (typeof result === 'object' && result !== null && 'success' in result && result.success === false) {
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
    created_at: msg.created_at ? new Date(msg.created_at).toISOString() : null,
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
      .order('id', { ascending: false }) // Tiebreaker for deterministic order
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
