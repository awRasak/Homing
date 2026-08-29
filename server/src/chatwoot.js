const token = () => process.env.CHATWOOT_API_TOKEN || '';
const base = () => (process.env.CHATWOOT_URL || '').replace(/\/+$/, '');
const accountId = () => process.env.CHATWOOT_ACCOUNT_ID || '';

export function isChatwootAvailable() {
  return !!(base() && token() && accountId());
}

async function chatwootRequest(path, { method = 'GET', body, params } = {}) {
  if (!isChatwootAvailable()) throw new Error('CHATWOOT_API_TOKEN/CHATWOOT_URL not configured');
  let url = `${base()}/api/v1/accounts/${accountId()}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      api_access_token: token(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.error || text.slice(0, 300);
    throw new Error(`Chatwoot ${res.status}: ${msg}`);
  }
  return json;
}

// ── Conversations ──
export function getConversations({ status = 'open', assigneeType = 'all' } = {}) {
  return chatwootRequest('/conversations', { params: { status, assignee_type: assigneeType } });
}

export function getConversation(conversationId) {
  return chatwootRequest(`/conversations/${conversationId}`);
}

export function getMessages(conversationId) {
  return chatwootRequest(`/conversations/${conversationId}/messages`);
}

// ── Messages ──
// Chatwoot POST /messages: { content, message_type, private, content_type }
export function postPrivateNote(conversationId, content) {
  return chatwootRequest(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content, message_type: 'outgoing', private: true, content_type: 'text' },
  });
}

export function sendReply(conversationId, content) {
  return chatwootRequest(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content, message_type: 'outgoing', private: false, content_type: 'text' },
  });
}

// Per-workspace lookup (Phase 2): when we have chatwoot_settings table
import { db } from './db.js';

export function getWorkspaceForAccount(chatwootAccountId) {
  try {
    const row = db.prepare('SELECT workspace FROM chatwoot_settings WHERE account_id = ?').get(String(chatwootAccountId));
    return row?.workspace || null;
  } catch { return null; }
}
