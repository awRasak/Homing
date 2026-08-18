import { useState } from 'react';

export default function DesignStrip({ designs, activeDesignId, onSelect, onCreate, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  function startRename(design) {
    setEditingId(design.id);
    setDraftName(design.name);
  }
  function commitRename(id) {
    const trimmed = draftName.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  }

  return (
    <div className="design-strip">
      {designs.map((d) => (
        <div
          key={d.id}
          className={`design-chip ${d.id === activeDesignId ? 'design-chip-active' : ''}`}
        >
          <button
            type="button"
            className="design-chip-main"
            onClick={() => onSelect(d.id)}
            title={d.name}
          >
            <span className="design-dot" style={{ background: d.accentColor }} />
            {editingId === d.id ? (
              <input
                autoFocus
                className="design-chip-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(d.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(d);
                }}
              >
                {d.name}
              </span>
            )}
          </button>
          {d.id === activeDesignId && (
            confirmDeleteId === d.id ? (
              <span className="design-chip-confirm">
                <button
                  type="button"
                  className="btn-text btn-danger"
                  onClick={() => {
                    onDelete(d.id);
                    setConfirmDeleteId(null);
                  }}
                >
                  Confirm clear?
                </button>
                <button type="button" className="btn-text" onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="design-chip-clear"
                title="Clear this design"
                onClick={() => setConfirmDeleteId(d.id)}
              >
                ×
              </button>
            )
          )}
        </div>
      ))}
      <button type="button" className="design-chip design-chip-new" onClick={onCreate}>
        + New design
      </button>
    </div>
  );
}
