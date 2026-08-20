import { useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n) { return String(n).padStart(2, '0'); }

export default function CalendarPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value) : null;
  const [view, setView] = useState(() => (parsed || new Date()));
  const [time, setTime] = useState(() => {
    if (value) { const d = new Date(value); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    return '09:00';
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  function selectedMatch(d) {
    return parsed && parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === d;
  }

  function handlePick(d) {
    const [h, m] = time.split(':').map(Number);
    const dt = new Date(year, month, d, h, m);
    onChange(dt.toISOString());
    setOpen(false);
  }

  function shiftMonth(delta) {
    setView(new Date(year, month + delta, 1));
  }

  return (
    <div className="cal-wrap">
      <button type="button" className="cp-input cal-trigger" onClick={() => setOpen(o => !o)}>
        <span className="cal-trigger-icon">📅</span>
        {parsed ? parsed.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Pick a date & time…'}
      </button>

      {open && (
        <>
          <div className="cal-overlay" onClick={() => setOpen(false)} />
          <div className="cal-pop">
            <div className="cal-head">
              <button type="button" className="cal-nav" onClick={() => shiftMonth(-1)}>‹</button>
              <div className="cal-title">{MONTHS[month]} {year}</div>
              <button type="button" className="cal-nav" onClick={() => shiftMonth(1)}>›</button>
            </div>

            <div className="cal-grid cal-days">
              {DAYS.map(d => <div key={d} className="cal-dow">{d}</div>)}
              {Array.from({ length: firstDay }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1;
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
                return (
                  <button key={d} type="button"
                    className={`cal-day${selectedMatch(d) ? ' selected' : ''}${isToday && !selectedMatch(d) ? ' today' : ''}`}
                    onClick={() => handlePick(d)}>
                    {d}
                  </button>
                );
              })}
            </div>

            <div className="cal-time-row">
              <span className="cal-time-lbl">Time</span>
              <input type="time" className="cal-time-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>

            <div className="cal-foot">
              <button type="button" className="btn-secondary cal-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary cal-btn" onClick={() => {
                const [h, m] = time.split(':').map(Number);
                const dt = new Date(year, month, view.getDate() > daysInMonth ? 1 : view.getDate(), h, m);
                onChange(dt.toISOString());
                setOpen(false);
              }}>Set</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}