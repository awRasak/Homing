import { useState } from 'react';
import { CURATED_GOOGLE_FONTS } from '../lib/googleFonts';

export default function SetupGapsModal({ gaps, onConfirm, onClose, accountLogoUrl, companyName }) {
  const fallbackHeadline = gaps.detectedHeadline && CURATED_GOOGLE_FONTS.includes(gaps.detectedHeadline) ? gaps.detectedHeadline : 'Inter';
  const fallbackBody = gaps.detectedBody && CURATED_GOOGLE_FONTS.includes(gaps.detectedBody) ? gaps.detectedBody : 'Roboto';
  const [headlineFont, setHeadlineFont] = useState(fallbackHeadline);
  const [bodyFont, setBodyFont] = useState(fallbackBody);
  const [selectedLogoId, setSelectedLogoId] = useState(null);
  const [uploadedLogo, setUploadedLogo] = useState(null);
  const knownCompany = companyName || gaps.companyName || 'your company';

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedLogo(reader.result);
      setSelectedLogoId(null);
    };
    reader.readAsDataURL(file);
  }

  function handleConfirm() {
    const logoDataUrl =
      uploadedLogo ?? gaps.logoCandidates.find((l) => l.id === selectedLogoId)?.dataUrl ?? null;
    onConfirm({
      headlineFont: gaps.needsFontConfirmation ? headlineFont : null,
      bodyFont: gaps.needsFontConfirmation ? bodyFont : null,
      logoDataUrl,
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="setup-gaps-modal" onClick={(e) => e.stopPropagation()}>
        <h3>A couple of things we couldn't detect</h3>
        <p className="modal-subtext">
          {gaps.needsFontConfirmation &&
            "This PDF's fonts aren't embedded with recoverable names — pick the closest match."}
        {gaps.needsFontConfirmation && gaps.needsLogoSelection && ' '}
        {gaps.needsLogoSelection && `Also, which of these is ${knownCompany}'s logo?`}
        </p>

        {gaps.needsFontConfirmation && (
          <div className="modal-field">
            <label htmlFor="gap-headline-font">Headline font
              {gaps.headlineDetectedName && <span className="hint-text" style={{ marginLeft: 8, fontWeight: 400 }}>detected: {gaps.headlineDetectedName} ({gaps.headlineOutcome})</span>}
            </label>
            <input
              id="gap-headline-font"
              list="headline-font-list"
              value={headlineFont}
              onChange={(e) => setHeadlineFont(e.target.value)}
              placeholder="Type or pick a Google Font"
            />
            <datalist id="headline-font-list">
              {CURATED_GOOGLE_FONTS.map((f) => <option key={f} value={f} />)}
            </datalist>

            <label htmlFor="gap-body-font" style={{ marginTop: 12 }}>Body font
              {gaps.bodyDetectedName && <span className="hint-text" style={{ marginLeft: 8, fontWeight: 400 }}>detected: {gaps.bodyDetectedName} ({gaps.bodyOutcome})</span>}
            </label>
            <input
              id="gap-body-font"
              list="body-font-list"
              value={bodyFont}
              onChange={(e) => setBodyFont(e.target.value)}
              placeholder="Type or pick a Google Font"
            />
            <datalist id="body-font-list">
              {CURATED_GOOGLE_FONTS.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
        )}

        {gaps.needsLogoSelection && (
          <div className="modal-field">
            <label>{knownCompany}'s logo</label>
            {accountLogoUrl ? (
              <div className="account-logo-card">
                <img src={accountLogoUrl} alt={`${knownCompany} logo`} />
                <div className="account-logo-meta">
                  <strong>Using the {knownCompany} logo from this design</strong>
                  <span>Pick a different one below if this PDF has a new mark.</span>
                </div>
              </div>
            ) : (
              <p className="hint-text" style={{ margin: '-2px 0 6px', lineHeight: 1.4 }}>
                We found {gaps.logoCandidates.length || 'a few'} small images near the top of the PDF.
                Pick the one that's {knownCompany}'s logo — the company you're pitching — or upload it.
              </p>
            )}
            {gaps.logoCandidates.length > 0 && (
              <div className="logo-candidate-grid">
                {gaps.logoCandidates.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    className={`logo-candidate ${selectedLogoId === img.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedLogoId(img.id);
                      setUploadedLogo(null);
                    }}
                    title="Click to select"
                  >
                    <img src={img.dataUrl} alt="Logo candidate" />
                  </button>
                ))}
              </div>
            )}
            <label className="logo-upload-tile">
              <input type="file" accept="image/*" onChange={handleUpload} />
              <span className="logo-upload-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <span className="logo-upload-copy">
                <strong>{accountLogoUrl ? 'Use a different logo' : `Upload ${knownCompany}'s logo`}</strong>
                <span>PNG, JPG or SVG — for the company this proposal is going to.</span>
              </span>
            </label>
            {uploadedLogo && (
              <div className="logo-preview-row">
                <img className="logo-preview" src={uploadedLogo} alt={`${knownCompany} logo`} />
                <div className="logo-preview-meta">
                  <strong>New logo ready</strong>
                  <button type="button" className="logo-remove-btn" onClick={() => setUploadedLogo(null)}>
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Skip for now</button>
          <button type="button" className="btn-primary" onClick={handleConfirm}>Save &amp; continue</button>
        </div>
      </div>
    </div>
  );
}
