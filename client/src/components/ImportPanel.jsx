import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { api } from '../api';

async function renderQuickPreview(file) {
  if (!file) return null;
  if (file.type && file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });
    const cvs = document.createElement('canvas');
    cvs.width = viewport.width;
    cvs.height = viewport.height;
    const ctx = cvs.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return cvs.toDataURL('image/jpeg', 0.7);
  }
  return null;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const STEPS = [
  { key: 'preview', label: 'Rendering preview' },
  { key: 'extract', label: 'Extracting text & structure' },
  { key: 'pages', label: 'Rendering pages' },
  { key: 'analyze', label: 'Analyzing design' },
  { key: 'upload', label: 'Saving to server' },
];

const MIN_STEP_MS = 350;

export default function ImportPanel({ file, onExtracted, designId, onComplete }) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [fading, setFading] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!file) return;
    cancelledRef.current = false;

    setStatus('analyzing');
    setError('');
    setActiveStep(0);
    setCompletedSteps(new Set());

    (async () => {
      try {
        // Step 0: render preview
        setActiveStep(0);
        const t0 = Date.now();
        let src = null;
        try { src = await renderQuickPreview(file); } catch { /* ok */ }
        if (cancelledRef.current) return;
        if (src) setPreviewSrc(src);
        // hold step 0 visible at least MIN_STEP_MS
        await new Promise(r => setTimeout(r, Math.max(0, MIN_STEP_MS - (Date.now() - t0))));
        if (cancelledRef.current) return;
        setCompletedSteps(prev => new Set([...prev, 0]));

        // Step 1: extract
        setActiveStep(1);
        const t1 = Date.now();
        const { renderAllPages } = await import('../lib/pdfExtract');
        if (cancelledRef.current) return;
        await new Promise(r => setTimeout(r, Math.max(0, MIN_STEP_MS - (Date.now() - t1))));
        if (cancelledRef.current) return;
        setCompletedSteps(prev => new Set([...prev, 1]));

        // Step 2: render pages
        setActiveStep(2);
        const t2 = Date.now();
        const allPages = await renderAllPages(file);
        if (cancelledRef.current) return;
        await new Promise(r => setTimeout(r, Math.max(0, MIN_STEP_MS - (Date.now() - t2))));
        if (cancelledRef.current) return;
        setCompletedSteps(prev => new Set([...prev, 2]));

        // Step 3: analyze
        setActiveStep(3);
        const t3 = Date.now();
        const firstPage = allPages[0];
        // Build palette from page 1 canvas so the Setup panel can show a real
        // accent even when the PDF uses images (not vector shapes) for colour.
        let palette = [];
        try {
          const { extractPalette } = await import('../lib/pdfExtract');
          if (firstPage?.canvas) palette = extractPalette(firstPage.canvas);
        } catch {}
        onExtracted?.({
          palette,
          content: firstPage.content,
          fonts: firstPage.fonts,
          notes: [],
          pages: allPages,
          sourceImage: {
            dataUrl: firstPage.dataUrl,
            width: firstPage.width,
            height: firstPage.height,
          },
          blocks: firstPage.blocks,
        });
        await new Promise(r => setTimeout(r, Math.max(0, MIN_STEP_MS - (Date.now() - t3))));
        if (cancelledRef.current) return;
        setCompletedSteps(prev => new Set([...prev, 3]));

        // Step 4: upload source PDF
        if (designId && file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
          setActiveStep(4);
          const t4 = Date.now();
          try {
            const arrayBuf = await file.arrayBuffer();
            await api.uploadSourcePdf(designId, new Blob([arrayBuf], { type: 'application/pdf' }));
          } catch (e) {
            console.warn('Failed to upload source PDF to server:', e);
          }
          await new Promise(r => setTimeout(r, Math.max(0, MIN_STEP_MS - (Date.now() - t4))));
          if (cancelledRef.current) return;
          setCompletedSteps(prev => new Set([...prev, 4]));
        } else {
          setActiveStep(4);
          setCompletedSteps(prev => new Set([...prev, 4]));
        }

        if (cancelledRef.current) return;

        // Show completed state before fading out
        setStatus('complete');
        await new Promise(r => setTimeout(r, 1200));
        if (cancelledRef.current) return;
        setFading(true);
        await new Promise(r => setTimeout(r, 400));
        onComplete?.();
      } catch (err) {
        console.error(err);
        if (!cancelledRef.current) {
          setError(err.message || 'Failed to read this file.');
          setStatus('error');
        }
      }
    })();

    return () => { cancelledRef.current = true; };
  }, [file]);

  if (!file) return null;

  const allDone = status === 'complete';
  const showModal = status === 'analyzing' || allDone;

  return (
    <div className={`import-panel ${fading ? 'import-panel-fade' : ''}`}>
      {showModal && (
        <div className="import-loading-modal">
          <div className="import-loading-card">
            {previewSrc ? (
              <div className="import-loading-preview">
                <img src={previewSrc} alt="Preview" />
                {allDone && <div className="import-loading-preview-overlay">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>}
              </div>
            ) : (
              <div className={`import-loading-preview import-loading-preview-placeholder ${allDone ? 'import-loading-preview-done' : ''}`}>
                {allDone ? (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                )}
              </div>
            )}
            <div className="import-loading-body">
              <div className="import-loading-header">
                <div className="import-loading-filename">{file.name}</div>
                <div className="import-loading-filesize">{formatSize(file.size)}</div>
              </div>

              {allDone && (
                <div className="import-loading-success">Design imported successfully</div>
              )}

              <div className="import-loading-steps">
                {STEPS.map((step, i) => {
                  const done = completedSteps.has(i);
                  const active = activeStep === i && !done;
                  return (
                    <div key={step.key} className={`import-step ${done ? 'import-step-done' : ''} ${active ? 'import-step-active' : ''}`}>
                      <div className="import-step-indicator">
                        {done ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : active ? (
                          <div className="import-step-spinner" />
                        ) : (
                          <div className="import-step-dot" />
                        )}
                      </div>
                      <span className="import-step-label">{step.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {status === 'error' && <p className="import-status import-error">{error}</p>}
    </div>
  );
}
