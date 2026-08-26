import { useMemo, useRef, useState } from 'react';
import { api } from '../api';

const STOPWORDS = new Set([
  'the', 'this', 'that', 'and', 'our', 'we', 'why', 'how', 'what', 'your', 'for', 'with',
  'from', 'about', 'us', 'it', 'in', 'on', 'at', 'a', 'an', 'all', 'not', 'but', 'can',
  'will', 'may', 'new', 'more', 'most', 'also', 'who', 'are', 'you', 'get', 'let', 'has',
  'have', 'was', 'were', 'they', 'their', 'them', 'then', 'than', 'out', 'into', 'over',
  'proposal', 'proposals', 'prepared', 'introduction', 'overview', 'pricing', 'timeline',
  'services', 'contact', 'scope', 'deliverables', 'process', 'investment', 'next', 'steps',
  'page', 'date', 'to', 'by',
]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(original, replacement) {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase() &&
      original.slice(1) === original.slice(1).toLowerCase()) return replacement;
  return replacement.toLowerCase();
}

function suggestOldName(design) {
  const blocks = (design.pages || []).flatMap((p) => p.blocks || []);
  if (!blocks.length && design.sourceTextBlocks?.length) blocks.push(...design.sourceTextBlocks);
  for (const b of blocks) {
    const m = (b.text || '').match(/prepared\s+for\s*:?\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/i);
    if (m) return m[1].trim();
  }
  const freq = new Map();
  for (const b of blocks) {
    for (const tok of (b.text || '').split(/\s+/)) {
      const clean = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (/^[A-Z][A-Za-z0-9&.'-]{2,}$/.test(clean) && !STOPWORDS.has(clean.toLowerCase())) {
        freq.set(clean, (freq.get(clean) || 0) + 1);
      }
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function computeReplacements(design, oldName, newName) {
  const needle = oldName.toLowerCase();
  const re = new RegExp(escapeRegExp(oldName), 'gi');
  let count = 0;
  const pagesTouched = new Set();
  const pageOverrides = { ...(design.pageOverrides || {}) };
  const textOverrides = { ...(design.textOverrides || {}) };

  const pages = design.pages?.length
    ? design.pages.map((p) => ({ key: String(p.pageNum || 1), blocks: p.blocks || [] }))
    : [{ key: '1', blocks: design.sourceTextBlocks || [] }];
  const multiPage = design.pages?.length > 1;

  for (const page of pages) {
    const target = multiPage
      ? (pageOverrides[page.key] = { ...(pageOverrides[page.key] || {}) })
      : textOverrides;
    for (const b of page.blocks) {
      const text = b.text || '';
      if (!text.toLowerCase().includes(needle)) continue;
      target[b.id] = text.replace(re, (m) => matchCase(m, newName));
      count += 1;
      pagesTouched.add(page.key);
    }
  }
  return { pageOverrides, textOverrides, count, pages: pagesTouched.size };
}

function collectImageCandidates(design) {
  const out = [];
  const pages = design.pages?.length
    ? design.pages
    : [{ pageNum: 1, images: [], height: design.sourceImageHeight, width: design.sourceImageWidth }];
  for (const page of pages) {
    const pageNum = page.pageNum || 1;
    (page.images || []).forEach((img, i) => {
      if (!img.dataUrl) return;
      const pageH = page.height || img.y + img.height || 1;
      out.push({
        id: `slot-${pageNum}-${i}`,
        pageNum,
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        dataUrl: img.dataUrl,
        top: (img.y || 0) / pageH,
        compact: (img.width || 1) / Math.max(img.height || 1, 1) < 6,
      });
    });
  }
  const sizeFreq = new Map();
  for (const c of out) {
    const k = `${Math.round(c.width / 12)}x${Math.round(c.height / 12)}`;
    sizeFreq.set(k, (sizeFreq.get(k) || 0) + 1);
  }
  for (const c of out) {
    const k = `${Math.round(c.width / 12)}x${Math.round(c.height / 12)}`;
    c.autoChecked = sizeFreq.get(k) >= 2 || (c.top < 0.15 && c.compact);
  }
  return out.sort((a, b) => Number(b.autoChecked) - Number(a.autoChecked)).slice(0, 24);
}

export default function RebrandPanel({ design, onPatch, onClose, onDone }) {
  const [oldName, setOldName] = useState(() => suggestOldName(design));
  const [newName, setNewName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [coverDataUrl, setCoverDataUrl] = useState(null);
  const [slots, setSlots] = useState(() => collectImageCandidates(design));
  const [phase, setPhase] = useState('form'); // form | summary | saving | done
  const [error, setError] = useState('');
  const logoInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const preview = useMemo(() => {
    if (!oldName.trim() || !newName.trim()) return null;
    return computeReplacements(design, oldName.trim(), newName.trim());
  }, [design, oldName, newName]);

  const checkedSlots = slots.filter((s) => s.checked && (logoDataUrl || coverDataUrl));

  function readFile(file, cb) {
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    reader.readAsDataURL(file);
  }

  function toggleSlot(id, patch) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    if (!preview) return;
    setPhase('saving');
    setError('');
    try {
      const logoSlots = slots
        .filter((s) => s.checked)
        .map((s) => ({
          id: s.id,
          pageNum: s.pageNum,
          x: Math.round(s.x),
          y: Math.round(s.y),
          width: Math.round(s.width),
          height: Math.round(s.height),
          kind: s.kind || 'logo',
        }));
      const patch = {};
      if (design.pages?.length > 1) {
        patch.pageOverrides = preview.pageOverrides;
      } else {
        patch.textOverrides = preview.textOverrides;
      }
      patch.logoSlots = logoSlots;
      if (coverDataUrl) patch.heroImageDataUrl = coverDataUrl;
      onPatch(design.id, patch);

      if (newName.trim()) {
        await api.upsertProposal({
          designId: design.id,
          companyName: newName.trim(),
          companyLogo: logoDataUrl,
        });
      }
      setPhase('done');
      onDone?.({
        replacements: preview.count,
        pages: preview.pages,
        slots: logoSlots.length,
      });
    } catch (err) {
      setError(err.message || 'Failed to save the rebrand.');
      setPhase('form');
    }
  }

  return (
    <div className="modal-overlay" onClick={phase === 'saving' ? undefined : onClose}>
      <div className="rebrand-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Rebrand for another company</h3>

        {phase !== 'done' && (
          <p className="modal-subtext">
            Every occurrence of the old name is replaced on all pages, in its original style.
            Text baked into images can't be changed. Patches use solid fills sampled around each
            slot, and replacement text renders in the nearest Google-font equivalent.
          </p>
        )}

        {phase === 'form' && (
          <>
            <div className="modal-field">
              <label htmlFor="rebrand-old">Old name (who it was made for)</label>
              <input
                id="rebrand-old"
                value={oldName}
                onChange={(e) => setOldName(e.target.value)}
                placeholder="e.g. Max"
              />
              <label htmlFor="rebrand-new" style={{ marginTop: 12 }}>New company name</label>
              <input
                id="rebrand-new"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div className="modal-field">
              <label>{newName.trim() || 'Recipient'} logo</label>
              <label className="logo-upload-tile">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f, setLogoDataUrl);
                    e.target.value = '';
                  }}
                />
                <span className="logo-upload-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </span>
                <span className="logo-upload-copy">
                  <strong>{logoDataUrl ? 'Logo ready — click to replace' : `Upload ${newName.trim() || "recipient"}'s logo`}</strong>
                  <span>Replaces every tagged logo slot in the PDF.</span>
                </span>
              </label>

              <label className="logo-upload-tile">
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f, setCoverDataUrl);
                    e.target.value = '';
                  }}
                />
                <span className="logo-upload-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </span>
                <span className="logo-upload-copy">
                  <strong>{coverDataUrl ? 'Cover ready — click to replace' : 'Cover image (optional)'}</strong>
                  <span>Fills slots marked as cover, edge to edge.</span>
                </span>
              </label>
              {logoDataUrl && <img className="logo-preview" src={logoDataUrl} alt="Recipient logo" />}
            </div>

            {slots.length > 0 && (
              <div className="modal-field">
                <label>Logo slots — tick every region that should receive the new logo</label>
                <div className="rebrand-slot-grid">
                  {slots.map((s) => (
                    <div key={s.id} className={`rebrand-slot${s.checked ? ' checked' : ''}`}>
                      <button
                        type="button"
                        className="rebrand-slot-thumb"
                        onClick={() => toggleSlot(s.id, { checked: !s.checked })}
                        title={`Page ${s.pageNum}`}
                      >
                        <img src={s.dataUrl} alt="" />
                        <span className="rebrand-slot-page">p{s.pageNum}</span>
                        {s.autoChecked && !s.checked && <span className="rebrand-slot-hint">suggested</span>}
                      </button>
                      {s.checked && (
                        <select
                          className="rebrand-slot-kind"
                          value={s.kind || 'logo'}
                          onChange={(e) => toggleSlot(s.id, { kind: e.target.value })}
                        >
                          <option value="logo">Logo fit</option>
                          <option value="cover">Cover fit</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="import-status import-error">{error}</p>}

            <div className="rebrand-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!oldName.trim() || !newName.trim() || !preview || (preview.count === 0 && checkedSlots.length === 0)}
                onClick={() => setPhase('summary')}
              >
                Review changes
              </button>
            </div>
          </>
        )}

        {phase === 'summary' && preview && (
          <>
            <div className="rebrand-summary">
              <div className="rebrand-summary-row">
                <strong>{preview.count}</strong> replacement{preview.count === 1 ? '' : 's'} on{' '}
                <strong>{preview.pages}</strong> page{preview.pages === 1 ? '' : 's'}
              </div>
              <div className="rebrand-summary-row">
                <strong>{slots.filter((s) => s.checked).length}</strong> logo slot{slots.filter((s) => s.checked).length === 1 ? '' : 's'}
                {logoDataUrl ? ' will receive the new logo' : ' will be blanked (no logo uploaded)'}
              </div>
              <div className="rebrand-summary-row dim">
                “{oldName.trim()}” → “{newName.trim()}” · originals stay untouched; everything lives in overrides
              </div>
            </div>
            <div className="rebrand-actions">
              <button type="button" className="btn-secondary" onClick={() => setPhase('form')}>Back</button>
              <button type="button" className="btn-primary" onClick={handleSave}>Apply rebrand</button>
            </div>
          </>
        )}

        {phase === 'saving' && <p className="modal-subtext">Applying…</p>}

        {phase === 'done' && (
          <>
            <div className="rebrand-summary">
              <div className="rebrand-summary-row">Rebrand applied ✓ — check the preview, then export.</div>
            </div>
            <div className="rebrand-actions">
              <button type="button" className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
