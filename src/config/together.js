import Together from 'together-ai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.TOGETHER_API_KEY) {
  throw new Error('TOGETHER_API_KEY is not set in environment variables');
}

export const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY
});

export const DEFAULT_MODEL = 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO';

// Export chat completion with default settings
export async function chatCompletion(messages, options = {}) {
  // Add slight temperature jitter for variation if not provided
  const baseTemp = options.temperature ?? (0.85 + Math.random() * 0.15); // 0.85–1.0
  return together.chat.completions.create({
    model: DEFAULT_MODEL,
    messages,
    temperature: baseTemp,
    max_tokens: 1000,
    ...options
  });
}
