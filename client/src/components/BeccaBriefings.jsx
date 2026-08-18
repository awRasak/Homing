import { useState, useEffect } from 'react';
import { api } from '../api';

function topicIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('crypto') || n.includes('bitcoin')) return '₿';
  if (n.includes('ai') || n.includes('openai') || n.includes('gpt')) return '🤖';
  if (n.includes('stock') || n.includes('market') || n.includes('invest')) return '📈';
  if (n.includes('climate') || n.includes('energy')) return '🌍';
  if (n.includes('health') || n.includes('medic')) return '💊';
  if (n.includes('tech') || n.includes('software') || n.includes('startup')) return '💻';
  return '📡';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STATUS_META = {
  changed: { label: '🔴 Changed', cls: 'changed' },
  stable: { label: '✅ Stable', cls: 'stable' },
  uncertain: { label: '🟡 Uncertain', cls: 'uncertain' },
};

export default function BeccaBriefings({ workspace }) {
  const [briefings, setBriefings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.becca.listBriefings(workspace, 100)
      .then(setBriefings)
      .catch(() => setBriefings([]))
      .finally(() => setLoading(false));
  }, [workspace]);

  function groupByDate(items) {
    const groups = {};
    for (const b of items) {
      const date = new Date(b.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (!groups[date]) groups[date] = [];
      groups[date].push(b);
    }
    return groups;
  }

  async function handleNoteUpdate(id, note) {
    await api.becca.updateBriefingNote(id, note);
    setBriefings(prev => prev.map(b => b.id === id ? { ...b, note } : b));
  }

  if (loading) return <div className="becca-loading">Loading briefings…</div>;

  const groups = groupByDate(briefings);
  const dates = Object.keys(groups);

  if (dates.length === 0) {
    return (
      <div className="page-empty">
        <div className="page-empty-icon">🗂</div>
        <div className="page-empty-title">No briefings yet</div>
        <div className="page-empty-sub">Run your first briefing from the Becca chat page.</div>
      </div>
    );
  }

  return (
    <div className="becca-briefings">
      {dates.map(date => (
        <div key={date} className="brief-history-group">
          <div className="brief-history-date">{date}</div>
          <div className="briefings-list">
            {groups[date].map(b => {
              const s = STATUS_META[b.status] || STATUS_META.uncertain;
              const urls = Array.isArray(b.urls) ? b.urls : JSON.parse(b.urls || '[]');
              return (
                <div key={b.id} className="brief-card">
                  <div className="bc-head">
                    <div className="bc-head-l">
                      <div className="bc-icon">{topicIcon(b.topic_name)}</div>
                      <div>
                        <div className="bc-topic">{esc(b.topic_name)}</div>
                        <div className="bc-date">{new Date(b.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {esc(b.sentiment)}</div>
                      </div>
                    </div>
                    <span className={`status-pill ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="bc-body">
                    <div className="bc-headline">{esc(b.headline)}</div>
                    <div className="bc-row">
                      <div className="bc-cell">
                        <div className="bc-cell-lbl">What Changed</div>
                        <div className="bc-cell-val">{esc(b.what_changed)}</div>
                      </div>
                      <div className="bc-cell">
                        <div className="bc-cell-lbl">Why It Matters</div>
                        <div className="bc-cell-val">{esc(b.why_it_matters)}</div>
                      </div>
                    </div>
                    <div className="bc-source">📌 {esc(b.source_note)}</div>
                    {urls.length > 0 && (
                      <div className="bc-actions">
                        {urls.map((u, i) => (
                          <a key={i} className="bc-share-btn" href={u} target="_blank" rel="noopener noreferrer">↗ Source {i + 1}</a>
                        ))}
                      </div>
                    )}
                    <div className="bc-notes">
                      <textarea className="bc-notes-input" value={b.note || ''} rows={1}
                        placeholder="Add a note… (actioned, follow up, shared with team)"
                        onChange={e => handleNoteUpdate(b.id, e.target.value)}
                        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
