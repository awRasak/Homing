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

export default function DesignCanvas({ canvasJson, canvasSize: canvasSizeProp, onCanvasReady, selectedObject, onObjectSelected, onLayersChanged, onZoomChange, onImageDrop }) {
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

  const dims = CANVAS_SIZES[canvasSize];

  // Scale factor to fit canvas in container. Measure the scrollable viewport
  // (.design-canvas-area, our parent) rather than containerRef itself —
  // containerRef wraps tightly around the canvas element, so its own
  // clientWidth/clientHeight just mirror the canvas's current (unscaled) size
  // instead of the actual available space, which made "fit" only account for
  // width and clip anything near the top/bottom of a tall canvas.
  const getScale = useCallback(() => {
    const viewport = containerRef.current?.parentElement;
    if (!viewport) return 0.5;
    const cw = viewport.clientWidth - 40;
    const ch = viewport.clientHeight - 40;
    return Math.min(cw / dims.w, ch / dims.h, 1);
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
      fc.on('selection:created', (e) => {
        const obj = e.selected?.[0];
        if (obj && onObjectSelected) onObjectSelected(serializeObject(obj));
      });
      fc.on('selection:updated', (e) => {
        const obj = e.selected?.[0];
        if (obj && onObjectSelected) onObjectSelected(serializeObject(obj));
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

      // Scroll-wheel zoom
      fc.on('mouse:wheel', (opt) => {
        const delta = opt.e.deltaY;
        let zoom = fc.getZoom() * (delta > 0 ? 0.95 : 1.05);
        zoom = Math.max(0.05, Math.min(zoom, 5));
        const pointer = fc.getScenePoint(opt.e);
        fc.zoomToPoint(pointer, zoom);
        if (onZoomChange) onZoomChange(fc.getZoom());
        opt.e.preventDefault();
        opt.e.stopPropagation();
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

  return (
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
