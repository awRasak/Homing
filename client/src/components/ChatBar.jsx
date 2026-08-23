import { useState, useEffect } from 'react';

export default function ChatBar({ onGenerate, generating, recentCompanies, providers, activeProvider, onBatchClick, genError }) {
  const [value, setValue] = useState('');
  const [provider, setProvider] = useState(activeProvider || '');
  const configuredProviders = Object.entries(providers || {}).filter(([, p]) => p.configured);

  useEffect(() => {
    if (activeProvider) setProvider(activeProvider);
  }, [activeProvider]);

  function submit(e) {
    e.preventDefault();
    if (!value.trim() || generating) return;
    onGenerate({ companyName: value.trim(), notes: '', provider });
    setValue('');
  }

  return (
    <div className="chat-bar-wrap">
      {genError && <div className="chat-error">{genError}</div>}
      <form className="chat-bar" onSubmit={submit}>
        {configuredProviders.length > 1 && (
          <select
            className="input-model-select"
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
          placeholder="Enter the company you're pitching to…"
          disabled={generating}
        />
        {onBatchClick && (
          <button type="button" className="chat-pill" disabled={generating} onClick={onBatchClick}>
            Batch
          </button>
        )}
        <button type="submit" className="input-send" disabled={generating || !value.trim()}>
          {generating ? '…' : '→'}
        </button>
      </form>
    </div>
  );
}
