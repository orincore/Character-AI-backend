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
    points = 300, // Increased from 100 to 300 requests
    duration = 60, // Per minute
    keyPrefix = 'rl',
    skip = () => false // Optional skip function
  } = options;

  return async (req, res, next) => {
    try {
      // Skip rate limiting for certain paths
      if (skip(req)) {
        return next();
      }
      
      // Use IP address or user ID if authenticated
      const key = req.user?.id || req.ip;
      const rateLimitKey = `${keyPrefix}:${key}`;

      const result = await rateLimiter.consume(rateLimitKey, points, duration);
      
      // Add rate limit headers to response
      res.set({
        'X-RateLimit-Limit': points,
        'X-RateLimit-Remaining': result.remainingPoints,
        'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString()
      });
      
      next();
    } catch (error) {
      console.error('Rate limit exceeded:', error);
      
      // Add retry-after header
      res.set('Retry-After', Math.ceil(duration / 1000));
      
      next(new RateLimitError());
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
  points: 100,      // 100 requests
  duration: 60,     // Per minute
  keyPrefix: 'api_rl',
});

export { 
  apiRateLimiter, 
  strictRateLimiter, 
  standardRateLimiter 
};
