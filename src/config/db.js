import { createPool } from 'pg';
import env from './env.js';

export const pool = createPool({
  connectionString: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/character_ai',
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export const query = (text, params) => pool.query(text, params);
