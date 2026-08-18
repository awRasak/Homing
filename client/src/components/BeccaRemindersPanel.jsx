export default function BeccaRemindersPanel({ reminders, onDismiss }) {
  if (!reminders || reminders.length === 0) {
    return <div className="rp-empty">No reminders yet</div>;
  }

  const now = Date.now();

  return (
    <div className="rp-panel">
      {reminders.map(r => {
        const due = r.due_at ? new Date(r.due_at) : null;
        const overdue = due && due.getTime() < now;
        return (
          <div key={r.id} className={`rp-card ${overdue ? 'overdue' : ''}`}>
            <div className="rp-card-text">{r.text || r.message}</div>
            <div className="rp-card-foot">
              {due && <span className="rp-due">{due.toLocaleString()}</span>}
              <button className="rp-dismiss" onClick={() => onDismiss(r.id)}>Dismiss</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
