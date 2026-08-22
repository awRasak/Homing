import { useEffect, useRef, useState } from 'react';
import {
  renderAllPages,
  extractPalette,
  sampleColorAtPixel,
  cropCanvasRegion,
  detectLogoRegion,
} from '../lib/pdfExtract';
import { outcomeLabel } from '../lib/googleFonts';
import { api } from '../api';

const DISPLAY_MAX_WIDTH = 760;

/**
 * Upload + render + extraction UI. Calls onExtracted(bundle) once analysis
 * of a newly uploaded file completes; bundle contains whatever could be
 * derived (palette, fonts, content, notes). Logo cropping calls
 * onLogoExtracted(dataUrl) separately since it's a manual user action.
 */
export default function ImportPanel({ file, onExtracted, onLogoExtracted, onAccentPicked, designId }) {
  const [canvas, setCanvas] = useState(null);
  const [imgSrc, setImgSrc] = useState(null);
  const [palette, setPalette] = useState([]);
  const [selectedAccent, setSelectedAccent] = useState(null);
  const [fontInfo, setFontInfo] = useState(null);
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | analyzing | done | error
  const [error, setError] = useState('');

  const [cropMode, setCropMode] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragRect, setDragRect] = useState(null);
  const [detectedLogo, setDetectedLogo] = useState(null);
  const [logoUseDetected, setLogoUseDetected] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setStatus('analyzing');
    setError('');
    setNotes([]);
    setFontInfo(null);

    (async () => {
      try {
        const allPages = await renderAllPages(file);
        if (cancelled) return;

        const firstPage = allPages[0];
        setCanvas(firstPage.canvas);
        setImgSrc(firstPage.dataUrl);

        const swatches = extractPalette(firstPage.canvas);
        setPalette(swatches);

        const logoRegion = detectLogoRegion(firstPage.canvas);
        setDetectedLogo(logoRegion);
        setLogoUseDetected(false);

        let content = firstPage.content;
        let fonts = firstPage.fonts;
        if (fonts) setFontInfo(fonts);

        setStatus('done');
        if (!cancelled) {
          onExtracted?.({
            palette: swatches,
            content,
            fonts,
            notes: content?.notes || [],
            pages: allPages,
            sourceImage: {
              dataUrl: firstPage.dataUrl,
              width: firstPage.width,
              height: firstPage.height,
            },
            blocks: firstPage.blocks,
          });
          // Upload raw PDF to server for structural export
          if (designId && file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
            try {
              const arrayBuf = await file.arrayBuffer();
              await api.uploadSourcePdf(designId, new Blob([arrayBuf], { type: 'application/pdf' }));
            } catch (e) {
              console.warn('Failed to upload source PDF to server:', e);
            }
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.message || 'Failed to read this file.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function displayToCanvasCoords(clientX, clientY) {
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function handleImageClick(e) {
    if (cropMode || !canvas) return;
    const { x, y } = displayToCanvasCoords(e.clientX, e.clientY);
    const hex = sampleColorAtPixel(canvas, x, y);
    setSelectedAccent(hex);
    onAccentPicked?.(hex);
  }

  function handleDragStart(e) {
    if (!cropMode) return;
    const rect = imgRef.current.getBoundingClientRect();
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragRect(null);
  }
  function handleDragMove(e) {
    if (!cropMode || !dragStart) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDragRect({
      left: Math.min(dragStart.x, x),
      top: Math.min(dragStart.y, y),
      width: Math.abs(x - dragStart.x),
      height: Math.abs(y - dragStart.y),
    });
  }
  function handleDragEnd() {
    setDragStart(null);
  }

  function useLogoSelection() {
    if (!dragRect || !canvas || dragRect.width < 4 || dragRect.height < 4) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dataUrl = cropCanvasRegion(
      canvas,
      dragRect.left * scaleX,
      dragRect.top * scaleY,
      dragRect.width * scaleX,
      dragRect.height * scaleY
    );
    onLogoExtracted?.(dataUrl);
    setCropMode(false);
    setDragRect(null);
    setLogoUseDetected(false);
  }

  function useDetectedLogo() {
    if (!detectedLogo || !canvas) return;
    const dataUrl = cropCanvasRegion(canvas, detectedLogo.x, detectedLogo.y, detectedLogo.width, detectedLogo.height);
    onLogoExtracted?.(dataUrl);
    setLogoUseDetected(true);
    setCropMode(false);
    setDragRect(null);
  }

  if (!file) return null;

  return (
    <div className="import-panel">
        {status === 'analyzing' && <p className="import-status">Reading design…</p>}
      {status === 'error' && <p className="import-status import-error">{error}</p>}

      {imgSrc && (
        <div className="import-render">
          <div
            className={`import-canvas-wrap ${cropMode ? 'crop-mode' : ''}`}
            style={{ maxWidth: DISPLAY_MAX_WIDTH }}
          >
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Uploaded design preview"
              style={{ width: '100%', display: 'block', cursor: cropMode ? 'crosshair' : 'crosshair' }}
              onClick={handleImageClick}
              onMouseDown={handleDragStart}
              onMouseMove={handleDragMove}
              onMouseUp={handleDragEnd}
              draggable={false}
            />
            {dragRect && (
              <div
                className="crop-rect"
                style={{
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                }}
              />
            )}
            {detectedLogo && !cropMode && !logoUseDetected && (
              <div
                className="logo-detect-rect"
                style={{
                  left: `${(detectedLogo.x / canvas.width) * 100}%`,
                  top: `${(detectedLogo.y / canvas.height) * 100}%`,
                  width: `${(detectedLogo.width / canvas.width) * 100}%`,
                  height: `${(detectedLogo.height / canvas.height) * 100}%`,
                }}
              />
            )}
          </div>

          <div className="import-controls">
            <div className="import-field-label">Accent color</div>
            <div className="swatch-row">
              {palette.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`swatch ${selectedAccent === hex ? 'swatch-selected' : ''}`}
                  style={{ background: hex }}
                  title={hex}
                  onClick={() => {
                    setSelectedAccent(hex);
                    onAccentPicked?.(hex);
                  }}
                />
              ))}
              {palette.length === 0 && <span className="hint-text">No strong accent colors detected — click anywhere on the design to sample one.</span>}
            </div>
            <p className="hint-text">Or click anywhere on the design above to sample that exact pixel.</p>

            <div className="import-field-label" style={{ marginTop: '0.75rem' }}>Logo</div>
            {!cropMode ? (
              <div className="logo-actions">
                <button type="button" className="btn-secondary" onClick={() => setCropMode(true)}>
                  Select logo region
                </button>
                {detectedLogo && !logoUseDetected && (
                  <button type="button" className="btn-secondary" onClick={useDetectedLogo}>
                    Use detected logo
                  </button>
                )}
                {logoUseDetected && <span className="hint-text">Detected logo applied ✓</span>}
              </div>
            ) : (
              <div className="crop-actions">
                <span className="hint-text">Drag a box over the logo, then confirm.</span>
                <button type="button" className="btn-secondary" onClick={useLogoSelection} disabled={!dragRect}>
                  Use selection
                </button>
                <button type="button" className="btn-text" onClick={() => { setCropMode(false); setDragRect(null); }}>
                  Cancel
                </button>
              </div>
            )}

            {fontInfo && (
              <>
                <div className="import-field-label" style={{ marginTop: '0.75rem' }}>Font detection</div>
                {fontInfo ? (
                  <ul className="font-report">
                    <li>
                      Headline: <strong>{fontInfo.headline.family}</strong> — {outcomeLabel(fontInfo.headline.outcome)}
                      {fontInfo.headline.outcome !== 'exact' && ` (detected "${fontInfo.headline.detectedName}")`}
                    </li>
                    <li>
                      Body: <strong>{fontInfo.body.family}</strong> — {outcomeLabel(fontInfo.body.outcome)}
                      {fontInfo.body.outcome !== 'exact' && ` (detected "${fontInfo.body.detectedName}")`}
                    </li>
                  </ul>
                ) : (
                  <p className="hint-text">No embedded text found to detect fonts from.</p>
                )}
              </>
            )}

            {notes.length > 0 && (
              <>
                <div className="import-field-label" style={{ marginTop: '0.75rem' }}>What was auto-filled</div>
                <ul className="extraction-notes">
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
