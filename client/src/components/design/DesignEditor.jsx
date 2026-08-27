import { useRef, useState, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import { ZoomIn, ZoomOut, Maximize2, Plus, Copy, Trash2 } from 'lucide-react';
import DesignCanvas, { CANVAS_SIZES } from './DesignCanvas';
import LayerPanel from './LayerPanel';
import AIGeneratePanel from './AIGeneratePanel';
import DesignToolbar from './DesignToolbar';
import { buildLayersFromPage, pickPresetForPage } from '../../lib/designImport';
import { renderAllPages } from '../../lib/pdfExtract';
import { api } from '../../api';

// Reverse-lookup a CANVAS_SIZES key from a saved canvas's own width/height,
// so reloading a template restores its real size instead of resetting to the
// 'instagram-post' default and mis-scaling every saved object.
function presetForDimensions(w, h) {
  const key = Object.keys(CANVAS_SIZES).find((k) => CANVAS_SIZES[k].w === w && CANVAS_SIZES[k].h === h);
  return key || 'instagram-post';
}

export default function DesignEditor({ design, onPatch }) {
  const fabricRef = useRef(null);
  const idCounter = useRef(0);
  const [canvasSize, setCanvasSize] = useState(() => (
    design?.canvasJson ? presetForDimensions(design.canvasJson.width, design.canvasJson.height) : 'instagram-post'
  ));
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [socialTemplateId, setSocialTemplateId] = useState(null);
  const saveCanvasTimer = useRef(null);
  const [layers, setLayers] = useState([]);
  const [selectedObj, setSelectedObj] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [activePanel, setActivePanel] = useState('layers');
  const [zoom, setZoom] = useState(1);
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
    setLayers(fc.getObjects().map((obj) => ({
      _id: obj._id,
      type: obj.type,
      name: obj.name,
      text: obj.text || '',
      visible: obj.visible !== false,
      selectable: obj.selectable !== false,
    })));
  }, []);

  const handleCanvasReady = useCallback((fc) => {
    fabricRef.current = fc;
    setZoom(fc.getZoom());
    setCanvasVersion((v) => v + 1);
  }, []);

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
  }, [refreshLayers, scheduleSaveCanvas]);

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
    const text = new fabric.IText('Edit me', {
      left: 100,
      top: 100,
      fontSize: 48,
      fontFamily: 'Inter, sans-serif',
      fill: '#1e211e',
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
  }, [refreshLayers, scheduleSaveCanvas]);

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
  }, [refreshLayers, scheduleSaveCanvas]);

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
  }, [refreshLayers, scheduleSaveCanvas]);

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
    setSelectedObj((prev) => (prev && prev._id === id ? { ...prev, ...props } : prev));
  }, [refreshLayers, scheduleSaveCanvas]);

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
    // Canva-style: scale the frame itself so the white page grows/shrinks
    fc.setZoom(next);
    fc.setWidth(dims.w * next);
    fc.setHeight(dims.h * next);
    fc.setViewportTransform([next, 0, 0, next, 0, 0]);
    fc.requestRenderAll();
    setZoom(next);
  }, [dims]);

  const handleZoomOut = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const next = Math.max(fc.getZoom() / 1.2, 0.05);
    fc.setZoom(next);
    fc.setWidth(dims.w * next);
    fc.setHeight(dims.h * next);
    fc.setViewportTransform([next, 0, 0, next, 0, 0]);
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
        for (const obj of objects) fc.add(obj);
        fc.renderAll();
        refreshLayers();
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
    const dataUrl = fc.toDataURL({ format: 'png', multiplier: 2, quality: 1 });
    downloadFile(dataUrl, 'design.png');
  }, [downloadFile]);

  const handleExportSvg = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const svg = fc.toSVG();
    downloadFile(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 'design.svg');
  }, [downloadFile]);

  const handleClear = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (!window.confirm('Clear all layers?')) return;
    fc.clear();
    fc.backgroundColor = '#ffffff';
    fc.renderAll();
    refreshLayers();
    scheduleSaveCanvas();
  }, [refreshLayers, scheduleSaveCanvas]);

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
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        addText();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        addRect();
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        addCircle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObj, handleDeleteLayer, addText, addRect, addCircle]);

  const handleSizeChange = useCallback((size) => {
    setCanvasSize(size);
  }, []);

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
      }
    }, 50);
  }, [activePageIdx, design?.id, onPatch, refreshLayers]);

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
    if (onPatch && design?.id && pages.length > 1) {
      onPatch(design.id, { canvasJson: { pages, activeIdx: idx } });
    }
  }, [activePageIdx, pages, design?.id, onPatch, refreshLayers]);

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
  }, [activePageIdx]);

  const handleDeletePage = useCallback((idx) => {
    if (pages.length <= 1) {
      // Single page: just clear
      const fc = fabricRef.current;
      if (fc) {
        fc.clear();
        fc.backgroundColor = '#ffffff';
        fc.renderAll();
        refreshLayers();
      }
      return;
    }
    setPages((prev) => prev.filter((_, i) => i !== idx));
    if (activePageIdx >= idx && activePageIdx > 0) {
      setActivePageIdx(activePageIdx - 1);
    } else if (activePageIdx >= pages.length - 1) {
      setActivePageIdx(pages.length - 2);
    }
  }, [pages.length, activePageIdx, refreshLayers]);

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
        onUndo={() => {}}
        onRedo={() => {}}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onClear={handleClear}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
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
        <div className="design-sidebar">
          <div className="design-sidebar-tabs">
            <button className={`design-sidebar-tab ${activePanel === 'layers' ? 'active' : ''}`} onClick={() => setActivePanel('layers')}>Layers</button>
            <button className={`design-sidebar-tab ${activePanel === 'ai' ? 'active' : ''}`} onClick={() => setActivePanel('ai')}>AI</button>
            <button className={`design-sidebar-tab ${activePanel === 'properties' ? 'active' : ''}`} onClick={() => setActivePanel('properties')}>Props</button>
          </div>
          <div className="design-sidebar-content">
            {activePanel === 'layers' && <LayerPanel layers={layers} onReorder={handleReorder} onSelect={handleSelectLayer} selectedId={selectedObj?._id} onDelete={handleDeleteLayer} onDuplicate={handleDuplicateLayer} onToggleVisible={handleToggleVisible} onToggleLock={handleToggleLock} />}
            {activePanel === 'ai' && <AIGeneratePanel onGenerate={handleGenerate} generating={generating} />}
            {activePanel === 'properties' && <ObjectPanel selectedObj={selectedObj} onUpdate={handleUpdateObject} />}
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

function ObjectPanel({ selectedObj, onUpdate }) {
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
          </div>
          <div className="op-section">
            <div className="op-field">
              <span className="op-field-label">Font size</span>
              <input className="op-input" type="number" value={selectedObj.fontSize || 48} onChange={(e) => update('fontSize', Number(e.target.value))} />
            </div>
          </div>
        </>
      )}

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
          <input className="op-color" type="color" value={selectedObj.fill || '#000000'} onChange={(e) => update('fill', e.target.value)} />
        </div>
      </div>

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

      <div className="op-section">
        <div className="op-field">
          <span className="op-field-label">Rotation {Math.round(selectedObj.angle ?? 0)}°</span>
          <input type="range" min="0" max="360" value={selectedObj.angle ?? 0} onChange={(e) => update('angle', Number(e.target.value))} />
        </div>
      </div>
    </div>
  );
}
