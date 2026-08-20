import { useState, useEffect } from 'react';

const INDUSTRIES = ['Automotive', 'Technology', 'Finance', 'Healthcare', 'Energy', 'Retail', 'Policy / Gov', 'Media', 'Real Estate', 'Education'];
const USECASES = ['Business decisions', 'Regulatory compliance', 'Investments', 'Research', 'Staying informed', 'Competitive intel'];

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function BeccaSettings({ profile, memory, onSaveProfile, onAddMemory, onRemoveMemory, onSaveSettings, settings, onClose }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [industries, setIndustries] = useState([]);
  const [usecases, setUsecases] = useState([]);
  const [memInput, setMemInput] = useState('');
  const [tab, setTab] = useState('profile');
  const [quietFrom, setQuietFrom] = useState('22:00');
  const [quietTo, setQuietTo] = useState('07:00');
  const [country, setCountry] = useState('');

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setRole(profile.role || '');
      setLocation(profile.location || '');
      setBio(profile.bio || '');
      setIndustries(profile.industries || []);
      setUsecases(profile.usecases || []);
    }
  }, [profile]);

  useEffect(() => {
    if (settings) {
      setQuietFrom(settings.quietFrom || '22:00');
      setQuietTo(settings.quietTo || '07:00');
      setCountry(settings.country || '');
    }
  }, [settings]);

  function handleSave() {
    onSaveProfile({ name, role, location, bio, industries, usecases });
    onSaveSettings('daily', { ...settings, quietFrom, quietTo, country });
    onClose();
  }

  function toggleIndustry(ind) {
    setIndustries(prev => prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]);
  }

  function toggleUsecase(uc) {
    setUsecases(prev => prev.includes(uc) ? prev.filter(u => u !== uc) : [...prev, uc]);
  }

  function handleAddMemory() {
    const val = memInput.trim();
    if (!val) return;
    onAddMemory(val);
    setMemInput('');
  }

  const initials = name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-head-l">
            <div className="modal-avatar-lg">{initials}</div>
            <div>
              <div className="modal-head-title">{name || 'Profile'}</div>
              <div className="modal-head-sub">Personal Intelligence Assistant</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          <div className={`modal-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profile</div>
          <div className={`modal-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</div>
          <div className={`modal-tab ${tab === 'memory' ? 'active' : ''}`} onClick={() => setTab('memory')}>Memory</div>
        </div>

        <div className="modal-body">
          {tab === 'profile' && (
            <div className="modal-tab-panel active">
              <div className="pf-row">
                <div className="pf-group">
                  <div className="pf-label">Name</div>
                  <input className="pf-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex" />
                </div>
                <div className="pf-group">
                  <div className="pf-label">Country / Region</div>
                  <input className="pf-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Lagos, Nigeria" />
                </div>
              </div>
              <div className="pf-group">
                <div className="pf-label">Role</div>
                <input className="pf-input" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Startup Founder, Investment Analyst…" />
              </div>
              <div className="pf-group">
                <div className="pf-label">Industry</div>
                <div className="profile-tags">
                  {INDUSTRIES.map(ind => (
                    <div key={ind} className={`ptag ${industries.includes(ind) ? 'selected' : ''}`} onClick={() => toggleIndustry(ind)}>{ind}</div>
                  ))}
                </div>
              </div>
              <div className="pf-group">
                <div className="pf-label">I use Homin for</div>
                <div className="profile-tags">
                  {USECASES.map(uc => (
                    <div key={uc} className={`ptag ${usecases.includes(uc) ? 'selected' : ''}`} onClick={() => toggleUsecase(uc)}>{uc}</div>
                  ))}
                </div>
              </div>
              <div className="pf-group">
                <div className="pf-label">Context</div>
                <textarea className="pf-textarea" value={bio} onChange={e => setBio(e.target.value)}
                  placeholder="Tell Homin about your work, what you track, and why it matters to you…" rows={3} />
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <div className="modal-tab-panel">
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
            <div className="modal-tab-panel">
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
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save-profile" onClick={handleSave}>Save ✦</button>
        </div>
      </div>
    </div>
  );
}
