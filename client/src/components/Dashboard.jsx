import { relativeTime } from '../lib/relativeTime';

export default function Dashboard({ proposals, loading, onContinue }) {
  if (loading) {
    return <div className="dash-empty">Loading your proposals…</div>;
  }

  if (proposals.length === 0) {
    return (
      <div className="dash-empty">
        <div className="dash-empty-icon">📄</div>
        <div className="dash-empty-title">No proposals yet</div>
        <div className="dash-empty-desc">
          Generate your first tailored proposal from the Proposals tab and it'll show up here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="dash-heading">Continue designing</div>
      <div className="dash-grid">
        {proposals.map((p) => (
          <button type="button" key={p.id} className="dash-card" onClick={() => onContinue(p)}>
            <div className="dash-thumb" style={{ '--thumb-accent': p.designAccentColor || '#4f46e5' }}>
              <div className="dash-thumb-sender">{p.designSenderName || 'Your name'}</div>
              <div className="dash-thumb-headline" style={{ fontFamily: `"${p.designHeadlineFont || 'Inter'}", sans-serif` }}>
                {p.headline || 'Untitled headline'}
              </div>
              <div className="dash-thumb-lines">
                <span />
                <span />
                <span style={{ width: '60%' }} />
              </div>
            </div>
            <div className="dash-card-meta">
              <div className="dash-card-title">{p.companyName}</div>
              <div className="dash-card-sub">
                {p.designName} · Edited {relativeTime(p.updatedAt)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
