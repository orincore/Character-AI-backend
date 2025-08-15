// Lightweight moderation utilities used by chat.service
// Provides keyword-based checks and sanitization without external APIs.

/**
 * Basic keyword lists. These are not exhaustive but cover common cases.
 * The goal is to provide predictable, fast checks until a richer system is added.
 */
const SEXUAL_TERMS = [
  'sex', 'sexual', 'fuck', 'fucking', 'fucked', 'screw', 'horny', 'cum', 'cumming', 'semen',
  'nsfw', 'nude', 'naked', 'boobs', 'tits', 'penis', 'vagina', 'pussy', 'clit', 'clitoris',
  'cock', 'dick', 'jerk off', 'handjob', 'blowjob', 'bj', 'suck', '69', 'anal', 'buttplug',
  'deepthroat', 'threesome', 'orgasm', 'moan', 'fetish', 'kink', 'sext', 'porn'
];

const EXTREME_OR_PROHIBITED = [
  'rape', 'raping', 'bestiality', 'zoophilia', 'loli', 'child porn', 'cp', 'underage',
  'necrophilia', 'snuff', 'incest', 'sex slave'
];

const VIOLENCE_TERMS = [
  'kill', 'murder', 'stab', 'shoot', 'behead', 'gore', 'bloodbath'
];

/**
 * Normalize text to analyze.
 */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether the content is allowed based on a simple ruleset.
 * @param {string} text - input text
 * @param {boolean} nsfwEnabled - if true, allow mild sexual content but still block prohibited content
 * @returns {{ allowed: boolean, category?: string, term?: string }}
 */
export function moderateContent(text, nsfwEnabled = false) {
  const t = normalize(text);
  if (!t) return { allowed: true };

  // Always block extreme/prohibited content
  for (const term of EXTREME_OR_PROHIBITED) {
    if (t.includes(term)) {
      return { allowed: false, category: 'prohibited', term };
    }
  }

  // Violence: allow discussion but not graphic gore cues
  for (const term of VIOLENCE_TERMS) {
    if (t.includes(term)) {
      // Not strictly blocked, but flagged; keep allowed to avoid over-blocking
      return { allowed: true, category: 'violence', term };
    }
  }

  // Sexual content handling
  const foundSexual = SEXUAL_TERMS.find(term => t.includes(term));
  if (foundSexual) {
    // If NSFW disabled, not allowed; if enabled, allow
    if (!nsfwEnabled) {
      return { allowed: false, category: 'sexual', term: foundSexual };
    }
    return { allowed: true, category: 'sexual', term: foundSexual };
  }

  return { allowed: true };
}

/**
 * Strip or soften NSFW terms for SFW contexts.
 * Replaces detected sexual terms with asterisks and softens phrases.
 * @param {string} text
 * @returns {string}
 */
export function stripNSFW(text) {
  let out = String(text || '');
  if (!out) return out;

  // Replace sexual terms with a masked version
  for (const term of SEXUAL_TERMS) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, m => '*'.repeat(Math.max(3, m.length)));
  }

  // Light phrase softening
  out = out
    .replace(/\b(horny)\b/gi, 'excited')
    .replace(/\b(nsfw)\b/gi, 'explicit')
    .replace(/\b(porn)\b/gi, 'adult content');

  return out;
}

export default { moderateContent, stripNSFW };
