import { CANVAS_SIZES } from './DesignCanvas';
import {
  Type,
  RectangleHorizontal,
  Circle,
  Image as ImageIcon,
  Layers,
  Group,
  Ungroup,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  X,
  Star,
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  FlipHorizontal,
  FlipVertical,
  StretchHorizontal,
  StretchVertical,
  Grid3x3,
  Magnet,
} from 'lucide-react';

export default function DesignToolbar({ canvasSize, onSizeChange, onAddText, onAddRect, onAddCircle, onAddImage, onImportLayers, canImportLayers, onDelete, onUndo, onRedo, canUndo, canRedo, onAlign, onGroup, onUngroup, onDistribute, onFlip, transparentBg, onToggleTransparent, onExportPng, onExportSvg, onExportJpg, onExportPdf, onClear, onZoomIn, onZoomOut, onZoomFit, isSocialTemplate, onSetSocialTemplate, snapEnabled, onToggleSnap, showGrid, onToggleGrid }) {
  return (
    <div className="design-toolbar">
      <div className="toolbar-group">
        <select className="toolbar-select" value={canvasSize} onChange={(e) => onSizeChange(e.target.value)} aria-label="Canvas size">
          {Object.entries(CANVAS_SIZES).map(([key, val]) => (
            <option key={key} value={key}>{val.label} ({val.w}×{val.h})</option>
          ))}
        </select>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {onImportLayers && (
          <button className="toolbar-btn toolbar-btn-import" onClick={onImportLayers} disabled={!canImportLayers} title="Import an uploaded proposal page as editable layers" aria-label="Import as layers">
            <Layers size={16} strokeWidth={1.8} />
            <span style={{ marginLeft: 4 }}>Layers</span>
          </button>
        )}
        <button className="toolbar-btn" onClick={onAddText} title="Add Text (T)" aria-label="Add Text">
          <Type size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddRect} title="Add Rectangle" aria-label="Add Rectangle">
          <RectangleHorizontal size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddCircle} title="Add Circle" aria-label="Add Circle">
          <Circle size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onAddImage} title="Add Image" aria-label="Add Image">
          <ImageIcon size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onDelete} title="Delete selected (Del)" aria-label="Delete selected">
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onUndo} title="Undo (Ctrl+Z)" aria-label="Undo" disabled={canUndo === false}>
          <Undo2 size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={canRedo === false}>
          <Redo2 size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={() => onAlign?.('left')} title="Align left" aria-label="Align left">
          <AlignLeft size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onAlign?.('centerH')} title="Align center horizontally" aria-label="Align center horizontally">
          <AlignCenterHorizontal size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onAlign?.('right')} title="Align right" aria-label="Align right">
          <AlignRight size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onAlign?.('top')} title="Align top" aria-label="Align top">
          <AlignStartVertical size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onAlign?.('centerV')} title="Align center vertically" aria-label="Align center vertically">
          <AlignCenterVertical size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onAlign?.('bottom')} title="Align bottom" aria-label="Align bottom">
          <AlignEndVertical size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={() => onDistribute?.('horizontal')} title="Distribute horizontally (3+ selected)">
          <StretchHorizontal size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onDistribute?.('vertical')} title="Distribute vertically (3+ selected)">
          <StretchVertical size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={() => onFlip?.('h')} title="Flip horizontal">
          <FlipHorizontal size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={() => onFlip?.('v')} title="Flip vertical">
          <FlipVertical size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onGroup} title="Group (Ctrl+G)" aria-label="Group">
          <Group size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onUngroup} title="Ungroup (Ctrl+Shift+G)" aria-label="Ungroup">
          <Ungroup size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In" aria-label="Zoom In">
          <ZoomIn size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out" aria-label="Zoom Out">
          <ZoomOut size={16} strokeWidth={1.8} />
        </button>
        <button className="toolbar-btn" onClick={onZoomFit} title="Fit to screen" aria-label="Fit to screen">
          <Maximize2 size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${showGrid ? 'active' : ''}`}
          onClick={onToggleGrid}
          title={showGrid ? 'Hide grid' : 'Show grid'}
          aria-label="Toggle grid"
          aria-pressed={showGrid}
        >
          <Grid3x3 size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`toolbar-btn ${snapEnabled ? 'active' : ''}`}
          onClick={onToggleSnap}
          title={snapEnabled ? 'Snap to grid: on' : 'Snap to grid: off'}
          aria-label="Toggle snap to grid"
          aria-pressed={snapEnabled}
        >
          <Magnet size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <label className="toolbar-check" title="Transparent background for PNG">
          <input type="checkbox" checked={!!transparentBg} onChange={onToggleTransparent} />
          <span>Transparent</span>
        </label>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportPng} title="Export PNG" aria-label="Export PNG">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>PNG</span>
        </button>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportJpg} title="Export JPG" aria-label="Export JPG">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>JPG</span>
        </button>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportPdf} title="Export PDF" aria-label="Export PDF">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>PDF</span>
        </button>
        <button className="toolbar-btn toolbar-btn-export" onClick={onExportSvg} title="Export SVG" aria-label="Export SVG">
          <Download size={14} strokeWidth={1.8} />
          <span style={{ marginLeft: 3 }}>SVG</span>
        </button>
        <button className="toolbar-btn toolbar-btn-clear" onClick={onClear} title="Clear canvas" aria-label="Clear canvas">
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
