import { useState } from 'react';
import {
  Type,
  RectangleHorizontal,
  Circle,
  Image as ImageIcon,
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Trash2,
  Diamond,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
} from 'lucide-react';

export default function LayerPanel({ layers, onReorder, onSelect, selectedId, onDelete, onDuplicate, onToggleVisible, onToggleLock, onBringForward, onSendBackward, onBringToFront, onSendToBack }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [filter, setFilter] = useState('');

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

  const q = filter.trim().toLowerCase();
  const visible = !q ? layers : layers.filter((l) => `${l.name || ''} ${l.text || ''} ${l.type}`.toLowerCase().includes(q));

  return (
    <div className="layer-panel">
      <div className="layer-panel-header">
        <span className="layer-panel-title">Layers</span>
        <input className="layer-search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter layers" />
      </div>
      <div className="layer-list">
        {visible.map((layer, displayIdx) => {
          const realIdx = layers.indexOf(layer);
          const targetIdx = displayIdx > 0 ? layers.indexOf(visible[displayIdx - 1]) : -1;
          const belowIdx = displayIdx < visible.length - 1 ? layers.indexOf(visible[displayIdx + 1]) : -1;
          return (
            <div
              key={layer._id || realIdx}
              className={`layer-item ${selectedId === layer._id ? 'selected' : ''} ${dragOverIdx === realIdx ? 'drag-over' : ''} ${!layer.visible ? 'hidden-layer' : ''}`}
              draggable={!q}
              tabIndex={0}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'ArrowUp' && targetIdx >= 0) {
                  e.preventDefault();
                  onReorder(realIdx, targetIdx);
                } else if (e.key === 'ArrowDown' && belowIdx >= 0) {
                  e.preventDefault();
                  onReorder(realIdx, belowIdx);
                }
              }}
              onDragStart={(e) => !q && handleDragStart(e, realIdx)}
              onDragOver={(e) => !q && handleDragOver(e, realIdx)}
              onDrop={(e) => !q && handleDrop(e, realIdx)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelect(layer._id)}
            >
              <span className="layer-icon">{getLayerIcon(layer)}</span>
              <span className="layer-name">{layer.name || layer.text?.slice(0, 20) || layer.type}</span>
              <div className="layer-actions">
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onToggleVisible(layer._id); }} title={layer.visible ? 'Hide' : 'Show'} aria-label={layer.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!layer.visible}>
                  {layer.visible ? <Eye size={14} strokeWidth={1.8} /> : <EyeOff size={14} strokeWidth={1.8} />}
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onToggleLock(layer._id); }} title={layer.selectable ? 'Lock' : 'Unlock'} aria-label={layer.selectable ? 'Lock layer' : 'Unlock layer'} aria-pressed={!layer.selectable}>
                  {layer.selectable ? <Unlock size={14} strokeWidth={1.8} /> : <Lock size={14} strokeWidth={1.8} />}
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onBringForward?.(layer._id); }} title="Move up" aria-label="Move up">
                  <ArrowUp size={14} strokeWidth={1.8} />
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onSendBackward?.(layer._id); }} title="Move down" aria-label="Move down">
                  <ArrowDown size={14} strokeWidth={1.8} />
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onBringToFront?.(layer._id); }} title="Bring to front" aria-label="Bring to front">
                  <ChevronsUp size={14} strokeWidth={1.8} />
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onSendToBack?.(layer._id); }} title="Send to back" aria-label="Send to back">
                  <ChevronsDown size={14} strokeWidth={1.8} />
                </button>
                <button className="layer-btn" onClick={(e) => { e.stopPropagation(); onDuplicate(layer._id); }} title="Duplicate" aria-label="Duplicate layer">
                  <Copy size={14} strokeWidth={1.8} />
                </button>
                <button className="layer-btn layer-btn-delete" onClick={(e) => { e.stopPropagation(); onDelete(layer._id); }} title="Delete" aria-label="Delete layer">
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="layer-empty">{filter ? 'No layers match that filter.' : 'No layers yet. Add text, shapes, or generate an image.'}</div>
        )}
      </div>
    </div>
  );
}

function getLayerIcon(layer) {
  const iconProps = { size: 14, strokeWidth: 1.8 };
  switch (layer.type) {
    case 'i-text':
    case 'text':
      return <Type {...iconProps} />;
    case 'rect':
      return <RectangleHorizontal {...iconProps} />;
    case 'circle':
      return <Circle {...iconProps} />;
    case 'image':
      return <ImageIcon {...iconProps} />;
    case 'group':
      return <Layers {...iconProps} />;
    default:
      return <Diamond {...iconProps} />;
  }
}
