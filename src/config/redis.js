import { createClient } from 'redis';

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.initialize();
  }

  async initialize() {
    try {
      const redisOptions = {
        username: process.env.REDIS_USERNAME || 'default',
        password: process.env.REDIS_PASSWORD,
        socket: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
          connectTimeout: 5000,
          keepAlive: 30000,
          reconnectStrategy: (retries) => {
            console.log(`Redis reconnection attempt ${retries + 1}`);
            if (retries > 5) {
              console.error('Too many retries on Redis. Connection Terminated');
              return new Error('Too many retries on Redis.');
            }
            return 1000; // Retry after 1 second
          }
        },
        // Enable ready checking to ensure we're connected before using
        enableReadyCheck: true,
        // Enable auto-resubscribing on reconnection
        autoResubscribe: true,
        // Enable auto-resending unfulfilled commands on reconnection
        autoResendUnfulfilledCommands: true,
      };
      
      console.log('Initializing Redis connection...');

      this.client = createClient(redisOptions);

      // Handle connection events
      this.client.on('connect', () => {
        console.log('Redis client connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        console.log('Redis client ready');
      });

      this.client.on('reconnecting', () => {
        this.isConnected = false;
        console.log('Redis client reconnecting...');
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        this.isConnected = false;
        console.log('Redis client disconnected');
      });

      await this.client.connect();
      console.log('Successfully connected to Redis Cloud');
      
      // Verify connection with a ping
      try {
        const pong = await this.client.ping();
        console.log('Redis ping response:', pong);
      } catch (pingError) {
        console.error('Redis ping failed:', pingError);
        throw pingError;
      }
      
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      throw error; // Re-throw to allow handling in the application
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  
  async set(key, value, ttl = 3600) {
    if (!this.isConnected) return false;
    try {
      await this.client.set(key, value, {
        EX: ttl, // Expire after ttl seconds
        NX: true, // Only set the key if it does not already exist
      });
      return true;
    } catch (error) {
      console.error('Redis set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Redis del error:', error);
      return false;
    }
  }

  async increment(key, ttl = 3600) {
    if (!this.isConnected) return null;
    try {
      // Increment the counter
      const current = await this.client.incr(key);
      // Only set expiry when the key is first created (value becomes 1)
      if (current === 1) {
        await this.client.expire(key, ttl);
      }
      return current;
    } catch (error) {
      console.error('Redis increment error:', error);
      return null;
    }
  }
}

// Create a singleton instance
const redisClient = new RedisClient();

export { redisClient };

// Export a simple interface for the rate limiter
export const rateLimiter = {
  consume: async (key, points, duration) => {
    const rateLimitKey = `rate_limit:${key}`;
    const current = await redisClient.increment(rateLimitKey, duration);
    
    if (current !== null && current > points) {
      throw new Error('Rate limit exceeded');
    }
    
    return {
      remainingPoints: points - (current || 0),
      msBeforeNext: duration * 1000,
      consumedPoints: current || 1,
    };
  },
};
