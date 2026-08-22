import { CANVAS_SIZES } from './DesignCanvas';

export default function DesignToolbar({ canvasSize, onSizeChange, onAddText, onAddRect, onAddCircle, onAddImage, onDelete, onUndo, onRedo, onExportPng, onExportSvg, onClear, onZoomIn, onZoomOut, onZoomFit }) {
  return (
    <div className="design-toolbar">
      <div className="toolbar-group">
        <select className="toolbar-select" value={canvasSize} onChange={(e) => onSizeChange(e.target.value)}>
          {Object.entries(CANVAS_SIZES).map(([key, val]) => (
            <option key={key} value={key}>{val.label} ({val.w}×{val.h})</option>
          ))}
        </select>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onAddText} title="Add Text (T)">T</button>
        <button className="toolbar-btn" onClick={onAddRect} title="Add Rectangle">▭</button>
        <button className="toolbar-btn" onClick={onAddCircle} title="Add Circle">○</button>
        <button className="toolbar-btn" onClick={onAddImage} title="Add Image URL">🖼</button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onDelete} title="Delete selected (Del)">🗑</button>
        <button className="toolbar-btn" onClick={onUndo} title="Undo (Ctrl+Z)">↩</button>
        <button className="toolbar-btn" onClick={onRedo} title="Redo (Ctrl+Shift+Z)">↪</button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In">+</button>
        <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out">−</button>
        <button className="toolbar-btn" onClick={onZoomFit} title="Fit to screen">⊞</button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportPng} title="Export PNG">PNG</button>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportSvg} title="Export SVG">SVG</button>
        <button className="toolbar-btn toolbar-btn-clear" onClick={onClear} title="Clear canvas">Clear</button>
      </div>
    </div>
  );
}
