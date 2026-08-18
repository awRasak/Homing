export default function BeccaBriefingsPanel({ briefings }) {
  if (!briefings || briefings.length === 0) {
    return <div className="bp-empty">No briefings yet</div>;
  }

  return (
    <div className="bp-panel">
      {briefings.map(b => (
        <div key={b.id} className="bp-card">
          <div className="bp-card-head">
            <span className="bp-card-topic">{b.topic_name || 'General'}</span>
            <span className={`bp-sentiment ${b.sentiment || 'neutral'}`}>
              {b.sentiment || 'neutral'}
            </span>
          </div>
          <div className="bp-card-title">{b.headline || 'Briefing'}</div>
          <div className="bp-card-body">{b.summary || b.body || ''}</div>
          {b.changed_since_last && <div className="bp-card-changed">Changed: {b.changed_since_last}</div>}
          <div className="bp-card-meta">
            {b.status && <span className={`bp-status ${b.status}`}>{b.status}</span>}
            {b.created_at && <span className="bp-time">{new Date(b.created_at).toLocaleDateString()}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
