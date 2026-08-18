import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

export default function RecipientsList() {
  const [recipients, setRecipients] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState({ email: '', companyName: '', firstName: '', lastName: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (tagFilter) params.tag = tagFilter;
      const list = await api.listRecipients(params);
      setRecipients(list);
    } catch (err) {
      console.error('Failed to load recipients', err);
    } finally {
      setLoading(false);
    }
  }, [search, tagFilter]);

  async function loadTags() {
    try {
      const t = await api.getRecipientTags();
      setTags(t);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    loadTags();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  async function loadTags() {
    try {
      const t = await api.getRecipientTags();
      setTags(t);
    } catch { /* ignore */ }
  }

  function openAdd() {
    setForm({ email: '', companyName: '', firstName: '', lastName: '', tags: '' });
    setAddOpen(true);
    setEditRow(null);
    setError('');
  }

  function openEdit(row) {
    setForm({
      email: row.email,
      companyName: row.companyName,
      firstName: row.firstName,
      lastName: row.lastName,
      tags: (row.tags || []).join(', '),
    });
    setEditRow(row);
    setAddOpen(true);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    setSaving(true);
    setError('');
    try {
      const data = {
        email: form.email.trim(),
        companyName: form.companyName.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (editRow) {
        const updated = await api.updateRecipient(editRow.id, data);
        setRecipients((prev) => prev.map((r) => (r.id === editRow.id ? updated : r)));
      } else {
        const created = await api.createRecipient(data);
        setRecipients((prev) => [created, ...prev]);
      }
      setAddOpen(false);
      loadTags();
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this recipient?')) return;
    try {
      await api.deleteRecipient(id);
      setRecipients((prev) => prev.filter((r) => r.id !== id));
      loadTags();
    } catch (err) {
      console.error('Failed to delete', err);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(reader.result);
      setImportResult(null);
      setImportOpen(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleImport() {
    if (!csvText.trim()) return;
    setImporting(true);
    setError('');
    try {
      const result = await api.importRecipients(csvText);
      setImportResult(result);
      load();
      loadTags();
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="recipients-page">
      <div className="recipients-header">
        <div className="recipients-header-l">
          <h2>Recipients</h2>
          <span className="recipients-count">{recipients.length} contacts</span>
        </div>
        <div className="recipients-header-r">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            Import CSV
          </button>
          <button type="button" className="btn-primary" onClick={openAdd}>
            + Add recipient
          </button>
        </div>
      </div>

      <div className="recipients-filters">
        <input
          className="recipients-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or company…"
        />
        {tags.length > 0 && (
          <select className="recipients-tag-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="import-error">{error}</div>}

      {loading ? (
        <div className="app-loading">Loading…</div>
      ) : recipients.length === 0 ? (
        <div className="recipients-empty">
          <p>No recipients yet.</p>
          <p>Import a CSV or add recipients manually to get started.</p>
        </div>
      ) : (
        <div className="recipients-table-wrap">
          <table className="recipients-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Company</th>
                <th>Name</th>
                <th>Tags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="recipients-email">{r.email}</td>
                  <td>{r.companyName}</td>
                  <td>{[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td>
                    <div className="recipients-tags">
                      {(r.tags || []).map((t) => (
                        <span key={t} className="recipients-tag">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="recipients-actions">
                    <button type="button" className="btn-ghost" onClick={() => openEdit(r)}>Edit</button>
                    <button type="button" className="btn-ghost btn-danger" onClick={() => handleDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <div className="drawer-overlay" onClick={() => setAddOpen(false)}>
          <div className="drawer-panel recipients-form-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>{editRow ? 'Edit recipient' : 'Add recipient'}</h3>
              <button type="button" className="drawer-close" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <form className="drawer-body recipient-add-form" onSubmit={handleSave}>
              <label className="field">
                <span>Email *</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </label>
              <label className="field">
                <span>Company</span>
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>First name</span>
                  <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </label>
                <label className="field">
                  <span>Last name</span>
                  <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>Tags (comma-separated)</span>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="e.g. saas, series-a, warm" />
              </label>
              <button type="submit" className="btn-primary" disabled={saving || !form.email.trim()}>
                {saving ? 'Saving…' : editRow ? 'Save changes' : 'Add recipient'}
              </button>
            </form>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="drawer-overlay" onClick={() => setImportOpen(false)}>
          <div className="drawer-panel recipients-form-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>Import recipients from CSV</h3>
              <button type="button" className="drawer-close" onClick={() => { setImportOpen(false); setImportResult(null); }}>✕</button>
            </div>
            <div className="drawer-body">
              <p className="recipients-csv-hint">
                CSV should have columns: <strong>email</strong>, company, first_name, last_name (flexible headers).
              </p>
              <textarea
                className="recipients-csv-textarea"
                rows={10}
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setImportResult(null); }}
                placeholder="email,company,first_name,last_name&#10;jane@acme.com,Acme Corp,Jane,Doe"
              />
              {importResult && (
                <div className="recipients-import-result">
                  <p>Imported: <strong>{importResult.imported}</strong> | Skipped: <strong>{importResult.skipped}</strong> | Total rows: <strong>{importResult.total}</strong></p>
                  {importResult.errors?.length > 0 && (
                    <div className="recipients-import-errors">
                      {importResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}
              <button type="button" className="btn-primary" disabled={importing || !csvText.trim()} onClick={handleImport}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
