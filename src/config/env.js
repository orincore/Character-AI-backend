import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const env = {
  // App
  PORT: process.env.PORT || '5000',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  APP_URL: process.env.APP_URL, // optional, for building absolute links in emails
  SECURITY_ALERTS_ENABLED: String(process.env.SECURITY_ALERTS_ENABLED || 'true').toLowerCase() === 'true',
  // Nudges (random character pings)
  NUDGE_ENABLED: String(process.env.NUDGE_ENABLED || 'false').toLowerCase() === 'true',
  NUDGE_MIN_INACTIVE_HOURS: process.env.NUDGE_MIN_INACTIVE_HOURS || '24',
  NUDGE_MAX_PER_DAY: process.env.NUDGE_MAX_PER_DAY || '1',
  NUDGE_BATCH_LIMIT: process.env.NUDGE_BATCH_LIMIT || '25',
  NUDGE_TICK_SECONDS: process.env.NUDGE_TICK_SECONDS || '300', // how often the worker ticks
  NUDGE_EMAIL_ENABLED: String(process.env.NUDGE_EMAIL_ENABLED || 'false').toLowerCase() === 'true',
  NUDGE_EMAIL_ONLY_IF_VERIFIED: String(process.env.NUDGE_EMAIL_ONLY_IF_VERIFIED || 'true').toLowerCase() === 'true',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '90d',
  JWT_COOKIE_EXPIRES_IN: process.env.JWT_COOKIE_EXPIRES_IN || '90',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'clyra_ai'}`,
  
  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  
  // Together AI
  TOGETHER_API_KEY: process.env.TOGETHER_API_KEY,
  
  // Push (Firebase FCM)
  PUSH_ENABLED: String(process.env.PUSH_ENABLED || 'false').toLowerCase() === 'true',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  
  // AWS
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  // Prefer S3_BUCKET; keep legacy names for compatibility
  S3_BUCKET: process.env.S3_BUCKET,
  S3_BUCKET_NAME: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
  // CloudFront/CF domain for public asset URLs
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,

  // SMTP / Email
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,

  // Branding
  APP_NAME: process.env.APP_NAME || 'Clyra AI'
};

// Validate required environment variables
const requiredVars = [
  'JWT_SECRET',
  'TOGETHER_API_KEY'
  // Note: Supabase and AWS are optional for initial testing
];

for (const key of requiredVars) {
  if (!env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

export default env;
