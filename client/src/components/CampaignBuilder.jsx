import { useState, useEffect } from 'react';
import { api } from '../api';

const MERGE_FIELDS = [
  { label: 'Company name', value: '{{company_name}}' },
  { label: 'First name', value: '{{first_name}}' },
  { label: 'Last name', value: '{{last_name}}' },
  { label: 'Headline', value: '{{headline}}' },
];

export default function CampaignBuilder({ designs }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    name: '',
    designId: '',
    subjectTemplate: 'Proposal for {{company_name}}',
    provider: 'resend',
  });
  const [addRecipientsOpen, setAddRecipientsOpen] = useState(false);
  const [availableRecipients, setAvailableRecipients] = useState([]);
  const [selectedRecipients, setSelectedRecipients] = useState(new Set());
  const [recipientSearch, setRecipientSearch] = useState('');

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const list = await api.listCampaigns();
      setCampaigns(list);
    } catch (err) {
      console.error('Failed to load campaigns', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    setDetailLoading(true);
    try {
      const d = await api.getCampaign(id);
      setDetail(d);
      setSelectedCampaign(id);
    } catch (err) {
      console.error('Failed to load campaign detail', err);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.designId) return;
    setCreating(true);
    try {
      const created = await api.createCampaign({
        designId: form.designId,
        name: form.name,
        subjectTemplate: form.subjectTemplate,
        provider: form.provider,
      });
      setCampaigns((prev) => [created, ...prev]);
      setForm({ name: '', designId: '', subjectTemplate: 'Proposal for {{company_name}}', provider: 'resend' });
      loadDetail(created.id);
    } catch (err) {
      console.error('Failed to create campaign', err);
    } finally {
      setCreating(false);
    }
  }

  async function openAddRecipients() {
    setAddRecipientsOpen(true);
    setSelectedRecipients(new Set());
    setRecipientSearch('');
    try {
      const list = await api.listRecipients();
      const existingIds = new Set((detail?.recipients || []).map((r) => r.recipientId));
      setAvailableRecipients(list.filter((r) => !existingIds.has(r.id)));
    } catch (err) {
      console.error('Failed to load recipients', err);
    }
  }

  async function handleAddRecipients() {
    if (selectedRecipients.size === 0 || !detail) return;
    try {
      await api.addRecipientsToCampaign(detail.id, [...selectedRecipients]);
      setAddRecipientsOpen(false);
      loadDetail(detail.id);
    } catch (err) {
      console.error('Failed to add recipients', err);
    }
  }

  async function handleSend() {
    if (!detail) return;
    if (!confirm(`Send emails to ${detail.recipients?.length || 0} recipients?`)) return;
    setSending(true);
    try {
      await api.sendCampaign(detail.id, detail.provider);
      loadDetail(detail.id);
      loadCampaigns();
    } catch (err) {
      console.error('Failed to send campaign', err);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign?')) return;
    try {
      await api.deleteCampaign(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
      if (selectedCampaign === id) {
        setSelectedCampaign(null);
        setDetail(null);
      }
    } catch (err) {
      console.error('Failed to delete campaign', err);
    }
  }

  function insertMergeField(field) {
    setForm((prev) => ({ ...prev, subjectTemplate: prev.subjectTemplate + field }));
  }

  const filteredRecipients = availableRecipients.filter((r) => {
    if (!recipientSearch) return true;
    const s = recipientSearch.toLowerCase();
    return r.email.toLowerCase().includes(s) || (r.companyName || '').toLowerCase().includes(s);
  });

  return (
    <div className="campaigns-page">
      <div className="campaigns-layout">
        {/* Left: Campaign list */}
        <div className="campaigns-sidebar">
          <div className="campaigns-sidebar-head">
            <h2>Campaigns</h2>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
              + New
            </button>
          </div>

          {creating && (
            <form className="campaign-create-form" onSubmit={handleCreate}>
              <label className="field">
                <span>Campaign name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Q4 outreach"
                />
              </label>
              <label className="field">
                <span>Design</span>
                <select value={form.designId} onChange={(e) => setForm({ ...form, designId: e.target.value })} required>
                  <option value="">Select a design…</option>
                  {(designs || []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Subject line</span>
                <input
                  value={form.subjectTemplate}
                  onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })}
                />
              </label>
              <div className="campaign-merge-fields">
                {MERGE_FIELDS.map((mf) => (
                  <button
                    key={mf.value}
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => insertMergeField(mf.value)}
                  >
                    {mf.label}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Email provider</span>
                <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                  <option value="resend">Resend</option>
                  <option value="smtp">SMTP</option>
                </select>
              </label>
              <div className="campaign-form-actions">
                <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!form.designId}>Create</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="app-loading">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="campaigns-empty">No campaigns yet.</div>
          ) : (
            <div className="campaign-list">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className={`campaign-item ${selectedCampaign === c.id ? 'campaign-item-active' : ''}`}
                  onClick={() => loadDetail(c.id)}
                >
                  <div className="campaign-item-name">{c.name || 'Untitled'}</div>
                  <div className="campaign-item-meta">
                    <span className={`campaign-status campaign-status-${c.status}`}>{c.status}</span>
                    <span>{c.sentCount}/{c.totalRecipients} sent</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Campaign detail */}
        <div className="campaigns-detail">
          {detailLoading ? (
            <div className="app-loading">Loading…</div>
          ) : !detail ? (
            <div className="campaigns-detail-empty">
              <p>Select a campaign or create a new one.</p>
            </div>
          ) : (
            <>
              <div className="campaign-detail-head">
                <div>
                  <h2>{detail.name || 'Untitled Campaign'}</h2>
                  <p className="campaign-detail-meta">
                    Design: {detail.designName} · Subject: {detail.subjectTemplate} · Provider: {detail.provider}
                  </p>
                </div>
                <div className="campaign-detail-actions">
                  {detail.status === 'draft' && (
                    <>
                      <button type="button" className="btn-secondary" onClick={openAddRecipients}>
                        Add recipients
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSend}
                        disabled={sending || (detail.recipients || []).length === 0}
                      >
                        {sending ? 'Sending…' : `Send (${(detail.recipients || []).filter((r) => r.status === 'pending').length} pending)`}
                      </button>
                    </>
                  )}
                  <button type="button" className="btn-ghost btn-danger" onClick={() => handleDelete(detail.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="campaign-stats">
                <div className="campaign-stat">
                  <span className="campaign-stat-value">{detail.totalRecipients}</span>
                  <span className="campaign-stat-label">Recipients</span>
                </div>
                <div className="campaign-stat">
                  <span className="campaign-stat-value">{detail.sentCount}</span>
                  <span className="campaign-stat-label">Sent</span>
                </div>
                <div className="campaign-stat">
                  <span className="campaign-stat-value">{detail.failedCount}</span>
                  <span className="campaign-stat-label">Failed</span>
                </div>
              </div>

              {detail.recipients && detail.recipients.length > 0 && (
                <table className="recipients-table" style={{ marginTop: '1rem' }}>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Sent</th>
                      <th>Opened</th>
                      <th>Clicked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recipients.map((r) => (
                      <tr key={r.id}>
                        <td className="recipients-email">{r.email}</td>
                        <td>{r.companyName || '—'}</td>
                        <td>
                          <span className={`campaign-status campaign-status-${r.status}`}>{r.status}</span>
                          {r.error && <span className="campaign-recipient-error" title={r.error}>!</span>}
                        </td>
                        <td>{r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}</td>
                        <td>{r.openedAt ? new Date(r.openedAt).toLocaleString() : '—'}</td>
                        <td>{r.clickedAt ? new Date(r.clickedAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {addRecipientsOpen && (
        <div className="drawer-overlay" onClick={() => setAddRecipientsOpen(false)}>
          <div className="drawer-panel recipients-form-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>Add recipients to campaign</h3>
              <button type="button" className="drawer-close" onClick={() => setAddRecipientsOpen(false)}>✕</button>
            </div>
            <div className="drawer-body">
              <input
                className="recipients-search"
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                placeholder="Search recipients…"
                style={{ marginBottom: '0.75rem' }}
              />
              <div className="campaign-add-recipient-list">
                {filteredRecipients.map((r) => (
                  <label key={r.id} className="batch-recipient-row">
                    <input
                      type="checkbox"
                      checked={selectedRecipients.has(r.id)}
                      onChange={() => {
                        const next = new Set(selectedRecipients);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        setSelectedRecipients(next);
                      }}
                    />
                    <div className="batch-recipient-info">
                      <span className="batch-recipient-email">{r.email}</span>
                      <span className="batch-recipient-company">{r.companyName || '—'}</span>
                    </div>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={handleAddRecipients}
                disabled={selectedRecipients.size === 0}
              >
                Add {selectedRecipients.size} recipient{selectedRecipients.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
