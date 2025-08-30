import Together from 'together-ai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.TOGETHER_API_KEY) {
  throw new Error('TOGETHER_API_KEY is not set in environment variables');
}

export const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY
});

// Prefer a serverless-available model by default; allow env override
// You can set TOGETHER_MODEL to pin a specific model
export const DEFAULT_MODEL = process.env.TOGETHER_MODEL || 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';

// Known good serverless models to try as fallbacks
const SERVERLESS_FALLBACKS = [
  DEFAULT_MODEL,
  'mistralai/Mixtral-8x7B-Instruct-v0.1',
  'Qwen/Qwen2.5-7B-Instruct',
  'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'
];

// Export chat completion with default settings and robust fallback handling
export async function chatCompletion(messages, options = {}) {
  // Add slight temperature jitter for variation if not provided
  const baseTemp = options.temperature ?? (0.85 + Math.random() * 0.15); // 0.85–1.0

  // Determine model preference order: explicit option -> default -> fallbacks
  const preferred = options.model || DEFAULT_MODEL;
  const candidates = Array.from(new Set([preferred, ...SERVERLESS_FALLBACKS]));
  let lastErr;

  for (const model of candidates) {
    try {
      return await together.chat.completions.create({
        model,
        messages,
        temperature: baseTemp,
        max_tokens: 1000,
        ...options,
        model // ensure our chosen candidate wins even if options.model is set
      });
    } catch (err) {
      // If the error indicates the model is not serverless-available, try the next candidate
      const msg = err?.message || '';
      const code = err?.error?.error?.code || err?.error?.code || err?.code;
      const isNotAvailable =
        code === 'model_not_available' || /non-serverless/i.test(msg) || /create and start a new dedicated endpoint/i.test(msg);
      lastErr = err;
      if (isNotAvailable) {
        continue; // try next model
      }
      // Other errors: rethrow immediately
      throw err;
    }
  }
  // If we exhausted candidates, throw the last error for visibility
  throw lastErr || new Error('Together.ai chat completion failed with no available models');
}
