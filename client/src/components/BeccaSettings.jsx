import { useState, useEffect } from 'react';
import { api } from '../api';

const INDUSTRIES = ['Automotive', 'Technology', 'Finance', 'Healthcare', 'Energy', 'Retail', 'Policy / Gov', 'Media', 'Real Estate', 'Education', 'Logistics', 'Agriculture', 'Manufacturing', 'Telecoms', 'Consulting'];
const USECASES = ['Business decisions', 'Regulatory compliance', 'Investments', 'Research', 'Staying informed', 'Competitive intel', 'Market analysis', 'Crisis monitoring', 'Partnership intel'];
const COMPANY_SIZES = ['Solo founder', '2-10', '11-50', '51-200', '201-1000', '1000+'];

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

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function BeccaSettings({ profile, memory, onSaveProfile, onAddMemory, onRemoveMemory, onSaveSettings, settings, onClose, onComplete }) {
  const [tab, setTab] = useState('company');
  const [companyName, setCompanyName] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [keyProducts, setKeyProducts] = useState([]);
  const [competitors, setCompetitors] = useState([]);
  const [targetMarket, setTargetMarket] = useState('');
  const [valueProposition, setValueProposition] = useState('');
  const [industries, setIndustries] = useState([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [usecases, setUsecases] = useState([]);
  const [links, setLinks] = useState([]);
  const [country, setCountry] = useState('');
  const [quietFrom, setQuietFrom] = useState('22:00');
  const [quietTo, setQuietTo] = useState('07:00');
  const [knowledge, setKnowledge] = useState([]);
  const [docFilename, setDocFilename] = useState('');
  const [docContent, setDocContent] = useState('');
  const [memInput, setMemInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setCompanyName(profile.company_name || '');
      setCompanyDescription(profile.company_description || '');
      setWebsite(profile.website || '');
      setCompanySize(profile.company_size || '');
      setKeyProducts(profile.key_products || []);
      setCompetitors(profile.competitors || []);
      setTargetMarket(profile.target_market || '');
      setValueProposition(profile.value_proposition || '');
      setIndustries(profile.industries || []);
      setName(profile.name || '');
      setRole(profile.role || '');
      setLocation(profile.location || '');
      setUsecases(profile.usecases || []);
      setLinks(profile.links || []);
    }
  }, [profile]);

  useEffect(() => {
    if (settings) {
      setQuietFrom(settings.quietFrom || '22:00');
      setQuietTo(settings.quietTo || '07:00');
      setCountry(settings.country || '');
    }
  }, [settings]);

  useEffect(() => {
    let alive = true;
    api.becca.listKnowledge()
      .then(data => { if (alive) setKnowledge(Array.isArray(data) ? data : (data.docs || [])); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function toggle(list, setList, val) {
    setList(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }

  async function handleAddDoc() {
    const fname = docFilename.trim();
    if (!fname || !docContent.trim()) return;
    try {
      await api.becca.addKnowledgeDoc({ filename: fname, content: docContent, doc_type: 'text' });
      setDocFilename('');
      setDocContent('');
      const data = await api.becca.listKnowledge();
      setKnowledge(Array.isArray(data) ? data : (data.docs || []));
    } catch {
      alert('Could not add document — try again.');
    }
  }

  async function handleDeleteDoc(id) {
    try {
      await api.becca.deleteKnowledgeDoc(id);
      setKnowledge(knowledge.filter(d => d.id !== id));
    } catch {
      alert('Could not delete document — try again.');
    }
  }

  function handleAddMemory() {
    const val = memInput.trim();
    if (!val) return;
    onAddMemory(val);
    setMemInput('');
  }

  async function handleExport() {
    try {
      setExporting(true);
      const md = await api.becca.exportKnowledgeBase();
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'homing-knowledge-base.md';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed — try again.');
    } finally {
      setExporting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await onSaveProfile({
        company_name: companyName,
        company_description: companyDescription,
        website,
        company_size: companySize,
        key_products: keyProducts.map(p => p.trim()).filter(Boolean),
        competitors: competitors.map(c => c.trim()).filter(Boolean),
        target_market: targetMarket,
        value_proposition: valueProposition,
        industries,
        name,
        role,
        location,
        usecases,
        links: links.map(l => l.trim()).filter(Boolean)
      });
      await onSaveSettings('daily', { ...settings, quietFrom, quietTo, country });
      if (onComplete) onComplete();
      else onClose();
    } catch {
      alert('Could not save your profile — try again.');
    } finally {
      setSaving(false);
    }
  }

  const initials = name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-head-l">
            <div className="modal-avatar-lg">{initials}</div>
            <div>
              <div className="modal-head-title">{companyName || name || 'Profile'}</div>
              <div className="modal-head-sub">Personal Intelligence Assistant</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          <div className={`modal-tab ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>Company</div>
          <div className={`modal-tab ${tab === 'you' ? 'active' : ''}`} onClick={() => setTab('you')}>You</div>
          <div className={`modal-tab ${tab === 'knowledge' ? 'active' : ''}`} onClick={() => setTab('knowledge')}>Knowledge Base</div>
          <div className={`modal-tab ${tab === 'preferences' ? 'active' : ''}`} onClick={() => setTab('preferences')}>Preferences</div>
          <div className={`modal-tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>Memory</div>
        </div>

        <div className="modal-body">
          {tab === 'company' && (
            <div className={`modal-tab-panel${tab === 'company' ? ' active' : ''}`}>
              <div className="pf-group">
                <div className="pf-label">Company Name</div>
                <input className="pf-input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Ltd" />
              </div>
              <div className="pf-group">
                <div className="pf-label">About the Company</div>
                <textarea className="pf-textarea" rows={3} value={companyDescription} onChange={e => setCompanyDescription(e.target.value)}
                  placeholder="What your company does, who it serves, and what makes it different…" />
              </div>
              <div className="pf-row">
                <div className="pf-group">
                  <div className="pf-label">Website</div>
                  <input className="pf-input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" />
                </div>
                <div className="pf-group">
                  <div className="pf-label">Company Size</div>
                  <select className="pf-input" value={companySize} onChange={e => setCompanySize(e.target.value)}>
                    <option value="">Select…</option>
                    {COMPANY_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
              </div>
              <div className="pf-group">
                <div className="pf-label">Key Products / Services</div>
                <EditableList items={keyProducts} onChange={setKeyProducts} placeholder="e.g. Mobile app for logistics tracking" />
              </div>
              <div className="pf-group">
                <div className="pf-label">Competitors</div>
                <EditableList items={competitors} onChange={setCompetitors} placeholder="e.g. Competitor Inc" />
              </div>
              <div className="pf-group">
                <div className="pf-label">Target Market</div>
                <input className="pf-input" value={targetMarket} onChange={e => setTargetMarket(e.target.value)}
                  placeholder="e.g. SMB retailers in West Africa" />
              </div>
              <div className="pf-group">
                <div className="pf-label">Value Proposition</div>
                <textarea className="pf-textarea" rows={2} value={valueProposition} onChange={e => setValueProposition(e.target.value)}
                  placeholder="Why customers choose you over alternatives…" />
              </div>
              <div className="pf-group">
                <div className="pf-label">Industry</div>
                <TagPicker options={INDUSTRIES} selected={industries} onToggle={val => toggle(industries, setIndustries, val)} />
              </div>
            </div>
          )}

          {tab === 'you' && (
            <div className={`modal-tab-panel${tab === 'you' ? ' active' : ''}`}>
              <div className="pf-row">
                <div className="pf-group">
                  <div className="pf-label">Name</div>
                  <input className="pf-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex" />
                </div>
                <div className="pf-group">
                  <div className="pf-label">Role</div>
                  <input className="pf-input" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Startup Founder, Investment Analyst…" />
                </div>
              </div>
              <div className="pf-group">
                <div className="pf-label">Country / Region</div>
                <input className="pf-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Lagos, Nigeria" />
              </div>
              <div className="pf-group">
                <div className="pf-label">I use Homin for</div>
                <TagPicker options={USECASES} selected={usecases} onToggle={val => toggle(usecases, setUsecases, val)} />
              </div>
              <div className="pf-group">
                <div className="pf-label">Reference Links</div>
                <div className="modal-desc" style={{ marginBottom: 10 }}>Links you trust — Homin uses these as context and sources when relevant.</div>
                <EditableList items={links} onChange={setLinks} placeholder="https://…" />
              </div>
            </div>
          )}

          {tab === 'knowledge' && (
            <div className={`modal-tab-panel${tab === 'knowledge' ? ' active' : ''}`}>
              <div className="settings-section">
                <div className="settings-section-title">Uploaded Documents</div>
                <div className="modal-desc" style={{ marginBottom: 10 }}>Documents Homin references when answering questions about your business.</div>
                <div className="memory-pills-wrap">
                  {knowledge.map(doc => (
                    <div key={doc.id} className="memory-pill">
                      {esc(doc.filename)}
                      {doc.created_at && <span style={{ opacity: 0.6, marginLeft: 8 }}>{new Date(doc.created_at).toLocaleDateString()}</span>}
                      <span className="mp-del" onClick={() => handleDeleteDoc(doc.id)}>✕</span>
                    </div>
                  ))}
                  {knowledge.length === 0 && <div className="empty-note">No documents uploaded yet.</div>}
                </div>
              </div>
              <div className="settings-section" style={{ marginTop: 16 }}>
                <div className="settings-section-title">Add New Document</div>
                <div className="pf-group">
                  <div className="pf-label">Filename</div>
                  <input className="pf-input" value={docFilename} onChange={e => setDocFilename(e.target.value)}
                    placeholder="e.g. product-spec.md" />
                </div>
                <div className="pf-group">
                  <div className="pf-label">Content</div>
                  <textarea className="pf-textarea" rows={6} value={docContent} onChange={e => setDocContent(e.target.value)}
                    placeholder="Paste the document contents here…" />
                </div>
                <div className="add-row">
                  <button className="btn-add-topic" onClick={handleAddDoc}>Add Document</button>
                </div>
              </div>
            </div>
          )}

          {tab === 'preferences' && (
            <div className={`modal-tab-panel${tab === 'preferences' ? ' active' : ''}`}>
              <div className="pf-group settings-section">
                <div className="settings-section-title">Search Region</div>
                <div className="modal-desc" style={{ marginBottom: 10 }}>News, research, and recommendations are scoped to this region by default.</div>
                <input type="text" className="pf-input" value={country} onChange={e => setCountry(e.target.value)}
                  placeholder="e.g. Nigeria" />
              </div>
              <div className="pf-group settings-section">
                <div className="settings-section-title">Quiet Hours</div>
                <div className="modal-desc" style={{ marginBottom: 10 }}>Homin won't fire automatic briefings during these hours.</div>
                <div className="quiet-row">
                  <span>No briefings between</span>
                  <input type="time" className="quiet-time-input" value={quietFrom} onChange={e => setQuietFrom(e.target.value)} />
                  <span>and</span>
                  <input type="time" className="quiet-time-input" value={quietTo} onChange={e => setQuietTo(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div className={`modal-tab-panel${tab === 'memory' ? ' active' : ''}`}>
              <div className="pf-group">
                <div className="settings-section-title">Homin's Memory</div>
                <div className="modal-desc" style={{ marginBottom: 10 }}>Things Homin always remembers and filters through in every response.</div>
                <div className="add-row" style={{ marginBottom: 8 }}>
                  <input type="text" className="pf-input" value={memInput} onChange={e => setMemInput(e.target.value)}
                    placeholder="e.g. I don't care about US politics" onKeyDown={e => { if (e.key === 'Enter') handleAddMemory(); }} />
                  <button className="btn-add-topic" onClick={handleAddMemory} style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>+ Add</button>
                </div>
                <div className="memory-pills-wrap">
                  {memory.map(m => (
                    <div key={m.id} className="memory-pill">
                      {esc(m.content)}
                      <span className="mp-del" onClick={() => onRemoveMemory(m.id)}>✕</span>
                    </div>
                  ))}
                  {memory.length === 0 && <div className="empty-note">No memory entries yet.</div>}
                </div>
                <div className="settings-section" style={{ marginTop: 16 }}>
                  <div className="settings-section-title">Export Knowledge Base</div>
                  <div className="modal-desc" style={{ marginBottom: 10 }}>Download your profile, topics, memory, and every conversation as a markdown file.</div>
                  <button className="btn-add-topic" onClick={handleExport} disabled={exporting}
                    style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                    {exporting ? 'Exporting…' : '⬇ Export all as knowledge base'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-save-profile" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save ✦'}</button>
        </div>
      </div>
    </div>
  );
}
