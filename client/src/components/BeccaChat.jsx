import { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import { WELCOME } from '../lib/welcome';
import { renderMarkdown } from './PostPreviewPage';
import { extractAttachmentText, isSupportedAttachment } from '../lib/chatAttachment';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MODEL_OPTIONS = [
  { value: 'gpt-oss-120b', label: 'GPT-OSS 120B', desc: 'Default — best instruction-following for daily use', color: '#0ea5e9' },
  { value: 'gpt-oss-20b', label: 'GPT-OSS 20B', desc: 'Faster, lighter, less reliable on nuance', color: '#7c3aed' },
  { value: 'compound-mini', label: 'Compound Mini', desc: 'Fast, light, low latency', color: 'var(--green-dark)' },
  { value: 'compound', label: 'Compound', desc: 'Agentic — does its own web browsing/tool use', color: '#f59e0b' },
  { value: 'gemini', label: 'Gemini', desc: 'Google’s model — separate provider from Groq', color: '#4285f4' },
];

function todaySessionId(ws) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${ws}:${y}-${m}-${day}`;
}

export default function BeccaChat({ topics, profile, memory, workspace, activeSession, onSelectSession, model, onModelChange, onActionExecuted, greeting }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attachment, setAttachment] = useState(null); // { name, text, truncated }
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState('');
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const modelWrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [kbInset, setKbInset] = useState(0);

  // Keep the composer above the on-screen keyboard. On iOS in a standalone PWA
  // the layout viewport may not shrink, so we track the visual viewport and
  // pad the composer by however much the keyboard covers.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let lastInset = 0;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (Math.abs(inset - lastInset) > 1) {
        lastInset = inset;
        setKbInset(inset);
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // One-time welcome message (e.g. right after company setup) — local only,
  // not persisted to the conversation history.
  const greetingShown = useRef(false);
  useEffect(() => {
    if (!greeting || greetingShown.current) return;
    greetingShown.current = true;
    setMessages(prev => [...prev, {
      id: 'greeting-' + Date.now(),
      role: 'becca',
      content: renderMarkdown(greeting),
      isHTML: true,
    }]);
  }, [greeting]);

  useEffect(() => {
    function onClickOutside(e) {
      if (modelWrapRef.current && !modelWrapRef.current.contains(e.target)) {
        setModelOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (activeSession) loadSessionMessages(activeSession);
  }, [activeSession]);

  async function loadSessionMessages(sessionId) {
    try {
      const data = await api.becca.getChatSession(sessionId, workspace);
      setMessages(data.map(m => ({
        id: m.id,
        role: m.role === 'assistant' ? 'becca' : m.role,
        content: m.role === 'assistant' ? renderMarkdown(m.content) : m.content,
        isHTML: m.role === 'assistant',
      })));
    } catch { setMessages([]); }
  }

  function appendMsg(role, content, extra = {}) {
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, content, ...extra }]);
  }

  function appendUser(text, attachmentName) { appendMsg('user', text, attachmentName ? { attachmentName } : {}); }
  function appendBecca(text) { appendMsg('becca', renderMarkdown(text), { isHTML: true }); }
  function appendThinking() { appendMsg('thinking', '', { thinkId: 'think-' + Date.now() }); }
  function removeThinking() { setMessages(prev => prev.filter(m => m.role !== 'thinking')); }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setAttachError('');
    if (!isSupportedAttachment(file)) {
      setAttachError('Only PDF, .txt, and .md files are supported right now.');
      return;
    }
    setAttaching(true);
    try {
      const extracted = await extractAttachmentText(file);
      setAttachment(extracted);
      // Persist to Homin's knowledge base so this document stays a durable
      // reference beyond this one message, not just one-shot chat context.
      try {
        const saved = await api.becca.addKnowledgeDoc({ filename: extracted.name, content: extracted.text, doc_type: 'text' });
        setAttachment((prev) => (prev && prev.name === extracted.name ? { ...prev, savedToKnowledge: true, knowledgeDocId: saved?.id } : prev));
      } catch { /* saving to the knowledge base is best-effort — the message can still send without it */ }
    } catch (err) {
      setAttachError(err.message || 'Could not read that file.');
    }
    setAttaching(false);
  }

  function removeAttachment() {
    // Undo the knowledge-base save too — the ✕ reads as "cancel this
    // attachment", so a dismissed file shouldn't linger as a permanent memory.
    if (attachment?.knowledgeDocId) {
      api.becca.deleteKnowledgeDoc(attachment.knowledgeDocId).catch(() => {});
    }
    setAttachment(null);
    setAttachError('');
  }

  async function handleSend() {
    const msg = input.trim();
    if ((!msg && !attachment) || busy) return;
    const effectiveMsg = msg || `Please review the attached document (${attachment.name}).`;
    const currentAttachment = attachment;
    setInput('');
    setAttachment(null);
    setBusy(true);
    appendUser(effectiveMsg, currentAttachment?.name);
    appendThinking();

    const currentSession = activeSession || todaySessionId(workspace);

    try {
      const result = await api.becca.sendChatMessage({
        message: effectiveMsg,
        workspace,
        model,
        attachmentName: currentAttachment?.name,
        attachmentText: currentAttachment?.text,
      });
      removeThinking();
      appendBecca(result.reply || 'Done.');
      if (!activeSession) onSelectSession?.(result.session_id || currentSession);
      if (result.action === 'executed') onActionExecuted?.();
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
    const currentAttachment = attachment;
    setInput('');
    setAttachment(null);
    setBusy(true);
    appendThinking();
    const currentSession = activeSession || todaySessionId(workspace);
    try {
      const result = await api.becca.sendChatMessage({
        message: msg,
        workspace,
        model,
        attachmentName: currentAttachment?.name,
        attachmentText: currentAttachment?.text,
      });
      removeThinking();
      appendBecca(result.reply || 'Done.');
      if (!activeSession) onSelectSession?.(result.session_id || currentSession);
      if (result.action === 'executed') onActionExecuted?.();
    } catch (err) {
      removeThinking();
      appendBecca(`⚠ ${err.message}`);
    }
    setBusy(false);
  }

  const quickChips = WELCOME.quickChips;

  return (
    <div className="becca-chat becca-chat-only">
      <div className="becca-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div className="becca-welcome">
            <div className="w-greeting">
              <div>
                <div className="w-hi">{WELCOME.greeting()}{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}!</div>
                <div className="w-main">{WELCOME.main} <span>{WELCOME.mainAccent}</span></div>
                <div className="w-sub">{WELCOME.sub}</div>
              </div>
            </div>
            <div>
              <div className="w-chips-label">{WELCOME.chipsLabel}</div>
              <div className="chips-row">
                {quickChips.slice(0, 3).map(c => (
                  <button key={c} className="chip" onClick={() => { setInput(''); appendUser(c, attachment?.name); handleQuickSend(c); }}>{c}</button>
                ))}
              </div>
              <div className="chips-row chips-row-2">
                {quickChips.slice(3).map(c => (
                  <button key={c} className="chip" onClick={() => { setInput(''); appendUser(c, attachment?.name); handleQuickSend(c); }}>{c}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`msg-group msg-${m.role}`}>
            {m.role === 'user' && (
              <div className="msg-user">
                <div className="msg-user-col">
                  {m.attachmentName && <div className="msg-attachment-chip">📎 {esc(m.attachmentName)}</div>}
                  <div className="msg-user-bubble">{esc(m.content)}</div>
                </div>
              </div>
            )}
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

      <div className="becca-input-bar" style={{ paddingBottom: kbInset > 0 ? `calc(0.75rem + ${kbInset}px)` : undefined }}>
        {(attachment || attaching || attachError) && (
          <div className="attachment-preview-row">
            {attaching && <div className="attachment-chip attachment-chip-loading">Reading file…</div>}
            {attachment && !attaching && (
              <div className="attachment-chip" title={attachment.savedToKnowledge ? "Saved to Homin's knowledge base — he'll remember this in future conversations" : undefined}>
                📎 {attachment.name}{attachment.truncated ? ' (truncated to fit)' : ''}
                {attachment.savedToKnowledge && <span className="attachment-chip-saved">· saved to knowledge base</span>}
                <button type="button" className="attachment-chip-remove" onClick={removeAttachment} aria-label={`Remove ${attachment.name}`}>✕</button>
              </div>
            )}
            {attachError && <div className="attachment-error">{attachError}</div>}
          </div>
        )}
        <div className="input-inner">
          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            style={{ display: 'none' }} onChange={handleFileSelect} />
          <button type="button" className="input-attach" title="Attach a PDF or text file"
            aria-label="Attach a PDF or text file" onClick={() => fileInputRef.current?.click()} disabled={busy || attaching}>📎</button>
          {onModelChange && (
            <div className="model-switcher" ref={modelWrapRef}>
              <button type="button" className="model-btn" onClick={() => setModelOpen(o => !o)}>
                <div className="model-btn-dot" style={{ background: (MODEL_OPTIONS.find(o => o.value === model) || MODEL_OPTIONS[0]).color }} />
                <span>{(MODEL_OPTIONS.find(o => o.value === model) || MODEL_OPTIONS[0]).label}</span>
                <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>▾</span>
              </button>
              <div className={`model-dropdown${modelOpen ? ' open' : ''}`}>
                {MODEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`model-option${model === opt.value ? ' active' : ''}`}
                    onClick={() => { onModelChange(opt.value); setModelOpen(false); }}
                  >
                    <div className="model-option-dot" style={{ background: opt.color }} />
                    <div className="model-option-body">
                      <div className="model-option-name">{opt.label}</div>
                      <div className="model-option-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <input ref={inputRef} type="text" className="input-main" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={attachment ? `Ask something about ${attachment.name}, or send as-is…` : "Ask me anything, or say 'track [topic]', 'briefing'…"} disabled={busy} />
          <button className="input-send" onClick={handleSend} disabled={busy || (!input.trim() && !attachment)}>↑</button>
        </div>
      </div>
    </div>
  );
}
