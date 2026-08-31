import { useRef, useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';

const CANVAS_SIZES = {
  'instagram-post': { w: 1080, h: 1080, label: 'Instagram Post' },
  'instagram-story': { w: 1080, h: 1920, label: 'Instagram Story' },
  'twitter-post': { w: 1200, h: 675, label: 'Twitter/X Post' },
  'linkedin-post': { w: 1200, h: 627, label: 'LinkedIn Post' },
  'facebook-post': { w: 1200, h: 630, label: 'Facebook Post' },
  'youtube-thumb': { w: 1280, h: 720, label: 'YouTube Thumbnail' },
  'a4-portrait': { w: 793, h: 1123, label: 'A4 Portrait' },
  'a4-landscape': { w: 1123, h: 793, label: 'A4 Landscape' },
  'custom': { w: 1200, h: 630, label: 'Custom' },
};

export { CANVAS_SIZES };

// Choose a "nice" tick step in canvas units that keeps on-screen spacing readable.
function niceStep(zoom) {
  const targets = [5, 10, 25, 50, 100, 250, 500, 1000, 2000];
  return targets.find((t) => t * zoom >= 40) || targets[targets.length - 1];
}

// Generate ruler tick marks (in canvas units) for a length in canvas units.
function rulerMarks(canvasLen, zoom) {
  const step = niceStep(zoom);
  const marks = [];
  const screen = canvasLen * zoom;
  for (let pos = 0; pos <= screen; pos += step * zoom) {
    const canvasUnit = pos / zoom;
    const isMajor = Math.round(canvasUnit) % (step * 5) === 0 || canvasUnit === 0;
    marks.push({ screen: Math.round(pos), canvasUnit, isMajor });
  }
  return marks;
}

export default function DesignCanvas({ canvasJson, canvasSize: canvasSizeProp, onCanvasReady, selectedObject, onObjectSelected, onLayersChanged, onZoomChange, onImageDrop, snapEnabled = true, showGrid = true, zoom = 1 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  // The parent passes canvasSize and remounts this component via key={canvasSize}
  // whenever it changes (e.g. importing an A4 page after starting from an
  // Instagram-post default) — so the prop only needs to seed the initial
  // state here, not stay synced via an effect. Previously this state ignored
  // the prop entirely and always initialized to 'instagram-post', so an
  // imported page's layers were positioned/scaled for e.g. a 793×1123 A4
  // canvas but painted onto a stale 1080×1080 square one.
  const [canvasSize, setCanvasSize] = useState(canvasSizeProp || 'instagram-post');
  const isPanning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });
  const [isDragOver, setIsDragOver] = useState(false);
  const snapEnabledRef = useRef(snapEnabled);
  const showGridRef = useRef(showGrid);
  const guidesRef = useRef([]);
  snapEnabledRef.current = snapEnabled;
  showGridRef.current = showGrid;

  const dims = CANVAS_SIZES[canvasSize];

  // Scale factor to fit canvas in container. Measure the scrollable viewport
  // (.design-canvas-area) rather than the canvas's own frame — the frame wraps
  // tightly around the (possibly zoomed) canvas, so reading its size would just
  // mirror the canvas instead of the available space. The ruler takes ~20px on
  // the top/left, so subtract it from the budget to avoid clipping.
  const getScale = useCallback(() => {
    const viewport = containerRef.current?.closest('.design-canvas-area') || containerRef.current?.parentElement;
    if (!viewport) return 0.5;
    const cw = viewport.clientWidth - 40 - 20;
    const ch = viewport.clientHeight - 40 - 20;
    return Math.max(0.05, Math.min(cw / dims.w, ch / dims.h, 1));
  }, [dims]);

  // Initialize fabric canvas
  useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return;

    try {
      const fc = new fabric.Canvas(canvasRef.current, {
        width: dims.w,
        height: dims.h,
        backgroundColor: '#ffffff',
        preserveObjectStacking: true,
      });

      const scale = getScale();
      fc.setZoom(scale);
      fc.setWidth(dims.w * scale);
      fc.setHeight(dims.h * scale);

      fabricRef.current = fc;

      // Events
      fc.on('selection:created', () => {
        const active = fc.getActiveObject();
        if (active && onObjectSelected) onObjectSelected(serializeObject(active));
      });
      fc.on('selection:updated', () => {
        const active = fc.getActiveObject();
        if (active && onObjectSelected) onObjectSelected(serializeObject(active));
      });
      fc.on('selection:cleared', () => {
        if (onObjectSelected) onObjectSelected(null);
      });
      fc.on('object:modified', () => {
        if (onLayersChanged) onLayersChanged();
      });
      fc.on('object:added', () => {
        if (onLayersChanged) onLayersChanged();
      });
      fc.on('object:removed', () => {
        if (onLayersChanged) onLayersChanged();
      });

      // Snap to 8px grid (only when within 4px) + canvas center/edges
      fc.on('object:moving', (opt) => {
        const obj = opt.target;
        if (!obj) return;
        const guides = [];
        if (snapEnabledRef.current) {
          const grid = 8;
          const threshold = 4;
          const snapIfClose = (v) => {
            const s = Math.round(v / grid) * grid;
            return Math.abs(v - s) < threshold ? s : v;
          };
          const rawLeft = obj.left;
          const rawTop = obj.top;
          obj.set({ left: snapIfClose(rawLeft), top: snapIfClose(rawTop) });
          const gx = snapIfClose(rawLeft);
          const gy = snapIfClose(rawTop);
          if (gx !== rawLeft) guides.push({ x: gx * (obj.scaleX || 1) });
          if (gy !== rawTop) guides.push({ y: gy * (obj.scaleY || 1) });
          // canvas center snap (within 6px)
          const cw = dims.w;
          const ch = dims.h;
          const w = (obj.width || 0) * (obj.scaleX || 1);
          const h = (obj.height || 0) * (obj.scaleY || 1);
          const cx = cw / 2;
          const cy = ch / 2;
          const objCx = obj.left + w / 2;
          const objCy = obj.top + h / 2;
          if (Math.abs(objCx - cx) < 8) { obj.set('left', cx - w / 2); guides.push({ x: cx }); }
          if (Math.abs(objCy - cy) < 8) { obj.set('top', cy - h / 2); guides.push({ y: cy }); }
          if (Math.abs(obj.left) < 8) { obj.set('left', 0); guides.push({ x: 0 }); }
          if (Math.abs(obj.left + w - cw) < 8) { obj.set('left', cw - w); guides.push({ x: cw }); }
          if (Math.abs(obj.top) < 8) { obj.set('top', 0); guides.push({ y: 0 }); }
          if (Math.abs(obj.top + h - ch) < 8) { obj.set('top', ch - h); guides.push({ y: ch }); }
        }
        guidesRef.current = guides;
      });
      fc.on('object:moved', () => { guidesRef.current = []; fc.requestRenderAll(); });
      fc.on('selection:cleared', () => { guidesRef.current = []; fc.requestRenderAll(); });

      // Panning: mouse down on empty canvas area starts pan
      fc.on('mouse:down', (opt) => {
        if (opt.target || isPanning.current) return;
        isPanning.current = true;
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY };
        fc.selection = false;
        fc.setCursor('grabbing');
      });

      fc.on('mouse:move', (opt) => {
        if (!isPanning.current) return;
        const dx = opt.e.clientX - lastPan.current.x;
        const dy = opt.e.clientY - lastPan.current.y;
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY };
        const vpt = fc.viewportTransform;
        vpt[4] += dx;
        vpt[5] += dy;
        fc.requestRenderAll();
      });

      fc.on('mouse:up', () => {
        if (isPanning.current) {
          isPanning.current = false;
          fc.selection = true;
          fc.setCursor('default');
        }
      });

      // Scroll-wheel zoom — scale the frame itself so the white page grows/shrinks with the content
      fc.on('mouse:wheel', (opt) => {
        const delta = opt.e.deltaY;
        let zoom = fc.getZoom() * (delta > 0 ? 0.95 : 1.05);
        zoom = Math.max(0.05, Math.min(zoom, 5));
        const pointer = fc.getScenePoint(opt.e);
        fc.zoomToPoint(pointer, zoom);
        fc.setWidth(dims.w * zoom);
        fc.setHeight(dims.h * zoom);
        if (onZoomChange) onZoomChange(fc.getZoom());
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // Pinch zoom (two-finger) + single-finger pan
      let pinchState = null;
      let panState = null;
      const upper = fc.upperCanvasEl;
      const getDist = (touches) => Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
      const handleTouchStart = (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          pinchState = { startDist: getDist(e.touches), startZoom: fc.getZoom() };
          panState = null;
        } else if (e.touches.length === 1) {
          const t = e.touches[0];
          // Only pan if touching empty canvas (no target)
          const target = fc.findTarget(t);
          if (!target) {
            panState = { x: t.clientX, y: t.clientY };
          }
        }
      };
      const handleTouchMove = (e) => {
        if (e.touches.length === 2 && pinchState) {
          e.preventDefault();
          const dist = getDist(e.touches);
          const scale = dist / pinchState.startDist;
          let zoom = pinchState.startZoom * scale;
          zoom = Math.max(0.05, Math.min(zoom, 5));
          const center = fc.getCenterPoint();
          fc.zoomToPoint(center, zoom);
          fc.setWidth(dims.w * zoom);
          fc.setHeight(dims.h * zoom);
          if (onZoomChange) onZoomChange(zoom);
        } else if (e.touches.length === 1 && panState) {
          e.preventDefault();
          const t = e.touches[0];
          const dx = t.clientX - panState.x;
          const dy = t.clientY - panState.y;
          panState.x = t.clientX;
          panState.y = t.clientY;
          const vpt = fc.viewportTransform;
          vpt[4] += dx;
          vpt[5] += dy;
          fc.requestRenderAll();
        }
      };
      const handleTouchEnd = (e) => {
        if (e.touches.length < 2) pinchState = null;
        if (e.touches.length === 0) panState = null;
      };
      upper.addEventListener('touchstart', handleTouchStart, { passive: false });
      upper.addEventListener('touchmove', handleTouchMove, { passive: false });
      upper.addEventListener('touchend', handleTouchEnd);
      // cleanup is handled in the effect's return below — store for removal
      fc.__pinchCleanup = () => {
        upper.removeEventListener('touchstart', handleTouchStart);
        upper.removeEventListener('touchmove', handleTouchMove);
        upper.removeEventListener('touchend', handleTouchEnd);
      };

      // ── Grid + snapping guides (drawn each render so they survive repaint) ──
      fc.on('after:render', () => {
        const ctx = fc.getContext(); // container context (between objects and selection)
        if (!ctx) return;
        const zoom = fc.getZoom();
        const w = dims.w;
        const h = dims.h;

        if (showGridRef.current) {
          ctx.save();
          // light dotted grid
          const step = 16 * (1 / zoom);
          ctx.beginPath();
          ctx.fillStyle = 'rgba(120,120,140,0.18)';
          for (let gx = step; gx < w; gx += step) {
            for (let gy = step; gy < h; gy += step) {
              ctx.moveTo(gx + 0.5, gy + 0.5);
              ctx.arc(gx, gy, 0.75, 0, Math.PI * 2);
            }
          }
          ctx.fill();
          ctx.restore();
        }

        // guide lines for active snap
        const guides = guidesRef.current || [];
        if (guides.length) {
          ctx.save();
          ctx.strokeStyle = 'rgba(232,0,120,0.85)';
          ctx.lineWidth = 1 / zoom;
          for (const g of guides) {
            ctx.beginPath();
            if (g.x !== undefined) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, h); }
            if (g.y !== undefined) { ctx.moveTo(0, g.y); ctx.lineTo(w, g.y); }
            ctx.stroke();
          }
          ctx.restore();
        }
      });

      if (onCanvasReady) onCanvasReady(fc);
      if (onZoomChange) onZoomChange(fc.getZoom());

      // Restore a previously-saved canvas (see DesignEditor's autosave). Async,
      // so it runs after onCanvasReady — the layer panel starts empty for a
      // beat, then populates once the saved objects are enlivened.
      if (canvasJson) {
        fc.loadFromJSON(canvasJson)
          .then(() => {
            fc.setZoom(scale);
            fc.setWidth(dims.w * scale);
            fc.setHeight(dims.h * scale);
            fc.renderAll();
            if (onLayersChanged) onLayersChanged();
          })
          .catch((err) => console.error('[DesignCanvas] Failed to load saved canvas:', err));
      }
    } catch (err) {
      console.error('[DesignCanvas] Init error:', err);
    }

    return () => {
      try {
        fabricRef.current?.__pinchCleanup?.();
      } catch {}
      try {
        fabricRef.current?.dispose();
      } catch {}
      fabricRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize handler — preserve user zoom, only adjust element size to fit container.
  // We keep the current zoom level and just re-center; the initial fit is handled above.
  useEffect(() => {
    const handleResize = () => {
      const fc = fabricRef.current;
      if (!fc) return;
      // Don't clobber manual zoom on resize; just ensure canvas element fits container
      // The zoom itself stays as the user left it.
      fc.renderAll();
      if (onZoomChange) onZoomChange(fc.getZoom());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dims, getScale, onZoomChange]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const fc = fabricRef.current;
    if (!fc) return;
    for (const file of imageFiles) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      try {
        const img = await fabric.FabricImage.fromURL(dataUrl);
        // Place at drop position or center; scale to fit 60% of canvas
        const dimsLocal = CANVAS_SIZES[canvasSize];
        const maxW = dimsLocal.w * 0.6;
        const maxH = dimsLocal.h * 0.6;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        img.set({
          left: (dimsLocal.w - img.width * scale) / 2,
          top: (dimsLocal.h - img.height * scale) / 2,
          scaleX: scale,
          scaleY: scale,
        });
        // If parent wants to handle, delegate; otherwise add directly
        if (onImageDrop) {
          onImageDrop({ dataUrl, width: img.width, height: img.height, left: img.left, top: img.top, scale });
        } else {
          img.set({ _id: `obj_drop_${Date.now()}`, name: file.name || 'Image' });
          fc.add(img);
          fc.setActiveObject(img);
          fc.renderAll();
          if (onLayersChanged) onLayersChanged();
        }
      } catch (err) {
        console.error('Drop image failed', err);
      }
    }
  }, [canvasSize, onImageDrop, onLayersChanged]);

  const RULER_SIZE = 20;
  const hMarks = rulerMarks(dims.w, zoom);
  const vMarks = rulerMarks(dims.h, zoom);
  const sel = selectedObject && selectedObject._id ? selectedObject : null;
  const selX = sel ? (sel.left + (sel.width / 2)) : null;
  const selY = sel ? (sel.top + (sel.height / 2)) : null;

  return (
    <div
      className="design-canvas-frame"
      role="group"
      aria-label="Canvas frame with rulers"
    >
      <div className="design-ruler-corner" />
      <div className="design-ruler design-ruler-h" aria-hidden="true">
        {hMarks.map((m) => (
          <span
            key={`h${m.screen}`}
            className={`design-ruler-tick ${m.isMajor ? 'major' : ''}`}
            style={{ left: m.screen, transform: 'translateX(-1px)' }}
          >
            {m.isMajor && <span className="design-ruler-label" style={{ right: 2 }}>{Math.round(m.canvasUnit)}</span>}
          </span>
        ))}
        {selX != null && <span className="design-ruler-marker" style={{ left: selX * zoom }} aria-hidden="true" />}
      </div>
      <div className="design-ruler design-ruler-v" aria-hidden="true">
        {vMarks.map((m) => (
          <span
            key={`v${m.screen}`}
            className={`design-ruler-tick ${m.isMajor ? 'major' : ''}`}
            style={{ top: m.screen, transform: 'translateY(-1px)' }}
          >
            {m.isMajor && <span className="design-ruler-label" style={{ bottom: 2 }}>{Math.round(m.canvasUnit)}</span>}
          </span>
        ))}
        {selY != null && <span className="design-ruler-marker design-ruler-marker-v" style={{ top: selY * zoom }} aria-hidden="true" />}
      </div>
      <div
        className={`design-canvas-container ${isDragOver ? 'drag-over' : ''}`}
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={handleDragLeave}
        onDrop={handleDrop}
      >
        <canvas ref={canvasRef} />
        {isDragOver && <div className="design-drop-overlay">Drop image to add to canvas</div>}
      </div>
    </div>
  );
}

function serializeObject(obj) {
  return {
    type: obj.type,
    left: Math.round(obj.left),
    top: Math.round(obj.top),
    width: Math.round(obj.width * (obj.scaleX || 1)),
    height: Math.round(obj.height * (obj.scaleY || 1)),
    angle: Math.round(obj.angle || 0),
    text: obj.text || '',
    fill: obj.fill || '',
    fontSize: obj.fontSize || '',
    fontFamily: obj.fontFamily || '',
    fontWeight: obj.fontWeight || '',
    name: obj.name || obj.type,
    selectable: obj.selectable !== false,
    visible: obj.visible !== false,
    _id: obj._id || null,
    _role: obj._role || null,
  };
}
