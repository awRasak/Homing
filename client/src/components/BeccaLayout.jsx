import { useState, useEffect } from 'react';
import { api } from '../api';
import BeccaChat from './BeccaChat';
import PostPreviewPage from './PostPreviewPage';
import { RunPipelineModal, PostCard, EditPostModal } from './ContentPipeline';

function formatSessionDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function todaySessionId(ws) {
  const d = new Date().toISOString().slice(0, 10);
  return `${ws}:${d}`;
}

/* ── Time Picker Modal ── */
function TimePickerModal({ time, onSet, onClose }) {
  const [hours, setHours] = useState(() => parseInt((time || '07:00').split(':')[0]) || 7);
  const [minutes, setMinutes] = useState(() => parseInt((time || '07:00').split(':')[1]) || 0);

  function incH() { setHours(h => (h + 1) % 24); }
  function decH() { setHours(h => (h + 23) % 24); }
  function incM() { setMinutes(m => (m + 15) % 60); }
  function decM() { setMinutes(m => (m + 45) % 60); }

  const display = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card tp-modal" onClick={e => e.stopPropagation()}>
        <div className="tp-label">Set briefing time</div>
        <div className="tp-picker">
          <div className="tp-col">
            <button className="tp-arrow" onClick={incH}>▲</button>
            <div className="tp-val">{String(hours).padStart(2, '0')}</div>
            <button className="tp-arrow" onClick={decH}>▼</button>
            <div className="tp-unit">hour</div>
          </div>
          <div className="tp-sep">:</div>
          <div className="tp-col">
            <button className="tp-arrow" onClick={incM}>▲</button>
            <div className="tp-val">{String(minutes).padStart(2, '0')}</div>
            <button className="tp-arrow" onClick={decM}>▼</button>
            <div className="tp-unit">min</div>
          </div>
        </div>
        <div className="tp-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => { onSet(display); onClose(); }}>Set</button>
        </div>
      </div>
    </div>
  );
}

/* ── Panel: Sessions (Chat tab) ── */
function PanelSessions({ workspace, activeSession, onSelectSession, onNewSession }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    try {
      const data = await api.becca.listChatSessions(workspace);
      setSessions(data);
    } catch { /* ignore */ }
  }

  function handleNew() {
    const todayId = todaySessionId(workspace);
    onNewSession(todayId);
    loadSessions();
  }

  return (
    <div className="session-panel">
      <div className="cs-header">
        <button className="cs-new" onClick={handleNew}>✦ New session</button>
      </div>
      <div className="cs-list">
        {sessions.length === 0 && <div className="cs-empty">No sessions yet</div>}
        {sessions.map(s => (
          <div key={s.session_id}
            className={`cs-item ${activeSession === s.session_id ? 'active' : ''}`}
            onClick={() => onSelectSession(s.session_id)}>
            <div className="cs-item-date">{formatSessionDate(s.started)}</div>
            <div className="cs-item-count">{s.message_count} msgs</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Panel: Watchlist ── */
function PanelWatchlist({ topics, onAddTopic, onRemoveTopic, onUpdateTopic }) {
  const [newTopic, setNewTopic] = useState('');
  const [newContext, setNewContext] = useState('');
  const [selected, setSelected] = useState(() => new Set(topics.map(t => t.id)));

  useEffect(() => { setSelected(new Set(topics.map(t => t.id))); }, [topics]);

  function handleAdd() {
    if (!newTopic.trim()) return;
    onAddTopic(newTopic.trim(), newContext.trim());
    setNewTopic('');
    setNewContext('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); }
  }

  function toggleAll() {
    if (selected.size === topics.length) setSelected(new Set());
    else setSelected(new Set(topics.map(t => t.id)));
  }

  return (
    <div className="watchlist-panel">
      <div className="wp-section">
        <div className="cp-label">Track a Topic</div>
        <input className="cp-input" type="text" placeholder="Topic name" value={newTopic}
          onChange={e => setNewTopic(e.target.value)} onKeyDown={handleKeyDown} />
        <textarea className="cp-textarea" placeholder="Context (optional)" rows={2} value={newContext}
          onChange={e => setNewContext(e.target.value)} />
        <button className="btn-add-topic" onClick={handleAdd} disabled={!newTopic.trim()}>+ Add to watchlist</button>
      </div>

      <div className="wp-section wp-topics">
        <div className="cp-label-row">
          <span className="cp-label">Watching ({topics.length})</span>
          <button className="cp-toggle-all" onClick={toggleAll}>
            {selected.size === topics.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className="wp-topics-list">
          {topics.length === 0 && <div className="cp-empty">No topics tracked yet</div>}
          {topics.map(t => (
            <div key={t.id} className="topic-row">
              <input type="checkbox" className="topic-check" checked={selected.has(t.id)}
                onChange={() => setSelected(prev => {
                  const next = new Set(prev);
                  next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                  return next;
                })} />
              <span className={`topic-dot priority-${t.priority || 'medium'}`} />
              <select className="topic-priority" value={t.priority || 'medium'}
                onChange={e => onUpdateTopic(t.id, { priority: e.target.value })}>
                <option value="high">High</option>
                <option value="medium">Med</option>
                <option value="low">Low</option>
              </select>
              <span className="topic-name">{t.name}</span>
              <button className="topic-remove" onClick={() => onRemoveTopic(t.id)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="wp-bottom">
        <button className="cp-brief-btn" disabled={topics.length === 0}>✦ Brief all topics</button>
      </div>
    </div>
  );
}

/* ── Panel: Briefings ── */
function PanelBriefings({ briefings, settings, onSaveSettings }) {
  const [showTimePicker, setShowTimePicker] = useState(false);
  const dailyOn = settings?.dailyOn || false;
  const dailyTime = settings?.dailyTime || '07:00';

  return (
    <div className="briefings-panel">
      <div className="bp-section daily-card">
        <div className="dc-row">
          <div className="dc-left">
            <div className="dc-toggle-row">
              <div className={`dc-toggle ${dailyOn ? 'on' : ''}`}
                onClick={() => onSaveSettings('daily', { dailyOn: !dailyOn, dailyTime })}>
                <div className="dc-toggle-knob" />
              </div>
              <div className="dc-status">
                <span className="dc-status-dot" style={{ background: dailyOn ? 'var(--green-dark)' : 'var(--grey-mid)' }} />
                {dailyOn ? `On · fires at ${dailyTime}` : 'Off'}
              </div>
            </div>
            <div className="dc-label">Daily Briefing</div>
          </div>
          <div className="dc-right" onClick={() => setShowTimePicker(true)}>
            <div className="dc-time">{dailyTime}</div>
            <div className="dc-time-hint">tap to set</div>
          </div>
        </div>
      </div>

      <div className="bp-section">
        <div className="cp-label">Past Briefings</div>
        {!briefings || briefings.length === 0 ? (
          <div className="cp-empty">No briefings yet</div>
        ) : (
          <div className="bp-list">
            {briefings.map(b => (
              <div key={b.id} className="bp-card">
                <div className="bp-card-head">
                  <span className="bp-card-topic">{b.topic_name || 'General'}</span>
                  <span className={`bp-sentiment ${b.sentiment || 'neutral'}`}>
                    {b.sentiment || 'neutral'}
                  </span>
                </div>
                <div className="bp-card-title">{b.headline || 'Briefing'}</div>
                {b.changed_since_last && <div className="bp-card-changed">Changed: {b.changed_since_last}</div>}
                <div className="bp-card-meta">
                  {b.status && <span className={`bp-status ${b.status}`}>{b.status}</span>}
                  {b.created_at && <span className="bp-time">{new Date(b.created_at).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTimePicker && (
        <TimePickerModal time={dailyTime}
          onSet={(t) => onSaveSettings('daily', { dailyOn, dailyTime: t })}
          onClose={() => setShowTimePicker(false)} />
      )}
    </div>
  );
}

/* ── Panel: Pipeline ── */
function PanelPipeline({ topics, workspace }) {
  const [posts, setPosts] = useState([]);
  const [showRun, setShowRun] = useState(false);
  const [editPost, setEditPost] = useState(null);
  const [previewPost, setPreviewPost] = useState(null);

  useEffect(() => { loadPosts(); }, [workspace]);

  async function loadPosts() {
    try {
      const data = await api.becca.listPosts(workspace);
      setPosts(data);
    } catch { /* ignore */ }
  }

  async function handleRun() {
    setShowRun(false);
    loadPosts();
  }

  async function handleDeletePost(id) {
    if (!confirm('Delete this post?')) return;
    await api.becca.deletePost(id);
    setPosts(prev => prev.filter(p => p.id !== id));
  }

  async function handleStatusChange(id, status) {
    await api.becca.updatePost(id, { status });
    setPosts(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  }

  async function handleSavePost(data) {
    await api.becca.updatePost(editPost.id, data);
    setPosts(prev => prev.map(p => p.id === editPost.id ? { ...p, ...data } : p));
    setEditPost(null);
  }

  const drafts = posts.filter(p => p.status === 'draft').length;
  const reviews = posts.filter(p => p.status === 'review').length;
  const published = posts.filter(p => p.status === 'published').length;

  return (
    <div className="pipeline-panel">
      <div className="pp-card">
        <div className="cp-label">Content Pipeline</div>
        <div className="pp-stats">
          <div className="pp-stat"><span className="pp-stat-val">{drafts}</span><span className="pp-stat-lbl">Drafts</span></div>
          <div className="pp-stat"><span className="pp-stat-val" style={{ color: '#c08000' }}>{reviews}</span><span className="pp-stat-lbl">Review</span></div>
          <div className="pp-stat"><span className="pp-stat-val" style={{ color: '#3b82f6' }}>{published}</span><span className="pp-stat-lbl">Pub'd</span></div>
        </div>
        <button className="btn-add-topic" onClick={() => setShowRun(true)}>▶ Run Pipeline</button>
      </div>

      <div className="pp-card pp-card-list">
        <div className="cp-label">Posts ({posts.length})</div>
        {posts.length === 0 ? (
          <div className="cp-empty">No posts yet — run the pipeline to generate one</div>
        ) : (
          <div className="pp-post-list">
            {posts.map(p => (
              <PostCard key={p.id} post={p}
                onEdit={setEditPost} onDelete={handleDeletePost}
                onStatusChange={handleStatusChange} onPreview={setPreviewPost} />
            ))}
          </div>
        )}
      </div>

      {showRun && <RunPipelineModal topics={topics} onRun={handleRun} onClose={() => setShowRun(false)} />}
      {editPost && <EditPostModal post={editPost} onSave={handleSavePost} onClose={() => setEditPost(null)} />}
      {previewPost && <PostPreviewPage post={previewPost} onClose={() => setPreviewPost(null)} />}
    </div>
  );
}

/* ── Panel: Reminders ── */
function PanelReminders({ reminders, onAddReminder, onDismissReminder }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const now = Date.now();

  async function handleAdd() {
    if (!text.trim()) return;
    await onAddReminder({ text: text.trim(), due: due ? new Date(due).toISOString() : null, when_raw: due });
    setText('');
    setDue('');
  }

  return (
    <div className="reminders-panel">
      <div className="bp-section">
        <div className="cp-label">New Reminder</div>
        <input className="cp-input" type="text" placeholder="What to remind you about?" value={text}
          onChange={e => setText(e.target.value)} />
        <input className="cp-input" type="datetime-local" value={due}
          onChange={e => setDue(e.target.value)} style={{ marginTop: 8 }} />
        <button className="btn-add-topic" onClick={handleAdd} disabled={!text.trim()}>+ Add reminder</button>
      </div>

      <div className="bp-section rp-list-section">
        <div className="cp-label">Reminders ({reminders.length})</div>
        {!reminders || reminders.length === 0 ? (
          <div className="cp-empty">No reminders yet — ask Homin to set one, or add above</div>
        ) : (
          <div className="rp-list">
            {reminders.map(r => {
              const dueAt = r.due ? new Date(r.due) : null;
              const overdue = dueAt && dueAt.getTime() < now;
              return (
                <div key={r.id} className={`rp-card ${overdue ? 'overdue' : ''}`}>
                  <div className="rp-card-text">{r.text}</div>
                  <div className="rp-card-foot">
                    {dueAt && <span className="rp-due">{dueAt.toLocaleString()}</span>}
                    {r.when_raw && !dueAt && <span className="rp-due">{r.when_raw}</span>}
                    <button className="rp-dismiss" onClick={() => onDismissReminder(r.id)}>Dismiss</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   LAYOUT
   ═══════════════════════════════════════════ */

const TABS = [
  { key: 'chat', icon: '💬', label: 'Chat' },
  { key: 'watchlist', icon: '📡', label: 'Watchlist' },
  { key: 'briefings', icon: '🗂', label: 'Briefings' },
  { key: 'pipeline', icon: '🛠', label: 'Pipeline' },
  { key: 'reminders', icon: '🔔', label: 'Reminders' },
];

export default function BeccaLayout({
  topics, profile, memory, briefings, reminders, settings,
  onAddTopic, onRemoveTopic, onUpdateTopic,
  onSaveSettings, onAddReminder, onDismissReminder,
  workspace, beccaSection, onSectionChange, beccaModel,
}) {
  const [activeSession, setActiveSession] = useState(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const activeTab = beccaSection;

  function handleTabClick(key) {
    onSectionChange(key);
  }

  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    function onMove(ev) {
      const w = Math.min(Math.max(startW + (ev.clientX - startX), 240), 560);
      setPanelWidth(w);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <div className="becca-layout">
      {/* ── TabBar ── */}
      <div className="al-tabbar">
        {TABS.map(tab => (
          <button key={tab.key}
            className={`al-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.key)}>
            <span className="al-tab-icon">{tab.icon}</span>
            <span className="al-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── BodyRow ── */}
      <div className="al-body">
        <div className="al-left" style={{ width: panelWidth }}>
          {activeTab === 'chat' && (
            <PanelSessions workspace={workspace} activeSession={activeSession}
              onSelectSession={setActiveSession}
              onNewSession={(id) => setActiveSession(id)} />
          )}
          {activeTab === 'watchlist' && (
            <PanelWatchlist topics={topics} onAddTopic={onAddTopic}
              onRemoveTopic={onRemoveTopic} onUpdateTopic={onUpdateTopic} />
          )}
          {activeTab === 'briefings' && (
            <PanelBriefings briefings={briefings} settings={settings}
              onSaveSettings={onSaveSettings} />
          )}
          {activeTab === 'pipeline' && (
            <PanelPipeline topics={topics} workspace={workspace} />
          )}
          {activeTab === 'reminders' && (
            <PanelReminders reminders={reminders} onAddReminder={onAddReminder} onDismissReminder={onDismissReminder} />
          )}
        </div>
        <div className="al-resizer" onMouseDown={startResize} title="Drag to resize" />
        <div className="al-chat">
          <BeccaChat topics={topics} profile={profile} memory={memory}
            workspace={workspace} activeSession={activeSession}
            onSelectSession={setActiveSession} model={beccaModel} />
        </div>
      </div>
    </div>
  );
}
