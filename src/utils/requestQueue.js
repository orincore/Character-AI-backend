import pQueue from 'p-queue';
import { RateLimitError } from '../middleware/errorHandler.js';

// Create a queue with optimized concurrency and rate limiting
const queue = new pQueue({
  concurrency: 100, // Increased concurrent requests
  interval: 1000, // Per second
  intervalCap: 200, // Increased max requests per second
  carryoverConcurrencyCount: true,
  autoStart: true,
  timeout: 30000, // 30 seconds timeout per request
  throwOnTimeout: true,
});

// Track active requests per user
const userQueues = new Map();

/**
 * Get or create a queue for a specific user
 */
function getUserQueue(userId) {
  if (!userQueues.has(userId)) {
    userQueues.set(
      userId,
      new pQueue({
        concurrency: 5, // Increased concurrency per user
        interval: 1000, // Per second
        intervalCap: 10, // Increased to 10 requests per second per user
        carryoverConcurrencyCount: true,
        autoStart: true,
        timeout: 30000,
      })
    );
  }
  return userQueues.get(userId);
}

/**
 * Add a request to the queue with rate limiting
 */
async function enqueueRequest(requestFn, userId = 'anonymous') {
  try {
    const userQueue = getUserQueue(userId);
    
    return await queue.add(() =>
      userQueue.add(requestFn, {
        throwOnTimeout: true,
      })
    );
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new RateLimitError('Request timed out. Please try again.');
    }
    throw error;
  }
}

// Clean up old user queues periodically
setInterval(() => {
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;
  
  for (const [userId, userQueue] of userQueues.entries()) {
    if (userQueue.size === 0 && userQueue.pending === 0) {
      const lastRun = userQueue._lastRun || 0;
      if (lastRun < tenMinutesAgo) {
        userQueues.delete(userId);
      }
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

export { enqueueRequest };
