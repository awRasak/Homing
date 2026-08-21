const BASE = import.meta.env.VITE_API_BASE || '/api';

async function handle(res) {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  status: () => fetch(`${BASE}/status?t=${Date.now()}`).then(handle),

  listDesigns: () => fetch(`${BASE}/designs`).then(handle),
  createDesign: (partial = {}) =>
    fetch(`${BASE}/designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    }).then(handle),
  getDesign: (id) => fetch(`${BASE}/designs/${id}`).then(handle),
  updateDesign: (id, patch) =>
    fetch(`${BASE}/designs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(handle),
  deleteDesign: (id) => fetch(`${BASE}/designs/${id}`, { method: 'DELETE' }).then(handle),

  listProposals: (designId) => fetch(`${BASE}/designs/${designId}/proposals`).then(handle),
  listAllProposals: () => fetch(`${BASE}/proposals`).then(handle),
  getProposal: (designId, proposalId) =>
    fetch(`${BASE}/designs/${designId}/proposals/${proposalId}`).then(handle),

  downloadPDF: async (proposalId) => {
    const res = await fetch(`${BASE}/proposals/${proposalId}/pdf`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'PDF download failed' }));
      throw new Error(err.error || 'PDF download failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'proposal.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  generate: (designId, { companyName, notes, provider, model }) =>
    fetch(`${BASE}/designs/${designId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, notes, provider, model }),
    }).then(handle),

  listRecipients: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${BASE}/recipients${qs ? '?' + qs : ''}`).then(handle);
  },
  getRecipientTags: () => fetch(`${BASE}/recipients/tags`).then(handle),
  getRecipient: (id) => fetch(`${BASE}/recipients/${id}`).then(handle),
  createRecipient: (data) =>
    fetch(`${BASE}/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handle),
  updateRecipient: (id, data) =>
    fetch(`${BASE}/recipients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handle),
  deleteRecipient: (id) => fetch(`${BASE}/recipients/${id}`, { method: 'DELETE' }).then(handle),
  importRecipients: (csv) =>
    fetch(`${BASE}/recipients/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    }).then(handle),

  batchGenerate: (designId, { recipientIds, provider, model }, onEvent) => {
    const controller = new AbortController();
    const body = JSON.stringify({ recipientIds, provider, model });

    fetch(`${BASE}/designs/${designId}/batch-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Batch generate failed' }));
        onEvent({ type: 'error', error: err.error });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent({ type: eventType, ...data });
            } catch { /* ignore malformed */ }
          }
        }
      }
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', error: err.message });
      }
    });

    return controller;
  },

  listCampaigns: () => fetch(`${BASE}/campaigns`).then(handle),
  getCampaign: (id) => fetch(`${BASE}/campaigns/${id}`).then(handle),
  createCampaign: (data) =>
    fetch(`${BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handle),
  addRecipientsToCampaign: (id, recipientIds) =>
    fetch(`${BASE}/campaigns/${id}/add-recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientIds }),
    }).then(handle),
  sendCampaign: (id, provider) =>
    fetch(`${BASE}/campaigns/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }).then(handle),
  deleteCampaign: (id) => fetch(`${BASE}/campaigns/${id}`, { method: 'DELETE' }).then(handle),

  // ═══════════════════════════════════════════
  // BECCA — Personal Intelligence Assistant
  // ═══════════════════════════════════════════
  becca: {
    getProfile: (workspace = 'default') =>
      fetch(`${BASE}/becca/profile?workspace=${workspace}`).then(handle),
    saveProfile: (data) =>
      fetch(`${BASE}/becca/profile`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),

    exportKnowledgeBase: async (workspace = 'default') => {
      const res = await fetch(`${BASE}/becca/export?workspace=${workspace}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      return await res.text();
    },

    listTopics: (workspace = 'default') =>
      fetch(`${BASE}/becca/topics?workspace=${workspace}`).then(handle),
    addTopic: (data) =>
      fetch(`${BASE}/becca/topics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    updateTopic: (id, data) =>
      fetch(`${BASE}/becca/topics/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    deleteTopic: (id) => fetch(`${BASE}/becca/topics/${id}`, { method: 'DELETE' }).then(handle),

    listBriefings: (workspace = 'default', limit = 50) =>
      fetch(`${BASE}/becca/briefings?workspace=${workspace}&limit=${limit}`).then(handle),
    getTopicBriefings: (topic, workspace = 'default') =>
      fetch(`${BASE}/becca/briefings/${encodeURIComponent(topic)}?workspace=${workspace}`).then(handle),
    saveBriefing: (data) =>
      fetch(`${BASE}/becca/briefings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    updateBriefingNote: (id, note) =>
      fetch(`${BASE}/becca/briefings/${id}/note`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
      }).then(handle),

    listReminders: (workspace = 'default') =>
      fetch(`${BASE}/becca/reminders?workspace=${workspace}`).then(handle),
    addReminder: (data) =>
      fetch(`${BASE}/becca/reminders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    updateReminder: (id, data) =>
      fetch(`${BASE}/becca/reminders/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    deleteReminder: (id) => fetch(`${BASE}/becca/reminders/${id}`, { method: 'DELETE' }).then(handle),

    listMemory: (workspace = 'default') =>
      fetch(`${BASE}/becca/memory?workspace=${workspace}`).then(handle),
    addMemory: (data) =>
      fetch(`${BASE}/becca/memory`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    deleteMemory: (id) => fetch(`${BASE}/becca/memory/${id}`, { method: 'DELETE' }).then(handle),

    listChat: (workspace = 'default', limit = 50) =>
      fetch(`${BASE}/becca/chat?workspace=${workspace}&limit=${limit}`).then(handle),
    listChatSessions: (workspace = 'default') =>
      fetch(`${BASE}/becca/chat?workspace=${workspace}`).then(handle),
    getChatSession: (sessionId, workspace = 'default') =>
      fetch(`${BASE}/becca/chat/${sessionId}?workspace=${workspace}`).then(handle),
    addChat: (data) =>
      fetch(`${BASE}/becca/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    sendChatMessage: (data) =>
      fetch(`${BASE}/becca/chat/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    clearChat: (workspace = 'default', session) => {
      const qs = session ? `?session=${session}` : '';
      return fetch(`${BASE}/becca/chat${qs}`, { method: 'DELETE' }).then(handle);
    },

    getSettings: (workspace = 'default') =>
      fetch(`${BASE}/becca/settings?workspace=${workspace}`).then(handle),
    saveSettings: (key, value, workspace = 'default') =>
      fetch(`${BASE}/becca/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, workspace }),
      }).then(handle),

    // ═══════════════════════════════════════════
    // CONTENT PIPELINE
    // ═══════════════════════════════════════════
    listPosts: (workspace = 'default', status, limit = 50) => {
      let qs = `workspace=${workspace}&limit=${limit}`;
      if (status) qs += `&status=${status}`;
      return fetch(`${BASE}/becca/posts?${qs}`).then(handle);
    },
    getPost: (id) => fetch(`${BASE}/becca/posts/${id}`).then(handle),
    createPost: (data) =>
      fetch(`${BASE}/becca/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    updatePost: (id, data) =>
      fetch(`${BASE}/becca/posts/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    deletePost: (id) => fetch(`${BASE}/becca/posts/${id}`, { method: 'DELETE' }).then(handle),

    scoutNews: (data) =>
      fetch(`${BASE}/becca/pipeline/scout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    writePost: (data) =>
      fetch(`${BASE}/becca/pipeline/write`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    generateCover: (data) =>
      fetch(`${BASE}/becca/pipeline/image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    seoCheck: (data) =>
      fetch(`${BASE}/becca/pipeline/seo/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
    seoAudit: (url) =>
      fetch(`${BASE}/becca/pipeline/seo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      }).then(handle),
    runPipeline: (data) =>
      fetch(`${BASE}/becca/pipeline/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(handle),
  },
};
