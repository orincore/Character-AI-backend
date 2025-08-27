import { Router } from 'express';
import supabase from '../config/supabaseClient.js';
import { protect } from '../middleware/auth.middleware.js';
import env from '../config/env.js';
import { registerToken, unregisterToken, sendToUser } from '../services/push.service.js';
import { generateNudgeViaAI, insertAssistantMessage, maybeSendEmailNudge } from '../jobs/nudge.service.js';

const router = Router();

// GET /api/notifications/pings?limit=20
// Returns recent nudge messages for the authenticated user, newest first
router.get('/pings', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));

    // Find user's sessions first to avoid RLS issues
    const { data: sessions, error: sessErr } = await supabase
      .from('chat_sessions')
      .select('id, character_id')
      .eq('user_id', userId);
    if (sessErr) return res.status(500).json({ status: 'error', message: 'Failed to fetch sessions' });

// POST /api/v1/notifications/test
// Triggers a test nudge: generates content, inserts assistant message (metadata.nudge=true),
// sends email (if enabled) and push (if enabled). Accepts optional { session_id }.
router.post('/test', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    let { session_id } = req.body || {};

    // Resolve a session: use body.session_id or pick the most recent for this user
    if (!session_id) {
      const { data: recent, error: sErr } = await supabase
        .from('chat_sessions')
        .select('id, character_id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle?.() || await supabase
          .from('chat_sessions')
          .select('id, character_id')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1);
      if (sErr) return res.status(400).json({ status: 'fail', message: 'No session found for user' });
      const chosen = Array.isArray(recent) ? recent[0] : recent;
      if (!chosen?.id) return res.status(400).json({ status: 'fail', message: 'No session found for user' });
      session_id = chosen.id;
    }

    // Load character (for email title)
    const { data: sess, error: sessErr } = await supabase
      .from('chat_sessions')
      .select('id, character_id')
      .eq('id', session_id)
      .single();
    if (sessErr || !sess) return res.status(404).json({ status: 'fail', message: 'Session not found' });

    let character = null;
    if (sess.character_id) {
      const { data: ch } = await supabase
        .from('characters')
        .select('id, name, avatar_url')
        .eq('id', sess.character_id)
        .single();
      character = ch || null;
    }

    // Generate content via AI with fallback
    let content = '';
    try {
      content = (await generateNudgeViaAI(session_id, userId)) || '';
    } catch {}
    if (!content) {
      const name = character?.name || 'Hey';
      const fallback = [
        `${name} here — miss me? **smiles**`,
        `Got a minute? I was thinking about you. **grins**`,
        `Wanna pick up where we left off? **tilts head**`,
        `I found something fun to chat about. Come? **waves**`,
        `Hey, you. I’ve got a thought. **leans closer**`
      ];
      content = fallback[Math.floor(Math.random() * fallback.length)];
    }

    // Insert assistant message (with metadata.nudge)
    await insertAssistantMessage(session_id, content, false);

    // Email (optional)
    await maybeSendEmailNudge(userId, character);

    // Push (optional)
    if (env.PUSH_ENABLED) {
      const title = `${character?.name || 'New message'}`;
      const body = content.length > 120 ? content.slice(0, 117) + '…' : content;
      await sendToUser(userId, {
        notification: { title, body },
        data: {
          type: 'nudge',
          session_id: String(session_id),
          character_id: sess.character_id ? String(sess.character_id) : '',
        }
      });
    }

    return res.json({ status: 'ok', session_id, content });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Failed to send test ping' });
  }
});
    const sessionIds = (sessions || []).map(s => s.id);
    if (sessionIds.length === 0) return res.json({ status: 'ok', items: [] });

    // Fetch nudges from chat_messages.metadata.nudge = true
    const { data: msgs, error: msgErr } = await supabase
      .from('chat_messages')
      .select('id, session_id, role, content, created_at, order_index, metadata')
      .in('session_id', sessionIds)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit * 2); // fetch extra then filter client-side for metadata flag
    if (msgErr) return res.status(500).json({ status: 'error', message: 'Failed to fetch notifications' });

    const nudges = (msgs || []).filter(m => m?.metadata && (m.metadata.nudge === true || m.metadata.nudge === 'true'));

    // Map with session + character for UI
    const bySession = new Map((sessions || []).map(s => [s.id, s]));
    const items = nudges.slice(0, limit).map(m => {
      const s = bySession.get(m.session_id);
      return {
        id: m.id,
        type: 'nudge',
        session_id: m.session_id,
        character_id: s?.character_id || null,
        title: 'New message',
        body: m.content,
        created_at: m.created_at,
      };
    });

    return res.json({ status: 'ok', items });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Unexpected error' });
  }
});

export default router;

// Register a device push token
router.post('/tokens', protect, async (req, res) => {
  try {
    if (!env.PUSH_ENABLED) return res.status(200).json({ status: 'ok', skipped: true });
    const userId = req.user.id;
    const { token, platform, deviceId } = req.body || {};
    if (!token) return res.status(400).json({ status: 'fail', message: 'token required' });
    await registerToken({ userId, token, platform, deviceId });
    return res.json({ status: 'ok' });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Failed to register token' });
  }
});

// Unregister a device push token
router.delete('/tokens', protect, async (req, res) => {
  try {
    if (!env.PUSH_ENABLED) return res.status(200).json({ status: 'ok', skipped: true });
    const userId = req.user.id;
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ status: 'fail', message: 'token required' });
    await unregisterToken({ userId, token });
    return res.json({ status: 'ok' });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Failed to unregister token' });
  }
});
