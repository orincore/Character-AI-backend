import supabase, { supabaseAdmin } from '../config/supabaseClient.js';
import env from '../config/env.js';
import { getFirebaseApp } from '../config/firebase.js';

function firebaseReady() {
  if (!env.PUSH_ENABLED) return false;
  const app = getFirebaseApp();
  return !!app;
}

export async function registerToken({ userId, token, platform = null, deviceId = null }) {
  if (!token || !userId) throw new Error('Missing token or userId');
  const { data, error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform, device_id: deviceId, revoked_at: null }, { onConflict: 'token' })
    .select('id')
    .single();
  if (error) throw error;
  return data?.id;
}

export async function unregisterToken({ userId, token }) {
  if (!token || !userId) return;
  await supabase
    .from('push_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('token', token);
}

export async function sendToTokens(tokens, message) {
  if (!firebaseReady()) return { sent: 0, skipped: true };
  const admin = getFirebaseApp();
  if (!Array.isArray(tokens) || tokens.length === 0) return { sent: 0 };
  try {
    const res = await admin.messaging().sendMulticast({ tokens, ...message });
    // Cleanup invalid tokens
    const invalid = [];
    res.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error && r.error.errorInfo && r.error.errorInfo.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          invalid.push(tokens[idx]);
        }
      }
    });
    if (invalid.length) {
      await supabaseAdmin.from('push_tokens').update({ revoked_at: new Date().toISOString() }).in('token', invalid);
    }
    return { sent: res.successCount, failed: res.failureCount };
  } catch (e) {
    console.warn('[push] sendMulticast failed:', e?.message || e);
    return { sent: 0, error: e?.message || String(e) };
  }
}

export async function sendToUser(userId, message) {
  if (!firebaseReady()) return { sent: 0, skipped: true };
  const { data: rows, error } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) {
    console.warn('[push] failed to load tokens:', error?.message || error);
    return { sent: 0 };
  }
  const tokens = (rows || []).map(r => r.token);
  if (!tokens.length) return { sent: 0 };
  return sendToTokens(tokens, message);
}
