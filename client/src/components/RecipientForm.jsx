import { useState } from 'react';

export default function RecipientForm({ onGenerate, generating, providers, activeProvider }) {
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [provider, setProvider] = useState(activeProvider || '');
  const configuredProviders = Object.entries(providers || {}).filter(([, p]) => p.configured);

  function submit(e) {
    e.preventDefault();
    if (!companyName.trim()) return;
    onGenerate({ companyName: companyName.trim(), notes: notes.trim(), provider });
  }

  return (
    <form className="recipient-form" onSubmit={submit}>
      <label className="field">
        <span>Company name</span>
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" required />
      </label>
      <label className="field">
        <span>Context notes (optional)</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Industry, pain point, how the relationship started…"
        />
      </label>
      {configuredProviders.length > 1 && (
        <label className="field">
          <span>AI Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={generating}>
            {configuredProviders.map(([id, p]) => (
              <option key={id} value={id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="btn-primary" disabled={generating || !companyName.trim()}>
        {generating ? 'Generating…' : 'Generate tailored copy'}
      </button>
    </form>
  );
}
