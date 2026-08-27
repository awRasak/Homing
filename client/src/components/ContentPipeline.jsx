import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { composeSocialImage } from '../lib/renderTemplate';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STATUSES = [
  { value: 'draft', label: 'Draft', color: 'var(--grey-mid)' },
  { value: 'review', label: 'Review', color: '#c08000' },
  { value: 'ready', label: 'Ready', color: 'var(--green-dark)' },
  { value: 'published', label: 'Published', color: '#3b82f6' },
];

const PIPELINE_STEPS = [
  { key: 'scout', icon: '/icons/watchlist.png', label: 'Scout', desc: 'Find news' },
  { key: 'write', icon: '/icons/write.png', label: 'Write', desc: 'Draft post' },
  { key: 'image', icon: '/icons/image.png', label: 'Image', desc: 'Cover art' },
  { key: 'seo', icon: '/icons/seo.png', label: 'SEO', desc: 'Audit score' },
  { key: 'publish', icon: '/icons/publish.png', label: 'Publish', desc: 'Go live' },
];

function SeoScore({ score }) {
  const color = score >= 80 ? 'var(--green-dark)' : score >= 50 ? '#c08000' : '#e05050';
  return (
    <span className="seo-score" style={{ color }}>
      {score}
    </span>
  );
}

export function PostCard({ post, onEdit, onDelete, onStatusChange, onPreview, onOpen, onAnnounce }) {
  const [expanded, setExpanded] = useState(false);
  const statusObj = STATUSES.find(s => s.value === post.status) || STATUSES[0];

  return (
    <div className={`pipeline-post ${expanded ? 'expanded' : ''}`}>
      <div className="pp-head" onClick={() => onOpen ? onOpen(post) : setExpanded(!expanded)}>
        <div className="pp-head-l">
          <span className="pp-status-dot" style={{ background: statusObj.color }} />
          <div className="pp-head-info">
            <div className="pp-title">{esc(post.title || 'Untitled')}</div>
            <div className="pp-meta">
              {post.topic_name && <span className="pp-topic">{esc(post.topic_name)}</span>}
              <span className="pp-date">{new Date(post.updated_at).toLocaleDateString()}</span>
              {post.seo_score > 0 && <SeoScore score={post.seo_score} />}
            </div>
          </div>
        </div>
        <div className="pp-head-r">
          {onAnnounce && (
            <button
              type="button"
              className="pp-announce-btn"
              title="Draft a social post about this"
              onClick={(e) => { e.stopPropagation(); onAnnounce(post); }}
            >
              📣
            </button>
          )}
          <span className="pp-expand">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div className="pp-body">
          {post.excerpt && <div className="pp-excerpt">{esc(post.excerpt)}</div>}
          {post.cover_url && <img className="pp-cover" src={post.cover_url} alt="Cover" />}
          {post.tags?.length > 0 && (
            <div className="pp-tags">
              {post.tags.map((t, i) => <span key={i} className="pp-tag">{esc(t)}</span>)}
            </div>
          )}
          {post.news_sources?.length > 0 && (
            <div className="pp-sources">
              <div className="pp-sources-label">Sources ({post.news_sources.length})</div>
              {post.news_sources.slice(0, 3).map((s, i) => (
                <div key={i} className="pp-source-item">
                  {s.url ? <a href={s.url} target="_blank" rel="noopener">{esc(s.title || s.source)}</a> : esc(s.title || s.source)}
                </div>
              ))}
            </div>
          )}
          {post.seo_data?.issues?.length > 0 && (
            <div className="pp-seo-issues">
              <div className="pp-seo-label">SEO Issues ({post.seo_data.issues.length})</div>
              {post.seo_data.issues.map((issue, i) => (
                <div key={i} className={`pp-seo-issue severity-${issue.severity}`}>
                  <span className="pp-seo-sev">{issue.severity}</span> {esc(issue.message)}
                  {issue.fix && <span className="pp-seo-fix"> → {esc(issue.fix)}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="pp-actions">
            {onPreview && <button className="btn-secondary" onClick={() => onPreview(post)}>Preview</button>}
            <button className="btn-secondary" onClick={() => onEdit(post)}>Edit</button>
            <button className="btn-text btn-danger" onClick={() => onDelete(post.id)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RunPipelineModal({ topics, onRun, onClose, designId }) {
  const [selectedTopic, setSelectedTopic] = useState('');
  const [customTopic, setCustomTopic] = useState('');
  const [topicContext, setTopicContext] = useState('');
  const [tone, setTone] = useState('Professional yet approachable');
  const [wordCount, setWordCount] = useState(800);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);

  const topicName = selectedTopic === '__custom__' ? customTopic : selectedTopic;

  async function handleRun() {
    if (!topicName.trim()) return;
    setRunning(true);
    setStep(0);
    // Simulate step progress
    const timers = [1, 2, 3, 4].map((s, i) => setTimeout(() => setStep(s), (i + 1) * 3000));
    try {
      const result = await api.becca.runPipeline({
        topicName: topicName.trim(), topicContext, tone, wordCount: parseInt(wordCount) || 800, designId,
      });
      timers.forEach(clearTimeout);
      onRun(result);
    } catch (err) {
      timers.forEach(clearTimeout);
      alert('Pipeline failed: ' + err.message);
    } finally {
      setRunning(false);
      setStep(-1);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--ink)' }}>Run Content Pipeline</h3>

        {!running ? (
          <>
            <div className="field">
              <span>Topic</span>
              <select value={selectedTopic} onChange={e => setSelectedTopic(e.target.value)}>
                <option value="">Select a tracked topic…</option>
                {topics.map(t => <option key={t.id} value={t.name}>{esc(t.name)}</option>)}
                <option value="__custom__">Custom topic…</option>
              </select>
            </div>
            {selectedTopic === '__custom__' && (
              <div className="field">
                <span>Custom topic</span>
                <input type="text" value={customTopic} onChange={e => setCustomTopic(e.target.value)} placeholder="e.g. AI agents for enterprise" />
              </div>
            )}
            <div className="field">
              <span>Additional context (optional)</span>
              <input type="text" value={topicContext} onChange={e => setTopicContext(e.target.value)} placeholder="e.g. Focus on recent GPT-5 announcements" />
            </div>
            <div className="field-row">
              <div className="field">
                <span>Tone</span>
                <select value={tone} onChange={e => setTone(e.target.value)}>
                  <option>Professional yet approachable</option>
                  <option>Technical deep-dive</option>
                  <option>Casual and conversational</option>
                  <option>Thought leadership</option>
                  <option>News/reporting</option>
                </select>
              </div>
              <div className="field">
                <span>Word count</span>
                <input type="number" value={wordCount} onChange={e => setWordCount(e.target.value)} min={300} max={3000} step={100} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleRun} disabled={!topicName.trim()}>Run Pipeline</button>
            </div>
          </>
        ) : (
          <div className="pipeline-progress">
            <div className="pp-steps">
              {PIPELINE_STEPS.map((s, i) => (
                <div key={s.key} className={`pp-step ${i <= step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
                  <div className="pp-step-icon">{i < step ? '✓' : <img className="pp-step-img" src={s.icon} alt="" />}</div>
                  <div className="pp-step-label">{s.label}</div>
                  {i < PIPELINE_STEPS.length - 1 && <div className="pp-step-line" />}
                </div>
              ))}
            </div>
            <div className="pp-step-status">
              {step < 4 ? `Running ${PIPELINE_STEPS[step]?.label || 'pipeline'}…` : 'Pipeline complete!'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EditPostModal({ post, onSave, onClose }) {
  const [title, setTitle] = useState(post?.title || '');
  const [body, setBody] = useState(post?.body || '');
  const [excerpt, setExcerpt] = useState(post?.excerpt || '');
  const [tags, setTags] = useState((post?.tags || []).join(', '));
  const [slug, setSlug] = useState(post?.slug || '');

  async function handleSave() {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const autoSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await onSave({ title, body, excerpt, tags: tagList, slug: autoSlug });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, textAlign: 'left', maxHeight: '80vh', overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--ink)' }}>Edit Post</h3>
        <div className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <span>Slug</span>
          <input type="text" value={slug} onChange={e => setSlug(e.target.value)} placeholder={title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')} />
        </div>
        <div className="field">
          <span>Excerpt</span>
          <textarea rows={2} value={excerpt} onChange={e => setExcerpt(e.target.value)} />
        </div>
        <div className="field">
          <span>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={e => setTags(e.target.value)} />
        </div>
        <div className="field">
          <span>Body (Markdown)</span>
          <textarea rows={16} value={body} onChange={e => setBody(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// Draft a social post about a finished blog post, using the same brand-image
// step and Buffer scheduling the Autopilot page uses — kept as a review-first
// draft here rather than posting straight from the pipeline.
export function AnnounceModal({ post, designId, onClose }) {
  const [connected, setConnected] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [previewPosts, setPreviewPosts] = useState(null);
  const [error, setError] = useState('');
  const [scheduledOk, setScheduledOk] = useState(false);

  useEffect(() => {
    api.buffer.getStatus()
      .then((s) => {
        setConnected(s.connected);
        if (!s.connected) return;
        return api.buffer.getChannels().then((res) => {
          const list = res.channels || [];
          setChannels(list);
          setSelectedChannels(new Set(list.filter((c) => !c.isLocked && !c.isDisconnected).map((c) => c.id)));
        });
      })
      .catch(() => setConnected(false));
  }, []);

  function toggleChannel(id) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    const selChannels = channels.filter((c) => selectedChannels.has(c.id));
    if (!selChannels.length) { setError('Select at least one channel'); return; }
    setError('');
    setGenerating(true);
    try {
      const result = await api.buffer.generate({ channelIds: selChannels, postId: post.id, designId });
      let posts = result.posts || [];
      // Prefer the configured social template over the prompt-styled fallback
      // image the server already generated — no dead end if there's no
      // template set, or the render/upload fails.
      const templateUrl = await composeSocialImage({ headline: post.title });
      if (templateUrl) posts = posts.map((p) => ({ ...p, imageUrl: templateUrl }));
      setPreviewPosts(posts);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSchedule() {
    if (!previewPosts?.length) return;
    setScheduling(true);
    setError('');
    try {
      const res = await api.buffer.scheduleAll({ posts: previewPosts });
      if (res.failed?.length && !res.succeeded) throw new Error(res.failed[0]?.error || 'Scheduling failed');
      setScheduledOk(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
        <h3 style={{ margin: '0 0 0.3rem', fontSize: '1rem', color: 'var(--ink)' }}>Draft a social post</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: 'var(--grey-mid)' }}>
          About “{esc(post.title || 'Untitled')}”
        </p>

        {connected === null && <div className="becca-loading">Checking Buffer…</div>}

        {connected === false && (
          <div className="page-empty" style={{ padding: '1rem 0' }}>
            <div className="page-empty-title">Buffer isn't connected</div>
            <div className="page-empty-sub">Connect Buffer from the Autopilot tab first, then come back here.</div>
          </div>
        )}

        {connected && scheduledOk && (
          <div className="page-empty" style={{ padding: '1rem 0' }}>
            <div className="page-empty-title">Scheduled ✓</div>
            <div className="page-empty-sub">Your announcement is queued in Buffer.</div>
            <button className="btn-primary" onClick={onClose} style={{ marginTop: '0.75rem' }}>Done</button>
          </div>
        )}

        {connected && !scheduledOk && !previewPosts && (
          <>
            <div className="field">
              <span>Channels</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className={`autopilot-mode-btn ${selectedChannels.has(ch.id) ? 'active' : ''}`}
                    disabled={ch.isLocked || ch.isDisconnected}
                    onClick={() => toggleChannel(ch.id)}
                  >
                    {ch.displayName || ch.name}
                  </button>
                ))}
                {!channels.length && <span style={{ fontSize: '0.8rem', color: 'var(--grey-mid)' }}>No channels connected.</span>}
              </div>
            </div>
            {error && <p className="import-error">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleGenerate} disabled={generating || !selectedChannels.size}>
                {generating ? 'Drafting…' : 'Draft posts'}
              </button>
            </div>
          </>
        )}

        {connected && !scheduledOk && previewPosts && (
          <>
            {previewPosts[0]?.imageUrl && (
              <img src={previewPosts[0].imageUrl} alt="Generated brand image" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
            )}
            <div className="autopilot-preview-list">
              {previewPosts.map((p, i) => (
                <div key={i} className="autopilot-preview-item">
                  <div className="autopilot-preview-service">{p.service} → {p.channelName}</div>
                  <div className="autopilot-preview-text">{p.text}</div>
                </div>
              ))}
            </div>
            {error && <p className="import-error">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={() => setPreviewPosts(null)}>Back</button>
              <button className="btn-primary" onClick={handleSchedule} disabled={scheduling}>
                {scheduling ? 'Scheduling…' : `Schedule ${previewPosts.length} posts`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ContentPipeline({ topics, workspace }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [showRun, setShowRun] = useState(false);
  const [editPost, setEditPost] = useState(null);

  const filtered = filterStatus ? posts.filter(p => p.status === filterStatus) : posts;

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    setLoading(true);
    try {
      const data = await api.becca.listPosts(workspace);
      setPosts(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleRunPipeline(result) {
    setShowRun(false);
    setPosts(prev => [{ ...result, tags: result.tags || [], news_sources: [], seo_data: result.seo_data || {}, status: 'draft', workspace, topic_name: '', slug: result.slug || '', body: '', excerpt: result.excerpt || '', cover_url: result.coverUrl || '', published_url: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]);
    // Reload to get full data
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

  const draftCount = posts.filter(p => p.status === 'draft').length;
  const reviewCount = posts.filter(p => p.status === 'review').length;
  const publishedCount = posts.filter(p => p.status === 'published').length;

  return (
    <div className="content-pipeline">
      <div className="cp-header">
        <div>
          <div className="cp-title">Content Pipeline</div>
          <div className="cp-subtitle">Scout → Write → Image → SEO → Publish</div>
        </div>
        <button className="btn-primary" onClick={() => setShowRun(true)}>▶ Run Pipeline</button>
      </div>

      <div className="cp-stats">
        <div className="cp-stat" onClick={() => setFilterStatus(filterStatus === 'draft' ? '' : 'draft')}>
          <div className="cp-stat-val">{draftCount}</div>
          <div className="cp-stat-lbl">Drafts</div>
        </div>
        <div className="cp-stat" onClick={() => setFilterStatus(filterStatus === 'review' ? '' : 'review')}>
          <div className="cp-stat-val" style={{ color: '#c08000' }}>{reviewCount}</div>
          <div className="cp-stat-lbl">Review</div>
        </div>
        <div className="cp-stat" onClick={() => setFilterStatus(filterStatus === 'published' ? '' : 'published')}>
          <div className="cp-stat-val" style={{ color: '#3b82f6' }}>{publishedCount}</div>
          <div className="cp-stat-lbl">Published</div>
        </div>
        <div className="cp-stat" onClick={() => setFilterStatus('')}>
          <div className="cp-stat-val">{posts.length}</div>
          <div className="cp-stat-lbl">Total</div>
        </div>
      </div>

      {filterStatus && (
        <div className="cp-filter-bar">
          <span>Filtered: <strong>{filterStatus}</strong></span>
          <button className="btn-text" onClick={() => setFilterStatus('')}>Clear</button>
        </div>
      )}

      {loading ? (
        <div className="becca-loading">Loading posts…</div>
      ) : filtered.length === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon">📝</div>
          <div className="page-empty-title">No posts yet</div>
          <div className="page-empty-sub">
            Run the content pipeline to automatically scout news, write a blog post, generate a cover image, and check SEO — all in one go.
          </div>
          <button className="btn-primary" onClick={() => setShowRun(true)}>▶ Run Pipeline</button>
        </div>
      ) : (
        <div className="cp-posts">
          {filtered.map(post => (
            <PostCard key={post.id} post={post} onEdit={setEditPost} onDelete={handleDeletePost} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      {showRun && <RunPipelineModal topics={topics} onRun={handleRunPipeline} onClose={() => setShowRun(false)} />}
      {editPost && <EditPostModal post={editPost} onSave={handleSavePost} onClose={() => setEditPost(null)} />}
    </div>
  );
}
