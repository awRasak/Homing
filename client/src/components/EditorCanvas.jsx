import { useState, useEffect, useRef, useCallback } from 'react';
import usePersistedState from '../hooks/usePersistedState';
import LivePreview from './LivePreview';
import ChatBar from './ChatBar';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
const PDF_RENDER_SCALE = 1.75;
const PT_TO_PX = 96 / 72;
const nativePageWidthPx = (renderedWidth) =>
  renderedWidth ? (renderedWidth / PDF_RENDER_SCALE) * PT_TO_PX : 793;
const nativePageHeightPx = (renderedHeight) =>
  renderedHeight ? (renderedHeight / PDF_RENDER_SCALE) * PT_TO_PX : 1123;

function PageRailThumb({ page, pageNumber, isActive, onClick }) {
  const activeRef = useRef(null);

  useEffect(() => {
    if (isActive) {
      activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  return (
    <button
      ref={isActive ? activeRef : null}
      className={`page-rail-thumb ${isActive ? 'active' : ''}`}
      onClick={() => onClick(pageNumber)}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={isActive}
    >
      <div className="page-rail-thumb-frame">
        <img
          src={page.dataUrl}
          alt={`Page ${pageNumber}`}
          draggable={false}
          className="page-rail-thumb-img"
        />
      </div>
      <span className="page-rail-thumb-number">{pageNumber}</span>
    </button>
  );
}

function CanvasChatBar({
  onGenerate,
  generating,
  recentCompanies,
  providers,
  activeProvider,
  genError,
}) {
  return (
    <div className="canvas-chat-bar no-print">
      <ChatBar
        onGenerate={onGenerate}
        generating={generating}
        recentCompanies={recentCompanies}
        providers={providers}
        activeProvider={activeProvider}
        genError={genError}
      />
    </div>
  );
}

export default function EditorCanvas({
  activeDesign,
  importFile,
  handleImportDone,
  handleExtracted,
  currentPage,
  setCurrentPage,
  handlePageTextOverride,
  handleTextOverride,
  generating,
  genError,
  providers,
  activeProvider,
  onGenerate,
  onRebrand,
  recentCompanies,
  currentProposal,
  handleExport,
}) {
  const viewportRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState('fit');
  const [pageRailCollapsed, setPageRailCollapsed] = usePersistedState(
    'proposal-editor:page-rail-collapsed',
    false
  );

  const pages = activeDesign?.pages || [];
  const isMultiPage = pages.length > 1;
  const activePage = pages[currentPage - 1];
  const nativeW = nativePageWidthPx(activePage?.width);
  const nativeH = nativePageHeightPx(activePage?.height);

  const calculateFitZoom = useCallback(() => {
    if (!viewportRef.current) return 1;
    const viewportWidth = viewportRef.current.clientWidth;
    const padding = 48;
    const fitZoom = (viewportWidth - padding) / nativeW;
    return clampZoom(fitZoom);
  }, [nativeW]);

  useEffect(() => {
    if (zoomMode !== 'fit') return;
    const recalc = () => setZoom(calculateFitZoom());
    recalc();
    const observer = new ResizeObserver(recalc);
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [zoomMode, calculateFitZoom]);

  return (
    <div className="editor-canvas">
      <div className="canvas-body">
        {/* Vertical collapsible page rail */}
        {isMultiPage && (
          <div className={`page-rail ${pageRailCollapsed ? 'collapsed' : ''}`}>
            <button
              className="page-rail-toggle"
              onClick={() => setPageRailCollapsed((c) => !c)}
              aria-label={pageRailCollapsed ? 'Expand pages panel' : 'Collapse pages panel'}
            >
              {pageRailCollapsed ? '\u203A' : '\u2039'}
            </button>

            {!pageRailCollapsed && (
              <div className="page-rail-list">
                {pages.map((page, i) => (
                  <PageRailThumb
                    key={page.pageNum || i}
                    page={page}
                    pageNumber={i + 1}
                    isActive={currentPage === i + 1}
                    onClick={setCurrentPage}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main preview area */}
        <div className="preview-area" ref={viewportRef}>
          {/* Zoom controls */}
          {isMultiPage && (
            <div className="zoom-controls no-print">
              <button
                type="button"
                className="zoom-nav-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                &#8249;
              </button>
              <span className="zoom-page-label">
                {currentPage} / {pages.length}
              </span>
              <button
                type="button"
                className="zoom-nav-btn"
                disabled={currentPage >= pages.length}
                onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
              >
                &#8250;
              </button>
              <div className="zoom-sep" />
              <button
                type="button"
                className="zoom-nav-btn"
                onClick={() => {
                  setZoomMode('manual');
                  setZoom((z) => clampZoom(z - 0.15));
                }}
              >
                &#8722;
              </button>
              <span
                className="zoom-label"
                onClick={() => setZoomMode('fit')}
                title="Click to fit width"
              >
                {zoomMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
              </span>
              <button
                type="button"
                className="zoom-nav-btn"
                onClick={() => {
                  setZoomMode('manual');
                  setZoom((z) => clampZoom(z + 0.15));
                }}
              >
                +
              </button>
              <button
                type="button"
                className={`zoom-fit-btn ${zoomMode === 'fit' ? 'active' : ''}`}
                onClick={() => setZoomMode('fit')}
              >
                Fit
              </button>
            </div>
          )}

          {/* Preview viewport */}
          <div className="preview-viewport-inner">
            <div
              className="preview-zoom-wrapper"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              {activeDesign?.sourceImageDataUrl && activePage && (
                <div
                  className="live-preview-wrap"
                  style={{
                    width: nativeW,
                    height: nativeH,
                    background: activePage.bgColor || activeDesign.backgroundColor || '#ffffff',
                  }}
                >
                  <LivePreview
                    sourceImageDataUrl={activePage.dataUrl}
                    sourceImageWidth={activePage.width}
                    sourceImageHeight={activePage.height}
                    sourceTextBlocks={activePage.blocks || []}
                    extractedImages={activePage.images || []}
                    shapes={activePage.shapes || []}
                    textOverrides={
                      (activeDesign.pageOverrides || {})[String(currentPage)] || {}
                    }
                    onOverride={(blockId, text) =>
                      handlePageTextOverride(currentPage, blockId, text)
                    }
                    headlineFont={activeDesign.headlineFont}
                    bodyFont={activeDesign.bodyFont}
                    backgroundColor={
                      activePage.bgColor || activeDesign.backgroundColor || '#ffffff'
                    }
                    pageNumber={currentPage}
                    totalPages={pages.length}
                  />
                </div>
              )}

              {/* Single-page / no-image fallback */}
              {!activePage && activeDesign?.sourceImageDataUrl && (
                <div
                  className="live-preview-wrap"
                  style={{
                    width: nativePageWidthPx(activeDesign.sourceImageWidth),
                    height: nativePageHeightPx(activeDesign.sourceImageHeight),
                    background: activeDesign.backgroundColor || '#ffffff',
                  }}
                >
                  <LivePreview
                    sourceImageDataUrl={activeDesign.sourceImageDataUrl}
                    sourceImageWidth={activeDesign.sourceImageWidth}
                    sourceImageHeight={activeDesign.sourceImageHeight}
                    sourceTextBlocks={activeDesign.sourceTextBlocks || []}
                    extractedImages={[]}
                    textOverrides={activeDesign.textOverrides || {}}
                    onOverride={handleTextOverride}
                    headlineFont={activeDesign.headlineFont}
                    bodyFont={activeDesign.bodyFont}
                    backgroundColor={activeDesign.backgroundColor || '#ffffff'}
                  />
                </div>
              )}
            </div>

            {/* Page label — outside the scale transform, stays crisp at any zoom */}
            {isMultiPage && (
              <div className="page-label-overlay no-print">
                Page {currentPage} of {pages.length}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Proposal actions */}
      {(currentProposal || onRebrand) && (
        <div className="proposal-actions no-print">
          {currentProposal && (
            <button type="button" className="btn-secondary" onClick={handleExport}>
              Download PDF
            </button>
          )}
          {onRebrand && (activeDesign?.pages?.length > 0 || activeDesign?.sourceTextBlocks?.length > 0) && (
            <button type="button" className="btn-secondary" onClick={onRebrand} title="Swap the recipient name and logo throughout">
              Rebrand for another company
            </button>
          )}
        </div>
      )}

      {/* Chat bar — scoped to canvas column only */}
      <CanvasChatBar
        onGenerate={onGenerate}
        generating={generating}
        recentCompanies={recentCompanies}
        providers={providers}
        activeProvider={activeProvider}
        genError={genError}
      />
    </div>
  );
}
