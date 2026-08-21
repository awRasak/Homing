import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function BatchGeneratePanel({ designId, onComplete, providers, activeProvider }) {
  const [recipients, setRecipients] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [provider, setProvider] = useState(activeProvider || '');
  const configuredProviders = Object.entries(providers || {}).filter(([, p]) => p.configured);

  useEffect(() => {
    if (activeProvider) setProvider(activeProvider);
  }, [activeProvider]);

  useEffect(() => {
    api.listRecipients().then((list) => {
      setRecipients(list);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === recipients.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(recipients.map((r) => r.id)));
    }
  }, [selected.size, recipients]);

  function startBatch() {
    if (selected.size === 0 || !designId) return;
    setGenerating(true);
    setResults([]);
    setProgress({ current: 0, total: selected.size, status: 'starting' });

    const controller = api.batchGenerate(
      designId,
      { recipientIds: [...selected], provider },
      (event) => {
        if (event.type === 'start') {
          setProgress({ current: 0, total: event.total, status: 'generating' });
        } else if (event.type === 'progress') {
          setProgress({
            current: event.current,
            total: event.total,
            status: event.status,
            companyName: event.companyName,
          });
          if (event.status === 'done' || event.status === 'error') {
            setResults((prev) => [
              ...prev,
              {
                companyName: event.companyName,
                recipientId: event.recipientId,
                status: event.status,
                proposalId: event.proposalId,
                error: event.error,
              },
            ]);
          }
        } else if (event.type === 'done') {
          setGenerating(false);
          setProgress({ current: event.total, total: event.total, status: 'complete' });
          if (onComplete) onComplete();
        } else if (event.type === 'error') {
          setGenerating(false);
          setProgress((prev) => ({ ...prev, status: 'error', error: event.error }));
        }
      },
    );

    window.__batchController = controller;
  }

  function cancelBatch() {
    if (window.__batchController) {
      window.__batchController.abort();
      setGenerating(false);
      setProgress((prev) => ({ ...prev, status: 'cancelled' }));
    }
  }

  const successCount = results.filter((r) => r.status === 'done').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  return (
    <div className="batch-panel">
      <h3>Batch Generate</h3>
      <p className="batch-hint">
        Select recipients to generate tailored proposals for each one.
      </p>

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

      {loading ? (
        <div className="app-loading">Loading recipients…</div>
      ) : recipients.length === 0 ? (
        <p className="batch-empty">No recipients found. Add recipients first.</p>
      ) : (
        <>
          <div className="batch-select-bar">
            <label className="batch-select-all">
              <input
                type="checkbox"
                checked={selected.size === recipients.length && recipients.length > 0}
                onChange={toggleAll}
                disabled={generating}
              />
              <span>Select all ({recipients.length})</span>
            </label>
            <span className="batch-selected-count">{selected.size} selected</span>
          </div>

          <div className="batch-recipient-list">
            {recipients.map((r) => (
              <label key={r.id} className="batch-recipient-row">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  disabled={generating}
                />
                <div className="batch-recipient-info">
                  <span className="batch-recipient-email">{r.email}</span>
                  <span className="batch-recipient-company">{r.companyName || '—'}</span>
                </div>
              </label>
            ))}
          </div>

          {progress && (
            <div className="batch-progress">
              <div className="batch-progress-bar">
                <div
                  className="batch-progress-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <div className="batch-progress-text">
                {progress.status === 'complete'
                  ? `Done — ${successCount} generated, ${errorCount} failed`
                  : progress.status === 'error'
                  ? `Error: ${progress.error}`
                  : `${progress.current}/${progress.total} — ${progress.companyName || ''}`}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="batch-results">
              {results.map((r, i) => (
                <div key={i} className={`batch-result batch-result-${r.status}`}>
                  <span>{r.companyName}</span>
                  <span>{r.status === 'done' ? '✓' : '✗ ' + r.error}</span>
                </div>
              ))}
            </div>
          )}

          <div className="batch-actions">
            {generating ? (
              <button type="button" className="btn-secondary" onClick={cancelBatch}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={startBatch}
                disabled={selected.size === 0}
              >
                Generate {selected.size} proposal{selected.size !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
