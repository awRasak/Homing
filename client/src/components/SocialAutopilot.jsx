import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { composeSocialImage } from '../lib/renderTemplate';

const SERVICE_COLORS = {
  linkedin: '#0a66c2',
  twitter: '#1da1f2',
  instagram: '#e4405f',
  facebook: '#1877f2',
  tiktok: '#000000',
  pinterest: '#bd081c',
  mastodon: '#6364ff',
  bluesky: '#0085ff',
  threads: '#000000',
  google_business: '#4285f4',
  youtube: '#ff0000',
};

export default function SocialAutopilot({ design, proposals, activeProposal }) {
  const [connected, setConnected] = useState(null);
  const [channels, setChannels] = useState([]);
  const [orgName, setOrgName] = useState('');
  const [posts, setPosts] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState(new Set());
  const [composer, setComposer] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewPosts, setPreviewPosts] = useState(null);
  const [scheduleMode, setScheduleMode] = useState('queue');
  const [scheduleTime, setScheduleTime] = useState('');
  const [msg, setMsg] = useState(null);
  const [topic, setTopic] = useState('');
  const [manualImageUrl, setManualImageUrl] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);

  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  // Boot: check status + load channels + posts
  useEffect(() => {
    api.buffer.getStatus()
      .then((s) => { setConnected(s.connected); if (s.connected) loadAll(); })
      .catch(() => setConnected(false));
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [chRes, postRes] = await Promise.all([api.buffer.getChannels(), api.buffer.getPosts()]);
      setChannels(chRes.channels || []);
      setOrgName(chRes.organizationName || '');
      setPosts(postRes.posts || []);
      // Auto-select all non-locked channels
      setSelectedChannels(new Set((chRes.channels || []).filter((c) => !c.isLocked && !c.isDisconnected).map((c) => c.id)));
    } catch (err) {
      flash(err.message, false);
    }
  }, []);

  const toggleChannel = (id) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSchedule = async () => {
    if (!composer.trim() || !selectedChannels.size) return;
    setScheduling(true);
    try {
      const channelArr = channels.filter((c) => selectedChannels.has(c.id));
      const results = [];
      for (const ch of channelArr) {
        const mode = scheduleMode === 'now' ? 'addToQueue' : scheduleMode === 'queue' ? 'addToQueue' : 'customScheduled';
        const dueAt = scheduleMode === 'scheduled' && scheduleTime ? new Date(scheduleTime).toISOString() : undefined;
        const post = await api.buffer.createPost({ channelId: ch.id, text: composer.trim(), mode, dueAt, imageUrl: manualImageUrl || undefined });
        results.push({ ok: true, channel: ch.displayName || ch.name });
      }
      flash(`Scheduled on ${results.length} channel${results.length > 1 ? 's' : ''}`);
      setComposer('');
      setManualImageUrl(null);
      loadAll();
    } catch (err) {
      flash(err.message, false);
    } finally {
      setScheduling(false);
    }
  };

  const handleDelete = async (postId) => {
    if (!window.confirm('Remove this scheduled post?')) return;
    try {
      await api.buffer.deletePost(postId);
      flash('Post removed');
      loadAll();
    } catch (err) {
      flash(err.message, false);
    }
  };

  const handleGenerateManualImage = async () => {
    if (!composer.trim()) { flash('Write the post text first', false); return; }
    setGeneratingImage(true);
    try {
      // Prefer the configured social template (real brand layout, headline
      // swapped in) — fall back to the prompt-styled AI image when there's
      // no template set, or the render/upload fails for any reason.
      const templateUrl = await composeSocialImage({ headline: composer.trim().slice(0, 120), logoDataUrl: design?.logoDataUrl || null });
      if (templateUrl) {
        setManualImageUrl(templateUrl);
      } else {
        const result = await api.buffer.generateImage({ text: composer.trim(), designId: design?.id });
        setManualImageUrl(result.url);
      }
    } catch (err) {
      flash(err.message, false);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleGenerate = async () => {
    const selChannels = channels.filter((c) => selectedChannels.has(c.id));
    if (!selChannels.length) { flash('Select at least one channel', false); return; }

    setGenerating(true);
    try {
      const result = await api.buffer.generate({ channelIds: selChannels, topic: topic.trim() || undefined, designId: design?.id });
      let posts = result.posts || [];
      const templateUrl = await composeSocialImage({ headline: topic.trim() || posts[0]?.text?.slice(0, 120), logoDataUrl: design?.logoDataUrl || null });
      if (templateUrl) posts = posts.map((p) => ({ ...p, imageUrl: templateUrl }));
      setPreviewPosts(posts);
    } catch (err) {
      flash(err.message, false);
    } finally {
      setGenerating(false);
    }
  };

  const handleScheduleGenerated = async () => {
    if (!previewPosts?.length) return;
    setScheduling(true);
    try {
      const res = await api.buffer.scheduleAll({ posts: previewPosts });
      flash(`Scheduled ${res.succeeded} of ${res.total} posts${res.failed?.length ? ` (${res.failed.length} failed)` : ''}`);
      setPreviewPosts(null);
      loadAll();
    } catch (err) {
      flash(err.message, false);
    } finally {
      setScheduling(false);
    }
  };

  // ── Not configured ──
  if (connected === false) {
    return (
      <div className="autopilot-page">
        <div className="autopilot-empty">
          <div className="autopilot-empty-icon">📡</div>
          <h2>Connect Buffer</h2>
          <p>Homing can schedule posts to all your social accounts through Buffer.</p>
          <ol className="autopilot-setup-steps">
            <li>Go to <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener">Buffer API Settings</a> and generate an API key</li>
            <li>Add <code>BUFFER_API_KEY=your_key_here</code> to <code>server/.env</code></li>
            <li>Restart the API server</li>
          </ol>
          <p className="autopilot-setup-note">Buffer's free plan includes API access with 3,000 requests per month.</p>
        </div>
      </div>
    );
  }

  if (connected === null) return <div className="autopilot-page"><div className="autopilot-loading">Connecting to Buffer…</div></div>;

  return (
    <div className="autopilot-page">
      {msg && <div className={`autopilot-flash ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      {/* Header */}
      <div className="autopilot-header">
        <div>
          <h2 className="autopilot-title">Social Autopilot</h2>
          <p className="autopilot-subtitle">{orgName} · {channels.length} channel{channels.length !== 1 ? 's' : ''} connected</p>
        </div>
        <button className="autopilot-btn-secondary" onClick={loadAll}>↻ Refresh</button>
      </div>

      {/* Channel picker */}
      <div className="autopilot-channels">
        <div className="autopilot-section-label">Channels</div>
        <div className="autopilot-channel-grid">
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`autopilot-chip ${selectedChannels.has(ch.id) ? 'selected' : ''} ${ch.isLocked || ch.isDisconnected ? 'disabled' : ''}`}
              onClick={() => !ch.isLocked && !ch.isDisconnected && toggleChannel(ch.id)}
              title={ch.isLocked ? 'Locked (upgrade required)' : ch.isDisconnected ? 'Disconnected' : ch.displayName}
              style={selectedChannels.has(ch.id) ? { borderColor: SERVICE_COLORS[ch.service] || '#c8f000' } : undefined}
            >
              <span className="autopilot-chip-dot" style={{ background: SERVICE_COLORS[ch.service] || '#999' }} />
              <span className="autopilot-chip-name">{ch.name || ch.displayName}</span>
              <span className="autopilot-chip-service">{ch.service}</span>
            </button>
          ))}
          {!channels.length && <div className="autopilot-empty-note">No channels found. Connect accounts in Buffer first.</div>}
        </div>
      </div>

      <div className="autopilot-body-grid">
        {/* Left: Compose + Generate */}
        <div className="autopilot-compose-col">
          {/* AI Generate */}
          <div className="autopilot-card">
            <div className="autopilot-card-header">Autopilot</div>
            <p className="autopilot-card-desc">
              Becca writes social posts from your conversations, research, and market intelligence.
            </p>
            <input
              type="text"
              className="autopilot-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Optional topic or angle (e.g. 'product launch', 'weekly tip')"
            />
            <button
              type="button"
              className="autopilot-btn-primary"
              onClick={handleGenerate}
              disabled={generating || !selectedChannels.size}
            >
              {generating ? 'Generating…' : '⚡ Generate Posts'}
            </button>
          </div>

          {/* Generated preview */}
          {previewPosts?.length > 0 && (
            <div className="autopilot-card autopilot-preview-card">
              <div className="autopilot-card-header">
                Generated Posts
                <button type="button" className="autopilot-btn-text" onClick={() => setPreviewPosts(null)}>✕</button>
              </div>
              {previewPosts[0]?.imageUrl && (
                <div className="autopilot-preview-image-wrap">
                  <img className="autopilot-preview-image" src={previewPosts[0].imageUrl} alt="Generated brand image" />
                  <span className="autopilot-preview-image-note">Same image attached to every post below</span>
                </div>
              )}
              <div className="autopilot-preview-list">
                {previewPosts.map((p, i) => (
                  <div key={i} className="autopilot-preview-item">
                    <div className="autopilot-preview-service" style={{ color: SERVICE_COLORS[p.service] }}>{p.service} → {p.channelName}</div>
                    <div className="autopilot-preview-text">{p.text}</div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="autopilot-btn-primary"
                onClick={handleScheduleGenerated}
                disabled={scheduling}
              >
                {scheduling ? 'Scheduling…' : `Schedule ${previewPosts.length} Posts`}
              </button>
            </div>
          )}

          {/* Manual compose */}
          <div className="autopilot-card">
            <div className="autopilot-card-header">Manual Post</div>
            <textarea
              className="autopilot-textarea"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Write a post…"
              rows={5}
            />
            <div className="autopilot-image-row">
              {manualImageUrl ? (
                <div className="autopilot-manual-image-wrap">
                  <img className="autopilot-manual-image" src={manualImageUrl} alt="Generated brand image" />
                  <button type="button" className="autopilot-btn-text autopilot-btn-danger" onClick={() => setManualImageUrl(null)}>Remove image</button>
                </div>
              ) : (
                <button
                  type="button"
                  className="autopilot-btn-secondary"
                  onClick={handleGenerateManualImage}
                  disabled={generatingImage || !composer.trim()}
                >
                  {generatingImage ? 'Generating image…' : '🖼 Generate image'}
                </button>
              )}
            </div>
            <div className="autopilot-compose-footer">
              <div className="autopilot-schedule-toggle">
                <button type="button" className={`autopilot-mode-btn ${scheduleMode === 'queue' ? 'active' : ''}`} onClick={() => setScheduleMode('queue')}>Add to queue</button>
                <button type="button" className={`autopilot-mode-btn ${scheduleMode === 'scheduled' ? 'active' : ''}`} onClick={() => setScheduleMode('scheduled')}>Schedule for…</button>
              </div>
              {scheduleMode === 'scheduled' && (
                <input
                  type="datetime-local"
                  className="autopilot-datetime"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              )}
            </div>
            <button
              type="button"
              className="autopilot-btn-primary"
              onClick={handleSchedule}
              disabled={scheduling || !composer.trim() || !selectedChannels.size}
            >
              {scheduling ? 'Posting…' : `Post to ${selectedChannels.size} channel${selectedChannels.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {/* Right: Queue */}
        <div className="autopilot-queue-col">
          <div className="autopilot-card">
            <div className="autopilot-card-header">
              Scheduled Posts
              <span className="autopilot-badge">{posts.length}</span>
            </div>
            <div className="autopilot-queue-list">
              {posts.map((p) => (
                <div key={p.id} className="autopilot-queue-item">
                  <div className="autopilot-queue-top">
                    <span className="autopilot-queue-service" style={{ color: SERVICE_COLORS[p.channelService] }}>
                      {p.channelService}
                    </span>
                    <span className="autopilot-queue-date">
                      {p.dueAt ? new Date(p.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Queued'}
                    </span>
                  </div>
                  <div className="autopilot-queue-text">{p.text?.slice(0, 180)}{p.text?.length > 180 ? '…' : ''}</div>
                  <button type="button" className="autopilot-btn-text autopilot-btn-danger" onClick={() => handleDelete(p.id)}>Remove</button>
                </div>
              ))}
              {!posts.length && <div className="autopilot-empty-note">No scheduled posts.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
