import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { isChatwootAvailable, getConversations, getConversation, getMessages, postPrivateNote, sendReply } from '../chatwoot.js';
import { buildKnowledgeBase, callGroq } from './becca.js';
import { sendEmail } from '../email.js';

const router = Router();
// Public webhook stays open — everything else requires workspace auth
const authRouter = Router();
authRouter.use(requireAuth);

// De-dupe: Chatwoot retries on non-2xx, and we ack 200 immediately, but still guard
const seenMessageIds = new Set();
setInterval(() => { if (seenMessageIds.size > 500) seenMessageIds.clear(); }, 60 * 60 * 1000);

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

    // ── Phase 2: draft or escalate ──
    if (!text || !String(text).trim()) return;
    const messageId = msg.id || `${conversationId}:${text.slice(0, 40)}`;
    if (seenMessageIds.has(String(messageId))) return;
    seenMessageIds.add(String(messageId));

    // Resolve workspace: prefer per-workspace chatwoot_settings, fallback to env/single-tenant
    let workspace = null;
    const incomingAccountId = body.account?.id || body.account_id || conversation.account_id;
    if (incomingAccountId) {
      try {
        const row = db.prepare('SELECT workspace FROM chatwoot_settings WHERE account_id = ?').get(String(incomingAccountId));
        if (row) workspace = row.workspace;
      } catch {}
    }
    if (!workspace) {
      try {
        const row = db.prepare('SELECT workspace FROM chatwoot_settings LIMIT 1').get();
        if (row) workspace = row.workspace;
      } catch {}
    }
    if (!workspace) {
      try {
        const row = db.prepare('SELECT workspace FROM users LIMIT 1').get();
        if (row) workspace = row.workspace;
      } catch {}
    }
    if (!workspace) workspace = 'default';

    // Fetch conversation history for context (best-effort)
    let history = '';
    try {
      const convo = await getConversation(conversationId);
      const msgs = convo?.messages || (await getMessages(conversationId).catch(() => null));
      const list = Array.isArray(msgs) ? msgs : (msgs?.payload || []);
      if (list.length) {
        history = list.slice(-8).map(m => `${m.message_type === 'incoming' ? 'Customer' : 'Agent'}: ${m.content || ''}`).join('\n').slice(0, 3000);
      }
    } catch {}

    const kb = buildKnowledgeBase(workspace);
    const knowledgeContext = kb.toPrompt().slice(0, 6000);

    const system = `You are Homin, drafting a reply to a customer on behalf of the business below. Be concise, helpful, and on-brand.

${knowledgeContext || 'No company context set up yet.'}

Conversation history:
${history || '(no prior messages)'}

Instructions:
- Draft a reply to the customer's latest message in the company's voice.
- If the knowledge base above does NOT actually contain the information needed (pricing not listed, policy unclear, requires human judgment), reply with exactly NEEDS_HUMAN and nothing else.
- Do not hallucinate. Do not apologize without answering.`;

    let draft = '';
    try {
      draft = await callGroq({
        model: process.env.CHATWOOT_DRAFT_MODEL || 'gpt-oss-20b',
        system,
        user: `Customer's latest message: "${String(text).slice(0, 1000)}"\n\nDraft a reply, or NEEDS_HUMAN if you cannot confidently answer from the knowledge base.`,
        temperature: 0.4,
        maxTokens: 600,
      });
    } catch (err) {
      console.error('[Chatwoot draft] LLM failed:', err.message);
      return;
    }

    draft = String(draft || '').trim().replace(/^["']|["']$/g, '');
    // Deterministic backstop: empty, just an apology, or too short to be useful
    const isNeedsHuman = draft === 'NEEDS_HUMAN' || !draft || draft.length < 10 || /^(sorry|i'?m not sure|i don'?t have|i can'?t answer)/i.test(draft) && draft.length < 80;

    if (isNeedsHuman) {
      // Escalate by email to workspace owner
      try {
        const owner = db.prepare('SELECT email, name FROM users WHERE workspace = ?').get(workspace);
        const to = owner?.email;
        if (!to) {
          console.warn('[Chatwoot escalate] no owner email for workspace', workspace);
          return;
        }
        const inboxLink = `Chatwoot conversation #${conversationId}`;
        await sendEmail({
          to,
          subject: `Homin needs your help — customer asked: "${String(text).slice(0, 60)}"`,
          html: `<p>Customer <strong>${contact.name || contact.email || 'unknown'}</strong> asked:</p>
                 <blockquote style="border-left:3px solid #c8f000;padding:8px 12px;background:#f7f8f7;">${String(text).replace(/</g,'&lt;')}</blockquote>
                 <p>Conversation history:</p><pre style="background:#f7f8f7;padding:10px;border-radius:8px;white-space:pre-wrap;">${String(history).replace(/</g,'&lt;').slice(0, 2000)}</pre>
                 <p><a href="${process.env.CHATWOOT_URL || ''}">Open in Chatwoot → conversation #${conversationId}</a></p>
                 <p style="color:#999;font-size:12px;">Homin couldn't confidently answer from the knowledge base, so this was not auto-drafted.</p>`,
        });
        console.log(`[Chatwoot escalate] emailed ${to} for #${conversationId}`);
      } catch (e) {
        console.error('[Chatwoot escalate] email failed:', e.message);
      }
      return;
    }

    // Got a real draft → post as private note (agent-visible only)
    try {
      await postPrivateNote(conversationId, draft);
      console.log(`[Chatwoot draft] posted private note to #${conversationId}: ${draft.slice(0, 80)}`);
    } catch (e) {
      console.error('[Chatwoot draft] postPrivateNote failed:', e.message);
    }
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
