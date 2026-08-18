import { useState, useEffect } from 'react';
import { api } from '../api';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatReminderDate(date) {
  if (!date) return 'next open';
  const now = new Date();
  const diff = date - now;
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins} min${mins !== 1 ? 's' : ''}`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `in ${hrs} hour${hrs !== 1 ? 's' : ''}`;
  const dys = Math.floor(diff / 86400000);
  if (dys === 1) return 'tomorrow';
  if (dys < 7) return `in ${dys} days`;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function BeccaReminders({ workspace }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.becca.listReminders(workspace)
      .then(setReminders)
      .catch(() => setReminders([]))
      .finally(() => setLoading(false));
  }, [workspace]);

  async function dismiss(id) {
    await api.becca.updateReminder(id, { dismissed: true });
    setReminders(prev => prev.map(r => r.id === id ? { ...r, dismissed: 1 } : r));
  }

  async function remove(id) {
    await api.becca.deleteReminder(id);
    setReminders(prev => prev.filter(r => r.id !== id));
  }

  const active = reminders.filter(r => !r.dismissed);

  if (loading) return <div className="becca-loading">Loading reminders…</div>;

  if (active.length === 0) {
    return (
      <div className="page-empty">
        <div className="page-empty-icon">⏰</div>
        <div className="page-empty-title">No reminders set</div>
        <div className="page-empty-sub">Tell Homin to "remind me to…" and it will appear here.</div>
      </div>
    );
  }

  return (
    <div className="becca-reminders">
      {active.map(r => {
        const due = r.due ? new Date(r.due) : null;
        const overdue = due && due < new Date();
        return (
          <div key={r.id} className={`rem-page-item ${overdue ? 'overdue' : ''}`}>
            <div className="rem-page-icon">{overdue ? '🔔' : '⏰'}</div>
            <div className="rem-page-body">
              <div className="rem-page-text">{esc(r.text)}</div>
              <div className="rem-page-when">{due ? formatReminderDate(due) : 'On next open'}{overdue ? ' · Overdue' : ''}</div>
            </div>
            <button className="rem-page-dismiss" onClick={() => dismiss(r.id)}>Dismiss</button>
          </div>
        );
      })}
    </div>
  );
}
