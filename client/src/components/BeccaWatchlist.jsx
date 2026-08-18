import { useState } from 'react';

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

const PRIORITY_COLORS = { high: '#e05050', medium: '#c08000', low: 'var(--grey-border)' };

export default function BeccaWatchlist({ topics, onAddTopic, onRemoveTopic, onUpdateTopic }) {
  const [name, setName] = useState('');
  const [ctx, setCtx] = useState('');
  const [selected, setSelected] = useState(new Set());

  function handleAdd() {
    const n = name.trim();
    if (!n) return;
    onAddTopic(n, ctx.trim());
    setName('');
    setCtx('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleAdd();
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === topics.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(topics.map(t => t.id)));
    }
  }

  return (
    <div className="becca-watchlist">
      <div className="wl-add">
        <input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="e.g. crypto regulation Nigeria" className="wl-input" />
        <textarea value={ctx} onChange={e => setCtx(e.target.value)}
          placeholder="Why does this matter to you? (optional)" className="wl-textarea" rows={2} />
        <button className="btn-add-topic" onClick={handleAdd}>+ Add to watchlist</button>
      </div>

      {topics.length > 0 && (
        <div className="wl-select-bar">
          <div className="wl-select-bar-l">
            <span className="section-lbl" style={{ margin: 0 }}>Watching ({topics.length})</span>
            {selected.size > 0 && <span className="selected-count visible">{selected.size} selected</span>}
          </div>
          <button className="select-all-btn" onClick={toggleSelectAll}>
            {selected.size === topics.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      )}

      <div className="topics-list">
        {topics.length === 0 && (
          <div className="empty-note">Nothing on your watchlist yet. Add a topic above or ask Homin to track something.</div>
        )}
        {topics.map(t => (
          <div key={t.id} className={`topic-card ${selected.has(t.id) ? 'selected' : ''}`}>
            <div className="tc-check" onClick={() => toggleSelect(t.id)}>
              {selected.has(t.id) ? '✓' : ''}
            </div>
            <div className="tc-priority" style={{ background: PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.low }} title={`${t.priority} priority`} />
            <div className="tc-icon">{topicIcon(t.name)}</div>
            <div className="tc-body">
              <div className="tc-name">{esc(t.name)}</div>
              {t.context && <div className="tc-ctx">{esc(t.context)}</div>}
            </div>
            <select className="priority-select" value={t.priority || 'medium'}
              onChange={e => onUpdateTopic(t.id, { priority: e.target.value })} title="Priority">
              <option value="high">High</option>
              <option value="medium">Med</option>
              <option value="low">Low</option>
            </select>
            <button className="tc-del" onClick={() => onRemoveTopic(t.id)} title="Remove">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
