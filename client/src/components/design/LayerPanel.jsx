import { useState } from 'react';

export default function LayerPanel({ layers, onReorder, onSelect, selectedId, onDelete, onDuplicate, onToggleVisible, onToggleLock }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function handleDragStart(e, idx) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  function handleDrop(e, idx) {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      onReorder(dragIdx, idx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
  }

  const reversed = [...layers].reverse();

  return (
    <div className="layer-panel">
      <div className="layer-panel-header">
        <span className="layer-panel-title">Layers</span>
      </div>
      <div className="layer-list">
        {reversed.map((layer, displayIdx) => {
          const realIdx = layers.length - 1 - displayIdx;
          return (
            <div
              key={layer._id || realIdx}
              className={`layer-item ${selectedId === layer._id ? 'selected' : ''} ${dragOverIdx === realIdx ? 'drag-over' : ''} ${!layer.visible ? 'hidden-layer' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, realIdx)}
              onDragOver={(e) => handleDragOver(e, realIdx)}
              onDrop={(e) => handleDrop(e, realIdx)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelect(layer._id)}
            >
              <span className="layer-icon">{getLayerIcon(layer)}</span>
              <span className="layer-name">{layer.name || layer.text?.slice(0, 20) || layer.type}</span>
              <div className="layer-actions">
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onToggleVisible(layer._id); }} title={layer.visible ? 'Hide' : 'Show'}>
                  {layer.visible ? '👁' : '👁‍🗨'}
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onToggleLock(layer._id); }} title={layer.selectable ? 'Lock' : 'Unlock'}>
                  {layer.selectable ? '🔓' : '🔒'}
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onDuplicate(layer._id); }} title="Duplicate">
                  ⧉
                </button>
                <button className="layer-btn layer-btn-delete" onClick={(e) => { e.stopPropagation(); onDelete(layer._id); }} title="Delete">
                  ×
                </button>
              </div>
            </div>
          );
        })}
        {layers.length === 0 && (
          <div className="layer-empty">No layers yet. Add text, shapes, or generate an image.</div>
        )}
      </div>
    </div>
  );
}

function getLayerIcon(layer) {
  switch (layer.type) {
    case 'i-text':
    case 'text':
      return 'T';
    case 'rect':
      return '▭';
    case 'circle':
      return '○';
    case 'image':
      return '🖼';
    case 'group':
      return '⊞';
    default:
      return '◆';
  }
}
