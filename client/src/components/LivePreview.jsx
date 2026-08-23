import { useState, useEffect } from 'react';

export default function LivePreview({ sourceImageDataUrl, sourceImageWidth, sourceImageHeight, sourceTextBlocks = [], textOverrides = {}, onOverride }) {
  const [focusedId, setFocusedId] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [sourceImageDataUrl]);

  function commit(block, el) {
    const newText = el.textContent;
    const wasOverridden = Object.prototype.hasOwnProperty.call(textOverrides, block.id);
    if (newText !== block.text || wasOverridden) {
      onOverride(block.id, newText);
    }
  }

  if (imgError || !sourceImageDataUrl) {
    return (
      <div id="proposal-preview" className="live-preview-wrap">
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
    <div id="proposal-preview" className="live-preview-wrap">
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

        return (
          <div
            key={block.id}
            className={`live-preview-block${isFocused ? ' focused' : ''}`}
            style={{
              left: `${(block.x / sourceImageWidth) * 100}%`,
              top: `${(block.y / sourceImageHeight) * 100}%`,
              width: `${(block.width / sourceImageWidth) * 100}%`,
              minHeight: `${(block.height / sourceImageHeight) * 100}%`,
              fontSize: `${(block.height / sourceImageWidth) * 100}cqw`,
              color: block.fg || '#000',
              background: isFocused ? (block.bg || 'rgba(255,255,255,0.85)') : 'transparent',
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
