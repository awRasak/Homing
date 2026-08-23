import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { api } from '../api';

const DISPLAY_MAX_WIDTH = 760;

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

export default function ImportPanel({ file, onExtracted, designId, onComplete }) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [extractedPages, setExtractedPages] = useState(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;

    renderQuickPreview(file).then((src) => {
      if (!cancelled && src) setPreviewSrc(src);
    }).catch(() => {});

    setStatus('analyzing');
    setError('');

    (async () => {
      try {
        const { renderAllPages } = await import('../lib/pdfExtract');
        const allPages = await renderAllPages(file);
        if (cancelled) return;

        const firstPage = allPages[0];
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

        if (designId && file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
          try {
            const arrayBuf = await file.arrayBuffer();
            await api.uploadSourcePdf(designId, new Blob([arrayBuf], { type: 'application/pdf' }));
          } catch (e) {
            console.warn('Failed to upload source PDF to server:', e);
          }
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
        <div className="import-preview-loading">
          {previewSrc ? (
            <div className="import-preview-thumb">
              <img src={previewSrc} alt="PDF preview" />
              <div className="import-preview-overlay">
                <div className="import-preview-spinner" />
                <div className="import-preview-label">Reading design…</div>
              </div>
            </div>
          ) : (
            <div className="import-preview-skeleton">
              <div className="import-preview-spinner" />
              <div className="import-preview-label">Loading preview…</div>
            </div>
          )}
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
            Design read — check the preview, pick a color, then continue.
          </div>
        </div>
      )}
      {status === 'error' && <p className="import-status import-error">{error}</p>}
    </div>
  );
}
