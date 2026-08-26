import { useState, useEffect } from 'react';
import { api } from '../api';

const INDUSTRIES = ['Automotive', 'Technology', 'Finance', 'Healthcare', 'Energy', 'Retail', 'Policy / Gov', 'Media', 'Real Estate', 'Education', 'Logistics', 'Agriculture', 'Manufacturing', 'Telecoms', 'Consulting'];

const STEPS = ['Website', 'Basics', 'Offer', 'Competition', 'Review'];

const FEATURES = [
  { icon: '/icons/chat.png', title: 'Chat with Homin', text: 'An AI chief-of-staff that knows your business and answers with that context.' },
  { icon: '/icons/watchlist.png', title: 'Watchlists & alerts', text: 'Track topics, competitors and markets — get told when something moves.' },
  { icon: '/icons/briefings.png', title: 'Daily briefings', text: 'A morning digest of what matters in your industry, written for you.' },
  { icon: '/icons/pencil.png', title: 'Instant proposals', text: 'Turn a company name into a tailored proposal in minutes.' },
  { icon: '/icons/mail.png', title: 'Campaigns at scale', text: 'Send personalised proposals to your whole list and track engagement.' },
];

function TagPicker({ options, selected, onToggle }) {
  return (
    <div className="profile-tags">
      {options.map(opt => (
        <div key={opt} className={`ptag ${selected.includes(opt) ? 'selected' : ''}`} onClick={() => onToggle(opt)}>{opt}</div>
      ))}
    </div>
  );
}

function EditableList({ items, onChange, placeholder }) {
  return (
    <div>
      {items.map((item, i) => (
        <div className="pf-link-row" key={i}>
          <input className="pf-input" value={item} onChange={e => {
            const next = [...items]; next[i] = e.target.value; onChange(next);
          }} placeholder={placeholder} />
          <span className="mp-del" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</span>
        </div>
      ))}
      <div className="add-row" style={{ marginTop: 6 }}>
        <button className="btn-add-topic" onClick={() => onChange([...items, ''])}>+ Add</button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="pf-group">
      <div className="pf-label">{label}</div>
      {hint && <div className="modal-desc" style={{ marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

export default function CompanyOnboarding({ onSave, onComplete, onClose }) {
  const [step, setStep] = useState(0); // 0 website · 1 basics · 2 offer · 3 competition · 4 review
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [featIndex, setFeatIndex] = useState(0);
  const [scannedFrom, setScannedFrom] = useState('');
  const [scannedRegion, setScannedRegion] = useState('');
  const [scannedCategory, setScannedCategory] = useState('');
  const [settingUpListening, setSettingUpListening] = useState(false);
  const [listeningProgress, setListeningProgress] = useState('');
  const [listeningComplete, setListeningComplete] = useState(false);

  // form state
  const [website, setWebsite] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [industries, setIndustries] = useState([]);
  const [keyProducts, setKeyProducts] = useState([]);
  const [targetMarket, setTargetMarket] = useState('');
  const [valueProposition, setValueProposition] = useState('');
  const [competitors, setCompetitors] = useState([]);

  function applyProfile(p) {
    if (!p) return;
    if (p.company_name) setCompanyName(p.company_name);
    if (p.company_description) setCompanyDescription(p.company_description);
    if (p.key_products?.length) setKeyProducts(p.key_products);
    if (p.competitors?.length) setCompetitors(p.competitors);
    if (p.target_market) setTargetMarket(p.target_market);
    if (p.value_proposition) setValueProposition(p.value_proposition);
    if (p.industries?.length) setIndustries(p.industries);
  }

  async function handleScan() {
    const url = website.trim();
    if (!url || scanning) return;
    setScanning(true);
    setScanError('');
    setScanProgress(6);
    try {
      const result = await api.becca.scanCompany(url);
      applyProfile(result.profile);
      setScannedFrom(result.scanned_pages > 1 ? `${result.scanned_pages} pages read` : 'homepage read');
      setScannedRegion(result.region || '');
      setScannedCategory(result.profile?.category || '');
      setScanProgress(100);
      // let the 100% bar register before moving on
      setTimeout(() => { setScanning(false); setStep(1); }, 700);
    } catch (err) {
      setScanError(err.message || "Couldn't read that site.");
      setScanning(false);
    }
  }

  // Ease the bar toward ~92% while the real scan runs, so it never stalls
  // at a fixed number no matter how long research takes.
  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => {
      setScanProgress(p => p < 92 ? p + Math.max(0.5, (92 - p) * 0.05) : p);
    }, 400);
    return () => clearInterval(t);
  }, [scanning]);

  // Auto-rotate the feature carousel during the scan.
  useEffect(() => {
    if (!scanning) return;
    setFeatIndex(0);
    const t = setInterval(() => setFeatIndex(i => (i + 1) % FEATURES.length), 3200);
    return () => clearInterval(t);
  }, [scanning]);

  function handleManual() {
    setScanError('');
    setStep(1);
  }

  function toggleIndustry(val) {
    setIndustries(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }

  function stepValid() {
    if (step === 0) return website.trim().length > 3;
    if (step === 1) return companyName.trim().length > 0;
    return true;
  }

  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        company_name: companyName,
        company_description: companyDescription,
        website: website.trim(),
        company_size: companySize,
        key_products: keyProducts.map(p => p.trim()).filter(Boolean),
        competitors: competitors.map(c => c.trim()).filter(Boolean),
        target_market: targetMarket,
        value_proposition: valueProposition,
        industries,
      });

      // Now auto-create watchlist topics from wizard data
      setSettingUpListening(true);
      setListeningProgress('Creating watchlist topics…');

      const topics = [];
      if (companyName.trim()) topics.push({ name: companyName.trim(), context: 'Brand monitoring — your company mentions', platforms: ['google_news', 'nairaland', 'reddit'] });
      competitors.filter(Boolean).forEach(c => topics.push({ name: c.trim(), context: 'Competitor intelligence', platforms: ['google_news', 'nairaland', 'reddit'] }));
      keyProducts.filter(Boolean).forEach(p => topics.push({ name: p.trim(), context: 'Product-specific monitoring', platforms: ['google_news', 'reddit'] }));
      if (industries.length > 0) topics.push({ name: industries[0] + ' industry trends', context: 'Industry market intelligence', platforms: ['google_news', 'nairaland', 'reddit'] });

      const created = [];
      for (const t of topics) {
        try {
          const res = await api.becca.addTopic(t);
          created.push(res);
        } catch { /* skip duplicates */ }
      }

      if (created.length > 0) {
        setListeningProgress(`Scanning ${created.length} topics across social platforms…`);
        // Fire-and-forget: trigger scan on all created topics
        api.social.scanAll().catch(() => {});
      }

      setListeningComplete(true);
    } catch {
      alert('Could not save — please try again.');
      setSaving(false);
    }
  }

  const host = website.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  return (
    <div className="modal-overlay open">
      <div className="modal onboarding-modal">
        <div className="modal-head">
          <div className="modal-head-l">
            <div className="modal-avatar-lg">✦</div>
            <div>
              <div className="modal-head-title">Set up your company</div>
              <div className="modal-head-sub">So Homin knows the context behind every answer</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {listeningComplete ? (
          /* ── Completion: social listening warm-up ── */
          <div className="ob-complete" style={{ textAlign: 'center', padding: '48px 32px' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>You're all set</div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
              Social listening is warming up across Google News, Nairaland, Reddit and YouTube.
              <br /><br />
              <strong>{companyName}</strong> is being watched for brand mentions. Competitors and industry topics are being scanned too.
              <br /><br />
              Expect your first report in about <strong>10 minutes</strong>. You'll find everything under <em>Watchlist</em> in the sidebar.
            </div>
            <button className="btn-save-profile" onClick={onComplete} style={{ marginTop: 24 }}>Got it →</button>
          </div>
        ) : settingUpListening ? (
          /* ── Setting up social listening ── */
          <div className="scan-showcase">
            <div className="feat-stage">
              {FEATURES.map((f, i) => (
                <div key={f.title} className={`feat-slide ${i === featIndex ? 'active' : ''}`}>
                  <img src={f.icon} alt="" className="feat-icon" />
                  <div className="feat-title">{f.title}</div>
                  <div className="feat-text">{f.text}</div>
                </div>
              ))}
            </div>
            <div className="feat-dots">
              {FEATURES.map((f, i) => (
                <button key={f.title} type="button"
                  className={`feat-dot ${i === featIndex ? 'active' : ''}`}
                  onClick={() => setFeatIndex(i)} aria-label={f.title} />
              ))}
            </div>
            <div className="scan-progress-row">
              <span className="scan-progress-label">{listeningProgress}</span>
              <span className="setup-spinner" style={{ width: 16, height: 16 }} />
            </div>
          </div>
        ) : scanning ? (
          /* ── Scan showcase: progress + feature carousel ── */
          <div className="scan-showcase">
            <div className="feat-stage">
              {FEATURES.map((f, i) => (
                <div key={f.title} className={`feat-slide ${i === featIndex ? 'active' : ''}`}>
                  <img src={f.icon} alt="" className="feat-icon" />
                  <div className="feat-title">{f.title}</div>
                  <div className="feat-text">{f.text}</div>
                </div>
              ))}
            </div>
            <div className="feat-dots">
              {FEATURES.map((f, i) => (
                <button key={f.title} type="button"
                  className={`feat-dot ${i === featIndex ? 'active' : ''}`}
                  onClick={() => setFeatIndex(i)} aria-label={f.title} />
              ))}
            </div>

            <div className="scan-progress-row">
              <span className="scan-progress-label">Researching {host}…</span>
              <span className="scan-progress-pct">{Math.round(scanProgress)}%</span>
            </div>
            <div className="scan-progress">
              <div className="scan-progress-fill" style={{ width: `${scanProgress}%` }} />
            </div>
          </div>
        ) : (
          <>
            {/* progress rail */}
            <div className="ob-steps">
          {STEPS.map((label, i) => (
            <div key={label}
              className={`ob-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => !scanning && setStep(i)}
              title={`Go to ${label}`}>
              <span className="ob-step-dot">{i < step ? '✓' : i + 1}</span>
              <span className="ob-step-label">{label}</span>
              {i < STEPS.length - 1 && <span className="ob-step-line" />}
            </div>
          ))}
        </div>

        <div className="modal-body">
          {step === 0 && (
            <>
              <Field label="What's your company website?" hint="We'll read it and pre-fill everything below — you review and confirm before anything is saved.">
                <input
                  className="pf-input ob-url-input"
                  value={website}
                  autoFocus
                  onChange={e => setWebsite(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
                  placeholder="e.g. acme.com"
                  disabled={scanning}
                />
              </Field>
              {scanError && (
                <p className="import-error">{scanError}</p>
              )}
              {scanning ? (
                <div className="ob-scanning">
                  <div className="setup-spinner" />
                  <span>Reading {host || 'your site'}…</span>
                </div>
              ) : null}
            </>
          )}

          {(step === 1 || step === 2 || step === 3) && scannedFrom && (
            <div className="ob-autofill-note">
              ✦ Auto-filled from {host} ({scannedFrom}{scannedCategory ? ` · category: ${scannedCategory}` : ''}{scannedRegion ? ` · context: ${scannedRegion}` : ''}) — edit anything that's off, and check the other steps too.
            </div>
          )}

          {step === 1 && (
            <>
              <Field label="Company Name">
                <input className="pf-input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Ltd" />
              </Field>
              <Field label="About the Company" hint="What your company does, who it serves, and what makes it different.">
                <textarea className="pf-textarea" rows={5} value={companyDescription} onChange={e => setCompanyDescription(e.target.value)}
                  placeholder="Acme builds…" />
              </Field>
              <Field label="Industry">
                <TagPicker options={INDUSTRIES} selected={industries} onToggle={toggleIndustry} />
              </Field>
              <Field label="Company Size">
                <select className="pf-input" value={companySize} onChange={e => setCompanySize(e.target.value)}>
                  <option value="">Select…</option>
                  {['Solo founder', '2-10', '11-50', '51-200', '201-1000', '1000+'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Key Products / Services">
                <EditableList items={keyProducts} onChange={setKeyProducts} placeholder="e.g. Mobile app for logistics tracking" />
              </Field>
              <Field label="Target Market">
                <input className="pf-input" value={targetMarket} onChange={e => setTargetMarket(e.target.value)}
                  placeholder="e.g. SMB retailers in West Africa" />
              </Field>
              <Field label="Value Proposition" hint="Why customers choose you over alternatives.">
                <textarea className="pf-textarea" rows={3} value={valueProposition} onChange={e => setValueProposition(e.target.value)}
                  placeholder="Because…" />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field label="Competitors" hint="Who else plays in your space? Homin uses this for competitive intel.">
                <EditableList items={competitors} onChange={setCompetitors} placeholder="e.g. Competitor Inc" />
              </Field>
            </>
          )}

          {step === 4 && (
            <>
              <div className="ob-review-note">Ready? This becomes Homin's context for briefings, research and answers.</div>
              <div className="ob-review">
                <div className="ob-review-row"><span>Company</span><strong>{companyName || '—'}</strong></div>
                {website.trim() && <div className="ob-review-row"><span>Website</span><strong>{host}</strong></div>}
                {industries.length > 0 && <div className="ob-review-row"><span>Industries</span><strong>{industries.join(', ')}</strong></div>}
                {keyProducts.filter(Boolean).length > 0 && (
                  <div className="ob-review-col"><span>Products / Services</span>
                    <ul>{keyProducts.filter(Boolean).map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
                {competitors.filter(Boolean).length > 0 && (
                  <div className="ob-review-col"><span>Competitors</span>
                    <ul>{competitors.filter(Boolean).map((c, i) => <li key={i}>{c}</li>)}</ul>
                  </div>
                )}
                {targetMarket && <div className="ob-review-row"><span>Target market</span><strong>{targetMarket}</strong></div>}
              </div>
            </>
          )}
        </div>

        {!settingUpListening && !listeningComplete && (
        <div className="modal-footer">
          {step === 0 ? (
            <>
              <button className="btn-cancel" onClick={onClose} disabled={scanning}>Cancel</button>
              <button className="btn-text" onClick={handleManual} disabled={scanning}>I'll fill it in myself</button>
              <button className="btn-save-profile" onClick={handleScan} disabled={!stepValid() || scanning}>
                {scanning ? 'Reading…' : 'Scan & auto-fill ✦'}
              </button>
            </>
          ) : (
            <>
              <button className="btn-cancel" onClick={() => setStep(step - 1)} disabled={saving}>Back</button>
              {step < 4 ? (
                <button className="btn-save-profile" onClick={() => setStep(step + 1)} disabled={!stepValid()}>Continue →</button>
              ) : (
                <button className="btn-save-profile" onClick={handleFinish} disabled={saving}>{saving ? 'Saving…' : 'Save & finish ✦'}</button>
              )}
            </>
          )}
            </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
