import { useState, useEffect } from 'react';
import { api } from '../api';
import { relativeTime } from '../lib/relativeTime';

const METRICS = [
  { key: 'totalProposals', label: 'Proposals', icon: '📄' },
  { key: 'totalRecipients', label: 'Recipients', icon: '👥' },
  { key: 'totalCampaigns', label: 'Campaigns', icon: '📨' },
  { key: 'totalSent', label: 'Emails Sent', icon: '✅' },
  { key: 'openRate', label: 'Open Rate', suffix: '%', icon: '👁' },
  { key: 'clickRate', label: 'Click Rate', suffix: '%', icon: '🔗' },
];

export default function Dashboard({ proposals, loading, onContinue }) {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    api
      .getProposalStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, []);

  return (
    <div className="dash">
      <div className="dash-metrics">
        {METRICS.map(({ key, label, suffix, icon }) => (
          <div key={key} className="dash-metric">
            <div className="dash-metric-icon">{icon}</div>
            <div className="dash-metric-value">
              {statsLoading ? '—' : stats?.[key] ?? 0}{!statsLoading && suffix ? suffix : ''}
            </div>
            <div className="dash-metric-label">{label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="dash-empty">Loading your proposals…</div>
      ) : proposals.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">📄</div>
          <div className="dash-empty-title">No proposals yet</div>
          <div className="dash-empty-desc">
            Generate your first tailored proposal and it'll show up here.
          </div>
        </div>
      ) : (
        <>
          <div className="dash-heading">Recent proposals</div>
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
        </>
      )}
    </div>
  );
}
