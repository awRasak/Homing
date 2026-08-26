import { useEffect, useRef, useState } from 'react';
import { CURATED_GOOGLE_FONTS, ensureGoogleFontLoaded } from '../lib/googleFonts';
import { api } from '../api';

const ADD_COLOR_DEFAULTS = ['#e11d48', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6'];

function pickFields(d) {
  const d2 = d || {};
  return {
    logoDataUrl: d2.logoDataUrl ?? null,
    logoVariations: d2.logoVariations ?? [],
    brandColors: d2.brandColors ?? [],
    accentColor: d2.accentColor ?? '#4f46e5',
    backgroundColor: d2.backgroundColor ?? '#ffffff',
    headlineFont: d2.headlineFont ?? 'Inter',
    bodyFont: d2.bodyFont ?? 'Inter',
    senderName: d2.senderName ?? '',
    tagline: d2.tagline ?? '',
    styleSample: d2.styleSample ?? '',
    staticSections: d2.staticSections ?? [],
  };
}

function nextDefaultColor(existing) {
  const free = ADD_COLOR_DEFAULTS.find((c) => !existing.includes(c));
  if (free) return free;
  let candidate;
  do {
    candidate = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
  } while (existing.includes(candidate));
  return candidate;
}

export default function BrandKit({ design, onPatch }) {
  const logoInputRef = useRef(null);
  const variationInputRef = useRef(null);
  const savedTimerRef = useRef(null);

  const [draft, setDraft] = useState(() => pickFields(design));
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const designId = design?.id;

  useEffect(() => {
    setDraft(pickFields(design));
    setSaveState('idle');
    // Re-initialize the draft when switching between designs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId]);

  useEffect(() => {
    if (design?.headlineFont) ensureGoogleFontLoaded(design.headlineFont);
    if (design?.bodyFont) ensureGoogleFontLoaded(design.bodyFont);
    if (draft.headlineFont) ensureGoogleFontLoaded(draft.headlineFont);
    if (draft.bodyFont) ensureGoogleFontLoaded(draft.bodyFont);
  }, [design?.headlineFont, design?.bodyFont, draft.headlineFont, draft.bodyFont]);

  if (!design) {
    return (
      <div className="brandkit-page">
        <div className="brandkit-empty">
          <p>Loading your brand kit…</p>
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(pickFields(design));

  function set(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  async function handleSave() {
    if (!designId || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await api.updateDesign(designId, pickFields(draft));
      onPatch(designId, pickFields(draft), { persist: false });
      setSaveState('saved');
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      console.error('Failed to save brand kit', err);
      setSaveState('error');
    }
  }

  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleVariationUpload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const existing = draft.logoVariations || [];
    Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                label: `Variation ${existing.length + 1}`,
                dataUrl: reader.result,
              });
            reader.readAsDataURL(file);
          })
      )
    ).then((added) => set('logoVariations', [...existing, ...added]));
  }

  function updateVariation(id, patch) {
    set(
      'logoVariations',
      (draft.logoVariations || []).map((v) => (v.id === id ? { ...v, ...patch } : v))
    );
  }

  return (
    <div className="brandkit-page">
      <div className="brandkit-topbar">
        <h2>Brand kit</h2>
        <div className="brandkit-save-area">
          {saveState === 'saving' && <span className="brandkit-save-status">Saving…</span>}
          {saveState === 'saved' && <span className="brandkit-save-status ok">Saved ✓</span>}
          {saveState === 'error' && <span className="brandkit-save-status err">Save failed</span>}
          {saveState === 'idle' && dirty && <span className="brandkit-save-status">Unsaved changes</span>}
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || saveState === 'saving'}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>

      <div className="brandkit-grid">

        <section className="brandkit-card">
          <h3>Logo</h3>
          <p className="brandkit-hint">Your company logo, used across all proposals.</p>
          {draft.logoDataUrl ? (
            <div className="brandkit-logo-preview">
              <img src={draft.logoDataUrl} alt="Logo" />
              <button type="button" className="btn-text btn-danger" onClick={() => set('logoDataUrl', null)}>Remove</button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => logoInputRef.current?.click()}>
              Upload logo
            </button>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ display: 'none' }}
            onChange={handleLogoUpload}
          />
          <div className="brandkit-logo-vars">
            <div className="brandkit-subhead">
              <span>Variations</span>
              <button type="button" className="btn-text" onClick={() => variationInputRef.current?.click()}>
                + Add variation
              </button>
            </div>
            {(draft.logoVariations || []).length === 0 && (
              <p className="brandkit-hint">Alternate marks — monochrome, icon-only, stacked… used where the primary logo doesn't fit.</p>
            )}
            <div className="brandkit-logo-vars-grid">
              {(draft.logoVariations || []).map((v) => (
                <div key={v.id} className="brandkit-logo-var">
                  <div className="brandkit-logo-var-thumb">
                    <img src={v.dataUrl} alt={v.label || 'Logo variation'} />
                  </div>
                  <input
                    className="brandkit-logo-var-label"
                    value={v.label || ''}
                    onChange={(e) => updateVariation(v.id, { label: e.target.value })}
                    placeholder="e.g. Monochrome"
                  />
                  {draft.logoDataUrl !== v.dataUrl && (
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => set('logoDataUrl', v.dataUrl)}
                      title="Use this variation as the primary logo"
                    >Set as primary</button>
                  )}
                  <button
                    type="button"
                    className="btn-text btn-danger"
                    onClick={() => set('logoVariations', (draft.logoVariations || []).filter((x) => x.id !== v.id))}
                  >Remove</button>
                </div>
              ))}
            </div>
          </div>
          <input
            ref={variationInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            multiple
            style={{ display: 'none' }}
            onChange={handleVariationUpload}
          />
        </section>

        <section className="brandkit-card">
          <h3>Colors</h3>
          <div className="brandkit-colors">
            <label className="brandkit-color-field">
              <span>Accent</span>
              <div className="color-field-lg">
                <div className="color-preview-lg" style={{ background: draft.accentColor }} />
                <input type="color" value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="color-picker-hidden" />
                <input className="color-hex-input" value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value)} />
              </div>
            </label>
            <label className="brandkit-color-field">
              <span>Background</span>
              <div className="color-field-lg">
                <div className="color-preview-lg" style={{ background: draft.backgroundColor || '#ffffff' }} />
                <input type="color" value={draft.backgroundColor || '#ffffff'} onChange={(e) => set('backgroundColor', e.target.value)} className="color-picker-hidden" />
                <input className="color-hex-input" value={draft.backgroundColor || '#ffffff'} onChange={(e) => set('backgroundColor', e.target.value)} />
              </div>
            </label>
            {(draft.brandColors || []).map((hex, i) => (
              <div key={`${hex}-${i}`} className="brandkit-color-row">
                <label className="brandkit-color-field">
                  <span>Brand color {i + 1}</span>
                  <div className="color-field-lg">
                    <div className="color-preview-lg" style={{ background: hex }} />
                    <input type="color" value={hex} onChange={(e) => {
                      const colors = [...(draft.brandColors || [])];
                      colors[i] = e.target.value;
                      set('brandColors', colors);
                    }} className="color-picker-hidden" />
                    <input className="color-hex-input" value={hex} onChange={(e) => {
                      const colors = [...(draft.brandColors || [])];
                      colors[i] = e.target.value;
                      set('brandColors', colors);
                    }} />
                  </div>
                </label>
                <button type="button" className="btn-text btn-danger" onClick={() => {
                  set('brandColors', (draft.brandColors || []).filter((_, j) => j !== i));
                }}>Remove</button>
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary brandkit-add-color"
              onClick={() => set('brandColors', [...(draft.brandColors || []), nextDefaultColor(draft.brandColors || [])])}
            >+ Add color</button>
          </div>
        </section>

        <section className="brandkit-card">
          <h3>Typography</h3>
          <div className="brandkit-fonts">
            <label className="brandkit-font-field">
              <span>Headline font</span>
              <select value={draft.headlineFont} onChange={(e) => set('headlineFont', e.target.value)}>
                {CURATED_GOOGLE_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <span className="font-preview" style={{ fontFamily: `"${draft.headlineFont}", sans-serif` }}>
                Aa Bb Cc
              </span>
            </label>
            <label className="brandkit-font-field">
              <span>Body font</span>
              <select value={draft.bodyFont} onChange={(e) => set('bodyFont', e.target.value)}>
                {CURATED_GOOGLE_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <span className="font-preview" style={{ fontFamily: `"${draft.bodyFont}", sans-serif` }}>
                Aa Bb Cc
              </span>
            </label>
          </div>
        </section>

        <section className="brandkit-card">
          <h3>Identity</h3>
          <div className="brandkit-identity">
            <label className="brandkit-field">
              <span>Sender name</span>
              <input value={draft.senderName || ''} onChange={(e) => set('senderName', e.target.value)} placeholder="Your name or company" />
            </label>
            <label className="brandkit-field">
              <span>Tagline / contact</span>
              <input value={draft.tagline || ''} onChange={(e) => set('tagline', e.target.value)} placeholder="email · phone · website" />
            </label>
          </div>
        </section>

        <section className="brandkit-card brandkit-card-wide">
          <h3>Writing tone</h3>
          <p className="brandkit-hint">Paste a sample of how you write — AI will match this voice when generating proposals.</p>
          <textarea
            rows={5}
            value={draft.styleSample || ''}
            onChange={(e) => set('styleSample', e.target.value)}
            placeholder="Paste a paragraph of your own writing here…"
          />
        </section>

        <section className="brandkit-card brandkit-card-wide">
          <h3>Static sections</h3>
          <p className="brandkit-hint">Content that appears unchanged in every proposal (Why us, process, pricing…).</p>
          {(draft.staticSections || []).map((s, i) => {
            const sections = [...(draft.staticSections || [])];
            return (
              <div key={i} className="brandkit-section-row">
                <input
                  className="brandkit-section-heading"
                  value={s.heading}
                  onChange={(e) => {
                    sections[i] = { ...sections[i], heading: e.target.value };
                    set('staticSections', sections);
                  }}
                  placeholder="Heading (e.g. Why us)"
                />
                <textarea
                  rows={3}
                  value={s.body}
                  onChange={(e) => {
                    sections[i] = { ...sections[i], body: e.target.value };
                    set('staticSections', sections);
                  }}
                  placeholder="Section body…"
                />
                <button type="button" className="btn-text btn-danger" onClick={() => {
                  set('staticSections', sections.filter((_, j) => j !== i));
                }}>Remove</button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary" onClick={() => {
            const sections = [...(draft.staticSections || []), { heading: '', body: '' }];
            set('staticSections', sections);
          }}>+ Add section</button>
        </section>

      </div>
    </div>
  );
}
