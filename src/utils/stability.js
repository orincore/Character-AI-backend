import axios from 'axios';
import FormData from 'form-data';

/**
 * Generate an image with Stability AI and return a Buffer
 * @param {object} options
 * @param {string} options.prompt - Text prompt
 * @param {string} [options.output_format='webp'] - 'png' | 'jpg' | 'webp'
 * @param {number} [options.width] - Optional width
 * @param {number} [options.height] - Optional height
 * @param {number} [options.seed] - Optional seed
 * @param {string} [options.model='ultra'] - Stability model path segment
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
export async function generateImageWithStability({
  prompt,
  output_format = 'webp',
  width,
  height,
  seed,
  model = 'ultra',
}) {
  if (!process.env.STABILITY_API_KEY) {
    throw new Error('Missing STABILITY_API_KEY');
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required');
  }

  const payload = {
    prompt,
    output_format,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };

  const url = `https://api.stability.ai/v2beta/stable-image/generate/${encodeURIComponent(model)}`;
  const form = axios.toFormData(payload, new FormData());

  const response = await axios.postForm(url, form, {
    validateStatus: undefined,
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
      Accept: 'image/*',
    },
    timeout: 60000,
  });

  if (response.status !== 200) {
    const text = Buffer.from(response.data || '').toString();
    throw new Error(`Stability API error ${response.status}: ${text}`);
  }

  const buffer = Buffer.from(response.data);
  const contentType = output_format === 'png'
    ? 'image/png'
    : output_format === 'jpg' || output_format === 'jpeg'
      ? 'image/jpeg'
      : 'image/webp';

  return { buffer, contentType };
}
