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

export default function ImportPanel({ file, onExtracted, designId, onComplete }) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [extractedPages, setExtractedPages] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());

  useEffect(() => {
    if (!file) return;
    let cancelled = false;

    // Step 0: quick preview
    setActiveStep(0);
    renderQuickPreview(file).then((src) => {
      if (!cancelled && src) setPreviewSrc(src);
      if (!cancelled) {
        setCompletedSteps(prev => new Set([...prev, 0]));
        setActiveStep(1);
      }
    }).catch(() => {
      if (!cancelled) {
        setCompletedSteps(prev => new Set([...prev, 0]));
        setActiveStep(1);
      }
    });

    setStatus('analyzing');
    setError('');

    (async () => {
      try {
        // Step 1: extract
        setActiveStep(1);
        const { renderAllPages } = await import('../lib/pdfExtract');
        if (cancelled) return;
        setCompletedSteps(prev => new Set([...prev, 1]));

        // Step 2: render pages
        setActiveStep(2);
        const allPages = await renderAllPages(file);
        if (cancelled) return;
        setCompletedSteps(prev => new Set([...prev, 2]));

        // Step 3: analyze
        setActiveStep(3);
        const firstPage = allPages[0];
        await new Promise(r => setTimeout(r, 400)); // brief pause so user sees the step
        if (cancelled) return;
        setCompletedSteps(prev => new Set([...prev, 3]));

        setStatus('done');
        setExtractedPages(allPages);
        onExtracted?.({
          palette: [],
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

        // Step 4: upload source PDF
        if (designId && file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
          setActiveStep(4);
          try {
            const arrayBuf = await file.arrayBuffer();
            await api.uploadSourcePdf(designId, new Blob([arrayBuf], { type: 'application/pdf' }));
          } catch (e) {
            console.warn('Failed to upload source PDF to server:', e);
          }
          if (!cancelled) setCompletedSteps(prev => new Set([...prev, 4]));
        }

        onComplete?.();
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.message || 'Failed to read this file.');
          setStatus('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [file]);

  if (!file) return null;

  return (
    <div className="import-panel">
      {status === 'analyzing' && (
        <div className="import-loading-modal">
          <div className="import-loading-card">
            {previewSrc ? (
              <div className="import-loading-preview">
                <img src={previewSrc} alt="Preview" />
              </div>
            ) : (
              <div className="import-loading-preview import-loading-preview-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
            )}
            <div className="import-loading-body">
              <div className="import-loading-header">
                <div className="import-loading-filename">{file.name}</div>
                <div className="import-loading-filesize">{formatSize(file.size)}</div>
              </div>
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
      {status === 'done' && extractedPages && (
        <div className="import-preview-done">
          <div className="import-done-thumb">
            <img src={extractedPages[0].dataUrl} alt="Page 1" />
            {extractedPages.length > 1 && (
              <span className="import-done-badge">{extractedPages.length} pages</span>
            )}
          </div>
          {extractedPages.length > 1 && (
            <div className="import-done-strip">
              {extractedPages.slice(1).map((p) => (
                <img key={p.pageNum} src={p.dataUrl} alt={`Page ${p.pageNum}`} />
              ))}
            </div>
          )}
          <div className="import-status import-ok">
            Design read — editing your text now.
          </div>
        </div>
      )}
      {status === 'error' && <p className="import-status import-error">{error}</p>}
    </div>
  );
}
