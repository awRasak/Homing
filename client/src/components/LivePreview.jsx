import { useState, useEffect } from 'react';
import { ensureGoogleFontLoaded } from '../lib/googleFonts';

export default function LivePreview({ sourceImageDataUrl, sourceImageWidth, sourceImageHeight, sourceTextBlocks = [], textOverrides = {}, onOverride, headlineFont, bodyFont, backgroundColor = '#ffffff' }) {
  const [focusedId, setFocusedId] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [sourceImageDataUrl]);

  useEffect(() => {
    if (headlineFont) ensureGoogleFontLoaded(headlineFont);
    if (bodyFont) ensureGoogleFontLoaded(bodyFont);
  }, [headlineFont, bodyFont]);

  function commit(block, el) {
    const newText = el.textContent;
    const wasOverridden = Object.prototype.hasOwnProperty.call(textOverrides, block.id);
    if (newText !== block.text || wasOverridden) {
      onOverride(block.id, newText);
    }
  }

  if (imgError || !sourceImageDataUrl) {
    return (
      <div id="proposal-preview" className="live-preview-wrap" style={{ background: backgroundColor }}>
        <div className="live-preview-broken">
          <div className="live-preview-broken-icon">⚠</div>
          <div className="live-preview-broken-text">
            Page image failed to load. Re-import this design to fix.
          </div>
        </div>
      </div>
    );
  }

  return (
      <div id="proposal-preview" className="live-preview-wrap" style={{ background: backgroundColor }}>
      <img
        src={sourceImageDataUrl}
        alt="Uploaded design"
        className="live-preview-img"
        draggable={false}
        onError={() => setImgError(true)}
        onLoad={(e) => {
          if (e.target.naturalWidth === 0 || e.target.naturalHeight === 0) {
            setImgError(true);
          }
        }}
      />
      {sourceTextBlocks.map((block) => {
        const overridden = Object.prototype.hasOwnProperty.call(textOverrides, block.id);
        const text = overridden ? textOverrides[block.id] : block.text;
        const isFocused = focusedId === block.id;
        const isTitle = block.tier === 'title';
        const fontFamily = isTitle
          ? `"${headlineFont || 'Inter'}", sans-serif`
          : `"${bodyFont || 'Inter'}", sans-serif`;

        const charCount = Math.max(text.length, 1);
        const heightBased = block.height;
        const widthBased = block.width / (charCount * 0.6);
        const fontSizePx = Math.min(heightBased, widthBased);
        const fontSizeCqw = (fontSizePx / sourceImageWidth) * 100;

        return (
          <div
            key={block.id}
            className={`live-preview-block${isFocused ? ' focused' : ''}`}
            style={{
              left: `${(block.x / sourceImageWidth) * 100}%`,
              top: `${(block.y / sourceImageHeight) * 100}%`,
              width: `${(block.width / sourceImageWidth) * 100}%`,
              minHeight: `${(block.height / sourceImageHeight) * 100}%`,
              fontSize: `${fontSizeCqw}cqw`,
              fontFamily,
              fontWeight: isTitle ? 700 : 400,
              color: block.fg || '#000',
              background: isFocused ? (block.bg || 'rgba(255,255,255,0.85)') : 'transparent',
              lineHeight: 1.15,
            }}
            contentEditable
            suppressContentEditableWarning
            onFocus={() => setFocusedId(block.id)}
            onBlur={(e) => {
              setFocusedId(null);
              commit(block, e.currentTarget);
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}
