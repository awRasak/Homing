import { useRef, useState, useEffect } from 'react';
import { CURATED_GOOGLE_FONTS, ensureGoogleFontLoaded } from '../lib/googleFonts';

export default function SetupForm({ design, onChange, importFile, onImportFile }) {
  const fileInputRef = useRef(null);
  const heroInputRef = useRef(null);
  const [saved, setSaved] = useState(false);

  function set(field, value) {
    onChange({ [field]: value });
  }

  function addSection() {
    onChange({ staticSections: [...(design.staticSections || []), { heading: '', body: '' }] });
  }
  function updateSection(index, patch) {
    const next = [...design.staticSections];
    next[index] = { ...next[index], ...patch };
    onChange({ staticSections: next });
  }
  function removeSection(index) {
    const next = design.staticSections.filter((_, i) => i !== index);
    onChange({ staticSections: next });
  }

  function handleHeroFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('heroImageDataUrl', reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  useEffect(() => {
    ensureGoogleFontLoaded(design.headlineFont);
  }, [design.headlineFont]);

  useEffect(() => {
    ensureGoogleFontLoaded(design.bodyFont);
  }, [design.bodyFont]);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="setup-form">
      <section className="form-section">
        <label className="field">
          <span>Sender name *</span>
          <input value={design.senderName} onChange={(e) => set('senderName', e.target.value)} placeholder="Jordan Ellis" />
        </label>
        <label className="field">
          <span>Tagline / contact line</span>
          <input value={design.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="jordan@studio.co · studio.co" />
        </label>
      </section>

      <section className="form-section">
        <label className="field">
          <span>Accent color</span>
          <div className="color-field-lg">
            <div className="color-preview-lg" style={{ background: design.accentColor }} />
            <input type="color" value={design.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="color-picker-hidden" />
            <input
              className="color-hex-input"
              value={design.accentColor}
              onChange={(e) => set('accentColor', e.target.value)}
            />
          </div>
        </label>
        <label className="field">
          <span>Logo</span>
          {design.logoDataUrl ? (
            <div className="logo-preview">
              <img src={design.logoDataUrl} alt="Logo" />
              <button type="button" className="btn-text" onClick={() => set('logoDataUrl', null)}>Remove</button>
            </div>
          ) : (
            <span className="hint-text">Extract one from an uploaded design below.</span>
          )}
        </label>
      </section>

      <section className="form-section">
        <div className="field-row">
          <label className="field">
            <span>Headline font</span>
            <select value={design.headlineFont} onChange={(e) => set('headlineFont', e.target.value)}>
              {CURATED_GOOGLE_FONTS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <span className="font-preview" style={{ fontFamily: `"${design.headlineFont}", sans-serif` }}>
              Aa Bb Cc
            </span>
          </label>
          <label className="field">
            <span>Body font</span>
            <select value={design.bodyFont} onChange={(e) => set('bodyFont', e.target.value)}>
              {CURATED_GOOGLE_FONTS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <span className="font-preview" style={{ fontFamily: `"${design.bodyFont}", sans-serif` }}>
              Aa Bb Cc
            </span>
          </label>
        </div>
      </section>

      <section className="form-section">
        <h3>Your writing tone</h3>
        <p className="hint-text">Paste an example of how you write — AI will match this tone.</p>
        <textarea
          rows={4}
          value={design.styleSample}
          onChange={(e) => set('styleSample', e.target.value)}
          placeholder="Paste a paragraph of your own writing here…"
        />
      </section>

      <section className="form-section">
        <h3>Static sections</h3>
        <p className="hint-text">Content that appears unchanged in every proposal (Why us, process, pricing…).</p>
        {(design.staticSections || []).map((s, i) => (
          <div key={i} className="static-section-row">
            <input
              className="static-section-heading"
              value={s.heading}
              onChange={(e) => updateSection(i, { heading: e.target.value })}
              placeholder="Heading (e.g. Why us)"
            />
            <textarea
              rows={3}
              value={s.body}
              onChange={(e) => updateSection(i, { body: e.target.value })}
              placeholder="Section body…"
            />
            <button type="button" className="btn-text btn-danger" onClick={() => removeSection(i)}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={addSection}>+ Add section</button>

        <label className="field" style={{ marginTop: '1rem' }}>
          <span>Hero image (shared across every proposal)</span>
          {design.heroImageDataUrl ? (
            <div className="logo-preview">
              <img src={design.heroImageDataUrl} alt="Hero" />
              <button type="button" className="btn-text" onClick={() => set('heroImageDataUrl', null)}>Remove</button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => heroInputRef.current?.click()}>Upload hero image</button>
          )}
          <input
            ref={heroInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={handleHeroFile}
          />
        </label>
      </section>

      <section className="form-section">
        <h3>Import from an existing design</h3>
        <p className="hint-text">
          Upload a PDF or image to extract branding and copy. Re-uploading never overwrites fields you've already filled in.
        </p>
        <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
          {importFile ? 'Upload a different file' : 'Upload a design'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = '';
          }}
        />
      </section>

      <div className="setup-save-bar">
        <button type="button" className="btn-primary setup-save-btn" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save setup'}
        </button>
      </div>
    </div>
  );
}
