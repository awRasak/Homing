import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth, setAuthToken, getAuthToken } from './api';
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
import { buildProposalPdf, downloadPdfBytes } from './lib/buildEditedPdf';
import BeccaLayout from './components/BeccaLayout';
import BeccaSettings from './components/BeccaSettings';
import CompanyOnboarding from './components/CompanyOnboarding';
import DesignEditor from './components/design/DesignEditor';
import './App.css';

const DEFAULT_FONT = 'Inter';
const ACTIVE_ID_KEY = 'homing:activeDesignId';
const THEME_KEY = 'homing:theme';

const SECTION_META = {
  proposals: { name: 'Proposal', status: 'Tailored proposal generator' },
  recipients: { name: 'Recipients', status: 'Manage your email list' },
  campaigns: { name: 'Campaigns', status: 'Send proposals at scale' },
  dashboard: { name: 'Dashboard', status: 'Your saved proposals' },
  becca: { name: 'Homin', status: 'Personal Intelligence Assistant' },
  design: { name: 'Design', status: 'AI-powered canvas editor' },
  settings: { name: 'Settings', status: 'Coming soon' },
};

const COMING_SOON_COPY = {
  settings: { icon: '⚙️', title: 'Settings', description: 'Account and profile settings are coming soon.' },
};

export default function App() {
  const [section, setSection] = useState('becca');
  const [theme, setTheme] = useState(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'));
  const [designs, setDesigns] = useState([]);
  const [activeDesignId, setActiveDesignId] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [currentProposal, setCurrentProposal] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [importFile, setImportFile] = useState(null);
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
  const [showCompanySetup, setShowCompanySetup] = useState(false);
  const [setupPhase, setSetupPhase] = useState(null); // null | 'saving' | 'complete'
  const [chatGreeting, setChatGreeting] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authHint, setAuthHint] = useState('');

  const bootstrapped = useRef(false);
  const saveTimers = useRef({});
  const savedResetTimer = useRef(null);
  const pendingProposalId = useRef(null);
  const setupTimer = useRef(null);

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
    setLoading(false);

    // Keep the backend warm while the tab is open (Render sleeps after ~15 min idle,
    // and the GitHub cron is unreliable with long delays).
    const heartbeat = setInterval(() => {
      fetch(`${import.meta.env.VITE_API_BASE || '/api'}/status`).catch(() => {});
    }, 5 * 60 * 1000);
    const reset = () => clearInterval(heartbeat);
    window.addEventListener('beforeunload', reset);

    (async () => {
      // Check auth
      const token = getAuthToken();
      if (token) {
        try {
          const me = await auth.me();
          setAuthUser(me.user);
        } catch {
          setAuthToken(null);
        }
      }
      setAuthLoading(false);
      await loadWorkspaceData();
    })();
  }, []);

  // Loads providers, designs, and Becca data — safe to call again after the
  // auth token becomes available (bootstrap runs before login/signup).
  async function loadWorkspaceData() {
    try {
      const status = await api.status();
      setProviders(status.providers || {});
      setActiveProvider(status.activeProvider || 'anthropic');
    } catch { /* providers optional */ }

    try {
      const list = await api.listDesigns();
      if (list.length === 0) {
        const created = await api.createDesign({});
        setDesigns([created]);
        setActiveDesignId(created.id);
        localStorage.setItem(ACTIVE_ID_KEY, created.id);
        setShowOnboarding(true);
      } else {
        setDesigns((prev) => prev.length ? prev : list);
        const saved = localStorage.getItem(ACTIVE_ID_KEY);
        const initialId = list.find((d) => d.id === saved)?.id || list[0].id;
        setActiveDesignId(initialId);
      }
    } catch (err) {
      console.error('Failed to load designs', err);
    }

    let loaded = { topics: [], briefings: [] };
    try {
      const [topics, profile, memory, reminders, briefings, settings] = await Promise.all([
        api.becca.listTopics(),
        api.becca.getProfile(),
        api.becca.listMemory(),
        api.becca.listReminders(),
        api.becca.listBriefings(100),
        api.becca.getSettings(),
      ]);
      loaded = { topics: topics || [], briefings: briefings || [] };
      setBeccaTopics(topics || []);
      setBeccaProfile(profile);
      setBeccaMemory(memory || []);
      setBeccaReminders(reminders || []);
      setBeccaBriefings(briefings || []);
      if (settings) setBeccaSettings(settings);
    } catch { /* becca not available */ }
    return loaded;
  }

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

      // Map AI-generated content onto text blocks in live-PDF mode
      const allBlocks = activeDesign.pages?.length
        ? (activeDesign.pages[0]?.blocks || [])
        : (activeDesign.sourceTextBlocks || []);
      if (allBlocks.length && (proposal.opening || proposal.bodyParagraphs?.length || proposal.closing)) {
        const titleBlock = allBlocks.find((b) => b.tier === 'title');
        const bodyBlocks = allBlocks
          .filter((b) => b.tier === 'body' && (!titleBlock || b.id !== titleBlock.id))
          .sort((a, b) => a.y - b.y);

        // Group body blocks into paragraph zones by vertical proximity
        const avgHeight = bodyBlocks.length ? bodyBlocks.reduce((s, b) => s + b.height, 0) / bodyBlocks.length : 0;
        const gapThreshold = avgHeight * 2.5 || 30;
        const zones = [];
        for (const b of bodyBlocks) {
          const lastZone = zones[zones.length - 1];
          if (lastZone && (b.y - lastZone[lastZone.length - 1].y - lastZone[lastZone.length - 1].height) <= gapThreshold) {
            lastZone.push(b);
          } else {
            zones.push([b]);
          }
        }

        // Build content list: opening + bodyParagraphs + closing
        const contentPieces = [];
        if (proposal.opening) contentPieces.push(proposal.opening);
        if (proposal.bodyParagraphs?.length) contentPieces.push(...proposal.bodyParagraphs);
        if (proposal.closing) contentPieces.push(proposal.closing);

        if (zones.length > 0 && contentPieces.length > 0) {
          const newOverrides = {};
          // Distribute content across zones
          for (let i = 0; i < zones.length; i++) {
            const text = i < contentPieces.length ? contentPieces[i] : '';
            // Apply text to the first block in each zone, clear the rest
            zones[i].forEach((block, j) => {
              newOverrides[block.id] = j === 0 ? text : '';
            });
          }
          // If more content pieces than zones, merge extras into the last zone
          if (contentPieces.length > zones.length) {
            const lastZoneBlocks = zones[zones.length - 1];
            const extras = contentPieces.slice(zones.length).join('\n\n');
            lastZoneBlocks.forEach((block, j) => {
              if (j === 0) newOverrides[block.id] = (newOverrides[block.id] || '') + '\n\n' + extras;
            });
          }

          const pages = activeDesign.pages || [];
          if (pages.length > 1) {
            const currentOverrides = activeDesign.pageOverrides || {};
            const page1Overrides = { ...(currentOverrides['1'] || {}), ...newOverrides };
            if (titleBlock && proposal.headline) page1Overrides[titleBlock.id] = proposal.headline;
            patchDesign(activeDesign.id, { pageOverrides: { ...currentOverrides, '1': page1Overrides } });
          } else {
            const currentOverrides = activeDesign.textOverrides || {};
            const next = { ...currentOverrides, ...newOverrides };
            if (titleBlock && proposal.headline) next[titleBlock.id] = proposal.headline;
            patchDesign(activeDesign.id, { textOverrides: next });
          }
        } else if (titleBlock && proposal.headline) {
          // Fallback: only map headline if no body blocks
          const pages = activeDesign.pages || [];
          if (pages.length > 1) {
            const currentOverrides = activeDesign.pageOverrides || {};
            const page1Overrides = { ...(currentOverrides['1'] || {}), [titleBlock.id]: proposal.headline };
            patchDesign(activeDesign.id, { pageOverrides: { ...currentOverrides, '1': page1Overrides } });
          } else {
            handleTextOverride(titleBlock.id, proposal.headline);
          }
        }
      } else {
        // Templated mode or no content: only map headline
        const titleBlock = (activeDesign.sourceTextBlocks || []).find((b) => b.tier === 'title');
        if (titleBlock && proposal.headline) {
          const pages = activeDesign.pages || [];
          if (pages.length > 1) {
            const currentOverrides = activeDesign.pageOverrides || {};
            const page1Overrides = { ...(currentOverrides['1'] || {}), [titleBlock.id]: proposal.headline };
            patchDesign(activeDesign.id, { pageOverrides: { ...currentOverrides, '1': page1Overrides } });
          } else {
            handleTextOverride(titleBlock.id, proposal.headline);
          }
        }
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
    if (!activeDesign || !currentProposal) return;
    const slug = (currentProposal.companyName || 'proposal').replace(/[^a-zA-Z0-9]+/g, '_');

    // Try server-side structural PDF export first (preserves real vector text)
    try {
      const blob = await api.downloadProposalPdf(currentProposal.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      return;
    } catch {
      // Fall through to client-side build
    }

    // Fallback: client-side raster-screenshot + text-overlay export
    try {
      const bytes = await buildProposalPdf(activeDesign, currentProposal);
      downloadPdfBytes(bytes, `${slug}.pdf`);
    } catch (err) {
      console.error('PDF export failed', err);
      setGenError(err.message || 'PDF export failed.');
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
      const result = await api.becca.addTopic({ name, context });
      const newTopic = { id: result.id, name, context, priority: 'medium' };
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
    await api.becca.saveProfile({ ...data });
    setBeccaProfile({ ...data });
  }

  async function handleBeccaAddMemory(content) {
    const result = await api.becca.addMemory({ content });
    setBeccaMemory(prev => [...prev, { id: result.id, content }]);
  }

  async function handleBeccaRemoveMemory(id) {
    await api.becca.deleteMemory(id);
    setBeccaMemory(prev => prev.filter(m => m.id !== id));
  }

  function handleBeccaRefreshMemory() {
    api.becca.listMemory()
      .then(memory => setBeccaMemory(Array.isArray(memory) ? memory : []))
      .catch(() => {});
  }

  async function handleBeccaSaveSettings(key, value) {
    await api.becca.saveSettings(key, value);
    setBeccaSettings(prev => ({ ...prev, ...value }));
  }

  function handleBeccaNavigate(target) {
    setSection('becca');
    setBeccaSection(target);
  }

  async function handleCompanySetupComplete() {
    setShowCompanySetup(false);
    setSetupPhase('saving');
    try {
      const profile = await api.becca.getProfile();
      setBeccaProfile(profile || null);
    } catch { /* keep whatever we have */ }
    setTimeout(() => setSetupPhase('complete'), 1200);
    setupTimer.current = setTimeout(finishCompanySetup, 2600);
  }

  function finishCompanySetup() {
    if (setupTimer.current) { clearTimeout(setupTimer.current); setupTimer.current = null; }
    if (!setupPhase) return;
    const firstName = (beccaProfile?.name || authUser?.name || '').split(' ')[0];
    const company = beccaProfile?.company_name;
    setSetupPhase(null);
    setSection('becca');
    setBeccaSection('chat');
    setChatGreeting(
      `Welcome aboard${firstName ? `, ${firstName}` : ''}! 🎉 ` +
      (company
        ? `I've got **${company}** locked in as your context — I'll tailor everything from briefings to research around it. `
        : `Your space is all set up. `) +
      `Try a suggestion below, ask me anything, or say \`track [topic]\` and I'll start watching it for you.`
    );
  }

  async function handleBeccaDismissReminder(id) {
    await api.becca.deleteReminder(id);
    setBeccaReminders(prev => prev.filter(r => r.id !== id));
  }

  async function handleBeccaAddReminder(data) {
    const result = await api.becca.addReminder({ ...data });
    const now = new Date().toISOString();
    setBeccaReminders(prev => [{ id: result.id, text: data.text, due: data.due || null, when_raw: data.when_raw || '', fired: 0, dismissed: 0, created_at: now }, ...prev]);
  }

  // ── Reminder firing ──
  // Poll local reminder state; when one is due, pop the alert modal + play a
  // chime, then mark it fired server-side so it never rings twice.
  const [firedReminder, setFiredReminder] = useState(null);
  const firedRef = useRef(new Set());

  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.28].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 1174.66;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.55);
      });
      setTimeout(() => ctx.close(), 1600);
    } catch { /* audio blocked — modal still shows */ }
  }

  useEffect(() => {
    if (!authUser) return;
    const iv = setInterval(() => {
      const now = Date.now();
      for (const r of beccaReminders) {
        if (r.fired || r.dismissed) continue;
        if (!r.due) continue;
        const due = new Date(r.due).getTime();
        if (isNaN(due)) continue;
        // ring anything up to 2 min overdue (missed while tab was closed)
        if (due <= now && now - due < 120_000 && !firedRef.current.has(r.id)) {
          firedRef.current.add(r.id);
          setFiredReminder(r);
          playChime();
          api.becca.updateReminder(r.id, { fired: 1 }).catch(() => {});
          setBeccaReminders(prev => prev.map(x => x.id === r.id ? { ...x, fired: 1 } : x));
          break;
        }
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [authUser, beccaReminders]);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError('');
    setAuthHint('');
    try {
      const result = authMode === 'login'
        ? await auth.login(authEmail, authPassword)
        : await auth.signup(authEmail, authPassword, authName);
      setAuthToken(result.token);
      setAuthUser(result.user);
      // Workspace data was never fetched pre-auth — load it now that we have a token.
      const workspace = await loadWorkspaceData();
      if (authMode === 'signup') setShowCompanySetup(true);
      else maybeGreetOnLogin(result.user, workspace);
    } catch (err) {
      if (authMode === 'login' && err.code === 'NO_ACCOUNT') {
        // Unknown email on sign-in → flow straight into signup with what they typed.
        setAuthError('');
        setAuthHint(`No account for ${authEmail.trim()} yet — add your name to create it.`);
        setAuthMode('signup');
      } else {
        setAuthError(err.message);
      }
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setAuthUser(null);
    setChatGreeting('');
  }

  // First sign-in of the day → time-based greeting from Homin in chat.
  function maybeGreetOnLogin(user, { topics, briefings }) {
    const today = new Date().toDateString();
    const key = `homin:greeted:${user.id}`;
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);

    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const firstName = (user.name || '').split(' ')[0];
    const hello = `Good ${part}${firstName ? `, ${firstName}` : ''}! 👋`;

    const activeTopics = topics.filter(t => t.status === 'active').length;
    let body;
    if (activeTopics === 0 && briefings.length === 0) {
      body = "What would you like to get done today?\n\nAsk me anything, say `track [topic]` to start watching something, or `brief me` for a catch-up whenever you're ready.";
    } else {
      const bits = [];
      if (activeTopics > 0) bits.push(`**${activeTopics} active topic${activeTopics > 1 ? 's' : ''}** on your watchlist`);
      if (briefings.length > 0) bits.push(`your latest briefing is ready`);
      body = `You've got ${bits.join(' and ')}. Say **brief me** for the latest, or tell me what you'd like to get done.`;
    }
    setChatGreeting(`${hello} ${body}`);
  }

  function handleAuthSwitch() {
    setAuthMode(prev => prev === 'login' ? 'signup' : 'login');
    setAuthError('');
    setAuthHint('');
  }

  useEffect(() => {
    function handleResizeMouseDown(e) {
      const resizer = e.target.closest('.editor-resizer, .editor-resizer-right');
      if (!resizer) return;
      e.preventDefault();
      const layout = resizer.closest('.editor-layout');
      const sidebar = layout.querySelector('.editor-sidebar');
      const panel = layout.querySelector('.editor-panel');
      const isRight = resizer.classList.contains('editor-resizer-right');
      const startX = e.clientX;
      const startSidebarW = sidebar.offsetWidth;
      const startPanelW = panel.offsetWidth;

      function onMouseMove(ev) {
        const dx = ev.clientX - startX;
        if (isRight) {
          const newW = Math.max(300, Math.min(560, startPanelW - dx));
          panel.style.width = newW + 'px';
        } else {
          const newW = Math.max(180, Math.min(400, startSidebarW + dx));
          sidebar.style.width = newW + 'px';
          sidebar.style.minWidth = newW + 'px';
        }
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    document.addEventListener('mousedown', handleResizeMouseDown);
    return () => document.removeEventListener('mousedown', handleResizeMouseDown);
  }, []);

  if (authLoading) {
    return <div className="app-loading">Loading…</div>;
  }

  if (!authUser) {
    return (
      <div className="auth-screen">
        <button
          type="button"
          className="theme-toggle auth-screen-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          <img src={theme === 'dark' ? '/icons/sun.png' : '/icons/moon.png'} alt="" className="theme-toggle-img" />
        </button>
        <div className="auth-card">
          <img src="/icons/logomark.png" alt="Homin" className="auth-logo" />
          <h1 className="auth-title">{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="auth-sub">{authMode === 'login' ? 'Sign in to continue' : 'Get started with Homin'}</p>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === 'signup' && (
              <input placeholder="Your name" className="auth-input" type="text"
                value={authName} onChange={e => setAuthName(e.target.value)} />
            )}
            <input placeholder="Email" className="auth-input" type="text"
              value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            <input placeholder="Password" className="auth-input" type="password"
              value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
            {authHint && <div className="auth-hint">{authHint}</div>}
            {authError && <div className="auth-error">{authError}</div>}
            <button
              type="submit"
              className={`auth-submit ${authEmail.trim() && authPassword.trim() ? 'auth-submit-ready' : ''}`}
            >
              {authMode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <button className="auth-switch" onClick={handleAuthSwitch}>
            {authMode === 'login' ? 'Don\'t have an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="app-loading">Loading…</div>;
  }

  const meta = SECTION_META[section];

  return (
    <div className="app-shell">
      <NavRail section={section} onNavigate={setSection}
        onOpenProfile={() => { setSection('becca'); setBeccaSettingsOpen(true); }} />

      <div className="main-area">
        <header className="topbar no-print">
          <div className={`topbar-l ${section === 'becca' ? 'clickable' : ''}`}
            onClick={section === 'becca' ? () => setBeccaSection('chat') : undefined}>
            {section !== 'becca' && section !== 'proposals' && <img src="/icons/logomark.png" alt="" className="topbar-logo-img" />}
            <div>
              <div className="topbar-name">{meta.name}</div>
              <div className="topbar-status">{meta.status}</div>
            </div>
          </div>
          <div className="topbar-r">
            <button
              type="button"
              className="theme-toggle"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              <img src={theme === 'dark' ? '/icons/sun.png' : '/icons/moon.png'} alt="" className="theme-toggle-img" />
            </button>
            <button type="button" className="btn-secondary" onClick={handleLogout} title="Sign out">
              Sign out
            </button>
            {section === 'proposals' && (
              <>
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
              </>
            )}
          </div>
        </header>

        {section === 'becca' ? (
          <div className="section-body becca-section">
            <BeccaLayout
              topics={beccaTopics} profile={beccaProfile} memory={beccaMemory}
              briefings={beccaBriefings} reminders={beccaReminders} settings={beccaSettings}
              onAddTopic={handleBeccaAddTopic} onRemoveTopic={handleBeccaRemoveTopic}
              onUpdateTopic={handleBeccaUpdateTopic} onSaveSettings={handleBeccaSaveSettings}
              onAddReminder={handleBeccaAddReminder} onDismissReminder={handleBeccaDismissReminder}
              beccaSection={beccaSection} onSectionChange={setBeccaSection}
              beccaModel={beccaModel} onModelChange={(m) => { setBeccaModel(m); localStorage.setItem('homin:model', m); }}
              chatGreeting={chatGreeting}
              onActionExecuted={() => {
                api.becca.listTopics().then(setBeccaTopics).catch(() => {});
                api.becca.listReminders().then(setBeccaReminders).catch(() => {});
                api.becca.listBriefings().then(setBeccaBriefings).catch(() => {});
              }} />
           </div>
         ) : section === 'proposals' ? (
          <div className="section-body proposals-section">
            <div className="becca-topbar">
              <div className="becca-topbar-tabs">
                {['editor', 'recipients', 'campaigns', 'dashboard'].map(t => (
                  <button key={t} className={`becca-tab ${proposalTab === t ? 'active' : ''}`}
                    onClick={() => setProposalTab(t)}>
                    <img className="becca-tab-icon" src={t === 'editor' ? '/icons/pencil.png' : t === 'recipients' ? '/icons/users.png' : t === 'campaigns' ? '/icons/mail.png' : '/icons/dashboard.png'} alt="" />
                    <span>{t === 'editor' ? 'Editor' : t === 'recipients' ? 'Recipients' : t === 'campaigns' ? 'Campaigns' : 'Dashboard'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="becca-content">
              {proposalTab === 'editor' && (
                <div className="editor-layout">
                  {showOnboarding && !showCompanySetup && (
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
                  <div className="editor-resizer" />

                  <div className="editor-canvas">
                    {activeDesign && importFile && (
                      <div className="app-preview-full">
                        <ImportPanel file={importFile} onExtracted={handleExtracted}
                          designId={activeDesignId} onComplete={handleImportDone} />
                      </div>
                    )}
                    {activeDesign && !importFile && (
                      <div className="preview-area">
                        <div className="preview-viewport">
                          {activeDesign.sourceImageDataUrl ? (
                            (() => {
                              const pages = activeDesign.pages || [];
                              const isMultiPage = pages.length > 1;
                              // Clamp against stale indices after switching designs
                              const safePage = Math.min(Math.max(1, currentPage), Math.max(1, pages.length));
                              const pageData = isMultiPage ? pages[safePage - 1] : null;
                              const displayDataUrl = pageData?.dataUrl || (isMultiPage ? null : activeDesign.sourceImageDataUrl);
                              const displayWidth = pageData?.width || activeDesign.sourceImageWidth;
                              const displayHeight = pageData?.height || activeDesign.sourceImageHeight;
                              const displayBlocks = pageData?.blocks || activeDesign.sourceTextBlocks || [];
                              const displayOverrides = isMultiPage
                                ? ((activeDesign.pageOverrides || {})[String(safePage)] || {})
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
                                        onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                                        disabled={safePage <= 1}
                                      >
                                        ‹
                                      </button>
                                      <span className="pagination-counter">{safePage} / {pages.length}</span>
                                      <button
                                        type="button"
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage(Math.min(pages.length, safePage + 1))}
                                        disabled={safePage >= pages.length}
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
                            <label className="btn-secondary logo-upload-label">
                              Company logo
                              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file || !currentProposal) return;
                                const reader = new FileReader();
                                reader.onload = async () => {
                                  const dataUrl = reader.result;
                                  setCurrentProposal((prev) => prev ? { ...prev, companyLogo: dataUrl } : prev);
                                  setProposals((prev) => prev.map((p) => p.id === currentProposal.id ? { ...p, companyLogo: dataUrl } : p));
                                  try {
                                    await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/proposals/${currentProposal.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('homing_token') ? { Authorization: `Bearer ${localStorage.getItem('homing_token')}` } : {}) },
                                      body: JSON.stringify({ companyLogo: dataUrl }),
                                    });
                                  } catch (err) {
                                    console.error('Failed to save company logo', err);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }} />
                            </label>
                          </div>
                        )}
                        {generating && (
                          <div className="generate-progress no-print" role="status" aria-live="polite">
                            <div className="generate-progress-info">
                              <span className="generate-progress-spinner" />
                              <span className="generate-progress-label">Generating your proposal…</span>
                            </div>
                            <div className="generate-progress-track">
                              <div className="generate-progress-fill" />
                            </div>
                          </div>
                        )}
                        {!currentProposal && activeDesign && !generating && (
                          <div className="empty-state no-print">
                            <div className="empty-step-hint">
                              Type the company you're pitching to below — Homin drafts a tailored proposal from your design.
                            </div>
                            <button type="button" className="btn-primary" onClick={() => setEditOpen(true)}>Edit your design</button>
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
                            genError={genError}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="editor-resizer-right" />

                  <div className="editor-panel no-print">
                    <div className="panel-step-indicator">
                      <span className={`panel-step ${tab === 'setup' ? 'panel-step-active' : ''}`} onClick={() => setTab('setup')}>
                        Setup
                      </span>
                      <span className={`panel-step ${tab === 'generate' ? 'panel-step-active' : ''}`} onClick={() => setTab('generate')}>
                        Generate
                      </span>
                      <span className={`panel-step ${tab === 'batch' ? 'panel-step-active' : ''}`} onClick={() => setTab('batch')}>
                        Batch
                      </span>
                    </div>
                    <div className="panel-content">
                      {tab === 'setup' && activeDesign && (
                        <SetupForm
                          design={activeDesign}
                          onChange={handleSetupChange}
                          importFile={importFile}
                          onImportFile={handleImportFile}
                        />
                      )}
                      {tab === 'generate' && (
                        <div className="generate-panel">
                          <RecipientForm onGenerate={handleGenerate} generating={generating} providers={providers} activeProvider={activeProvider} />
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
        ) : section === 'design' ? (
          <div className="section-body design-section">
            <DesignEditor />
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

      {showCompanySetup && (
        <CompanyOnboarding
          onSave={handleBeccaSaveProfile}
          onComplete={handleCompanySetupComplete}
          onClose={() => {
            setShowCompanySetup(false);
            setSection('becca');
            setBeccaSection('chat');
          }} />
      )}

      {beccaSettingsOpen && (
        <BeccaSettings profile={beccaProfile} memory={beccaMemory} settings={beccaSettings}
          onSaveProfile={handleBeccaSaveProfile} onAddMemory={handleBeccaAddMemory} onRemoveMemory={handleBeccaRemoveMemory}
          onRefreshMemory={handleBeccaRefreshMemory}
          onSaveSettings={handleBeccaSaveSettings}
          onClose={() => setBeccaSettingsOpen(false)} />
      )}

      {setupPhase && (
        <div className="setup-celebrate-overlay">
          <div className="setup-celebrate-card">
            {setupPhase === 'saving' ? (
              <>
                <div className="setup-spinner" />
                <div className="setup-celebrate-title">Setting up your space…</div>
                <div className="setup-celebrate-sub">Saving your company context</div>
              </>
            ) : (
              <>
                <button type="button" className="setup-complete-check" onClick={finishCompanySetup}>✓</button>
                <div className="setup-celebrate-title">You're all set!</div>
                <div className="setup-celebrate-sub">Taking you to Homin…</div>
              </>
            )}
          </div>
        </div>
      )}

      {firedReminder && (
        <div className="reminder-modal-overlay" onClick={() => setFiredReminder(null)}>
          <div className="reminder-modal" onClick={e => e.stopPropagation()}>
            <div className="reminder-modal-icon">⏰</div>
            <div className="reminder-modal-title">Reminder</div>
            <div className="reminder-modal-text">{firedReminder.text}</div>
            {firedReminder.when_raw && (
              <div className="reminder-modal-when">set for “{firedReminder.when_raw}”</div>
            )}
            <div className="reminder-modal-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  const snoozed = new Date(Date.now() + 5 * 60_000).toISOString();
                  api.becca.updateReminder(firedReminder.id, { fired: 0 }).catch(() => {});
                  setBeccaReminders(prev => prev.map(x => x.id === firedReminder.id ? { ...x, fired: 0, due: snoozed } : x));
                  firedRef.current.delete(firedReminder.id);
                  setFiredReminder(null);
                }}>Snooze 5 min</button>
              <button className="btn-save-profile" onClick={() => setFiredReminder(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
