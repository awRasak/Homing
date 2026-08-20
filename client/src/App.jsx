import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import OnboardingModal from './components/OnboardingModal';
import DesignStrip from './components/DesignStrip';
import ChatBar from './components/ChatBar';
import PreviewDocument from './components/PreviewDocument';
import LivePreview from './components/LivePreview';
import ImportPanel from './components/ImportPanel';
import NavRail from './components/NavRail';
import ComingSoon from './components/ComingSoon';
import EditDesignDrawer from './components/EditDesignDrawer';
import Dashboard from './components/Dashboard';
import RecipientsList from './components/RecipientsList';
import CampaignBuilder from './components/CampaignBuilder';
import SetupForm from './components/SetupForm';
import RecipientForm from './components/RecipientForm';
import BatchGeneratePanel from './components/BatchGeneratePanel';
import HistoryList from './components/HistoryList';
import BeccaLayout from './components/BeccaLayout';
import BeccaSettings from './components/BeccaSettings';
import './App.css';

const DEFAULT_FONT = 'Inter';
const ACTIVE_ID_KEY = 'homing:activeDesignId';
const THEME_KEY = 'homing:theme';

const SECTION_META = {
  proposals: { name: 'Proposals', status: 'Tailored proposal generator' },
  recipients: { name: 'Recipients', status: 'Manage your email list' },
  campaigns: { name: 'Campaigns', status: 'Send proposals at scale' },
  dashboard: { name: 'Dashboard', status: 'Your saved proposals' },
  becca: { name: 'Homin', status: 'Personal Intelligence Assistant' },
  settings: { name: 'Settings', status: 'Coming soon' },
};

const COMING_SOON_COPY = {
  settings: { icon: '⚙️', title: 'Settings', description: 'Account and profile settings are coming soon.' },
};

const BECCA_WORKSPACE = 'default';

export default function App() {
  const [section, setSection] = useState('becca');
  const [theme, setTheme] = useState(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'));
  const [designs, setDesigns] = useState([]);
  const [activeDesignId, setActiveDesignId] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [currentProposal, setCurrentProposal] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [providers, setProviders] = useState({});
  const [activeProvider, setActiveProvider] = useState('anthropic');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [tab, setTab] = useState('setup'); // 'setup' | 'generate'
  const [editOpen, setEditOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [allProposals, setAllProposals] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | pending | saving | saved | error
  const [beccaSection, setBeccaSection] = useState('chat'); // chat | watchlist | pipeline | briefings | reminders
  const [proposalTab, setProposalTab] = useState('editor'); // editor | recipients | campaigns | dashboard
  const [beccaTopics, setBeccaTopics] = useState([]);
  const [beccaProfile, setBeccaProfile] = useState(null);
  const [beccaMemory, setBeccaMemory] = useState([]);
  const [beccaReminders, setBeccaReminders] = useState([]);
  const [beccaBriefings, setBeccaBriefings] = useState([]);
  const [beccaSettings, setBeccaSettings] = useState({ dailyOn: false, dailyTime: '07:00', quietFrom: '22:00', quietTo: '07:00' });
  const [beccaSettingsOpen, setBeccaSettingsOpen] = useState(false);
  const [beccaModel, setBeccaModel] = useState(() => localStorage.getItem('homin:model') || 'gpt-oss-20b');

  const bootstrapped = useRef(false);
  const saveTimers = useRef({});
  const savedResetTimer = useRef(null);
  const pendingProposalId = useRef(null);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (next === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const status = await api.status();
        setProviders(status.providers || {});
        setActiveProvider(status.activeProvider || 'anthropic');
        setAiConfigured(Object.values(status.providers || {}).some((p) => p.configured));

        const list = await api.listDesigns();
        if (list.length === 0) {
          const created = await api.createDesign({});
          setDesigns([created]);
          setActiveDesignId(created.id);
          localStorage.setItem(ACTIVE_ID_KEY, created.id);
          setShowOnboarding(true);
        } else {
          setDesigns(list);
          const saved = localStorage.getItem(ACTIVE_ID_KEY);
          const initialId = list.find((d) => d.id === saved)?.id || list[0].id;
          setActiveDesignId(initialId);
        }

        // Load Becca data
        try {
          const [topics, profile, memory, reminders, briefings, settings] = await Promise.all([
            api.becca.listTopics(BECCA_WORKSPACE),
            api.becca.getProfile(BECCA_WORKSPACE),
            api.becca.listMemory(BECCA_WORKSPACE),
            api.becca.listReminders(BECCA_WORKSPACE),
            api.becca.listBriefings(BECCA_WORKSPACE, 100),
            api.becca.getSettings(BECCA_WORKSPACE),
          ]);
          setBeccaTopics(topics || []);
          setBeccaProfile(profile);
          setBeccaMemory(memory || []);
          setBeccaReminders(reminders || []);
          setBeccaBriefings(briefings || []);
          if (settings) setBeccaSettings(settings);
        } catch { /* becca not available */ }
      } catch (err) {
        console.error('Failed to load designs', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeDesignId) return;
    localStorage.setItem(ACTIVE_ID_KEY, activeDesignId);
    setCurrentPage(1);
    api
      .listProposals(activeDesignId)
      .then((list) => {
        setProposals(list);
        const targetId = pendingProposalId.current;
        pendingProposalId.current = null;
        setCurrentProposal(targetId ? list.find((p) => p.id === targetId) || null : null);
      })
      .catch((err) => console.error('Failed to load proposal history', err));
  }, [activeDesignId]);

  useEffect(() => {
    if (section !== 'dashboard') return;
    setDashboardLoading(true);
    api
      .listAllProposals()
      .then(setAllProposals)
      .catch((err) => console.error('Failed to load dashboard proposals', err))
      .finally(() => setDashboardLoading(false));
  }, [section]);

  const activeDesign = useMemo(
    () => designs.find((d) => d.id === activeDesignId) || null,
    [designs, activeDesignId]
  );

  function patchDesign(id, patch, { persist = true } = {}) {
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    if (!persist) return;
    setSaveStatus('pending');
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => attemptSave(id, patch, 0), 500);
  }

  function attemptSave(id, patch, retryCount) {
    setSaveStatus('saving');
    api
      .updateDesign(id, patch)
      .then(() => {
        setSaveStatus('saved');
        clearTimeout(savedResetTimer.current);
        savedResetTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
      })
      .catch((err) => {
        console.error('Failed to save design', err);
        if (retryCount < 3) {
          setSaveStatus('retrying');
          setTimeout(() => attemptSave(id, patch, retryCount + 1), 1500 * (retryCount + 1));
        } else {
          setSaveStatus('error');
        }
      });
  }

  function handleSetupChange(patch) {
    if (!activeDesign) return;
    patchDesign(activeDesign.id, patch);
  }

  async function handleCreateDesign() {
    try {
      const created = await api.createDesign({});
      setDesigns((prev) => [...prev, created]);
      setActiveDesignId(created.id);
      setImportFile(null);
      setShowOnboarding(true);
      setTab('setup');
      setEditOpen(false);
    } catch (err) {
      console.error('Failed to create design', err);
    }
  }

  function handleRenameDesign(id, name) {
    patchDesign(id, { name });
  }

  async function handleDeleteDesign(id) {
    try {
      await api.deleteDesign(id);
      const remaining = designs.filter((d) => d.id !== id);
      if (remaining.length === 0) {
        const created = await api.createDesign({});
        setDesigns([created]);
        setActiveDesignId(created.id);
        setShowOnboarding(true);
      } else {
        setDesigns(remaining);
        setActiveDesignId(remaining[0].id);
      }
      setImportFile(null);
    } catch (err) {
      console.error('Failed to delete design', err);
    }
  }

  function handleImportFile(file) {
    setImportFile(file);
    setEditOpen(false);
  }

  function handleImportDone() {
    setImportFile(null);
    setTab('setup');
    setEditOpen(true);
  }

  function handleOnboardingUpload(file) {
    setShowOnboarding(false);
    handleImportFile(file);
  }
  function handleOnboardingSkip() {
    setShowOnboarding(false);
    setTab('setup');
    setEditOpen(true);
  }

  function handleExtracted({ content, fonts, notes, sourceImage, blocks, pages }) {
    if (!activeDesign) return;
    const patch = {};
    const fillNotes = [...notes];

    if (content) {
      if (content.senderName && !activeDesign.senderName) patch.senderName = content.senderName;
      if (content.contactEmail && !activeDesign.tagline) patch.tagline = content.contactEmail;
      if (content.styleSample && !activeDesign.styleSample) patch.styleSample = content.styleSample;
      if (content.sections?.length && (activeDesign.staticSections || []).length === 0) {
        patch.staticSections = content.sections;
      }
      if (content.detectedHeadline) patch.detectedHeadline = content.detectedHeadline;
    }

    if (fonts) {
      if (activeDesign.headlineFont === DEFAULT_FONT) patch.headlineFont = fonts.headline.family;
      if (activeDesign.bodyFont === DEFAULT_FONT) patch.bodyFont = fonts.body.family;
      fillNotes.push(
        `Headline font ${fonts.headline.outcome === 'exact' ? 'matched' : fonts.headline.outcome === 'metric-compatible' ? 'swapped to a metric-compatible font' : 'guessed'}: ${fonts.headline.family}.`,
        `Body font ${fonts.body.outcome === 'exact' ? 'matched' : fonts.body.outcome === 'metric-compatible' ? 'swapped to a metric-compatible font' : 'guessed'}: ${fonts.body.family}.`
      );
    }

    if (sourceImage) {
      patch.sourceImageDataUrl = sourceImage.dataUrl;
      patch.sourceImageWidth = sourceImage.width;
      patch.sourceImageHeight = sourceImage.height;
      patch.sourceTextBlocks = blocks || [];
      patch.textOverrides = {};
    }

    if (pages?.length) {
      patch.pages = pages.map((p) => ({
        pageNum: p.pageNum,
        dataUrl: p.dataUrl,
        width: p.width,
        height: p.height,
        blocks: p.blocks,
      }));
      patch.pageOverrides = {};
      setCurrentPage(1);
    }

    patch.extractionNote = fillNotes.join(' ');
    if (Object.keys(patch).length > 0) patchDesign(activeDesign.id, patch);
  }

  function handleTextOverride(blockId, text) {
    if (!activeDesign) return;
    const pages = activeDesign.pages || [];
    if (pages.length > 1) {
      const pageNum = String(currentPage);
      const currentOverrides = activeDesign.pageOverrides || {};
      const pageOverrides = { ...(currentOverrides[pageNum] || {}), [blockId]: text };
      const next = { ...currentOverrides, [pageNum]: pageOverrides };
      patchDesign(activeDesign.id, { pageOverrides: next });
    } else {
      const next = { ...(activeDesign.textOverrides || {}), [blockId]: text };
      patchDesign(activeDesign.id, { textOverrides: next });
    }
  }

  function handleAccentPicked(hex) {
    if (!activeDesign) return;
    patchDesign(activeDesign.id, { accentColor: hex });
  }

  function handleLogoExtracted(dataUrl) {
    if (!activeDesign) return;
    patchDesign(activeDesign.id, { logoDataUrl: dataUrl });
  }

  async function handleGenerate({ companyName, notes, provider, model }) {
    if (!activeDesign) return;
    setGenerating(true);
    setGenError('');
    try {
      const proposal = await api.generate(activeDesign.id, { companyName, notes, provider, model });
      setCurrentProposal(proposal);
      setProposals((prev) => {
        const withoutDup = prev.filter((p) => p.id !== proposal.id);
        return [proposal, ...withoutDup];
      });
      const titleBlock = (activeDesign.sourceTextBlocks || []).find((b) => b.tier === 'title');
      if (titleBlock && proposal.headline) {
        handleTextOverride(titleBlock.id, proposal.headline);
      }
    } catch (err) {
      setGenError(err.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  function handleSelectHistory(proposal) {
    setCurrentProposal(proposal);
  }

  function handleContinueProposal(proposal) {
    pendingProposalId.current = proposal.id;
    if (proposal.designId === activeDesignId) {
      setCurrentProposal(proposal);
      pendingProposalId.current = null;
    } else {
      setActiveDesignId(proposal.designId);
    }
    setSection('proposals');
  }

  async function handleExport() {
    if (currentProposal?.id) {
      try {
        await api.downloadPDF(currentProposal.id);
      } catch (err) {
        console.error('PDF download failed', err);
        window.print();
      }
    } else {
      window.print();
    }
  }

  const recentCompanies = useMemo(
    () => [...new Set(proposals.map((p) => p.companyName))],
    [proposals]
  );

  // ═══════════════════════════════════════════
  // BECCA HANDLERS
  // ═══════════════════════════════════════════
  async function handleBeccaAddTopic(name, context) {
    const existing = beccaTopics.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return false;
    try {
      const result = await api.becca.addTopic({ name, context, workspace: BECCA_WORKSPACE });
      const newTopic = { id: result.id, name, context, priority: 'medium', workspace: BECCA_WORKSPACE };
      setBeccaTopics(prev => [...prev, newTopic]);
      return true;
    } catch { return false; }
  }

  async function handleBeccaRemoveTopic(id) {
    await api.becca.deleteTopic(id);
    setBeccaTopics(prev => prev.filter(t => t.id !== id));
  }

  async function handleBeccaUpdateTopic(id, data) {
    await api.becca.updateTopic(id, data);
    setBeccaTopics(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
  }

  async function handleBeccaSaveProfile(data) {
    await api.becca.saveProfile({ ...data, workspace: BECCA_WORKSPACE });
    setBeccaProfile({ ...data, workspace: BECCA_WORKSPACE });
  }

  async function handleBeccaAddMemory(content) {
    const result = await api.becca.addMemory({ content, workspace: BECCA_WORKSPACE });
    setBeccaMemory(prev => [...prev, { id: result.id, content, workspace: BECCA_WORKSPACE }]);
  }

  async function handleBeccaRemoveMemory(id) {
    await api.becca.deleteMemory(id);
    setBeccaMemory(prev => prev.filter(m => m.id !== id));
  }

  async function handleBeccaSaveSettings(key, value) {
    await api.becca.saveSettings(key, value, BECCA_WORKSPACE);
    setBeccaSettings(prev => ({ ...prev, ...value }));
  }

  function handleBeccaNavigate(target) {
    setSection('becca');
    setBeccaSection(target);
  }

  async function handleBeccaDismissReminder(id) {
    await api.becca.deleteReminder(id);
    setBeccaReminders(prev => prev.filter(r => r.id !== id));
  }

  async function handleBeccaAddReminder(data) {
    const result = await api.becca.addReminder({ ...data, workspace: BECCA_WORKSPACE });
    const now = new Date().toISOString();
    setBeccaReminders(prev => [{ id: result.id, text: data.text, due: data.due || null, when_raw: data.when_raw || '', fired: 0, dismissed: 0, created_at: now }, ...prev]);
  }

  if (loading) {
    return <div className="app-loading">Loading…</div>;
  }

  const meta = SECTION_META[section];

  return (
    <div className="app-shell">
      <NavRail section={section} onNavigate={setSection} theme={theme} onToggleTheme={toggleTheme}
        onOpenProfile={() => { setSection('becca'); setBeccaSettingsOpen(true); }} />

      <div className="main-area">
        <header className="topbar no-print">
          <div className={`topbar-l ${section === 'becca' ? 'clickable' : ''}`}
            onClick={section === 'becca' ? () => setBeccaSection('chat') : undefined}>
            <div className="topbar-spark">✦</div>
            <div>
              <div className="topbar-name">{meta.name}</div>
              <div className="topbar-status">{meta.status}</div>
            </div>
          </div>
          {section === 'proposals' && (
            <div className="topbar-r">
              {activeDesign && saveStatus !== 'idle' && (
                <span className={`save-status save-status-${saveStatus}`}>
                  {saveStatus === 'pending' && 'Unsaved changes'}
                  {saveStatus === 'saving' && 'Saving…'}
                  {saveStatus === 'retrying' && 'Save failed, retrying…'}
                  {saveStatus === 'saved' && 'Saved ✓'}
                  {saveStatus === 'error' && "Couldn't save — check your connection"}
                </span>
              )}
              <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
                Edit design
              </button>
              <button type="button" className="btn-primary" onClick={handleExport} disabled={!currentProposal}>
                Download PDF
              </button>
            </div>
          )}
        </header>

        {section === 'becca' ? (
          <div className="section-body becca-section">
            <BeccaLayout
              topics={beccaTopics} profile={beccaProfile} memory={beccaMemory}
              briefings={beccaBriefings} reminders={beccaReminders} settings={beccaSettings}
              onAddTopic={handleBeccaAddTopic} onRemoveTopic={handleBeccaRemoveTopic}
              onUpdateTopic={handleBeccaUpdateTopic} onSaveSettings={handleBeccaSaveSettings}
              onAddReminder={handleBeccaAddReminder} onDismissReminder={handleBeccaDismissReminder}
              workspace={BECCA_WORKSPACE} beccaSection={beccaSection} onSectionChange={setBeccaSection}
              beccaModel={beccaModel} onModelChange={(m) => { setBeccaModel(m); localStorage.setItem('homin:model', m); }} />
            {beccaSettingsOpen && (
              <BeccaSettings profile={beccaProfile} memory={beccaMemory} settings={beccaSettings}
                onSaveProfile={handleBeccaSaveProfile} onAddMemory={handleBeccaAddMemory} onRemoveMemory={handleBeccaRemoveMemory}
                onSaveSettings={handleBeccaSaveSettings} onClose={() => setBeccaSettingsOpen(false)} />
            )}
          </div>
        ) : section === 'proposals' ? (
          <div className="section-body proposals-section">
            <div className="becca-topbar">
              <div className="becca-topbar-tabs">
                {['editor', 'recipients', 'campaigns', 'dashboard'].map(t => (
                  <button key={t} className={`becca-tab ${proposalTab === t ? 'active' : ''}`}
                    onClick={() => setProposalTab(t)}>
                    {t === 'editor' ? '✏️ Editor' : t === 'recipients' ? '👤 Recipients' : t === 'campaigns' ? '📧 Campaigns' : '📊 Dashboard'}
                  </button>
                ))}
              </div>
            </div>
            <div className="becca-content">
              {proposalTab === 'editor' && (
                <div className="editor-layout">
                  {showOnboarding && (
                    <OnboardingModal onUpload={handleOnboardingUpload} onSkip={handleOnboardingSkip} />
                  )}
                  <div className="editor-sidebar no-print">
                    <DesignStrip
                      designs={designs}
                      activeDesignId={activeDesignId}
                      onSelect={setActiveDesignId}
                      onCreate={handleCreateDesign}
                      onRename={handleRenameDesign}
                      onDelete={handleDeleteDesign}
                    />
                  </div>

                  <div className="editor-canvas">
                    {!aiConfigured && (
                      <div className="banner-warning no-print">
                        No AI providers configured — generation is disabled. Add an API key to server/.env and restart the server.
                      </div>
                    )}
                    {activeDesign && importFile && (
                      <div className="app-preview-full">
                        <div className="import-review-head">
                          <span>Reviewing uploaded design — pick a color, crop the logo, then continue.</span>
                          <button type="button" className="btn-primary" onClick={handleImportDone}>Done</button>
                        </div>
                        <ImportPanel file={importFile} onExtracted={handleExtracted}
                          onLogoExtracted={handleLogoExtracted} onAccentPicked={handleAccentPicked} />
                      </div>
                    )}
                    {activeDesign && !importFile && (
                      <div className="preview-area">
                        <div className="preview-viewport">
                          {activeDesign.sourceImageDataUrl ? (
                            (() => {
                              const pages = activeDesign.pages || [];
                              const isMultiPage = pages.length > 1;
                              const pageData = isMultiPage ? pages[currentPage - 1] : null;
                              const displayDataUrl = pageData?.dataUrl || activeDesign.sourceImageDataUrl;
                              const displayWidth = pageData?.width || activeDesign.sourceImageWidth;
                              const displayHeight = pageData?.height || activeDesign.sourceImageHeight;
                              const displayBlocks = pageData?.blocks || activeDesign.sourceTextBlocks || [];
                              const displayOverrides = isMultiPage
                                ? ((activeDesign.pageOverrides || {})[String(currentPage)] || {})
                                : (activeDesign.textOverrides || {});

                              return (
                                <>
                                  <LivePreview
                                    sourceImageDataUrl={displayDataUrl}
                                    sourceImageWidth={displayWidth}
                                    sourceImageHeight={displayHeight}
                                    sourceTextBlocks={displayBlocks}
                                    textOverrides={displayOverrides}
                                    onOverride={handleTextOverride}
                                  />
                                  {isMultiPage && (
                                    <div className="pagination-controls no-print">
                                      <button
                                        type="button"
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        disabled={currentPage <= 1}
                                      >
                                        ‹
                                      </button>
                                      <span className="pagination-counter">{currentPage} / {pages.length}</span>
                                      <button
                                        type="button"
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
                                        disabled={currentPage >= pages.length}
                                      >
                                        ›
                                      </button>
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <PreviewDocument design={activeDesign} proposal={currentProposal} companyName={currentProposal?.companyName} />
                          )}
                        </div>
                        {currentProposal && (
                          <div className="proposal-actions no-print">
                            <button type="button" className="btn-secondary" onClick={handleExport}>Download PDF</button>
                            <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>Edit proposal</button>
                          </div>
                        )}
                        {!currentProposal && activeDesign && (
                          <div className="empty-state no-print">
                            <div className="empty-state-steps">
                              <div className="empty-step">
                                <span className="empty-step-num">1</span>
                                <span className="empty-step-text">Fill in your details</span>
                              </div>
                              <div className="empty-step-arrow">→</div>
                              <div className="empty-step">
                                <span className="empty-step-num">2</span>
                                <span className="empty-step-text">Enter a company name</span>
                              </div>
                              <div className="empty-step-arrow">→</div>
                              <div className="empty-step">
                                <span className="empty-step-num">3</span>
                                <span className="empty-step-text">Generate</span>
                              </div>
                            </div>
                            <button type="button" className="btn-primary" onClick={() => setEditOpen(true)}>Get started</button>
                          </div>
                        )}
                        <div className="no-print">
                          <ChatBar
                            onGenerate={handleGenerate}
                            generating={generating}
                            recentCompanies={recentCompanies}
                            providers={providers}
                            activeProvider={activeProvider}
                            onBatchClick={() => { setTab('batch'); setEditOpen(true); }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="editor-panel no-print">
                    <div className="panel-step-indicator">
                      <span className={`panel-step ${tab === 'setup' ? 'panel-step-active' : tab === 'generate' || tab === 'batch' ? 'panel-step-done' : ''}`}>
                        <span className="panel-step-num">1</span> Setup
                      </span>
                      <span className="panel-step-arrow">→</span>
                      <span className={`panel-step ${tab === 'generate' ? 'panel-step-active' : tab === 'batch' ? 'panel-step-done' : ''}`}>
                        <span className="panel-step-num">2</span> Generate
                      </span>
                      <span className="panel-step-arrow">→</span>
                      <span className={`panel-step ${tab === 'batch' ? 'panel-step-active' : ''}`}>
                        <span className="panel-step-num">3</span> Batch
                      </span>
                    </div>
                    <div className="panel-tabs-lg">
                      <button
                        type="button"
                        className={tab === 'setup' ? 'panel-tab-lg panel-tab-lg-active' : 'panel-tab-lg'}
                        onClick={() => onTabChange('setup')}
                      >
                        Setup
                      </button>
                      <button
                        type="button"
                        className={tab === 'generate' ? 'panel-tab-lg panel-tab-lg-active' : 'panel-tab-lg'}
                        onClick={() => onTabChange('generate')}
                      >
                        Generate
                      </button>
                      <button
                        type="button"
                        className={tab === 'batch' ? 'panel-tab-lg panel-tab-lg-active' : 'panel-tab-lg'}
                        onClick={() => onTabChange('batch')}
                      >
                        Batch
                      </button>
                    </div>
                    <div className="panel-content">
                      {tab === 'setup' && (
                        <SetupForm
                          design={activeDesign}
                          onChange={handleSetupChange}
                          importFile={importFile}
                          onImportFile={handleImportFile}
                        />
                      )}
                      {tab === 'generate' && (
                        <div className="generate-panel">
                          <RecipientForm onGenerate={onGenerate} generating={generating} providers={providers} activeProvider={activeProvider} />
                          {genError && <p className="import-error">{genError}</p>}
                          <h3 style={{ marginTop: '1.5rem' }}>History</h3>
                          <HistoryList proposals={proposals} activeProposalId={currentProposal?.id} onSelect={handleSelectHistory} />
                        </div>
                      )}
                      {tab === 'batch' && (
                        <BatchGeneratePanel
                          designId={activeDesign?.id}
                          providers={providers}
                          activeProvider={activeProvider}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {proposalTab === 'recipients' && <RecipientsList />}
              {proposalTab === 'campaigns' && <CampaignBuilder designs={designs} />}
              {proposalTab === 'dashboard' && <Dashboard proposals={allProposals} loading={dashboardLoading} onContinue={handleContinueProposal} />}
            </div>
          </div>
        ) : (
          <div className="section-body">
            <ComingSoon {...COMING_SOON_COPY[section]} />
          </div>
        )}
      </div>

      <EditDesignDrawer
        open={editOpen && section === 'proposals' && Boolean(activeDesign)}
        onClose={() => setEditOpen(false)}
        tab={tab}
        onTabChange={setTab}
        design={activeDesign}
        onChange={handleSetupChange}
        importFile={importFile}
        onImportFile={handleImportFile}
        onGenerate={handleGenerate}
        generating={generating}
        genError={genError}
        proposals={proposals}
        activeProposalId={currentProposal?.id}
        onSelectHistory={handleSelectHistory}
        providers={providers}
        activeProvider={activeProvider}
      />
    </div>
  );
}
