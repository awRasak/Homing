import { useRef } from 'react';

export default function OnboardingModal({ onUpload, onSkip }) {
  const fileInputRef = useRef(null);

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2>Set up this design</h2>
        <p className="modal-copy">
          Upload an existing proposal (PDF or image) and Homing will pull your branding, fonts,
          and copy straight from it — or start blank and fill things in yourself.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload a design
          </button>
          <button type="button" className="btn-text" onClick={onSkip}>
            Skip for now
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
