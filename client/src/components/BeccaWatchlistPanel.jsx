import { useState } from 'react';

function TopicCard({ topic, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [ctx, setCtx] = useState(topic.context || '');

  return (
    <div className="wl-card">
      <div className="wl-card-head">
        <span className={`topic-dot priority-${topic.priority || 'medium'}`} />
        <select className="topic-priority" value={topic.priority || 'medium'}
          onChange={e => onUpdate(topic.id, { priority: e.target.value })}>
          <option value="high">High</option>
          <option value="medium">Med</option>
          <option value="low">Low</option>
        </select>
        <span className="wl-card-name">{topic.name}</span>
        <button className="topic-remove" onClick={() => onRemove(topic.id)}>×</button>
      </div>
      <div className="wl-card-body">
        {topic.context && !editing && (
          <div className="wl-card-ctx" onClick={() => setEditing(true)}>{topic.context}</div>
        )}
        {(editing || !topic.context) && (
          <textarea className="wl-card-ctx-input" value={ctx} rows={2}
            placeholder="Add context…"
            onChange={e => setCtx(e.target.value)}
            onBlur={() => { onUpdate(topic.id, { context: ctx }); setEditing(false); }} />
        )}
      </div>
    </div>
  );
}

export default function BeccaWatchlistPanel({ topics, onAddTopic, onRemoveTopic, onUpdateTopic }) {
  const [newTopic, setNewTopic] = useState('');
  const [newCtx, setNewCtx] = useState('');

  function handleAdd() {
    if (!newTopic.trim()) return;
    onAddTopic(newTopic.trim(), newCtx.trim());
    setNewTopic('');
    setNewCtx('');
  }

  return (
    <div className="wl-panel">
      <div className="wl-add">
        <div className="cp-label">Track a Topic</div>
        <input className="cp-input" type="text" placeholder="Topic name" value={newTopic}
          onChange={e => setNewTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
        <textarea className="cp-textarea" placeholder="Context (optional)" rows={2} value={newCtx}
          onChange={e => setNewCtx(e.target.value)} />
        <button className="btn-add-topic" onClick={handleAdd} disabled={!newTopic.trim()}>+ Add to watchlist</button>
      </div>
      <div className="wl-list">
        {topics.length === 0 && <div className="cp-empty">No topics tracked yet</div>}
        {topics.map(t => (
          <TopicCard key={t.id} topic={t} onUpdate={onUpdateTopic} onRemove={onRemoveTopic} />
        ))}
      </div>
    </div>
  );
}
