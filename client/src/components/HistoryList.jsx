export default function HistoryList({ proposals, activeProposalId, onSelect }) {
  if (!proposals.length) {
    return <p className="hint-text">Generated proposals for this design will show up here.</p>;
  }
  return (
    <ul className="history-list">
      {proposals.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className={`history-item ${p.id === activeProposalId ? 'history-item-active' : ''}`}
            onClick={() => onSelect(p)}
          >
            <span className="history-company">{p.companyName}</span>
            <span className="history-date">{new Date(p.updatedAt).toLocaleDateString()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
