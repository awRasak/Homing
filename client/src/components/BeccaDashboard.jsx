import { useState, useEffect } from 'react';
import { api } from '../api';

function topicIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('crypto') || n.includes('bitcoin')) return '₿';
  if (n.includes('ai') || n.includes('openai') || n.includes('gpt')) return '🤖';
  if (n.includes('stock') || n.includes('market') || n.includes('invest')) return '📈';
  if (n.includes('tech') || n.includes('software') || n.includes('startup')) return '💻';
  return '📡';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function BeccaDashboard({ topics, reminders, briefingsCount, onNavigate }) {
  const activeReminders = reminders.filter(r => !r.dismissed);

  return (
    <div className="becca-dashboard">
      <div className="dash-section-lbl">Quick actions</div>
      <div className="dash-action-row" style={{ marginBottom: 20 }}>
        <button className="dash-action-btn" onClick={() => onNavigate('chat')}>✦ Run briefing</button>
        <button className="dash-action-btn secondary" onClick={() => onNavigate('chat')}>💬 Open chat</button>
        <button className="dash-action-btn secondary" onClick={() => onNavigate('watchlist')}>📡 Watchlist</button>
      </div>

      <div className="dash-section-lbl">Overview</div>
      <div className="dash-grid">
        <div className="dash-card" onClick={() => onNavigate('watchlist')}>
          <div className="dash-card-icon">📡</div>
          <div className="dash-card-title">Topics tracked</div>
          <div className="dash-card-value green">{topics.length}</div>
          <div className="dash-card-sub">{topics.length === 0 ? 'Add your first topic' : `${topics.length} topic${topics.length !== 1 ? 's' : ''} on watchlist`}</div>
        </div>
        <div className="dash-card" onClick={() => onNavigate('briefings')}>
          <div className="dash-card-icon">🗂</div>
          <div className="dash-card-title">Briefings run</div>
          <div className="dash-card-value">{briefingsCount}</div>
          <div className="dash-card-sub">{briefingsCount === 0 ? 'No briefings yet' : `${briefingsCount} total`}</div>
        </div>
        <div className="dash-card" onClick={() => onNavigate('reminders')}>
          <div className="dash-card-icon">⏰</div>
          <div className="dash-card-title">Reminders</div>
          <div className="dash-card-value">{activeReminders.length}</div>
          <div className="dash-card-sub">{activeReminders.length === 0 ? 'No pending reminders' : `${activeReminders.length} pending`}</div>
        </div>
        <div className="dash-card accent" onClick={() => onNavigate('chat')}>
          <div className="dash-card-icon">🟢</div>
          <div className="dash-card-title">Intelligence</div>
          <div className="dash-card-value green">Active</div>
          <div className="dash-card-sub">Web search + AI analysis</div>
        </div>
      </div>

      {topics.length > 0 && (
        <>
          <div className="dash-section-lbl" style={{ marginTop: 8 }}>Watching</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topics.slice(0, 4).map(t => (
              <div key={t.id} className="dash-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1rem' }}>{topicIcon(t.name)}</span>
                <div style={{ flex: 1 }}>
                  <div className="dash-card-title" style={{ margin: 0 }}>{esc(t.name)}</div>
                  {t.context && <div className="dash-card-sub" style={{ margin: 0 }}>{esc(t.context.slice(0, 60))}{t.context.length > 60 ? '…' : ''}</div>}
                </div>
              </div>
            ))}
            {topics.length > 4 && <div className="dash-card-sub" style={{ textAlign: 'center', padding: '8px 0' }}>+{topics.length - 4} more</div>}
          </div>
        </>
      )}
    </div>
  );
}
