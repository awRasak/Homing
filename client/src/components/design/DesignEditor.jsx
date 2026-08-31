import { useRef, useState, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import { ZoomIn, ZoomOut, Maximize2, Plus, Copy, Trash2 } from 'lucide-react';
import DesignCanvas, { CANVAS_SIZES } from './DesignCanvas';
import LayerPanel from './LayerPanel';
import AIGeneratePanel from './AIGeneratePanel';
import DesignToolbar from './DesignToolbar';
import { buildLayersFromPage, pickPresetForPage } from '../../lib/designImport';
import { renderAllPages } from '../../lib/pdfExtract';
import { PDFDocument } from 'pdf-lib';
import { api } from '../../api';
import { CURATED_GOOGLE_FONTS, ensureGoogleFontLoaded } from '../../lib/googleFonts';

// Reverse-lookup a CANVAS_SIZES key from a saved canvas's own width/height,
// so reloading a template restores its real size instead of resetting to the
// 'instagram-post' default and mis-scaling every saved object.
function presetForDimensions(w, h) {
  const key = Object.keys(CANVAS_SIZES).find((k) => CANVAS_SIZES[k].w === w && CANVAS_SIZES[k].h === h);
  return key || 'instagram-post';
}

function rgbToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const toHex = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
  }
  return '#000000';
}

function parseFontFamily(f) {
  if (!f) return 'Inter';
  return f.split(',')[0].replace(/['"]/g, '').trim() || 'Inter';
}

export default function DesignEditor({ design, onPatch }) {
  const fabricRef = useRef(null);
  const idCounter = useRef(0);
  const [canvasSize, setCanvasSize] = useState(() => (
    design?.canvasJson ? presetForDimensions(design.canvasJson.width, design.canvasJson.height) : 'instagram-post'
  ));
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('design:sbWidth') || '', 10);
    return Number.isFinite(saved) ? Math.min(480, Math.max(200, saved)) : 280;
  });
  const [transparentBg, setTransparentBg] = useState(false);
  const [socialTemplateId, setSocialTemplateId] = useState(null);
  const saveCanvasTimer = useRef(null);
  const clipboardRef = useRef(null);
  const historyMapRef = useRef(new Map()); // pageId -> { stack:[], idx:-1 }
  const isRestoringRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);

  const getCurrentHistory = useCallback(() => {
    const pageId = pages[activePageIdx]?.id || 'page-1';
    if (!historyMapRef.current.has(pageId)) historyMapRef.current.set(pageId, { stack: [], idx: -1 });
    return historyMapRef.current.get(pageId);
  }, [pages, activePageIdx]);

  const canUndo = (() => {
    const h = historyMapRef.current.get(pages[activePageIdx]?.id || 'page-1');
    return !!h && h.idx > 0;
  })();
  const canRedo = (() => {
    const h = historyMapRef.current.get(pages[activePageIdx]?.id || 'page-1');
    return !!h && h.idx >= 0 && h.idx < h.stack.length - 1;
  })();

  // Persist history per design (cap 20 per page to stay under localStorage 5MB)
  useEffect(() => {
    if (!design?.id) return;
    try {
      const raw = localStorage.getItem(`design:history:${design.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          Object.entries(parsed).forEach(([pid, v]) => {
            if (v && Array.isArray(v.stack) && typeof v.idx === 'number') {
              historyMapRef.current.set(pid, { stack: v.stack.slice(-20), idx: Math.min(v.idx, v.stack.length - 1) });
            }
          });
          setHistoryTick((x) => x + 1);
        }
      }
    } catch {}
  }, [design?.id]);

  useEffect(() => {
    if (!design?.id || historyMapRef.current.size === 0) return;
    try {
      const obj = {};
      historyMapRef.current.forEach((v, k) => { obj[k] = { stack: v.stack.slice(-20), idx: v.idx }; });
      localStorage.setItem(`design:history:${design.id}`, JSON.stringify(obj));
    } catch {}
  }, [historyTick, design?.id]);
  const [layers, setLayers] = useState([]);
  const [selectedObj, setSelectedObj] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [activePanel, setActivePanel] = useState('layers');
  const [zoom, setZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [commandInput, setCommandInput] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState(null); // { page, replace }
  const [proposals, setProposals] = useState([]);
  const [proposalPages, setProposalPages] = useState(null); // { name, pages }
  const [extracting, setExtracting] = useState(false);
  // Canva-style pages / frames
  const [pages, setPages] = useState(() => {
    if (design?.canvasJson?.pages && Array.isArray(design.canvasJson.pages)) {
      return design.canvasJson.pages;
    }
    return [{ id: 'page-1', json: design?.canvasJson || null, name: 'Page 1' }];
  });
  const [activePageIdx, setActivePageIdx] = useState(0);

  const dims = CANVAS_SIZES[canvasSize];
  const importablePages = design?.pages?.length ? design.pages : null;
  const imageInputRef = useRef(null);

  const genId = useCallback(() => {
    return `obj_${++idCounter.current}_${Date.now()}`;
  }, []);

  const refreshLayers = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const next = fc.getObjects().map((obj) => ({
      _id: obj._id,
      type: obj.type,
      name: obj.name,
      text: obj.text || '',
      visible: obj.visible !== false,
      selectable: obj.selectable !== false,
    }));
    setLayers((prev) => {
      if (prev.length === next.length &&
          prev.every((l, i) => l._id === next[i]._id && l.visible === next[i].visible && l.selectable === next[i].selectable)) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleCanvasReady = useCallback((fc) => {
    fabricRef.current = fc;
    setZoom(fc.getZoom());
    setCanvasVersion((v) => v + 1);
    // seed history for current page
    setTimeout(() => {
      const h = getCurrentHistory();
      const snap = JSON.stringify(fc.toObject(['_id', 'name', '_role']));
      h.stack = [snap];
      h.idx = 0;
      setHistoryTick((x) => x + 1);
    }, 300);
  }, [getCurrentHistory]);

  const pushHistory = useCallback(() => {
    if (isRestoringRef.current) return;
    const fc = fabricRef.current;
    if (!fc) return;
    const h = getCurrentHistory();
    const snap = JSON.stringify(fc.toObject(['_id', 'name', '_role']));
    if (h.stack[h.idx] === snap) return;
    const next = h.stack.slice(0, h.idx + 1);
    next.push(snap);
    if (next.length > 50) next.shift();
    h.stack = next;
    h.idx = next.length - 1;
    setHistoryTick((x) => x + 1);
  }, [getCurrentHistory]);

  const handleUndo = useCallback(() => {
    const h = getCurrentHistory();
    if (h.idx <= 0) return;
    const fc = fabricRef.current;
    if (!fc) return;
    isRestoringRef.current = true;
    h.idx -= 1;
    const snap = h.stack[h.idx];
    fc.loadFromJSON(JSON.parse(snap))
      .then(() => {
        fc.renderAll();
        refreshLayers();
        scheduleSaveCanvas();
      })
      .finally(() => {
        isRestoringRef.current = false;
        setHistoryTick((x) => x + 1);
      });
  }, [getCurrentHistory, refreshLayers, scheduleSaveCanvas]);

  const handleRedo = useCallback(() => {
    const h = getCurrentHistory();
    if (h.idx >= h.stack.length - 1) return;
    const fc = fabricRef.current;
    if (!fc) return;
    isRestoringRef.current = true;
    h.idx += 1;
    const snap = h.stack[h.idx];
    fc.loadFromJSON(JSON.parse(snap))
      .then(() => {
        fc.renderAll();
        refreshLayers();
        scheduleSaveCanvas();
      })
      .finally(() => {
        isRestoringRef.current = false;
        setHistoryTick((x) => x + 1);
      });
  }, [getCurrentHistory, refreshLayers, scheduleSaveCanvas]);

  // Debounce-persist the canvas so reopening Design (or reloading the app)
  // restores what was there, and so a template marked via "Use as social
  // template" is actually available for the compositor to read later.
  const scheduleSaveCanvas = useCallback(() => {
    if (!design?.id || !onPatch) return;
    clearTimeout(saveCanvasTimer.current);
    saveCanvasTimer.current = setTimeout(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const json = fc.toObject(['_id', 'name', '_role']);
      if (pages.length > 1) {
        setPages((prev) => {
          const next = [...prev];
          if (next[activePageIdx]) next[activePageIdx] = { ...next[activePageIdx], json };
          onPatch(design.id, { canvasJson: { pages: next, activeIdx: activePageIdx } });
          return next;
        });
      } else {
        onPatch(design.id, { canvasJson: json });
      }
    }, 800);
  }, [design?.id, onPatch, pages.length, activePageIdx]);

  const handleLayersChanged = useCallback(() => {
    refreshLayers();
    scheduleSaveCanvas();
    // push undo snapshot (debounced slightly to avoid dupes during rapid adds)
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  // Which design (if any) is currently the reusable social-post template.
  useEffect(() => {
    api.becca.getSocialTemplate()
      .then((s) => setSocialTemplateId(s?.designId || null))
      .catch(() => {});
  }, []);

  const isSocialTemplate = !!design?.id && design.id === socialTemplateId;
  const handleSetSocialTemplate = useCallback(() => {
    if (!design?.id) return;
    const nextId = isSocialTemplate ? null : design.id;
    api.becca.setSocialTemplate(nextId)
      .then(() => setSocialTemplateId(nextId))
      .catch((err) => window.alert(err.message || 'Failed to update social template'));
  }, [design?.id, isSocialTemplate]);

  const handleObjectSelected = useCallback((obj) => {
    setSelectedObj(obj);
    if (obj) setActivePanel('properties');
  }, []);

  const addText = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    // Use Textbox (an IText subclass) for every text element so add/import/edit
    // share one type instead of mixing IText (auto-scaling) and Textbox
    // (fixed-width wrap). A fixed starting width keeps behavior predictable;
    // users can clear it for auto-fit (see ObjectPanel auto-width).
    const text = new fabric.Textbox('Edit me', {
      left: 100,
      top: 100,
      width: 480,
      fontSize: 48,
      fontFamily: 'Inter, sans-serif',
      fill: '#1e211e',
      textAlign: 'left',
      _id: genId(),
      name: 'Text',
    });
    fc.add(text);
    fc.setActiveObject(text);
    fc.renderAll();
    text.enterEditing();
  }, [genId]);

  const addRect = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.add(new fabric.Rect({
      left: 100,
      top: 100,
      width: 200,
      height: 150,
      fill: '#c8f000',
      rx: 8,
      ry: 8,
      _id: genId(),
      name: 'Rectangle',
    }));
    fc.renderAll();
  }, [genId]);

  const addCircle = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.add(new fabric.Circle({
      left: 150,
      top: 150,
      radius: 75,
      fill: '#6366f1',
      _id: genId(),
      name: 'Circle',
    }));
    fc.renderAll();
  }, [genId]);

  const addImageFromFile = useCallback(async (file) => {
    const fc = fabricRef.current;
    if (!fc || !file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    try {
      const img = await fabric.FabricImage.fromURL(dataUrl);
      img.set({ _id: genId(), name: file.name || 'Image' });
      const maxW = dims.w * 0.6;
      const maxH = dims.h * 0.6;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      img.scaleX = scale;
      img.scaleY = scale;
      fc.add(img);
      fc.centerObject(img);
      fc.setActiveObject(img);
      fc.renderAll();
    } catch {
      window.alert('Failed to load that image.');
    }
  }, [dims, genId]);

  const addImage = useCallback(() => {
    // Prefer file picker; fallback to URL prompt if no file chosen
    if (imageInputRef.current) {
      imageInputRef.current.click();
      return;
    }
    const url = window.prompt('Enter image URL:');
    if (!url) return;
    fabric.FabricImage.fromURL(url)
      .then((img) => {
        img.set({ _id: genId(), name: 'Image' });
        const maxW = dims.w * 0.6;
        const maxH = dims.h * 0.6;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        img.scaleX = scale;
        img.scaleY = scale;
        fc.add(img);
        fc.centerObject(img);
        fc.setActiveObject(img);
        fc.renderAll();
      })
      .catch(() => window.alert('Failed to load image from that URL.'));
  }, [dims, genId]);

  const handleReorder = useCallback((fromIdx, toIdx) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects()[fromIdx];
    if (!obj) return;
    fc.moveTo(obj, toIdx);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleBringForward = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getObjects();
    const idx = objs.findIndex((o) => o._id === id);
    if (idx < 0 || idx >= objs.length - 1) return;
    fc.moveTo(objs[idx], idx + 1);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleSendBackward = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getObjects();
    const idx = objs.findIndex((o) => o._id === id);
    if (idx <= 0) return;
    fc.moveTo(objs[idx], idx - 1);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleBringToFront = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getObjects();
    const obj = objs.find((o) => o._id === id);
    if (!obj) return;
    fc.bringObjectToFront(obj);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleSendToBack = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getObjects();
    const obj = objs.find((o) => o._id === id);
    if (!obj) return;
    fc.sendObjectToBack(obj);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleDeleteLayer = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    fc.remove(obj);
    fc.renderAll();
  }, []);

  const handleDuplicateLayer = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    obj.clone().then((clone) => {
      clone.set({
        left: obj.left + 20,
        top: obj.top + 20,
        _id: genId(),
        name: `${obj.name || obj.type} copy`,
      });
      fc.add(clone);
      fc.setActiveObject(clone);
      fc.renderAll();
    });
  }, [genId]);

  const handleToggleVisible = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    obj.set('visible', !obj.visible);
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleToggleLock = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    obj.set({
      selectable: !obj.selectable,
      evented: obj.selectable,
    });
    if (!obj.selectable && fc.getActiveObject() === obj) fc.discardActiveObject();
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleSelectLayer = useCallback((id) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    fc.setActiveObject(obj);
    fc.renderAll();
  }, []);

  const handleUpdateObject = useCallback((id, props) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find((o) => o._id === id);
    if (!obj) return;
    obj.set(props);
    obj.setCoords();
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
    setSelectedObj((prev) => (prev && prev._id === id ? { ...prev, ...props } : prev));
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  // Shrink a Textbox's wrap width to tightly fit its widest line of current text.
  const handleAutoWidth = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!active || (active.type !== 'textbox' && active.type !== 'i-text' && active.type !== 'text')) return;
    try {
      const lineCount = (active._textLines && active._textLines.length) || 1;
      let widest = 0;
      for (let i = 0; i < lineCount; i++) {
        if (typeof active.getLineWidth === 'function') {
          const lw = active.getLineWidth(i);
          if (lw > widest) widest = lw;
        }
      }
      if (widest > 0) {
        active.set('width', Math.ceil(widest));
        active.initDimensions();
        active.setCoords();
        fc.renderAll();
        refreshLayers();
        scheduleSaveCanvas();
        setTimeout(() => pushHistory(), 50);
      }
    } catch {}
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleGenerate = useCallback(async (prompt, negative) => {
    const fc = fabricRef.current;
    if (!fc || !prompt.trim()) return;
    // Handle solid-color background requests locally — no need to call the image model
    const bgMatch = prompt.trim().match(/^(?:i want a |background\s*)?(#[0-9a-fA-F]{3,8})\s*(background)?$/i);
    if (bgMatch) {
      fc.backgroundColor = bgMatch[1];
      fc.renderAll();
      refreshLayers();
      return;
    }
    setGenerating(true);
    let blobUrl = null;
    try {
      let fullPrompt = prompt.trim();
      if (negative && negative.trim()) fullPrompt += `, avoid: ${negative.trim()}`;
      const seed = Math.floor(Math.random() * 2147483647);
      const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${dims.w}&height=${dims.h}&nologo=true&seed=${seed}`;
      let res = await fetch(`${base}&model=turbo`);
      if (res.status === 403) {
        // flux is intermittently 403 behind Cloudflare — turbo is the free fallback
        res = await fetch(`${base}&model=flux`);
      }
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const img = await fabric.FabricImage.fromURL(blobUrl);
      img.set({
        _id: genId(),
        name: 'AI Image',
        left: 0,
        top: 0,
      });
      img.scaleToWidth(dims.w);
      if (img.scaleY * img.height < dims.h) img.scaleToHeight(dims.h);
      fc.add(img);
      fc.sendObjectToBack(img);
      fc.renderAll();
    } catch (err) {
      window.alert(err.message || 'Image generation failed. Please try again.');
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setGenerating(false);
    }
  }, [dims, genId]);

  const handleZoomIn = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const next = Math.min(fc.getZoom() * 1.2, 5);
    const center = fc.getCenterPoint();
    fc.zoomToPoint(center, next);
    fc.setWidth(dims.w * next);
    fc.setHeight(dims.h * next);
    fc.requestRenderAll();
    setZoom(next);
  }, [dims]);

  const handleZoomOut = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const next = Math.max(fc.getZoom() / 1.2, 0.05);
    const center = fc.getCenterPoint();
    fc.zoomToPoint(center, next);
    fc.setWidth(dims.w * next);
    fc.setHeight(dims.h * next);
    fc.requestRenderAll();
    setZoom(next);
  }, [dims]);

  const handleZoomFit = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const area = fc.lowerCanvasEl?.parentElement?.parentElement || fc.upperCanvasEl?.parentElement?.parentElement;
    const cw = area ? area.clientWidth - 40 : dims.w;
    const ch = area ? area.clientHeight - 40 : dims.h;
    const scale = Math.min(cw / dims.w, ch / dims.h, 1);
    // Reset pan and zoom to fit
    fc.setViewportTransform([scale, 0, 0, scale, 0, 0]);
    fc.setWidth(dims.w * scale);
    fc.setHeight(dims.h * scale);
    fc.requestRenderAll();
    setZoom(scale);
  }, [dims]);

  const handleOpenImport = useCallback(() => {
    setProposalPages(null);
    setImportOpen(true);
    api.listAllProposals()
      .then((rows) => setProposals(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const handlePickProposal = useCallback(async (p) => {
    setExtracting(true);
    try {
      const blob = await api.downloadProposalPdf(p.id);
      const file = new File([blob], 'proposal.pdf', { type: 'application/pdf' });
      const pages = await renderAllPages(file);
      // Keep pages that have any visual content (dataUrl always present after render)
      const usable = pages.filter((pg) => pg.dataUrl);
      if (!usable.length) throw new Error('no pages');
      setProposalPages({
        name: p.companyName || p.name || `Proposal ${p.id?.slice(0, 6) || ''}`,
        pages: usable,
      });
    } catch (err) {
      console.error('Proposal extraction failed', err);
      window.alert('Could not read that proposal PDF. Try again in a moment.');
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleImportPage = useCallback((page) => {
    const fc = fabricRef.current;
    if (fc && fc.getObjects().length > 0) {
      if (!window.confirm('The canvas already has layers. Replace them with this page?')) return;
    }
    setImportOpen(false);
    setImporting(true);
    setPendingImport({ page, replace: true, preset: pickPresetForPage(page) });
    setCanvasSize(pickPresetForPage(page));
  }, []);

  // Runs after the canvas has been recreated for the imported page's aspect
  // ratio (DesignCanvas is keyed by canvasSize).
  useEffect(() => {
    if (!pendingImport || !fabricRef.current) return;
    const fc = fabricRef.current;
    let cancelled = false;
    (async () => {
      try {
        const targetW = CANVAS_SIZES[pendingImport.preset]?.w || dims.w;
        const objects = await buildLayersFromPage(pendingImport.page, {
          targetW,
          headlineFont: design?.headlineFont || 'Poppins',
          bodyFont: design?.bodyFont || 'Inter',
          genId,
        });
        if (cancelled || fabricRef.current !== fc) return;
        fc.clear();
        fc.backgroundColor = '#ffffff';
        for (let i = 0; i < objects.length; i++) {
          fc.add(objects[i]);
          if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        fc.renderAll();
        refreshLayers();
        setTimeout(() => pushHistory(), 60);
      } catch (err) {
        console.error('Layer import failed', err);
        window.alert('Could not convert that page into editable layers.');
      } finally {
        if (!cancelled) {
          setImporting(false);
          setPendingImport(null);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasVersion, pendingImport]);

  const downloadFile = useCallback((data, filename) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = data;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleExportPng = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const prevBg = fc.backgroundColor;
    try {
      if (transparentBg) fc.backgroundColor = null;
      const dataUrl = fc.toDataURL({ format: 'png', multiplier: 2, quality: 1 });
      downloadFile(dataUrl, 'design.png');
    } catch (err) {
      console.error('PNG export failed', err);
      window.alert('Export failed — canvas too large for this device. Try “Fit” then export, or remove some high-res images.');
      try {
        const fallback = fc.toDataURL({ format: 'png', multiplier: 1, quality: 1 });
        downloadFile(fallback, 'design.png');
      } catch {}
    } finally {
      if (transparentBg) {
        fc.backgroundColor = prevBg;
        fc.requestRenderAll();
      }
    }
  }, [downloadFile, transparentBg]);

  const handleExportSvg = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    try {
      const svg = fc.toSVG();
      downloadFile(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 'design.svg');
    } catch (err) {
      console.error('SVG export failed', err);
      window.alert('SVG export failed: ' + (err.message || 'unknown error'));
    }
  }, [downloadFile]);

  const handleExportJpg = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    try {
      // JPG has no alpha — composite on white first, then jpeg-encode.
      const dataUrl = fc.toDataURL({ format: 'jpeg', multiplier: 2, quality: 0.92 });
      downloadFile(dataUrl, 'design.jpg');
    } catch (err) {
      console.error('JPG export failed', err);
      window.alert('Export failed — try “Fit” then export, or remove some high-res images.');
    }
  }, [downloadFile]);

  const handleExportPdf = useCallback(async () => {
    const fc = fabricRef.current;
    if (!fc) return;
    try {
      const multiplier = 2;
      const dataUrl = fc.toDataURL({ format: 'png', multiplier, quality: 1 });
      const pngBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
      const doc = await PDFDocument.create();
      // PDF points (72/in) from canvas pixels (96/in): page is drawn at the
      // canvas's size and the PNG embedded 1:1 in point space.
      const page = doc.addPage([dims.w, dims.h]);
      const png = await doc.embedPng(pngBytes);
      page.drawImage(png, { x: 0, y: 0, width: dims.w, height: dims.h });
      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      downloadFile(url, 'design.pdf');
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed', err);
      window.alert('PDF export failed: ' + (err.message || 'unknown error'));
    }
  }, [downloadFile, dims]);

  const handleClear = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (!window.confirm('Clear all layers?')) return;
    fc.clear();
    fc.backgroundColor = '#ffffff';
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  // Convert a text block's lines into a bullet / numbered list, or back to plain.
  // Markers are written into the text itself (fabric Textbox has no native list),
  // so the result is plain text with "• " or "1. " prefixes per line.
  const listMarker = (listType, i) => listType === 'bullets' ? '• ' : `${i + 1}. `;
  const handleSetList = useCallback((type) => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!active || (active.type !== 'textbox' && active.type !== 'i-text' && active.type !== 'text')) return;
    const raw = String(active.text || '');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    let next;
    if (type === 'none') {
      next = lines.map((l) => l.replace(/^(\d+\.|•|\-)\s+/, '')).join('\n');
    } else {
      next = lines.map((l, i) => {
        const clean = l.replace(/^(\d+\.|•|\-)\s+/, '');
        return listMarker(type, i) + clean;
      }).join('\n');
    }
    active.set({ text: next, _list: type === 'none' ? null : type });
    active.initDimensions();
    active.setCoords();
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, scheduleSaveCanvas, pushHistory]);

  const handleCopy = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!active || active.isEditing) return;
    active.clone().then((c) => { clipboardRef.current = c; });
  }, []);

  const handlePaste = useCallback(() => {
    const fc = fabricRef.current;
    const clip = clipboardRef.current;
    if (!fc || !clip) return;
    clip.clone().then((clone) => {
      clone.set({ left: (clone.left || 0) + 20, top: (clone.top || 0) + 20, _id: genId(), name: `${clone.name || clone.type} copy` });
      fc.add(clone);
      fc.setActiveObject(clone);
      fc.renderAll();
      refreshLayers();
      setTimeout(() => pushHistory(), 50);
    });
  }, [genId, refreshLayers, pushHistory]);

  const handleNudge = useCallback((dx, dy) => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!active || active.isEditing) return;
    active.set('left', (active.left || 0) + dx);
    active.set('top', (active.top || 0) + dy);
    active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, pushHistory]);

  const handleAlign = useCallback((dir) => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active) return;
    const objs = active.type === 'activeSelection' ? active.getObjects() : [active];
    const cw = dims.w;
    const ch = dims.h;
    objs.forEach((obj) => {
      const w = obj.width * (obj.scaleX || 1);
      const h = obj.height * (obj.scaleY || 1);
      if (dir === 'left') obj.set('left', 0);
      else if (dir === 'centerH') obj.set('left', (cw - w) / 2);
      else if (dir === 'right') obj.set('left', cw - w);
      else if (dir === 'top') obj.set('top', 0);
      else if (dir === 'centerV') obj.set('top', (ch - h) / 2);
      else if (dir === 'bottom') obj.set('top', ch - h);
      obj.setCoords();
    });
    if (active.type === 'activeSelection') active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [dims, refreshLayers, pushHistory]);

  const handleDistribute = useCallback((dir) => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'activeSelection' || active.getObjects().length < 3) return;
    const objs = [...active.getObjects()].sort((a, b) => (dir === 'horizontal' ? a.left - b.left : a.top - b.top));
    if (dir === 'horizontal') {
      const minX = Math.min(...objs.map((o) => o.left));
      const maxR = Math.max(...objs.map((o) => o.left + o.width * (o.scaleX || 1)));
      const totalW = objs.reduce((s, o) => s + o.width * (o.scaleX || 1), 0);
      const gap = (maxR - minX - totalW) / (objs.length - 1);
      let cur = minX;
      objs.forEach((obj) => {
        obj.set('left', cur);
        cur += obj.width * (obj.scaleX || 1) + gap;
        obj.setCoords();
      });
    } else {
      const minY = Math.min(...objs.map((o) => o.top));
      const maxB = Math.max(...objs.map((o) => o.top + o.height * (o.scaleY || 1)));
      const totalH = objs.reduce((s, o) => s + o.height * (o.scaleY || 1), 0);
      const gap = (maxB - minY - totalH) / (objs.length - 1);
      let cur = minY;
      objs.forEach((obj) => {
        obj.set('top', cur);
        cur += obj.height * (obj.scaleY || 1) + gap;
        obj.setCoords();
      });
    }
    active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, pushHistory]);

  const handleFlip = useCallback((axis) => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.isEditing) return;
    const objs = active.type === 'activeSelection' ? active.getObjects() : [active];
    objs.forEach((obj) => {
      if (axis === 'h') obj.set('flipX', !obj.flipX);
      else obj.set('flipY', !obj.flipY);
      obj.setCoords();
    });
    if (active.type === 'activeSelection') active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, pushHistory]);

  const handleImageFit = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'image') return;
    const maxW = dims.w * 0.8;
    const maxH = dims.h * 0.8;
    const scale = Math.min(maxW / active.width, maxH / active.height);
    active.set({ scaleX: scale, scaleY: scale });
    fc.centerObject(active);
    active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [dims, refreshLayers, pushHistory]);

  const handleImageFill = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'image') return;
    const scale = Math.max(dims.w / active.width, dims.h / active.height);
    active.set({ scaleX: scale, scaleY: scale });
    fc.centerObject(active);
    active.setCoords();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [dims, refreshLayers, pushHistory]);

  const handleReplaceImage = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'image') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      try {
        const newImg = await fabric.FabricImage.fromURL(dataUrl);
        newImg.set({
          left: active.left,
          top: active.top,
          scaleX: active.scaleX,
          scaleY: active.scaleY,
          angle: active.angle,
          flipX: active.flipX,
          flipY: active.flipY,
          _id: active._id,
          name: file.name || active.name,
          _role: active._role,
        });
        fc.remove(active);
        fc.add(newImg);
        fc.setActiveObject(newImg);
        fc.requestRenderAll();
        refreshLayers();
        setTimeout(() => pushHistory(), 50);
      } catch {}
    };
    input.click();
  }, [refreshLayers, pushHistory]);

  const handleGroup = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'activeSelection' || active.getObjects().length < 2) return;
    const objects = active.getObjects();
    const all = fc.getObjects();
    const minIdx = Math.min(...objects.map((o) => all.indexOf(o)).filter((i) => i >= 0));
    fc.discardActiveObject();
    objects.forEach((o) => fc.remove(o));
    const group = new fabric.Group(objects, { _id: genId(), name: 'Group' });
    // Preserve original z-order — insert at lowest index, not top
    if (minIdx >= 0 && minIdx < fc.getObjects().length) fc.insertAt(group, minIdx);
    else fc.add(group);
    fc.setActiveObject(group);
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [genId, refreshLayers, pushHistory]);

  const handleUngroup = useCallback(() => {
    const fc = fabricRef.current;
    const active = fc?.getActiveObject();
    if (!fc || !active || active.type !== 'group') return;
    // toActiveSelection handles coordinate conversion correctly
    active.toActiveSelection();
    fc.requestRenderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 50);
  }, [refreshLayers, pushHistory]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const fc = fabricRef.current;
      if (!fc) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObj) {
        e.preventDefault();
        handleDeleteLayer(selectedObj._id);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const active = fc.getActiveObject();
        if (active?._id) handleDuplicateLayer(active._id);
        else if (active) {
          active.clone().then((clone) => {
            clone.set({ left: (active.left || 0) + 20, top: (active.top || 0) + 20, _id: genId(), name: `${active.name || active.type} copy` });
            fc.add(clone);
            fc.setActiveObject(clone);
            fc.renderAll();
            refreshLayers();
            setTimeout(() => pushHistory(), 50);
          });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleUngroup();
        else handleGroup();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') handleNudge(0, -step);
        else if (e.key === 'ArrowDown') handleNudge(0, step);
        else if (e.key === 'ArrowLeft') handleNudge(-step, 0);
        else if (e.key === 'ArrowRight') handleNudge(step, 0);
      } else if (!fc.getActiveObject()?.isEditing && e.key.toLowerCase() === 't') {
        e.preventDefault();
        addText();
      } else if (!fc.getActiveObject()?.isEditing && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        addRect();
      } else if (!fc.getActiveObject()?.isEditing && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        addCircle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObj, handleDeleteLayer, addText, addRect, addCircle, handleUndo, handleRedo, handleCopy, handlePaste, handleNudge, handleDuplicateLayer, handleGroup, handleUngroup, genId, refreshLayers, pushHistory]);

  const handleSizeChange = useCallback((size) => {
    setCanvasSize(size);
  }, []);

  const handleSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => {
      const dx = startX - ev.clientX;
      const next = Math.min(480, Math.max(200, startW + dx));
      setSidebarWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('design:sbWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  // Canva-style pages: save current canvas before switching, load target page
  const saveCurrentPageSilently = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc || pages.length === 0) return;
    try {
      const json = fc.toObject(['_id', 'name', '_role']);
      setPages((prev) => {
        const next = [...prev];
        if (next[activePageIdx]) next[activePageIdx] = { ...next[activePageIdx], json };
        return next;
      });
    } catch {}
  }, [activePageIdx, pages.length]);

  const handleAddPage = useCallback(() => {
    const fc = fabricRef.current;
    if (fc) {
      try {
        const json = fc.toObject(['_id', 'name', '_role']);
        setPages((prev) => {
          const next = [...prev];
          if (next[activePageIdx]) next[activePageIdx] = { ...next[activePageIdx], json };
          const newPage = { id: `page-${Date.now()}`, json: null, name: `Page ${next.length + 1}` };
          const updated = [...next, newPage];
          if (onPatch && design?.id && updated.length > 1) {
            onPatch(design.id, { canvasJson: { pages: updated, activeIdx: updated.length - 1 } });
          }
          return updated;
        });
      } catch {}
    }
    setActivePageIdx((prev) => prev + 1);
    // Clear canvas for new blank page after a tick so Fabric is ready
    setTimeout(() => {
      const fc2 = fabricRef.current;
      if (fc2) {
        fc2.clear();
        fc2.backgroundColor = '#ffffff';
        fc2.renderAll();
        refreshLayers();
        setTimeout(() => pushHistory(), 60);
      }
    }, 50);
  }, [activePageIdx, design?.id, onPatch, refreshLayers, pushHistory]);

  const handleSwitchPage = useCallback(async (idx) => {
    if (idx === activePageIdx) return;
    const fc = fabricRef.current;
    if (!fc) return;
    // Save current
    try {
      const json = fc.toObject(['_id', 'name', '_role']);
      setPages((prev) => {
        const next = [...prev];
        if (next[activePageIdx]) next[activePageIdx] = { ...next[activePageIdx], json };
        return next;
      });
    } catch {}
    setActivePageIdx(idx);
    const target = pages[idx];
    fc.clear();
    fc.backgroundColor = '#ffffff';
    if (target?.json) {
      try {
        await fc.loadFromJSON(target.json);
        fc.renderAll();
      } catch (err) {
        console.error('Failed to load page', err);
      }
    }
    fc.renderAll();
    refreshLayers();
    setTimeout(() => pushHistory(), 60);
    if (onPatch && design?.id && pages.length > 1) {
      onPatch(design.id, { canvasJson: { pages, activeIdx: idx } });
    }
  }, [activePageIdx, pages, design?.id, onPatch, refreshLayers, pushHistory]);

  const handleDuplicatePage = useCallback((idx) => {
    const fc = fabricRef.current;
    if (fc && idx === activePageIdx) {
      try {
        const json = fc.toObject(['_id', 'name', '_role']);
        setPages((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], json };
          const dup = { id: `page-${Date.now()}`, json, name: `${next[idx].name} copy` };
          const updated = [...next.slice(0, idx + 1), dup, ...next.slice(idx + 1)];
          return updated;
        });
        setActivePageIdx(idx + 1);
      } catch {}
    } else {
      setPages((prev) => {
        const dup = { ...prev[idx], id: `page-${Date.now()}`, name: `${prev[idx].name} copy` };
        return [...prev.slice(0, idx + 1), dup, ...prev.slice(idx + 1)];
      });
    }
    setTimeout(() => pushHistory(), 80);
  }, [activePageIdx, pushHistory]);

  const handleDeletePage = useCallback((idx) => {
    if (pages.length <= 1) {
      // Single page: just clear
      const fc = fabricRef.current;
      if (fc) {
        fc.clear();
        fc.backgroundColor = '#ffffff';
        fc.renderAll();
        refreshLayers();
        setTimeout(() => pushHistory(), 60);
      }
      return;
    }
    setPages((prev) => prev.filter((_, i) => i !== idx));
    if (activePageIdx >= idx && activePageIdx > 0) {
      setActivePageIdx(activePageIdx - 1);
    } else if (activePageIdx >= pages.length - 1) {
      setActivePageIdx(pages.length - 2);
    }
    setTimeout(() => pushHistory(), 80);
  }, [pages.length, activePageIdx, refreshLayers, pushHistory]);

  function handleCommand(text) {
    const fc = fabricRef.current;
    if (!fc || !text.trim()) return;
    const cmd = text.trim().toLowerCase();
    setCommandHistory(prev => [...prev, { role: 'user', text }]);
    const replies = [];

    if (cmd === 'add text' || cmd === 'text') {
      addText();
      replies.push('Added a text element.');
    } else if (cmd === 'add rectangle' || cmd === 'rect' || cmd === 'add rect') {
      addRect();
      replies.push('Added a rectangle.');
    } else if (cmd === 'add circle' || cmd === 'circle') {
      addCircle();
      replies.push('Added a circle.');
    } else if (cmd.startsWith('background ') || cmd.startsWith('bg ')) {
      const color = cmd.replace(/^(background|bg)\s+/, '').trim();
      fc.backgroundColor = color;
      fc.renderAll();
      replies.push(`Background set to ${color}.`);
    } else if (cmd === 'clear') {
      fc.clear();
      fc.backgroundColor = '#ffffff';
      fc.renderAll();
      refreshLayers();
      scheduleSaveCanvas();
      replies.push('Canvas cleared.');
    } else if (cmd.startsWith('resize ')) {
      const parts = cmd.replace('resize', '').trim().split(/x|\s/);
      const w = parseInt(parts[0]);
      const h = parseInt(parts[1]);
      if (w > 0 && h > 0) {
        const key = Object.keys(CANVAS_SIZES).find(k => CANVAS_SIZES[k].w === w && CANVAS_SIZES[k].h === h);
        if (key) { setCanvasSize(key); replies.push(`Resized to ${w}×${h}.`); }
        else replies.push(`No preset for ${w}×${h}. Available: ${Object.values(CANVAS_SIZES).map(v => `${v.w}×${v.h}`).join(', ')}.`);
      } else {
        replies.push('Usage: resize 1080x1080');
      }
    } else if (cmd === 'layers' || cmd === 'list') {
      const objs = fc.getObjects();
      if (objs.length === 0) replies.push('Canvas is empty.');
      else objs.forEach((o, i) => replies.push(`${i + 1}. ${o.name || o.type}`));
    } else if (cmd.startsWith('delete ') || cmd.startsWith('remove ')) {
      const target = cmd.replace(/^(delete|remove)\s+/, '').trim();
      const obj = fc.getObjects().find(o => (o.name || '').toLowerCase() === target || o.type === target);
      if (obj) { fc.remove(obj); fc.renderAll(); replies.push(`Removed ${obj.name || obj.type}.`); }
      else replies.push(`Couldn't find "${target}".`);
    } else if (cmd === 'help') {
      replies.push(
        'Commands: add text, add rectangle, add circle, background [color],',
        'resize [WxH], layers, delete [name], clear, help',
      );
    } else {
      replies.push(`Unknown command: "${cmd}". Type "help" for available commands.`);
    }

    setCommandHistory(prev => [...prev, { role: 'assistant', text: replies.join('\n') }]);
    setCommandInput('');
  }

  return (
    <div className="design-editor">
      <DesignToolbar
        canvasSize={canvasSize}
        onSizeChange={handleSizeChange}
        onAddText={addText}
        onAddRect={addRect}
        onAddCircle={addCircle}
        onAddImage={addImage}
        onImportLayers={handleOpenImport}
        canImportLayers={!importing && !extracting}
        onDelete={() => selectedObj && handleDeleteLayer(selectedObj._id)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onAlign={handleAlign}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onDistribute={handleDistribute}
        onFlip={handleFlip}
        transparentBg={transparentBg}
        onToggleTransparent={() => setTransparentBg((v) => !v)}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onExportJpg={handleExportJpg}
        onExportPdf={handleExportPdf}
        onClear={handleClear}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((v) => !v)}
        isSocialTemplate={isSocialTemplate}
        onSetSocialTemplate={design?.id ? handleSetSocialTemplate : null}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) addImageFromFile(f);
          e.target.value = '';
        }}
      />
      <div className="design-main">
        <div className="design-pages-strip">
          {pages.map((p, idx) => (
            <div
              key={p.id}
              className={`design-page-thumb ${activePageIdx === idx ? 'active' : ''}`}
              onClick={() => handleSwitchPage(idx)}
            >
              <div className="page-thumb-preview">
                <span className="page-number">{idx + 1}</span>
                <span className="page-thumb-label">{p.name}</span>
              </div>
              <div className="page-thumb-actions">
                <button
                  type="button"
                  className="page-thumb-btn"
                  onClick={(e) => { e.stopPropagation(); handleDuplicatePage(idx); }}
                  title="Duplicate page"
                >
                  <Copy size={12} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="page-thumb-btn page-thumb-btn-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeletePage(idx); }}
                  title="Delete page"
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="design-add-page-btn" onClick={handleAddPage}>
            <Plus size={14} strokeWidth={1.8} />
            <span>Add page</span>
          </button>
        </div>
        <div className="design-canvas-area">
          <DesignCanvas
            key={canvasSize}
            canvasSize={canvasSize}
            canvasJson={pages[activePageIdx]?.json}
            onCanvasReady={handleCanvasReady}
            onObjectSelected={handleObjectSelected}
            onLayersChanged={handleLayersChanged}
            onZoomChange={setZoom}
            snapEnabled={snapEnabled}
            showGrid={showGrid}
            zoom={zoom}
          />
          <div className="design-zoom-controls">
            <button type="button" className="design-zoom-btn" onClick={handleZoomIn} title="Zoom in">
              <ZoomIn size={16} strokeWidth={1.8} />
            </button>
            <span className="design-zoom-level">{Math.round(zoom * 100)}%</span>
            <button type="button" className="design-zoom-btn" onClick={handleZoomOut} title="Zoom out">
              <ZoomOut size={16} strokeWidth={1.8} />
            </button>
            <button type="button" className="design-zoom-btn" onClick={handleZoomFit} title="Fit to screen">
              <Maximize2 size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="design-sidebar-resizer" onMouseDown={handleSidebarResizeStart} />
        <div className="design-sidebar" style={{ width: sidebarWidth }}>
          <div className="design-sidebar-tabs">
            <button className={`design-sidebar-tab ${activePanel === 'layers' ? 'active' : ''}`} onClick={() => setActivePanel('layers')}>Layers</button>
            <button className={`design-sidebar-tab ${activePanel === 'ai' ? 'active' : ''}`} onClick={() => setActivePanel('ai')}>AI</button>
            <button className={`design-sidebar-tab ${activePanel === 'properties' ? 'active' : ''}`} onClick={() => setActivePanel('properties')}>Props</button>
          </div>
          <div className="design-sidebar-content">
            {activePanel === 'layers' && <LayerPanel layers={layers} onReorder={handleReorder} onSelect={handleSelectLayer} selectedId={selectedObj?._id} onDelete={handleDeleteLayer} onDuplicate={handleDuplicateLayer} onToggleVisible={handleToggleVisible} onToggleLock={handleToggleLock} onBringForward={handleBringForward} onSendBackward={handleSendBackward} onBringToFront={handleBringToFront} onSendToBack={handleSendToBack} />}
            {activePanel === 'ai' && <AIGeneratePanel onGenerate={handleGenerate} generating={generating} />}
            {activePanel === 'properties' && <ObjectPanel selectedObj={selectedObj} onUpdate={handleUpdateObject} onReplaceImage={handleReplaceImage} onImageFit={handleImageFit} onImageFill={handleImageFill} onAutoWidth={handleAutoWidth} onSetList={handleSetList} />}
          </div>
        </div>
      </div>
      {commandHistory.length > 0 && (
        <div className="design-chat-log">
          {commandHistory.map((msg, i) => (
            <div key={i} className={`design-chat-msg design-chat-${msg.role}`}>
              {msg.text.split('\n').map((line, j) => <div key={j}>{line}</div>)}
            </div>
          ))}
        </div>
      )}
      <div className="design-chat-bar">
        <input
          type="text"
          className="design-chat-input"
          value={commandInput}
          onChange={e => setCommandInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCommand(commandInput); } }}
          placeholder="Type a command — 'add text', 'background #ff0000', 'help'…"
        />
        <button
          type="button"
          className="design-chat-send"
          onClick={() => handleCommand(commandInput)}
          disabled={!commandInput.trim()}
        >↑</button>
      </div>
      {importOpen && (
        <div className="modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="design-import-picker" onClick={(e) => e.stopPropagation()}>
            {proposalPages ? (
              <>
                <button type="button" className="design-import-back" onClick={() => setProposalPages(null)}>← Choose a different source</button>
                <h3>Import page as layers</h3>
                <p className="design-import-sub">
                  Pages extracted from “{proposalPages.name}” — text, images and
                  shapes become editable layers on top of the original.
                </p>
                <div className="design-import-grid">
                  {proposalPages.pages.map((p, i) => (
                    <button key={i} type="button" className="design-import-thumb" onClick={() => handleImportPage(p)}>
                      <img src={p.dataUrl} alt={`Page ${i + 1}`} />
                      <span>Page {i + 1}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h3>Import page as layers</h3>
                <p className="design-import-sub">
                  Pick a page to convert — text, images and shapes become editable
                  layers on top of the original. Or upload an image/PDF to split into layers.
                </p>
                {extracting && <div className="design-import-extracting">Reading PDF…</div>}
                {!extracting && (
                  <div className="design-import-upload">
                    <label className="design-import-upload-btn">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setExtracting(true);
                          try {
                            const pgs = await renderAllPages(f);
                            const usable = pgs.filter((pg) => pg.dataUrl);
                            if (!usable.length) throw new Error('no pages');
                            if (usable.length === 1) {
                              handleImportPage(usable[0]);
                            } else {
                              setProposalPages({ name: f.name, pages: usable });
                            }
                          } catch (err) {
                            console.error(err);
                            window.alert('Could not read that file.');
                          } finally {
                            setExtracting(false);
                            e.target.value = '';
                          }
                        }}
                      />
                      + Upload image/PDF to split into layers
                    </label>
                  </div>
                )}
                {!extracting && importablePages && (
                  <>
                    <div className="design-import-heading">Your design</div>
                    <div className="design-import-grid">
                      {importablePages.map((p, i) => (
                        <button key={i} type="button" className="design-import-thumb" onClick={() => handleImportPage(p)}>
                          <img src={p.dataUrl} alt={`Page ${i + 1}`} />
                          <span>Page {i + 1}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {!extracting && proposals.length > 0 && (
                  <>
                    <div className="design-import-heading">From a proposal</div>
                    <div className="design-import-proposals">
                      {proposals.map((p) => (
                        <button key={p.id} type="button" className="design-import-proposal" onClick={() => handlePickProposal(p)}>
                          {p.companyName || p.name || `Proposal ${String(p.id).slice(0, 6)}`}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {importing && (
        <div className="modal-overlay">
          <div className="design-importing">Converting to layers…</div>
        </div>
      )}
    </div>
  );
}

function ObjectPanel({ selectedObj, onUpdate, onReplaceImage, onImageFit, onImageFill, onAutoWidth, onSetList }) {
  if (!selectedObj) {
    return <div className="object-panel"><p className="object-panel-empty">Select an object to edit its properties.</p></div>;
  }

  const update = (key, value) => onUpdate(selectedObj._id, { [key]: value });

  return (
    <div className="object-panel">
      <div className="op-section">
        <div className="op-label">{selectedObj.name || selectedObj.type}</div>
      </div>

      {(selectedObj.type === 'i-text' || selectedObj.type === 'textbox' || selectedObj.type === 'text') && (
        <>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Text</span>
              <textarea className="op-input" value={selectedObj.text || ''} onChange={(e) => update('text', e.target.value)} rows={3} />
            </div>
            <div className="op-field" style={{ marginTop: 8 }}>
              <span className="op-field-label">List</span>
              <select className="op-input" value={selectedObj._list || 'none'} onChange={(e) => onSetList(e.target.value)}>
                <option value="none">None</option>
                <option value="bullets">Bullets</option>
                <option value="numbers">Numbered</option>
              </select>
            </div>
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Font size</span>
              <input className="op-input" type="number" value={selectedObj.fontSize || 48} onChange={(e) => update('fontSize', Number(e.target.value))} />
            </div>
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Font family</span>
              <select
                className="op-input"
                value={parseFontFamily(selectedObj.fontFamily)}
                onChange={async (e) => {
                  const f = e.target.value;
                  ensureGoogleFontLoaded(f);
                  try { await document.fonts.ready; } catch {}
                  update('fontFamily', f);
                }}
              >
                {CURATED_GOOGLE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Text align</span>
              <select
                className="op-input"
                value={selectedObj.textAlign || 'left'}
                onChange={(e) => update('textAlign', e.target.value)}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </div>
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Text width</span>
              <input className="op-input" type="number" value={Math.round(selectedObj.width ?? 0)} onChange={(e) => update('width', Math.max(1, Number(e.target.value) || 0))} title="Wrap width for the text block" />
            </div>
            <div className="op-row" style={{ marginTop: 6 }}>
              <button type="button" className="op-toggle-btn" onClick={onAutoWidth} title="Shrink the box's wrap width to tightly fit the current text">Fit width to text</button>
            </div>
          </div>
          <div className="op-section">
            <div className="op-row">
              <div className="op-field">
                <span className="op-field-label">Line height</span>
                <input className="op-input op-input-sm" type="number" step="0.1" min="0.5" max="3" value={selectedObj.lineHeight ?? 1.16} onChange={(e) => update('lineHeight', parseFloat(e.target.value) || 1.16)} />
              </div>
              <div className="op-field">
                <span className="op-field-label">Spacing</span>
                <input className="op-input op-input-sm" type="number" step="10" min="-200" max="1000" value={selectedObj.charSpacing ?? 0} onChange={(e) => update('charSpacing', parseInt(e.target.value, 10) || 0)} />
              </div>
            </div>
          </div>
          <div className="op-section">
            <div className="op-row">
              <button type="button" className={`op-toggle-btn ${selectedObj.fontWeight === '700' || selectedObj.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => update('fontWeight', selectedObj.fontWeight === '700' ? '400' : '700')} title="Bold">B</button>
              <button type="button" className={`op-toggle-btn ${selectedObj.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => update('fontStyle', selectedObj.fontStyle === 'italic' ? 'normal' : 'italic')} title="Italic">I</button>
              <button type="button" className={`op-toggle-btn ${selectedObj.underline ? 'active' : ''}`} onClick={() => update('underline', !selectedObj.underline)} title="Underline">U</button>
            </div>
          </div>
        </>
      )}

          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Text outline</span>
              <div className="op-row">
                <div className="op-field">
                  <input className="op-color" type="color" value={rgbToHex(selectedObj.stroke || '#000000')} onChange={(e) => update('stroke', e.target.value)} title="Outline color" />
                </div>
                <div className="op-field">
                  <input className="op-input op-input-sm" type="number" min="0" max="20" value={selectedObj.strokeWidth ?? 0} onChange={(e) => update('strokeWidth', Number(e.target.value) || 0)} title="Outline width" />
                </div>
              </div>
            </div>
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Shadow</span>
              <select
                className="op-input"
                value={selectedObj.shadow ? (selectedObj.shadow.offsetX ?? 0) + '' : 'none'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'none') update('shadow', null);
                  else update('shadow', { color: 'rgba(0,0,0,0.35)', blur: Number(v), offsetX: Number(v) === 0 ? 0 : Number(v), offsetY: Number(v) === 0 ? 0 : Number(v) });
                }}
              >
                <option value="none">None</option>
                <option value="0">0 (soft edge)</option>
                <option value="2">2</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="16">16</option>
              </select>
            </div>
          </div>
          <div className="op-section">
            <div className="op-field-label">Social template role</div>
        <div className="op-row">
          <button
            type="button"
            className={`op-role-btn ${selectedObj._role === 'headline' ? 'active' : ''}`}
            onClick={() => update('_role', selectedObj._role === 'headline' ? null : 'headline')}
          >
            {selectedObj._role === 'headline' ? '✓ Headline' : 'Use as headline'}
          </button>
          <button
            type="button"
            className={`op-role-btn ${selectedObj._role === 'logo' ? 'active' : ''}`}
            onClick={() => update('_role', selectedObj._role === 'logo' ? null : 'logo')}
          >
            {selectedObj._role === 'logo' ? '✓ Logo' : 'Use as logo'}
          </button>
        </div>
        <p className="op-role-hint">The headline-tagged layer's text gets swapped for generated copy when this design is used as the social-post template.</p>
      </div>

      <div className="op-section">
        <div className="op-field">
          <span className="op-field-label">Fill</span>
          <input className="op-color" type="color" value={rgbToHex(selectedObj.fill || '#000000')} onChange={(e) => update('fill', e.target.value)} />
        </div>
      </div>

      <div className="op-section">
        <div className="op-field">
          <span className="op-field-label">Opacity {Math.round((selectedObj.opacity ?? 1) * 100)}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round((selectedObj.opacity ?? 1) * 100)}
            onChange={(e) => update('opacity', Number(e.target.value) / 100)}
          />
        </div>
      </div>

      {(selectedObj.type === 'rect' || selectedObj.type === 'circle' || selectedObj.type === 'path') && (
        <div className="op-section">
          <div className="op-row">
            <div className="op-field">
              <span className="op-field-label">Stroke</span>
              <input className="op-color" type="color" value={rgbToHex(selectedObj.stroke || '#000000')} onChange={(e) => update('stroke', e.target.value || null)} />
            </div>
            <div className="op-field">
              <span className="op-field-label">Width</span>
              <input className="op-input op-input-sm" type="number" min="0" max="40" value={selectedObj.strokeWidth ?? 0} onChange={(e) => update('strokeWidth', Number(e.target.value) || 0)} />
            </div>
          </div>
        </div>
      )}

      {selectedObj.type === 'image' && (
        <div className="op-section">
          <div className="op-row">
            <button type="button" className="op-btn" onClick={onReplaceImage}>Replace</button>
            <button type="button" className="op-btn" onClick={onImageFit}>Fit</button>
            <button type="button" className="op-btn" onClick={onImageFill}>Fill</button>
          </div>
        </div>
      )}

      <div className="op-section">
        <div className="op-row">
          <div className="op-field">
            <span className="op-field-label">X</span>
            <input className="op-input op-input-sm" type="number" value={selectedObj.left ?? 0} onChange={(e) => update('left', Number(e.target.value))} />
          </div>
          <div className="op-field">
            <span className="op-field-label">Y</span>
            <input className="op-input op-input-sm" type="number" value={selectedObj.top ?? 0} onChange={(e) => update('top', Number(e.target.value))} />
          </div>
        </div>
      </div>

      {!(selectedObj.type === 'textbox' || selectedObj.type === 'i-text' || selectedObj.type === 'text') && (
        <div className="op-section">
          <div className="op-row">
            <div className="op-field">
              <span className="op-field-label">Width</span>
              <input className="op-input op-input-sm" type="number" value={Math.round(selectedObj.width ?? 0)} onChange={(e) => update('width', Number(e.target.value))} />
            </div>
            <div className="op-field">
              <span className="op-field-label">Height</span>
              <input className="op-input op-input-sm" type="number" value={Math.round(selectedObj.height ?? 0)} onChange={(e) => update('height', Number(e.target.value))} />
            </div>
          </div>
        </div>
      )}

      <div className="op-section">
        <div className="op-field">
          <span className="op-field-label">Rotation {Math.round(selectedObj.angle ?? 0)}°</span>
          <input type="range" min="0" max="360" value={selectedObj.angle ?? 0} onChange={(e) => update('angle', Number(e.target.value))} />
        </div>
      </div>
    </div>
  );
}
