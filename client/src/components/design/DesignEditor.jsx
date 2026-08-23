import { useRef, useState, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import DesignCanvas, { CANVAS_SIZES } from './DesignCanvas';
import LayerPanel from './LayerPanel';
import AIGeneratePanel from './AIGeneratePanel';
import DesignToolbar from './DesignToolbar';

export default function DesignEditor() {
  const fabricRef = useRef(null);
  const idCounter = useRef(0);
  const [canvasSize, setCanvasSize] = useState('instagram-post');
  const [layers, setLayers] = useState([]);
  const [selectedObj, setSelectedObj] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [activePanel, setActivePanel] = useState('layers');
  const [zoom, setZoom] = useState(1);
  const [commandInput, setCommandInput] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);

  const dims = CANVAS_SIZES[canvasSize];

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
  }, []);

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

  const addImage = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const url = window.prompt('Enter image URL:');
    if (!url) return;
    fabric.FabricImage.fromURL(url)
      .then((img) => {
        img.set({ _id: genId(), name: 'Image' });
        const maxW = dims.w * 0.6;
        const maxH = dims.h * 0.6;
        const scale = Math.min(maxW / img.width, maxH / img.height);
        img.scaleToWidth(maxW);
        if (img.scaleY > scale) img.scaleToHeight(maxH);
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
  }, [refreshLayers]);

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
  }, [refreshLayers]);

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
  }, [refreshLayers]);

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
    setSelectedObj((prev) => (prev && prev._id === id ? { ...prev, ...props } : prev));
  }, [refreshLayers]);

  const handleGenerate = useCallback(async (prompt, negative) => {
    const fc = fabricRef.current;
    if (!fc || !prompt.trim()) return;
    setGenerating(true);
    let blobUrl = null;
    try {
      let fullPrompt = prompt.trim();
      if (negative && negative.trim()) fullPrompt += `, avoid: ${negative.trim()}`;
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?model=flux&width=${dims.w}&height=${dims.h}&nologo=true&seed=${Math.floor(Math.random() * 2147483647)}`;
      const res = await fetch(url);
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
    const center = fc.getCenterPoint();
    fc.zoomToPoint(center, Math.min(fc.getZoom() * 1.2, 5));
    setZoom(fc.getZoom());
  }, []);

  const handleZoomOut = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const center = fc.getCenterPoint();
    fc.zoomToPoint(center, Math.max(fc.getZoom() / 1.2, 0.05));
    setZoom(fc.getZoom());
  }, []);

  const handleZoomFit = useCallback(() => {
    const fc = fabricRef.current;
    const container = fc?.lowerCanvasEl?.parentElement?.parentElement;
    if (!fc) return;
    const cw = container ? container.clientWidth - 40 : dims.w;
    const ch = container ? container.clientHeight - 40 : dims.h;
    const scale = Math.min(cw / dims.w, ch / dims.h, 1);
    fc.setViewportTransform([scale, 0, 0, scale, 0, 0]);
    fc.setWidth(dims.w * scale);
    fc.setHeight(dims.h * scale);
    fc.renderAll();
    setZoom(scale);
  }, [dims]);

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
  }, [refreshLayers]);

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
        onDelete={() => selectedObj && handleDeleteLayer(selectedObj._id)}
        onUndo={() => {}}
        onRedo={() => {}}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onClear={handleClear}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
      />
      <div className="design-main">
        <div className="design-canvas-area">
          <DesignCanvas
            key={canvasSize}
            canvasSize={canvasSize}
            onCanvasReady={handleCanvasReady}
            onObjectSelected={handleObjectSelected}
            onLayersChanged={refreshLayers}
          />
          <div className="design-zoom-controls">
            <button type="button" className="design-zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
            <span className="design-zoom-level">{Math.round(zoom * 100)}%</span>
            <button type="button" className="design-zoom-btn" onClick={handleZoomOut} title="Zoom out">−</button>
            <button type="button" className="design-zoom-btn" onClick={handleZoomFit} title="Fit to screen">⊞</button>
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
    </div>
  );
}

function ObjectPanel({ selectedObj, onUpdate }) {
  if (!selectedObj) {
    return <div className="object-panel"><p className="panel-empty">Select an object to edit its properties.</p></div>;
  }

  const update = (key, value) => onUpdate(selectedObj._id, { [key]: value });

  return (
    <div className="object-panel">
      <div className="panel-header">
        <span>{selectedObj.name || selectedObj.type}</span>
      </div>

      {(selectedObj.type === 'i-text' || selectedObj.type === 'textbox' || selectedObj.type === 'text') && (
        <>
          <label className="panel-field">
            <span>Text</span>
            <textarea value={selectedObj.text || ''} onChange={(e) => update('text', e.target.value)} rows={3} />
          </label>
          <label className="panel-field">
            <span>Font size</span>
            <input type="number" value={selectedObj.fontSize || 48} onChange={(e) => update('fontSize', Number(e.target.value))} />
          </label>
        </>
      )}

      <label className="panel-field">
        <span>Fill</span>
        <input type="color" value={selectedObj.fill || '#000000'} onChange={(e) => update('fill', e.target.value)} />
      </label>

      <div className="panel-row">
        <label className="panel-field">
          <span>X</span>
          <input type="number" value={selectedObj.left ?? 0} onChange={(e) => update('left', Number(e.target.value))} />
        </label>
        <label className="panel-field">
          <span>Y</span>
          <input type="number" value={selectedObj.top ?? 0} onChange={(e) => update('top', Number(e.target.value))} />
        </label>
      </div>

      <div className="panel-row">
        <label className="panel-field">
          <span>Width</span>
          <input type="number" value={selectedObj.width ?? 0} onChange={(e) => update('width', Number(e.target.value))} />
        </label>
        <label className="panel-field">
          <span>Height</span>
          <input type="number" value={selectedObj.height ?? 0} onChange={(e) => update('height', Number(e.target.value))} />
        </label>
      </div>

      <label className="panel-field">
        <span>Rotation</span>
        <input type="range" min="0" max="360" value={selectedObj.angle ?? 0} onChange={(e) => update('angle', Number(e.target.value))} />
      </label>
    </div>
  );
}
