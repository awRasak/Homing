import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function InboxPanel() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.chatwoot.getConversations({ status: 'open' });
      const list = data?.data?.payload || data?.payload || data?.data || data || [];
      const arr = Array.isArray(list) ? list : [];
      setConversations(arr);
      setError('');
      setNotConfigured(false);
      if (arr.length && !selectedId) setSelectedId(arr[0].id);
    } catch (e) {
      if (e.message?.includes('not configured') || e.status === 503) {
        setNotConfigured(true);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadConversations();
    const iv = setInterval(loadConversations, 12000);
    return () => clearInterval(iv);
  }, [loadConversations]);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    setMessagesLoading(true);
    try {
      const data = await api.chatwoot.getMessages(id);
      const list = data?.payload || data?.data?.payload || data || [];
      const arr = Array.isArray(list) ? list : [];
      setMessages(arr);
      // Prefill draft from latest private note (Homin's draft)
      const privateNotes = arr.filter(m => m.private);
      const lastDraft = privateNotes.length ? privateNotes[privateNotes.length - 1].content : '';
      setDraft(lastDraft);
    } catch (e) {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  async function handleSend() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      await api.chatwoot.sendReply(selectedId, draft.trim());
      setDraft('');
      await loadMessages(selectedId);
      await loadConversations();
    } catch (e) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  }

  if (notConfigured) {
    return (
      <div className="inbox-panel">
        <div className="inbox-empty">
          <div className="inbox-empty-icon">💬</div>
          <div className="inbox-empty-title">Chatwoot not connected</div>
          <div className="inbox-empty-text">Add <code>CHATWOOT_URL</code>, <code>CHATWOOT_API_TOKEN</code> and <code>CHATWOOT_ACCOUNT_ID</code> in Render → Environment, then add the Website inbox widget to motoka.ng.</div>
        </div>
      </div>
    );
  }

  const selected = conversations.find(c => String(c.id) === String(selectedId));

  return (
    <div className="inbox-panel">
      <div className="inbox-list">
        <div className="inbox-list-head">
          <span className="cp-label" style={{ marginBottom: 0 }}>Open conversations</span>
          <button className="btn-text" onClick={loadConversations} title="Refresh">↻</button>
        </div>
        {loading && <div className="cp-empty">Loading…</div>}
        {!loading && conversations.length === 0 && <div className="cp-empty">No open conversations — new messages from motoka.ng will appear here within seconds.</div>}
        {error && <div className="import-error">{error}</div>}
        <div className="inbox-convos">
          {conversations.map(c => {
            const contact = c.meta?.sender || c.contact || {};
            const lastMsg = c.last_non_activity_message?.content || c.last_message?.content || '';
            return (
              <div key={c.id} className={`inbox-convo ${String(c.id) === String(selectedId) ? 'active' : ''}`} onClick={() => setSelectedId(c.id)}>
                <div className="inbox-convo-name">{contact.name || contact.email || `Conversation #${c.id}`}</div>
                <div className="inbox-convo-preview">{lastMsg.slice(0, 80) || '—'}</div>
                <div className="inbox-convo-meta">
                  <span className={`inbox-status status-${c.status || 'open'}`}>{c.status || 'open'}</span>
                  {c.unread_count > 0 && <span className="inbox-unread">{c.unread_count}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="inbox-detail">
        {!selectedId ? (
          <div className="inbox-empty">Select a conversation</div>
        ) : messagesLoading ? (
          <div className="cp-empty">Loading messages…</div>
        ) : (
          <>
            <div className="inbox-detail-head">
              <div>
                <div className="inbox-detail-name">{selected?.meta?.sender?.name || selected?.contact?.name || `Conversation #${selectedId}`}</div>
                <div className="inbox-detail-sub">{selected?.meta?.sender?.email || selected?.contact?.email || ''}</div>
              </div>
              <a href={`${selected?.meta?.sender?.thumbnail || ''}`} target="_blank" rel="noreferrer" className="btn-text" style={{ fontSize: '0.75rem' }}>Open in Chatwoot →</a>
            </div>

            <div className="inbox-messages">
              {messages.map(m => (
                <div key={m.id} className={`inbox-msg ${m.private ? 'private' : ''} ${m.message_type === 'incoming' ? 'incoming' : 'outgoing'}`}>
                  <div className="inbox-msg-meta">{m.private ? 'Homin draft (private)' : m.message_type === 'incoming' ? 'Customer' : 'Agent'} · {m.created_at ? new Date(m.created_at * 1000 || m.created_at).toLocaleString() : ''}</div>
                  <div className="inbox-msg-body">{m.content || ''}</div>
                </div>
              ))}
              {messages.length === 0 && <div className="cp-empty">No messages yet.</div>}
            </div>

            <div className="inbox-draft">
              <div className="cp-label">Draft reply (private note until you send)</div>
              <textarea className="cp-textarea" rows={4} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Homin's draft will appear here — edit before sending…" />
              {!draft.trim() && <div className="scan-hint">No draft yet — Homin will draft when a new customer message arrives, or it was escalated by email.</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-save-profile" onClick={handleSend} disabled={!draft.trim() || sending}>{sending ? 'Sending…' : 'Send reply →'}</button>
                <button className="btn-cancel" onClick={() => loadMessages(selectedId)}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
