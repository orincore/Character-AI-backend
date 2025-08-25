import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createClient } from 'redis';
import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import os from 'os';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

// Routes
import authRoutes from './routes/auth.routes.js';
import characterRoutes from './routes/character.routes.js';
import chatRoutes from './routes/chat.routes.js';

// Middleware
import errorHandler, { handleRateLimit } from './middleware/errorHandler.js';
import { standardRateLimiter, strictRateLimiter } from './middleware/rateLimiter.js';

// Config
import env from './config/env.js';
import { redisClient } from './config/redis.js';

// Initialize Express
const app = express();
const PORT = env.PORT || 5000;

// Security middleware
app.use(helmet());

// Enhanced CORS for mobile (Expo) and web
const isProd = env.NODE_ENV === 'production';
const devAllowedOrigins = [
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'exp://',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
];

const configuredOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const corsOptions = {
  origin: isProd
    ? configuredOrigins
    : function (origin, callback) {
        // In dev: allow all localhost and Expo origins
        if (!origin) return callback(null, true);
        if (devAllowedOrigins.some(prefix => origin.startsWith(prefix))) {
          return callback(null, true);
        }
        // Also allow anything specified in CORS_ORIGIN
        if (configuredOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Fallback: allow in dev
        return callback(null, true);
      },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']
};

app.use(cors(corsOptions));

// Rate limiting with Redis - More permissive settings for high concurrency
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute (reduced from 15 minutes)
  max: 300, // Increased from 100 to 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  store: redisClient.isConnected 
    ? new RedisStore({
        sendCommand: (...args) => redisClient.client.sendCommand(args),
        prefix: 'rl:',
      })
    : undefined,
  handler: handleRateLimit,
  message: 'Too many requests from this IP, please try again after a minute',
  onLimitReached: (req, res, options) => {
    console.warn(`Rate limit reached for IP: ${req.ip}`);
  }
});

// Apply rate limiting only to auth routes (most restrictive)
app.use('/api/v1/auth', strictRateLimiter);

// Note: Chat routes have their own chatRateLimiter applied in chat.routes.js
// Other API routes will use the route-specific rate limiters

// Increase the server timeout to handle long-running requests
app.timeout = 30000; // 30 seconds

// Increase the maximum number of event listeners
process.setMaxListeners(20);

// Optimize the server for handling many concurrent connections
const startServer = () => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
    
    // Log memory usage
    const used = process.memoryUsage();
    for (let key in used) {
      console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
    }
  });

  // Handle server errors
  const closeServer = () => {
    console.log('Shutting down server...');
    server.close(() => {
      console.log('Server closed');
      if (redisClient.isConnected) {
        redisClient.client.quit();
      }
      process.exit(0);
    });
  };

  // Handle process termination
  process.on('SIGTERM', closeServer);
  process.on('SIGINT', closeServer);

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    closeServer();
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    closeServer();
  });

  return server;
};

// Start the server
const server = startServer();

// Helper: get top processes by CPU and Memory using `ps` (works on Linux/macOS)
const execAsync = promisify(execCb);
async function getTopProcesses(limit = 5) {
  try {
    // pid ppid comm %cpu %mem rss(KB)
    const { stdout } = await execAsync('ps -Ao pid,ppid,comm,%cpu,%mem,rss');
    const lines = stdout.trim().split('\n');
    const header = lines.shift();
    const list = lines
      .map((l) => l.trim().split(/\s+/))
      .filter((cols) => cols.length >= 6)
      .map((cols) => {
        const pid = parseInt(cols[0], 10);
        const ppid = parseInt(cols[1], 10);
        const command = cols[2];
        const cpuPercent = parseFloat(cols[3]);
        const memPercent = parseFloat(cols[4]);
        const rssKB = parseInt(cols[5], 10);
        return {
          pid,
          ppid,
          command,
          cpuPercent: isNaN(cpuPercent) ? 0 : cpuPercent,
          memPercent: isNaN(memPercent) ? 0 : memPercent,
          rssMB: Number(((isNaN(rssKB) ? 0 : rssKB) / 1024).toFixed(2)),
        };
      });
    const byCpu = [...list].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, limit);
    const byMem = [...list].sort((a, b) => b.memPercent - a.memPercent).slice(0, limit);
    return { byCpu, byMem };
  } catch (err) {
    return { error: err.message };
  }
}

// Small helper to sleep for ms (top-level)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Health check endpoint
app.get('/health', async (req, res) => {
  // System and process metrics
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = totalMem > 0 ? Number(((usedMem / totalMem) * 100).toFixed(2)) : null;
  const cores = os.cpus()?.length || 1;
  const load = os.loadavg();
  const loadPct1m = Number(((load[0] / cores) * 100).toFixed(2));
  const top = await getTopProcesses(5);

  // Sample process CPU usage over a short window for a more intuitive percent
  // Also sample system CPU percent over the same window
  const cpuTimesStart = os.cpus().reduce((acc, c) => {
    const t = c.times; return {
      idle: acc.idle + t.idle,
      total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
    };
  }, { idle: 0, total: 0 });
  const startCpu = process.cpuUsage();
  const startHr = process.hrtime.bigint();
  await sleep(250);
  const deltaCpu = process.cpuUsage(startCpu);
  const endHr = process.hrtime.bigint();
  const elapsedMicros = Number(endHr - startHr) / 1000; // ns -> µs
  const procCpuPercent = elapsedMicros > 0
    ? Number((((deltaCpu.user + deltaCpu.system) / (elapsedMicros * cores)) * 100).toFixed(2))
    : null;
  const cpuTimesEnd = os.cpus().reduce((acc, c) => {
    const t = c.times; return {
      idle: acc.idle + t.idle,
      total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
    };
  }, { idle: 0, total: 0 });
  const totalDelta = cpuTimesEnd.total - cpuTimesStart.total;
  const idleDelta = cpuTimesEnd.idle - cpuTimesStart.idle;
  const systemCpuPercent = totalDelta > 0
    ? Number((((totalDelta - idleDelta) / totalDelta) * 100).toFixed(2))
    : null;
  const procMemPercent = totalMem > 0 ? Number(((mem.rss / totalMem) * 100).toFixed(2)) : null;

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    summary: {
      cpuPercent: systemCpuPercent,     // system CPU% over ~250ms
      memoryPercent: memPct,            // system memory usage percent
      systemCpuPercent,
      processCpuPercent: procCpuPercent,
      systemMemPercent: memPct,
      processMemPercent: procMemPercent,
    },
    app: {
      env: env.NODE_ENV,
      version: process.version,
      pid: process.pid,
      uptimeSec: Number(process.uptime().toFixed(2)),
      redis: redisClient.isConnected ? 'connected' : 'disconnected',
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      uptimeSec: os.uptime(),
      cores,
      loadAvg: {
        '1m': Number(load[0].toFixed(2)),
        '5m': Number(load[1].toFixed(2)),
        '15m': Number(load[2].toFixed(2)),
        cpuPercent1mApprox: loadPct1m,
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usedPercent: memPct,
      },
    },
    process: {
      memoryMB: {
        rss: Number((mem.rss / 1024 / 1024).toFixed(2)),
        heapTotal: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
        heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
        external: Number((mem.external / 1024 / 1024).toFixed(2)),
        arrayBuffers: Number((mem.arrayBuffers / 1024 / 1024).toFixed(2)),
      },
      cpuMicros: {
        user: cpu.user,
        system: cpu.system,
      },
      cpuPercentSampled: procCpuPercent,
    },
    topProcesses: top,
  });
});

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Health check
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ 
    status: 'success', 
    message: 'Server is running',
    timestamp: new Date().toISOString() 
  });
});

// Import test routes
import testRoutes from './routes/test.routes.js';

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/characters', characterRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/test', testRoutes);

// 404 handler
app.all('*', (req, res, next) => {
  res.status(404).json({
    status: 'fail',
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server (handled by startServer function)

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    console.log('💥 Process terminated!');
  });
});

export { app, server };
