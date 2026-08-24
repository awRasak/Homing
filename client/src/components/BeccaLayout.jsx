import { useState, useEffect } from 'react';
import { api } from '../api';
import BeccaChat from './BeccaChat';
import CalendarPicker from './CalendarPicker';
import { renderMarkdown } from './PostPreviewPage';
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
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${ws}:${y}-${m}-${day}`;
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
const ALL_PLATFORMS = [
  { id: 'google_news', label: 'News', icon: '📰' },
  { id: 'youtube', label: 'YouTube', icon: '▶' },
  { id: 'reddit', label: 'Reddit', icon: '◉' },
  { id: 'twitter', label: 'X', icon: '𝕏' },
  { id: 'tiktok', label: 'TikTok', icon: '♪' },
  { id: 'instagram', label: 'Instagram', icon: '📷' },
  { id: 'facebook', label: 'Facebook', icon: 'f' },
  { id: 'snapchat', label: 'Snapchat', icon: '👻' },
];

function PanelWatchlist({ topics, onAddTopic, onRemoveTopic, onUpdateTopic, workspace, beccaModel, onRefresh, settings }) {
  const [newTopic, setNewTopic] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newPlatforms, setNewPlatforms] = useState(['google_news']);
  const [briefingTopic, setBriefingTopic] = useState(null);
  const [scanningTopic, setScanningTopic] = useState(null);
  const [topicStats, setTopicStats] = useState({});
  const [expandedTopic, setExpandedTopic] = useState(null);

  function handleAdd() {
    if (!newTopic.trim()) return;
    onAddTopic(newTopic.trim(), newContext.trim(), newPlatforms);
    setNewTopic('');
    setNewContext('');
    setNewPlatforms(['google_news']);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); }
  }

  async function handleToggleBlog(id) {
    await api.becca.toggleTopicBlog(id);
    if (onRefresh) onRefresh();
  }

  async function handleToggleStatus(id) {
    await api.becca.toggleTopicStatus(id);
    if (onRefresh) onRefresh();
  }

  async function handleBriefNow(topic) {
    setBriefingTopic(topic.id);
    try {
      const res = await api.becca.triggerTopicBrief(topic.id, { workspace, model: beccaModel || 'gpt-oss-20b', region: settings?.country || '' });
      alert(res.summary || 'Briefing complete');
    } catch (err) {
      alert('Briefing failed: ' + err.message);
    }
    setBriefingTopic(null);
  }

  async function handleScanTopic(topic) {
    setScanningTopic(topic.id);
    try {
      const res = await api.social.scanTopic(topic.id);
      setTopicStats(prev => ({ ...prev, [topic.id]: res }));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Scan failed:', err);
    }
    setScanningTopic(null);
  }

  async function handleLoadStats(topicId) {
    try {
      const res = await api.social.getStats(topicId);
      setTopicStats(prev => ({ ...prev, [topicId]: { ...prev[topicId], statsData: res } }));
    } catch { /* ok */ }
  }

  function togglePlatform(platformId) {
    setNewPlatforms(prev =>
      prev.includes(platformId) ? prev.filter(p => p !== platformId) : [...prev, platformId]
    );
  }

  const activeTopics = topics.filter(t => t.status === 'active');
  const pausedTopics = topics.filter(t => t.status === 'paused');

  function relativeTime(iso) {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="watchlist-panel">
      <div className="wp-section">
        <div className="cp-label">Track a Topic</div>
        <input className="cp-input" type="text" placeholder="Topic name" value={newTopic}
          onChange={e => setNewTopic(e.target.value)} onKeyDown={handleKeyDown} />
        <textarea className="cp-textarea" placeholder="Context (optional)" rows={2} value={newContext}
          onChange={e => setNewContext(e.target.value)} />

        <div className="platform-picker">
          <div className="cp-label" style={{ fontSize: '0.75rem', marginBottom: '0.3rem' }}>Platforms</div>
          <div className="platform-chips">
            {ALL_PLATFORMS.map(p => (
              <button key={p.id}
                className={`platform-chip ${newPlatforms.includes(p.id) ? 'platform-chip-active' : ''}`}
                onClick={() => togglePlatform(p.id)}
                title={p.label}>
                <span className="platform-chip-icon">{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button className="btn-add-topic" onClick={handleAdd} disabled={!newTopic.trim()}>+ Add to watchlist</button>
      </div>

      <div className="wp-section wp-topics">
        <div className="cp-label">Active ({activeTopics.length})</div>
        <div className="wp-topics-list">
          {activeTopics.length === 0 && <div className="cp-empty">No topics tracked yet</div>}
          {activeTopics.map(t => {
            const topicPlatforms = JSON.parse(t.platforms || '["google_news"]');
            const stats = topicStats[t.id];
            return (
              <div key={t.id} className="topic-row topic-row-extended">
                <div className="topic-row-top">
                  <span className={`topic-dot priority-${t.priority || 'medium'}`} />
                  <select className="topic-priority" value={t.priority || 'medium'}
                    onChange={e => onUpdateTopic(t.id, { priority: e.target.value })}>
                    <option value="high">High</option>
                    <option value="medium">Med</option>
                    <option value="low">Low</option>
                  </select>
                  <span className="topic-name">{t.name}</span>
                  {t.last_fetch_status === 'failed' && (
                    <span className="topic-warning" title={t.last_fetch_error || 'Fetch failed'}>⚠</span>
                  )}
                  <div className="topic-row-actions">
                    <label className="topic-toggle" title="Generate blog content">
                      <input type="checkbox" checked={!!t.blog_generation_enabled}
                        onChange={() => handleToggleBlog(t.id)} />
                      <span className="topic-toggle-label">Blog</span>
                    </label>
                    <button className="topic-scan-btn" disabled={scanningTopic === t.id}
                      onClick={() => handleScanTopic(t)} title="Scan social platforms">
                      {scanningTopic === t.id ? '...' : '◎'}
                    </button>
                    <button className="topic-brief-btn" disabled={briefingTopic === t.id}
                      onClick={() => handleBriefNow(t)} title="Brief me now">
                      {briefingTopic === t.id ? '...' : '✦'}
                    </button>
                    <button className="topic-remove" onClick={() => handleToggleStatus(t.id)} title="Pause">⏸</button>
                  </div>
                </div>
                <div className="topic-platforms">
                  {topicPlatforms.map(pid => {
                    const p = ALL_PLATFORMS.find(x => x.id === pid);
                    return p ? <span key={pid} className="topic-platform-badge" title={p.label}>{p.icon}</span> : null;
                  })}
                  {topicPlatforms.length > 1 && (
                    <button className="topic-expand-btn" onClick={() => {
                      const next = expandedTopic === t.id ? null : t.id;
                      setExpandedTopic(next);
                      if (next) handleLoadStats(t.id);
                    }}>
                      {expandedTopic === t.id ? '▾' : '▸'} {topicPlatforms.length} platforms
                    </button>
                  )}
                </div>
                {expandedTopic === t.id && stats?.statsData && (
                  <div className="topic-stats-grid">
                    {stats.statsData.platforms.map(ps => (
                      <div key={ps.platform} className="topic-stat-card">
                        <span className="topic-stat-platform">{ALL_PLATFORMS.find(p => p.id === ps.platform)?.icon || ps.platform}</span>
                        <span className="topic-stat-count">{ps.total_mentions}</span>
                        <span className={`topic-stat-sentiment sentiment-${ps.avg_sentiment > 0.1 ? 'pos' : ps.avg_sentiment < -0.1 ? 'neg' : 'neu'}`}>
                          {ps.avg_sentiment > 0.1 ? '😊' : ps.avg_sentiment < -0.1 ? '😟' : '😐'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pausedTopics.length > 0 && (
        <div className="wp-section wp-topics wp-paused">
          <div className="cp-label">Paused ({pausedTopics.length})</div>
          <div className="wp-topics-list">
            {pausedTopics.map(t => (
              <div key={t.id} className="topic-row topic-paused">
                <span className="topic-name">{t.name}</span>
                <button className="topic-resume" onClick={() => handleToggleStatus(t.id)} title="Resume">▶</button>
                <button className="topic-remove" onClick={() => onRemoveTopic(t.id)} title="Delete">×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Panel: Briefings ── */
function PanelBriefings({ briefings, settings, onSaveSettings, workspace }) {
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const dailyOn = settings?.dailyOn || false;
  const dailyTime = settings?.dailyTime || '07:00';
  const timezone = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const country = settings?.country || '';

  const TIMEZONES = [
    'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland', 'UTC',
  ];

  function relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

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
        <div className="cp-label">Briefing Settings</div>
        <div className="bp-settings-row">
          <label className="bp-settings-label">Region / Country</label>
          <input className="cp-input" type="text" placeholder="e.g. Nigeria, UK, USA"
            value={country}
            onChange={e => onSaveSettings('daily', { dailyOn, dailyTime, timezone, country: e.target.value })} />
        </div>
        <div className="bp-settings-row">
          <label className="bp-settings-label">Timezone</label>
          <select className="cp-input" value={timezone}
            onChange={e => onSaveSettings('daily', { dailyOn, dailyTime, timezone: e.target.value, country })}>
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </div>

      <div className="bp-section">
        <div className="cp-label">Past Briefings</div>
        {!briefings || briefings.length === 0 ? (
          <div className="cp-empty">No briefings yet. Add topics and wait for the daily brief, or say "brief me now" in chat.</div>
        ) : (
          <div className="bp-list">
            {briefings.map(b => (
              <div key={b.id} className={`bp-card ${expanded === b.id ? 'expanded' : ''}`}
                onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                <div className="bp-card-head">
                  <span className="bp-card-time">{relativeTime(b.created_at)}</span>
                  {b.topics_skipped && b.topics_skipped.length > 0 && (
                    <span className="bp-skipped-note">{b.topics_skipped.length} topic{b.topics_skipped.length > 1 ? 's' : ''} had no updates</span>
                  )}
                </div>
                {expanded === b.id ? (
                  <div className="bp-card-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.summary || '') }} />
                ) : (
                  <div className="bp-card-preview">{(b.summary || '').slice(0, 120)}...</div>
                )}
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
function PanelPipeline({ topics, workspace, onOpenPost, refreshKey }) {
  const [posts, setPosts] = useState([]);
  const [showRun, setShowRun] = useState(false);
  const [editPost, setEditPost] = useState(null);
  const [view, setView] = useState('drafts');

  useEffect(() => { loadPosts(); }, [workspace, refreshKey]);

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

  const draftPosts = posts.filter(p => p.status === 'draft' || p.status === 'review');
  const readyPosts = posts.filter(p => p.status === 'ready' || p.status === 'published');
  const visiblePosts = view === 'drafts' ? draftPosts : readyPosts;

  return (
    <div className="pipeline-panel">
      <div className="pp-card">
        <div className="cp-label">Content Pipeline</div>
        <button className="btn-add-topic" onClick={() => setShowRun(true)}>▶ Run Pipeline</button>
      </div>

      <div className="pp-card pp-card-list">
        <div className="pp-tabs">
          <button className={`pp-tab ${view === 'drafts' ? 'active' : ''}`} onClick={() => setView('drafts')}>
            Drafts ({draftPosts.length})
          </button>
          <button className={`pp-tab ${view === 'ready' ? 'active' : ''}`} onClick={() => setView('ready')}>
            Ready ({readyPosts.length})
          </button>
        </div>
        {visiblePosts.length === 0 ? (
          <div className="cp-empty">{view === 'drafts' ? 'No drafts yet — run the pipeline to generate one' : 'No posts ready to post'}</div>
        ) : (
          <div className="pp-post-list">
            {visiblePosts.map(p => (
              <PostCard key={p.id} post={p}
                onEdit={setEditPost} onDelete={handleDeletePost}
                onStatusChange={handleStatusChange} onOpen={onOpenPost} />
            ))}
          </div>
        )}
      </div>

      {showRun && <RunPipelineModal topics={topics} onRun={handleRun} onClose={() => setShowRun(false)} />}
      {editPost && <EditPostModal post={editPost} onSave={handleSavePost} onClose={() => setEditPost(null)} />}
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
        <CalendarPicker value={due} onChange={setDue} />
        <button className="btn-add-topic" onClick={handleAdd} disabled={!text.trim()}>+ Add reminder</button>
      </div>

      <div className="bp-section rp-list-section">
        <div className="cp-label">Reminders ({reminders.length})</div>
        {!reminders || reminders.length === 0 ? (
          <div className="cp-empty">No reminders yet — ask Homin to set one, or add above</div>
        ) : (
          <div className="rp-list">
            {reminders.map(r => {
              const dueAt = r.due && !isNaN(new Date(r.due).getTime()) ? new Date(r.due) : null;
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

/* ── Draft Drawer (blog post preview, shrinks chat area) ── */
function DraftDrawer({ post, onClose, onMove }) {
  const isDraftish = post.status === 'draft' || post.status === 'review';
  return (
    <div className="draft-drawer">
      <div className="draft-drawer-head">
        <div className="draft-drawer-title">{esc(post.title || 'Untitled Draft')}</div>
        <button className="draft-drawer-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="draft-drawer-scroll">
        {post.cover_url && <img className="preview-cover" src={post.cover_url} alt="Cover" />}
        <header className="preview-header">
          {post.topic_name && <span className="preview-topic">{esc(post.topic_name)}</span>}
          {post.tags?.length > 0 && (
            <div className="preview-tags">
              {post.tags.map((t, i) => <span key={i} className="preview-tag">{esc(t)}</span>)}
            </div>
          )}
          {post.excerpt && <p className="preview-excerpt">{esc(post.excerpt)}</p>}
        </header>
        <div className="preview-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />
        {post.news_sources?.length > 0 && (
          <footer className="preview-sources">
            <h4>Sources</h4>
            {post.news_sources.map((s, i) => (
              <div key={i} className="preview-source">
                {s.url ? <a href={s.url} target="_blank" rel="noopener">{esc(s.title || s.source)}</a> : esc(s.title || s.source)}
              </div>
            ))}
          </footer>
        )}
      </div>
      <div className="draft-drawer-actions">
        <button className="draft-drawer-move" onClick={() => onMove(isDraftish ? 'ready' : 'draft')}>
          {isDraftish ? '→ Ready to Post' : '← Back to Drafts'}
        </button>
        <span className="draft-drawer-status">{post.status}</span>
      </div>
    </div>
  );
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ═══════════════════════════════════════════
   LAYOUT
   ═══════════════════════════════════════════ */

const TABS = [
  { key: 'chat', icon: '/icons/chat.png', label: 'Chat' },
  { key: 'watchlist', icon: '/icons/watchlist.png', label: 'Watchlist' },
  { key: 'briefings', icon: '/icons/briefings.png', label: 'Briefings' },
  { key: 'pipeline', icon: '/icons/pipeline.png', label: 'Pipeline' },
  { key: 'reminders', icon: '/icons/reminders.png', label: 'Reminders' },
];

export default function BeccaLayout({
  topics, profile, memory, briefings, reminders, settings,
  onAddTopic, onRemoveTopic, onUpdateTopic,
  onSaveSettings, onAddReminder, onDismissReminder,
  workspace, beccaSection, onSectionChange, beccaModel, onModelChange, onActionExecuted,
  chatGreeting,
}) {
  const [activeSession, setActiveSession] = useState(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const [openDraft, setOpenDraft] = useState(null);
  const [draftMoveNonce, setDraftMoveNonce] = useState(0);
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

  // Per-tab counts — a small badge so it's obvious when an action added
  // something (a reminder from chat, a new topic, a fresh briefing…).
  const tabCounts = {
    chat: null,
    watchlist: topics.filter(t => t.status !== 'paused').length,
    briefings: briefings.length,
    pipeline: null,
    reminders: reminders.filter(r => !r.dismissed && !(r.fired && new Date(r.due) < new Date(Date.now() - 120_000))).length,
  };

  return (
    <div className="becca-layout">
      {/* ── TabBar ── */}
      <div className="al-tabbar">
        {TABS.map(tab => (
          <button key={tab.key}
            className={`al-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.key)}>
            <img className="al-tab-icon" src={tab.icon} alt="" />
            <span className="al-tab-label">{tab.label}</span>
            {tabCounts[tab.key] > 0 && (
              <span className="al-tab-badge">{tabCounts[tab.key] > 9 ? '9+' : tabCounts[tab.key]}</span>
            )}
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
              onRemoveTopic={onRemoveTopic} onUpdateTopic={onUpdateTopic}
              workspace={workspace} beccaModel={beccaModel} onRefresh={onActionExecuted}
              settings={settings} />
          )}
          {activeTab === 'briefings' && (
            <PanelBriefings briefings={briefings} settings={settings}
              onSaveSettings={onSaveSettings} workspace={workspace} />
          )}
          {activeTab === 'pipeline' && (
            <PanelPipeline topics={topics} workspace={workspace} onOpenPost={setOpenDraft} refreshKey={draftMoveNonce} />
          )}
          {activeTab === 'reminders' && (
            <PanelReminders reminders={reminders} onAddReminder={onAddReminder} onDismissReminder={onDismissReminder} />
          )}
        </div>
        <div className="al-resizer" onMouseDown={startResize} title="Drag to resize" />
        {openDraft && (
          <DraftDrawer post={openDraft} onClose={() => setOpenDraft(null)}
            onMove={async (status) => {
              await api.becca.updatePost(openDraft.id, { status });
              setOpenDraft({ ...openDraft, status });
              setDraftMoveNonce(n => n + 1);
            }} />
        )}
        <div className="al-chat">
          <BeccaChat topics={topics} profile={profile} memory={memory}
            workspace={workspace} activeSession={activeSession}
            onSelectSession={setActiveSession} model={beccaModel} onModelChange={onModelChange} onActionExecuted={onActionExecuted}
            greeting={chatGreeting} />
        </div>
      </div>
    </div>
  );
}
