import { rateLimiter } from '../config/redis.js';
import { RateLimitError } from './errorHandler.js';

/**
 * Rate limiter middleware
 * @param {Object} options - Rate limiter options
 * @param {number} options.points - Maximum number of points (requests) that can be consumed
 * @param {number} options.duration - Duration in seconds for the rate limit window
 * @param {string} options.keyPrefix - Prefix for the rate limiter key
 * @returns {Function} Express middleware function
 */
const apiRateLimiter = (options = {}) => {
  const { 
    points = 300, // default per-minute points
    duration = 60, // window in seconds
    keyPrefix = 'rl',
    skip = () => false // Optional skip function
  } = options;

  return async (req, res, next) => {
    try {
      // TEMPORARY: Skip rate limiting in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV] Rate limiting disabled for ${req.method} ${req.path}`);
        return next();
      }

      // Allow callers to skip (e.g., health, websockets, streams)
      if (skip(req)) {
        return next();
      }

      // Prefer device ID header for mobile, then authenticated user ID, then IP
      const deviceId = req.headers['x-device-id'];
      const subject = deviceId || (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`);
      // Include path to isolate endpoints and reduce cross-endpoint contention
      const pathKey = req.path || req.originalUrl || '';
      const rateLimitKey = `${keyPrefix}:${subject}:${pathKey}`;

      const result = await rateLimiter.consume(rateLimitKey, points, duration);

      // Add rate limit headers to response for client-side handling
      res.set({
        'X-RateLimit-Limit': String(points),
        'X-RateLimit-Remaining': String(result.remainingPoints),
        'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString()
      });

      return next();
    } catch (error) {
      console.error('Rate limit exceeded:', error);

      // Correct Retry-After to seconds (duration is already seconds)
      res.set('Retry-After', String(Math.ceil(duration)));

      return next(new RateLimitError());
    }
  };
};

/**
 * Strict rate limiter for sensitive endpoints (like login, signup)
 */
const strictRateLimiter = apiRateLimiter({
  points: 5,         // 5 requests
  duration: 60 * 15, // Per 15 minutes
  keyPrefix: 'strict_rl',
});

/**
 * Standard rate limiter for API endpoints
 */
const standardRateLimiter = apiRateLimiter({
  points: 500,      // 500 requests (increased for mobile apps)
  duration: 60,     // Per minute
  keyPrefix: 'api_rl',
});

/**
 * Chat-specific rate limiter (more permissive for real-time chat)
 */
const chatRateLimiter = apiRateLimiter({
  points: 1000,     // 1000 requests
  duration: 60,     // Per minute
  keyPrefix: 'chat_rl',
});

/**
 * Burst-friendly rate limiter for concurrent requests
 */
const burstRateLimiter = apiRateLimiter({
  points: 50,       // 50 requests
  duration: 10,     // Per 10 seconds (allows bursts)
  keyPrefix: 'burst_rl',
});

export { 
  apiRateLimiter, 
  strictRateLimiter, 
  standardRateLimiter,
  chatRateLimiter,
  burstRateLimiter
};
