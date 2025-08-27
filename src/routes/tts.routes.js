import express from 'express';
import crypto from 'crypto';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { protect } from '../middleware/auth.middleware.js';
import { apiRateLimiter } from '../middleware/rateLimiter.js';
import env from '../config/env.js';
import { redisClient } from '../config/redis.js';
import { uploadToS3 } from '../config/s3.js';

const router = express.Router();

// Per-user, per-endpoint limiter (burst friendly)
const ttsLimiter = apiRateLimiter({ points: 60, duration: 60, keyPrefix: 'tts_rl' });

// Polly client
const polly = new PollyClient({
  region: env.AWS_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined,
});

// Map simple reactions to short SSML snippets
function reactionToSSML(reaction) {
  const r = String(reaction || '').toLowerCase();
  switch (r) {
    case 'smiles':
      return '<speak><prosody pitch="high">mmm</prosody></speak>';
    case 'laughs':
      return '<speak><prosody rate="fast" pitch="high">haha</prosody></speak>';
    case 'sighs':
      return '<speak><prosody rate="slow" pitch="low">sigh</prosody></speak>';
    case 'whispers':
      return '<speak><amazon:effect name="whispered">whispers</amazon:effect></speak>';
    default:
      return null;
  }
}

function wrapTextAsSSML(text) {
  // Basic SSML wrapper; keep simple to avoid Polly validation errors
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<speak>${escaped}</speak>`;
}

function buildCacheKey(payload) {
  const { text = '', voiceId = '', engine = 'neural', languageCode = '', reaction = '' } = payload || {};
  const data = JSON.stringify({ text, voiceId, engine, languageCode, reaction });
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return `tts:polly:${hash}`;
}

router.post('/polly', protect, ttsLimiter, async (req, res) => {
  try {
    const { text, voiceId, engine = 'neural', languageCode, reaction, format = 'mp3' } = req.body || {};

    // Basic validation
    if (!voiceId) return res.status(400).json({ error: 'voiceId is required' });
    if (!languageCode) return res.status(400).json({ error: 'languageCode is required' });

    const useReaction = reaction && reactionToSSML(reaction);
    if (!useReaction && (!text || typeof text !== 'string')) {
      return res.status(400).json({ error: 'text is required when reaction is not provided' });
    }
    const content = useReaction ? '' : String(text);
    if (content.length > 1500) {
      return res.status(400).json({ error: 'text too long (max 1500 characters)' });
    }

    // Cache check
    const cacheKey = buildCacheKey({ text, voiceId, engine, languageCode, reaction });
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      try {
        return res.status(200).json(JSON.parse(cached));
      } catch {}
    }

    // Prepare SSML
    const ssml = useReaction ? useReaction : wrapTextAsSSML(content);

    // Synthesize
    const outputFormat = (String(format || 'mp3').toLowerCase() === 'ogg') ? 'ogg_vorbis' : 'mp3';
    const cmd = new SynthesizeSpeechCommand({
      Engine: engine === 'neural' ? 'neural' : 'standard',
      VoiceId: voiceId,
      LanguageCode: languageCode,
      OutputFormat: outputFormat,
      TextType: 'ssml',
      Text: ssml,
    });

    const result = await polly.send(cmd);
    const audioBuffer = Buffer.from(await result.AudioStream?.transformToByteArray?.() || []);

    // Decide: S3 or base64
    const canUpload = Boolean(env.S3_BUCKET || env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET);

    if (canUpload) {
      const prefix = (process.env.TTS_S3_PREFIX || 'tts').replace(/^\/+|\/+$/g, '');
      const ts = Date.now();
      const key = `${prefix}/${voiceId}/${ts}-${cacheKey.slice(-12)}.${outputFormat === 'mp3' ? 'mp3' : 'ogg'}`;

      const upload = await uploadToS3({
        Key: key,
        Body: audioBuffer,
        ContentType: outputFormat === 'mp3' ? 'audio/mpeg' : 'audio/ogg',
        Metadata: {
          voiceId,
          engine,
          languageCode,
          reaction: String(reaction || ''),
        }
      });

      const response = { url: upload.url, format: outputFormat, key: upload.key || key };
      await redisClient.set(cacheKey, JSON.stringify(response), 60 * 60 * 24); // 24h
      return res.status(200).json(response);
    }

    // Fallback: base64
    const audioBase64 = audioBuffer.toString('base64');
    const response = { audioBase64, format: outputFormat };
    await redisClient.set(cacheKey, JSON.stringify(response), 60 * 60 * 6); // 6h
    return res.status(200).json(response);
  } catch (err) {
    console.error('[TTS Polly] error:', err);
    const code = err?.$metadata?.httpStatusCode || 500;
    return res.status(code >= 400 && code < 600 ? code : 500).json({ error: err?.message || 'TTS failed' });
  }
});

export default router;
