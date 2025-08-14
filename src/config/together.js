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
  return together.chat.completions.create({
    model: DEFAULT_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1000,
    ...options
  });
}
