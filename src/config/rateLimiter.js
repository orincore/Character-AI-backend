import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

// Create Redis client
let redisClient;

// Initialize Redis client
(async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 5000) // Exponential backoff
      }
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });
    
    await redisClient.connect();
    console.log('Connected to Redis for rate limiting');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    // Fallback to in-memory store if Redis fails
    redisClient = null;
  }
})();

// Rate limiting configuration
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { 
    status: 'error',
    message: 'Too many requests, please try again later.'
  },
  // Use Redis store if available, otherwise use in-memory
  store: redisClient 
    ? new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: 'rl:',
      })
    : undefined,
  // Skip rate limiting for certain paths or conditions
  skip: (req) => {
    // Add any paths that shouldn't be rate limited
    const skipPaths = ['/health', '/status'];
    return skipPaths.some(path => req.path.startsWith(path));
  }
});

// Per-user rate limiting
const userRateLimiter = (req, res, next) => {
  // If using authentication, you can use user ID for more granular control
  const userId = req.user?.id || req.ip;
  
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per user
    keyGenerator: () => userId,
    message: { 
      status: 'error',
      message: 'Too many requests from this user, please try again in a minute.'
    },
    store: redisClient 
      ? new RedisStore({
          sendCommand: (...args) => redisClient.sendCommand(args),
          prefix: `user_rl:${userId}:`,
        })
      : undefined,
  })(req, res, next);
};

export { rateLimiter, userRateLimiter };
