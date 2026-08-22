export default function ObjectPanel({ selectedObj, onUpdate }) {
  if (!selectedObj) {
    return (
      <div className="object-panel">
        <div className="object-panel-empty">Select an object on the canvas to edit its properties.</div>
      </div>
    );
  }

  function handleChange(key, value) {
    onUpdate(selectedObj._id, { [key]: value });
  }

  return (
    <div className="object-panel">
      <div className="op-section">
        <div className="op-label">Type</div>
        <div className="op-value">{selectedObj.type}</div>
      </div>

      {(selectedObj.type === 'i-text' || selectedObj.type === 'text') && (
        <div className="op-section">
          <div className="op-label">Text</div>
          <textarea
            className="op-input"
            value={selectedObj.text || ''}
            onChange={(e) => handleChange('text', e.target.value)}
            rows={2}
          />
          <div className="op-row">
            <div className="op-field">
              <label className="op-field-label">Size</label>
              <input className="op-input op-input-sm" type="number" value={selectedObj.fontSize || 48}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value) || 48)} />
            </div>
            <div className="op-field">
              <label className="op-field-label">Weight</label>
              <select className="op-input op-input-sm" value={selectedObj.fontWeight || 'normal'}
                onChange={(e) => handleChange('fontWeight', e.target.value)}>
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </div>
          <div className="op-field">
            <label className="op-field-label">Font</label>
            <select className="op-input" value={selectedObj.fontFamily || 'Inter, sans-serif'}
              onChange={(e) => handleChange('fontFamily', e.target.value)}>
              <option value="Inter, sans-serif">Inter</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Courier New, monospace">Courier New</option>
              <option value="Verdana, sans-serif">Verdana</option>
              <option value="Impact, sans-serif">Impact</option>
            </select>
          </div>
        </div>
      )}

      <div className="op-section">
        <div className="op-label">Color</div>
        <div className="op-row">
          <input className="op-color" type="color" value={selectedObj.fill || '#000000'}
            onChange={(e) => handleChange('fill', e.target.value)} />
          <input className="op-input" type="text" value={selectedObj.fill || ''}
            onChange={(e) => handleChange('fill', e.target.value)} />
        </div>
      </div>

      <div className="op-section">
        <div className="op-label">Position & Size</div>
        <div className="op-row">
          <div className="op-field">
            <label className="op-field-label">X</label>
            <input className="op-input op-input-sm" type="number" value={selectedObj.left || 0}
              onChange={(e) => handleChange('left', parseInt(e.target.value) || 0)} />
          </div>
          <div className="op-field">
            <label className="op-field-label">Y</label>
            <input className="op-input op-input-sm" type="number" value={selectedObj.top || 0}
              onChange={(e) => handleChange('top', parseInt(e.target.value) || 0)} />
          </div>
        </div>
        <div className="op-row">
          <div className="op-field">
            <label className="op-field-label">W</label>
            <input className="op-input op-input-sm" type="number" value={selectedObj.width || 0}
              onChange={(e) => {
                const newW = parseInt(e.target.value) || 0;
                const scaleX = newW / (selectedObj.width || 1);
                onUpdate(selectedObj._id, { scaleX });
              }} />
          </div>
          <div className="op-field">
            <label className="op-field-label">H</label>
            <input className="op-input op-input-sm" type="number" value={selectedObj.height || 0}
              onChange={(e) => {
                const newH = parseInt(e.target.value) || 0;
                const scaleY = newH / (selectedObj.height || 1);
                onUpdate(selectedObj._id, { scaleY });
              }} />
          </div>
        </div>
        <div className="op-field">
          <label className="op-field-label">Rotation</label>
          <input className="op-input" type="range" min="0" max="360" value={selectedObj.angle || 0}
            onChange={(e) => handleChange('angle', parseInt(e.target.value))} />
          <span className="op-rotation-val">{selectedObj.angle || 0}°</span>
        </div>
      </div>

      <div className="op-section">
        <div className="op-label">Name</div>
        <input className="op-input" type="text" value={selectedObj.name || ''}
          onChange={(e) => handleChange('name', e.target.value)} />
      </div>
    </div>
  );
}
