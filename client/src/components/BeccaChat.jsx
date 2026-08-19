import { useState, useRef, useEffect } from 'react';
import { api } from '../api';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function todaySessionId(ws) {
  const d = new Date().toISOString().slice(0, 10);
  return `${ws}:${d}`;
}

export default function BeccaChat({ topics, profile, memory, workspace, activeSession, onSelectSession, model, onModelChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (activeSession) loadSessionMessages(activeSession);
  }, [activeSession]);

  async function loadSessionMessages(sessionId) {
    try {
      const data = await api.becca.getChatSession(sessionId, workspace);
      setMessages(data.map(m => ({
        id: m.id,
        role: m.role === 'assistant' ? 'becca' : m.role,
        content: m.content,
        isHTML: m.role === 'assistant',
      })));
    } catch { setMessages([]); }
  }

  function appendMsg(role, content, extra = {}) {
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, content, ...extra }]);
  }

  function appendUser(text) { appendMsg('user', text); }
  function appendBecca(text) { appendMsg('becca', text, { isHTML: true }); }
  function appendThinking() { appendMsg('thinking', '', { thinkId: 'think-' + Date.now() }); }
  function removeThinking() { setMessages(prev => prev.filter(m => m.role !== 'thinking')); }

  async function handleSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    appendUser(msg);
    appendThinking();

    const currentSession = activeSession || todaySessionId(workspace);

    try {
      const result = await api.becca.sendChatMessage({ message: msg, workspace, model });
      removeThinking();
      appendBecca(result.reply || 'Done.');
      if (!activeSession) onSelectSession?.(result.session_id || currentSession);
    } catch (err) {
      removeThinking();
      let errMsg = err.message || 'Something went wrong.';
      if (errMsg.includes('Failed to fetch')) errMsg = 'Connection failed. Check your internet.';
      appendBecca(`⚠ ${errMsg}`);
    }

    setBusy(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleQuickSend(msg) {
    setInput('');
    setBusy(true);
    appendThinking();
    const currentSession = activeSession || todaySessionId(workspace);
    try {
      const result = await api.becca.sendChatMessage({ message: msg, workspace, model });
      removeThinking();
      appendBecca(result.reply || 'Done.');
      if (!activeSession) onSelectSession?.(result.session_id || currentSession);
    } catch (err) {
      removeThinking();
      appendBecca(`⚠ ${err.message}`);
    }
    setBusy(false);
  }

  const quickChips = [
    'Track AI regulation',
    'What\'s new in crypto?',
    'Give me a briefing',
    'Remember: always frame for enterprise',
    'Remind me to review the pipeline tomorrow',
  ];

  return (
    <div className="becca-chat becca-chat-only">
      <div className="becca-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div className="becca-welcome">
            <div className="w-greeting">
              <div className="w-avatar">✦</div>
              <div>
                <div className="w-hi">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}!</div>
                <div className="w-main">How can I help you <span>today?</span></div>
                <div className="w-sub">I'm your personal intelligence assistant. Ask me anything, tell me what to track, or say "give me a briefing".</div>
              </div>
            </div>
            <div>
              <div className="w-chips-label">Try saying…</div>
              <div className="chips-row">
                {quickChips.map(c => (
                  <button key={c} className="chip" onClick={() => { setInput(''); appendUser(c); handleQuickSend(c); }}>{c}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`msg-group msg-${m.role}`}>
            {m.role === 'user' && <div className="msg-user"><div className="msg-user-bubble">{esc(m.content)}</div></div>}
            {m.role === 'becca' && (
              <div className="msg-becca">
                <div className="becca-av">✦</div>
                <div className="becca-bubble" dangerouslySetInnerHTML={m.isHTML ? { __html: m.content } : undefined}>
                  {!m.isHTML ? m.content : undefined}
                </div>
              </div>
            )}
            {m.role === 'thinking' && (
              <div className="thinking-row">
                <div className="becca-av">✦</div>
                <div className="thinking-bubble">
                  <div className="dots"><span /><span /><span /></div>
                  <div className="thinking-label">Homin is thinking…</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="becca-input-bar">
        <div className="input-inner">
          <input ref={inputRef} type="text" className="input-main" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Ask me anything, or say 'track [topic]', 'briefing'…" disabled={busy} />
          {onModelChange && (
            <select className="input-model-select" value={model}
              onChange={e => onModelChange(e.target.value)} title="Model">
              <option value="gpt-oss-20b">gpt-oss-20b</option>
              <option value="gpt-oss-120b">gpt-oss-120b</option>
              <option value="compound-mini">compound-mini</option>
              <option value="compound">compound</option>
              <option value="qwen-3.6-27b">qwen-3.6-27b</option>
            </select>
          )}
          <button className="input-send" onClick={handleSend} disabled={busy || !input.trim()}>↑</button>
        </div>
      </div>
    </div>
  );
}
