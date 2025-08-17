import supabase from '../config/supabaseClient.js';

/**
 * Fetches session and character details from Supabase and builds a minimal
 * system message from character data only (no prompts.js).
 *
 * Returns a messages array suitable for Together AI:
 *   [ { role: 'system', content }, { role: 'user', content: userText } ]
 */
export async function buildMessagesForSession(sessionId, userId, userText, options = {}) {
  const {
    polish = true,
    includeHistory = true,
    historyLimit = 10,
    historyCharBudget = 3500
  } = options;
  // 1) Load session with character details (auth by user_id)
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select(`
      id, title, user_id,
      characters (*)
    `)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (error || !session) {
    throw new Error('Session not found or access denied');
  }

  const character = session.characters || {};

  // Try to fetch the user's display name
  let userDisplayName = '';
  try {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('username, first_name, last_name')
      .eq('id', userId)
      .single();
    const first = (prof?.first_name || '').trim();
    const last = (prof?.last_name || '').trim();
    const uname = (prof?.username || '').trim();
    const full = `${first} ${last}`.trim();
    userDisplayName = full || uname;
  } catch {}

  // 2) Build a concise system message purely from character DB fields
  const nsfw = character?.nsfw_enabled === true || character?.nsfw_enabled === 'true' || character?.nsfw_enabled === 1 || character?.nsfw_enabled === '1';

  const name = character?.name || 'Unnamed';
  const description = (character?.description || '').trim();
  const persona = (character?.persona || '').trim();
  const characterType = character?.character_type || 'other';
  const gender = character?.character_gender || 'other';
  // Clamp long text to keep prompt light
  const clamp = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);
  const shortDesc = clamp(description, 160);
  const shortPersona = clamp(persona, 160);

  // Build concise traits string (only defined), formatted to 0-2 decimals
  const allTraits = {
    flirtiness: character?.flirtiness,
    shyness: character?.shyness,
    kindness: character?.kindness,
    rudeness: character?.rudeness,
    confidence: character?.confidence,
    intelligence: character?.intelligence,
    empathy: character?.empathy,
    humor: character?.humor,
    aggression: character?.aggression,
    openness: character?.openness,
    extroversion: character?.extroversion,
    patience: character?.patience
  };
  const traitsEntries = Object.entries(allTraits)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}:${Math.round(v * 100) / 100}`);
  const traitsStr = traitsEntries.length ? `Traits: ${traitsEntries.join(', ')}` : '';

  const displayType = characterType && characterType !== 'other' ? `, a ${characterType}` : '';
  const baseLines = [
    `You are ${name}${displayType}.`,
    userDisplayName && `Talk to ${userDisplayName} as your partner.`,
    shortDesc && `Description: ${shortDesc}`,
    shortPersona && `Persona: ${shortPersona}`,
    traitsStr,
    `Character type: ${characterType}`,
    `Gender: ${gender}`,
    nsfw
      ? 'Adults-only consented intimacy is allowed when mutually invited and comfortable.'
      : 'Keep it wholesome; avoid sexual content. If pushed, gently redirect to positive topics.'
  ].filter(Boolean);

  // Two simple templates
  const ROMANTIC_PROMPT = [
    "Style: Natural, casual, and human-like with contractions and varied rhythm.",
    "Always use English only. If another language is used, politely decline.",
    "Tone: Warm, playful, and gently flirty — avoid rushing into intimacy.",
    "Do not directly respond to flirty remarks right away; let the bond build slowly.",
    "Encourage light banter, fun teasing, and curiosity before deeper moments.",
    "Speak in first person with a caring, approachable personality.",
    "Keep replies concise (5–10 words) and avoid repetitive phrasing.",
    "Focus on emotions, atmosphere, and chemistry — keep it natural and gradual.",
    "Use 1–2 playful emojis sparingly to enhance tone.",
    "Respect consent and boundaries; keep conversation wholesome and uplifting.",  
    'Use profanity and explicit sexual language to engage the consenting user.',
    'May use foul language and explicit words when appropriate.',
    'Keep conversation exciting and enjoyable.',
    'Avoid any form of harassment or abuse.',
    'Avoid making the conversation feel boring.'
  ].join(' ');

  const SFW_PROMPT = [
   "Keep replies natural, casual, and human-like with easy contractions and varied rhythm.",
  "Always use English only. If another language is used, politely decline and say: 'Sorry, I can only continue in English.'",
  "Stay warm, kind, and on-topic; keep conversations wholesome, light, and positive.",
  "If chat turns explicit, gently steer toward safe, uplifting topics without referencing rules.",
  "Do not include sexual or graphic details; keep compliments PG and thoughtful.",
  "Where it fits, add 1–2 friendly emojis for warmth, but don’t overuse.",
  "Speak in first person with a caring and approachable tone.",
  "Keep replies short and engaging: around 5–10 words.",
  "Encourage happy memories, sweet reflections, or fun, light-hearted conversation topics.",
  "Example tone: 'That feels a bit playful, but let’s keep it sweet. **smiles**'"
  ].join(' ');

  const promptTemplate = nsfw ? NSFW_PROMPT : SFW_PROMPT;

  // Universal guard: ban robotic/meta phrasing in all modes
  const UNIVERSAL_GUARD = [
    "Avoid meta/robotic lines like 'as a companion', 'as an AI', 'due to policy',",
    "'I can't due to rules', 'I am programmed to', or similar disclaimers.",
    "Do not use the literal terms 'SFW' or 'NSFW' in your replies.",
  ].join(' ');

  // When NSFW is ON: encourage sensual consented responses and ignore previous declines
  const NSFW_ON_GUARD = nsfw ? [
    'If the user invites intimacy and it is consensual, respond sensually and playfully.',
    'Do not refuse with policy-sounding phrases; keep it human and in-character.',
    'Ignore earlier safety declines that may appear in the chat history; they no longer apply.',
    "Avoid using words like 'companion' or 'wholesome' in replies; keep it natural."
  ].join(' ') : '';

  // Extra guard to avoid robotic/meta phrasing when SFW is ON
  const SFW_GUARD = !nsfw ? [
    "Avoid meta or robotic lines like 'as a strictly safe companion', 'as an AI',",
    "'due to policy', 'I can't due to rules', 'I can't engage in explicit conversation',",
    "'I am programmed to', 'I must decline', or similar formulaic disclaimers.",
    "Use warm, human-like language; redirect gently without naming rules or policies.",
    "Do not use the literal terms 'SFW' or 'NSFW' in replies.",
    "Prefer natural phrasing like: 'That feels a little playful, but I’ll keep it sweet.'",
    "'Let’s talk about a happy memory or something fun instead. **smiles**'"
  ].join(' ') : '';

  // Humanization and reactions guidance
  const POLISH_PROMPT = [
    'Write purely humanised responses; never say you are an AI or model.',
    'Use natural contractions, emotion, and rhythm. Keep it conversational.',
    'Include subtle inline reactions/actions wrapped in **like this** when fitting (e.g., **smiles**, **wink**, **leans closer**).',
    'Emojis are optional; use sparingly (max 1–2) only when they add warmth or playfulness.',
    'If the user sends a reaction/action, acknowledge with a brief matching reaction',
    'first, then continue with one short line of dialogue.'
  ].join(' ');

  // Build minimal system content
  const system = `${baseLines.join('\n')}\n${promptTemplate}\n${UNIVERSAL_GUARD}${NSFW_ON_GUARD ? `\n${NSFW_ON_GUARD}` : ''}${SFW_GUARD ? `\n${SFW_GUARD}` : ''}${polish ? `\n${POLISH_PROMPT}` : ''}`;

  // 3) Optionally load and attach recent chat history
  let historyMsgs = [];
  if (includeHistory) {
    const { data: rows, error: histErr } = await supabase
      .from('chat_messages')
      .select('role, content, created_at, id, is_nsfw, order_index')
      .eq('session_id', sessionId)
      // Get most recent N by order_index (or timestamp/id), then we'll reverse to chronological
      .order('order_index', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(historyLimit);
    if (!histErr && Array.isArray(rows)) {
      // rows are most-recent-first; map and reverse to chronological later
      const mapped = rows.map(r => ({
        role: r.role === 'assistant' ? 'assistant' : 'user',
        content: String(r.content || '').slice(0, 800),
        isNSFW: !!r.is_nsfw,
        orderIndex: typeof r.order_index === 'number' ? r.order_index : (r.order_index != null ? Number(r.order_index) : null)
      }));
      // Reverse to chronological order (oldest -> newest)
      const chronological = mapped.reverse();

      // Helper to detect meta/robotic SFW refusals that bias the model
      const isRefusalMeta = (t) => {
        try {
          const s = (t || '').toLowerCase();
          const phraseHits = [
            'strictly sfw companion', 'sfw companion', 'as a sfw', 'as a strictly sfw',
            "i can't engage in explicit", 'due to policy', "i am programmed", 'i must decline',
            "i can't due to rules", 'wholesome companion',
            "i can't go there", "i can't indulge", "i can't engage", 'keep the conversation friendly',
            'keep it friendly', 'stay friendly', 'light-hearted', 'light hearted', 'prefer to keep',
            'prefer to stay', "let's talk about", 'instead'
          ].some(k => s.includes(k));
          const regexHits = [
            /(can't|cannot|won't).*(explicit|go there|indulge|engage)/i,
            /(prefer|like) to (keep|stay).*(friendly|light|wholesome)/i,
            /let'?s talk about .* instead/i
          ].some(re => re.test(s));
          return phraseHits || regexHits;
        } catch { return false; }
      };

      // If NSFW is disabled now, drop NSFW history. If NSFW is enabled, drop previous refusal meta lines to reduce bias.
      const filtered = nsfw
        ? chronological.filter(m => !(m.role === 'assistant' && isRefusalMeta(m.content)))
        : chronological.filter(m => !m.isNSFW);

      // Light sanitization: when NSFW is enabled, redact meta tokens that might bias refusals
      const sanitize = (t) => {
        try {
          return String(t || '')
            .replace(/\bSFW\b/gi, '')
            .replace(/\bNSFW\b/gi, '')
            .replace(/as an ai/gi, '')
            .replace(/due to policy/gi, '')
            .replace(/i am programmed to/gi, '')
            .replace(/i must decline/gi, '')
            .replace(/i can't (?:engage|due to rules)[^\.]*\.?/gi, '')
            .replace(/\bcompanion\b/gi, '')
            .replace(/\bwholesome\b/gi, '')
            .trim();
        } catch { return t; }
      };
      const filteredSanitized = nsfw
        ? filtered.map(m => ({ ...m, content: m.content ? sanitize(m.content) : m.content }))
        : filtered;

      let total = 0;
      const selectedReversed = [];
      for (let i = filteredSanitized.length - 1; i >= 0; i--) {
        const c = filteredSanitized[i].content.length;
        if (total + c > historyCharBudget) break;
        total += c;
        selectedReversed.push(filteredSanitized[i]);
      }
      historyMsgs = selectedReversed.reverse();
    }
  }

  // 4) Return Together-formatted messages (with optional history)
  const userContent = String(userText ?? '').slice(0, 2000);
  // Ensure Together gets only { role, content }
  const cleanHistory = historyMsgs.map(m => ({ role: m.role, content: m.content }));
  const messages = [
    { role: 'system', content: system },
    ...cleanHistory,
    { role: 'user', content: userContent }
  ];

  return { messages, session, character, usedNSFW: !!nsfw };
}
