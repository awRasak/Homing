import { CANVAS_SIZES } from './DesignCanvas';
import {
  Type,
  RectangleHorizontal,
  Circle,
  Image as ImageIcon,
  Layers,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  X,
  Star,
} from 'lucide-react';

export default function DesignToolbar({ canvasSize, onSizeChange, onAddText, onAddRect, onAddCircle, onAddImage, onImportLayers, canImportLayers, onDelete, onUndo, onRedo, onExportPng, onExportSvg, onClear, onZoomIn, onZoomOut, onZoomFit, isSocialTemplate, onSetSocialTemplate }) {
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
        {onImportLayers && (
          <button className="toolbar-btn toolbar-btn-import" onClick={onImportLayers} disabled={!canImportLayers} title="Import an uploaded proposal page as editable layers">
            <Layers size={16} strokeWidth={1.8} />
            <span style={{ marginLeft: 4 }}>Layers</span>
          </button>
        )}
        <button className="toolbar-btn" onClick={onAddText} title="Add Text (T)">
          <Type size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddRect} title="Add Rectangle">
          <RectangleHorizontal size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddCircle} title="Add Circle">
          <Circle size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddImage} title="Add Image">
          <ImageIcon size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onDelete} title="Delete selected (Del)">
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onRedo} title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In">
          <ZoomIn size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out">
          <ZoomOut size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onZoomFit} title="Fit to screen">
          <Maximize2 size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportPng} title="Export PNG">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>PNG</span>
        </button>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportSvg} title="Export SVG">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>SVG</span>
        </button>
        <button className="toolbar-btn toolbar-btn-clear" onClick={onClear} title="Clear canvas">
          <X size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>Clear</span>
        </button>
      </div>

      {onSetSocialTemplate && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group">
            <button
              className={`toolbar-btn toolbar-btn-template ${isSocialTemplate ? 'active' : ''}`}
              onClick={onSetSocialTemplate}
              title={isSocialTemplate ? 'This design is the social-post template — click to unset' : 'Use this design as the social-post template'}
            >
              <Star size={14} strokeWidth={isSocialTemplate ? 2 : 1.8} fill={isSocialTemplate ? 'currentColor' : 'none'} />
              <span style={{ marginLeft: 4 }}>{isSocialTemplate ? 'Social template' : 'Use as template'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
