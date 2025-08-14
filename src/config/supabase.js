import { createClient } from '@supabase/supabase-js';
import env from './env.js';

// Initialize Supabase client
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false // We'll handle sessions manually
    }
  }
);

// Service role client for admin operations (if needed)
export const supabaseAdmin = env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;
