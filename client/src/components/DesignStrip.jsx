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
          {editingId !== d.id && (
            <button
              type="button"
              className="design-chip-rename"
              title="Rename this design"
              onClick={(e) => {
                e.stopPropagation();
                startRename(d);
              }}
            >
              ✎
            </button>
          )}
          {d.id === activeDesignId && (
            <button
              type="button"
              className="design-chip-clear"
              title="Delete design"
              onClick={() => setConfirmDeleteId(d.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="design-chip design-chip-new" onClick={onCreate}>
        + New design
      </button>

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '320px', padding: '1.5rem' }}>
            <div className="modal-head-title" style={{ marginBottom: '0.35rem' }}>Delete design?</div>
            <div className="modal-head-sub" style={{ marginTop: 0, marginBottom: '1rem' }}>
              This will permanently remove this design and all its proposals.
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ background: 'var(--danger)', color: '#fff', boxShadow: 'none', width: '100%', marginBottom: '0.75rem' }}
              onClick={() => {
                onDelete(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%' }}
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
