import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { isChatwootAvailable, getConversations, getConversation, getMessages, postPrivateNote, sendReply } from '../chatwoot.js';

const router = Router();
// Public webhook stays open — everything else requires workspace auth
const authRouter = Router();
authRouter.use(requireAuth);

// ── Public webhook — no JWT, verified by shared secret if set ──
router.post('/webhook', async (req, res) => {
  // Ack fast to avoid Chatwoot retries
  res.status(200).json({ ok: true });

  try {
    const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
    if (secret) {
      const got = req.headers['x-chatwoot-signature'] || req.headers['x-hub-signature'] || '';
      if (got && got !== secret) {
        console.warn('[Chatwoot webhook] bad signature');
        return;
      }
    }

    const body = req.body || {};
    const event = body.event || body.webhookEvent;
    // Chatwoot sends { event: 'message_created', conversation: { ... }, message: { ... } }
    if (event && event !== 'message_created') return;

    const msg = body.message || body.content || {};
    const messageType = msg.message_type || msg.messageType || '';
    // Only act on incoming customer messages
    if (messageType && messageType !== 'incoming') return;

    const conversation = body.conversation || {};
    const conversationId = conversation.id || body.conversation_id || msg.conversation_id;
    const contact = conversation.contact || body.sender || {};
    const text = msg.content || msg.content_text || '';

    console.log(`[Chatwoot webhook] incoming #${conversationId} from ${contact.name || contact.email || 'unknown'}: ${String(text).slice(0, 120)}`);

    // Phase 1: just log. Phase 2 will draft/escalate here.
  } catch (e) {
    console.error('[Chatwoot webhook] error:', e.message);
  }
});

// ── Authenticated proxy — UI polls these ──
authRouter.get('/conversations', async (req, res) => {
  if (!isChatwootAvailable()) return res.status(503).json({ error: 'Chatwoot not configured (CHATWOOT_URL/CHATWOOT_API_TOKEN)' });
  try {
    const data = await getConversations({ status: req.query.status || 'open' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

authRouter.get('/conversations/:id', async (req, res) => {
  if (!isChatwootAvailable()) return res.status(503).json({ error: 'Chatwoot not configured' });
  try {
    const data = await getConversation(req.params.id);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

authRouter.get('/conversations/:id/messages', async (req, res) => {
  if (!isChatwootAvailable()) return res.status(503).json({ error: 'Chatwoot not configured' });
  try {
    const data = await getMessages(req.params.id);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

authRouter.post('/conversations/:id/private-note', async (req, res) => {
  if (!isChatwootAvailable()) return res.status(503).json({ error: 'Chatwoot not configured' });
  try {
    const data = await postPrivateNote(req.params.id, req.body.content || '');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

authRouter.post('/conversations/:id/reply', async (req, res) => {
  if (!isChatwootAvailable()) return res.status(503).json({ error: 'Chatwoot not configured' });
  try {
    const data = await sendReply(req.params.id, req.body.content || '');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Per-workspace settings (for multi-tenant Phase 2) ──
authRouter.get('/settings', (req, res) => {
  const ws = req.workspace;
  const row = db.prepare('SELECT * FROM chatwoot_settings WHERE workspace = ?').get(ws);
  if (!row) return res.json(null);
  res.json({ ...row, api_token: row.api_token ? '••••' + row.api_token.slice(-4) : '' });
});

authRouter.put('/settings', (req, res) => {
  const ws = req.workspace;
  const { chatwoot_url, api_token, account_id, inbox_id, auto_reply_enabled } = req.body || {};
  const now = nowIso();
  const existing = db.prepare('SELECT workspace FROM chatwoot_settings WHERE workspace = ?').get(ws);
  if (existing) {
    const sets = [];
    const vals = [];
    if (chatwoot_url !== undefined) { sets.push('chatwoot_url = ?'); vals.push(chatwoot_url); }
    if (api_token !== undefined) { sets.push('api_token = ?'); vals.push(api_token); }
    if (account_id !== undefined) { sets.push('account_id = ?'); vals.push(account_id); }
    if (inbox_id !== undefined) { sets.push('inbox_id = ?'); vals.push(inbox_id); }
    if (auto_reply_enabled !== undefined) { sets.push('auto_reply_enabled = ?'); vals.push(auto_reply_enabled ? 1 : 0); }
    sets.push('updated_at = ?'); vals.push(now);
    vals.push(ws);
    db.prepare(`UPDATE chatwoot_settings SET ${sets.join(', ')} WHERE workspace = ?`).run(...vals);
  } else {
    db.prepare('INSERT INTO chatwoot_settings (workspace, chatwoot_url, api_token, account_id, inbox_id, auto_reply_enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
      ws, chatwoot_url || '', api_token || '', account_id || '', inbox_id || '', auto_reply_enabled ? 1 : 0, now, now
    );
  }
  res.json({ ok: true });
});

router.use('/', authRouter);
export default router;
