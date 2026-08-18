import { useState } from 'react';

export default function ChatBar({ onGenerate, generating, recentCompanies, providers, activeProvider, onBatchClick }) {
  const [value, setValue] = useState('');
  const [provider, setProvider] = useState(activeProvider || '');
  const configuredProviders = Object.entries(providers || {}).filter(([, p]) => p.configured);

  function submit(e) {
    e.preventDefault();
    if (!value.trim() || generating) return;
    onGenerate({ companyName: value.trim(), notes: '', provider });
    setValue('');
  }

  return (
    <div className="chat-bar-wrap">
      {generating && (
        <div className="generating-indicator">
          <div className="generating-spinner" />
          <span>Generating your proposal…</span>
        </div>
      )}
      {recentCompanies.length > 0 && (
        <div className="chat-pills">
          {recentCompanies.slice(0, 4).map((name) => (
            <button
              key={name}
              type="button"
              className="chat-pill"
              disabled={generating}
              onClick={() => onGenerate({ companyName: name, notes: '', provider })}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <form className="chat-bar" onSubmit={submit}>
        {configuredProviders.length > 1 && (
          <select
            className="chat-provider-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={generating}
          >
            {configuredProviders.map(([id, p]) => (
              <option key={id} value={id}>{p.name}</option>
            ))}
          </select>
        )}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter the company you're pitching to (e.g. LagRide, Flutterwave…)"
          disabled={generating}
        />
        {onBatchClick && (
          <button type="button" className="btn-secondary chat-batch-btn" disabled={generating} onClick={onBatchClick}>
            Batch
          </button>
        )}
        <button type="submit" className="btn-primary chat-send" disabled={generating || !value.trim()}>
          {generating ? '…' : 'Generate Proposal'}
        </button>
      </form>
    </div>
  );
}
