import SetupForm from './SetupForm';
import RecipientForm from './RecipientForm';
import HistoryList from './HistoryList';
import BatchGeneratePanel from './BatchGeneratePanel';

export default function EditDesignDrawer({
  open,
  onClose,
  tab,
  onTabChange,
  design,
  onChange,
  importFile,
  onImportFile,
  onGenerate,
  generating,
  genError,
  proposals,
  activeProposalId,
  onSelectHistory,
  providers,
  activeProvider,
}) {
  if (!open) return null;

  return (
    <div className="drawer-overlay no-print" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="panel-tabs">
            <button
              type="button"
              className={tab === 'setup' ? 'panel-tab panel-tab-active' : 'panel-tab'}
              onClick={() => onTabChange('setup')}
            >
              Design setup
            </button>
            <button
              type="button"
              className={tab === 'generate' ? 'panel-tab panel-tab-active' : 'panel-tab'}
              onClick={() => onTabChange('generate')}
            >
              Generate
            </button>
            <button
              type="button"
              className={tab === 'batch' ? 'panel-tab panel-tab-active' : 'panel-tab'}
              onClick={() => onTabChange('batch')}
            >
              Batch
            </button>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {tab === 'setup' ? (
            <SetupForm design={design} onChange={onChange} importFile={importFile} onImportFile={onImportFile} />
          ) : tab === 'batch' ? (
            <BatchGeneratePanel
              designId={design?.id}
              providers={providers}
              activeProvider={activeProvider}
            />
          ) : (
            <div className="generate-panel">
              <RecipientForm onGenerate={onGenerate} generating={generating} providers={providers} activeProvider={activeProvider} />
              {genError && <p className="import-error">{genError}</p>}
              <h3 style={{ marginTop: '1.5rem' }}>History</h3>
              <HistoryList proposals={proposals} activeProposalId={activeProposalId} onSelect={onSelectHistory} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
