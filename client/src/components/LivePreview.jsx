import { useState } from 'react';

export default function LivePreview({ design, onOverride }) {
  const [focusedId, setFocusedId] = useState(null);
  const { sourceImageDataUrl, sourceImageWidth, sourceImageHeight, sourceTextBlocks = [], textOverrides = {} } = design;

  function commit(block, el) {
    const newText = el.textContent;
    const wasOverridden = Object.prototype.hasOwnProperty.call(textOverrides, block.id);
    if (newText !== block.text || wasOverridden) {
      onOverride(block.id, newText);
    }
  }

  return (
    <div id="proposal-preview" className="live-preview-wrap">
      <img src={sourceImageDataUrl} alt="Uploaded design" className="live-preview-img" draggable={false} />
      {sourceTextBlocks.map((block) => {
        const overridden = Object.prototype.hasOwnProperty.call(textOverrides, block.id);
        const text = overridden ? textOverrides[block.id] : block.text;
        const reveal = overridden || focusedId === block.id;

        return (
          <div
            key={block.id}
            className="live-preview-block"
            style={{
              left: `${(block.x / sourceImageWidth) * 100}%`,
              top: `${(block.y / sourceImageHeight) * 100}%`,
              width: `${(block.width / sourceImageWidth) * 100}%`,
              minHeight: `${(block.height / sourceImageHeight) * 100}%`,
              fontSize: `${(block.height / sourceImageWidth) * 100}cqw`,
              color: reveal ? block.fg : 'transparent',
              background: reveal ? block.bg : 'transparent',
              zIndex: reveal ? 2 : 1,
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
