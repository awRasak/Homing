const BASE = import.meta.env.VITE_API_BASE || '/api';
export { BASE };

async function handle(res, fromAuth = false) {
  if (res.status === 401 && !fromAuth) {
    // Token expired or invalid — clear auth state
    localStorage.removeItem('homing_token');
    window.dispatchEvent(new Event('auth:logout'));
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = '';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      /* ignore */
    }
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Token management ──

let authToken = localStorage.getItem('homing_token') || null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('homing_token', token);
  } else {
    localStorage.removeItem('homing_token');
  }
}

export function getAuthToken() {
  return authToken;
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

function jsonBody(data) {
  return JSON.stringify(data);
}

// ── Auth API ──

export const auth = {
  signup: (email, password, name) =>
    fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody({ email, password, name }),
    }).then((res) => handle(res, true)),
  login: (email, password) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody({ email, password }),
    }).then((res) => handle(res, true)),
  me: () =>
    fetch(`${BASE}/auth/me`, { headers: authHeaders() }).then(handle),
  forgotPassword: (email) =>
    fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody({ email }),
    }).then((res) => handle(res, true)),
  resetPassword: (token, password) =>
    fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody({ token, password }),
    }).then((res) => handle(res, true)),
};

// ── Protected API ──

export const api = {
  status: () => fetch(`${BASE}/status?t=${Date.now()}`).then(handle),

  listDesigns: () =>
    fetch(`${BASE}/designs`, { headers: authHeaders() }).then(handle),
  createDesign: (partial = {}) =>
    fetch(`${BASE}/designs`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(partial),
    }).then(handle),
  getDesign: (id) =>
    fetch(`${BASE}/designs/${id}`, { headers: authHeaders() }).then(handle),
  updateDesign: (id, patch) =>
    fetch(`${BASE}/designs/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(patch),
    }).then(handle),
  deleteDesign: (id) =>
    fetch(`${BASE}/designs/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),
  uploadSourcePdf: (designId, pdfBlob) =>
    fetch(`${BASE}/designs/${designId}/source-pdf`, {
      method: 'POST',
      headers: authHeaders(),
      body: pdfBlob,
    }).then(handle),

  listProposals: (designId) =>
    fetch(`${BASE}/designs/${designId}/proposals`, { headers: authHeaders() }).then(handle),
  listAllProposals: () =>
    fetch(`${BASE}/proposals`, { headers: authHeaders() }).then(handle),
  getProposalStats: () =>
    fetch(`${BASE}/proposals/stats`, { headers: authHeaders() }).then(handle),
  getProposal: (designId, proposalId) =>
    fetch(`${BASE}/designs/${designId}/proposals/${proposalId}`, { headers: authHeaders() }).then(handle),
  upsertProposal: (data) =>
    fetch(`${BASE}/proposals/upsert`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(data),
    }).then(handle),

  generate: (designId, { companyName, notes, provider, model }) =>
    fetch(`${BASE}/designs/${designId}/generate`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody({ companyName, notes, provider, model }),
    }).then(handle),

  downloadProposalPdf: (proposalId) =>
    fetch(`${BASE}/proposals/${proposalId}/pdf`, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error('PDF export failed');
        return res.blob();
      }),

  listRecipients: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${BASE}/recipients${qs ? '?' + qs : ''}`, { headers: authHeaders() }).then(handle);
  },
  getRecipientTags: () =>
    fetch(`${BASE}/recipients/tags`, { headers: authHeaders() }).then(handle),
  getRecipient: (id) =>
    fetch(`${BASE}/recipients/${id}`, { headers: authHeaders() }).then(handle),
  createRecipient: (data) =>
    fetch(`${BASE}/recipients`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(data),
    }).then(handle),
  updateRecipient: (id, data) =>
    fetch(`${BASE}/recipients/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(data),
    }).then(handle),
  deleteRecipient: (id) =>
    fetch(`${BASE}/recipients/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),
  importRecipients: (csv) =>
    fetch(`${BASE}/recipients/import`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody({ csv }),
    }).then(handle),

  batchGenerate: (designId, { recipientIds, provider, model }, onEvent) => {
    const controller = new AbortController();
    const body = jsonBody({ recipientIds, provider, model });

    fetch(`${BASE}/designs/${designId}/batch-generate`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
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

  listCampaigns: () =>
    fetch(`${BASE}/campaigns`, { headers: authHeaders() }).then(handle),
  getCampaign: (id) =>
    fetch(`${BASE}/campaigns/${id}`, { headers: authHeaders() }).then(handle),
  createCampaign: (data) =>
    fetch(`${BASE}/campaigns`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody(data),
    }).then(handle),
  addRecipientsToCampaign: (id, recipientIds) =>
    fetch(`${BASE}/campaigns/${id}/add-recipients`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody({ recipientIds }),
    }).then(handle),
  sendCampaign: (id, provider) =>
    fetch(`${BASE}/campaigns/${id}/send`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: jsonBody({ provider }),
    }).then(handle),
  deleteCampaign: (id) =>
    fetch(`${BASE}/campaigns/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

  // ═══════════════════════════════════════════
  // BECCA — Personal Intelligence Assistant
  // ═══════════════════════════════════════════
  becca: {
    getProfile: () =>
      fetch(`${BASE}/becca/profile`, { headers: authHeaders() }).then(handle),
    scanCompany: (url) =>
      fetch(`${BASE}/becca/scan-company`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody({ url }),
      }).then(handle),
    saveProfile: (data) =>
      fetch(`${BASE}/becca/profile`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),

    exportKnowledgeBase: async () => {
      const res = await fetch(`${BASE}/becca/export`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      return await res.text();
    },

    listKnowledge: () =>
      fetch(`${BASE}/becca/knowledge`, { headers: authHeaders() }).then(handle),
    getKnowledgeDoc: (id) =>
      fetch(`${BASE}/becca/knowledge/${id}`, { headers: authHeaders() }).then(handle),
    addKnowledgeDoc: (data) =>
      fetch(`${BASE}/becca/knowledge`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deleteKnowledgeDoc: (id) =>
      fetch(`${BASE}/becca/knowledge/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),
    knowledgeOverview: () =>
      fetch(`${BASE}/becca/knowledge/overview`, { headers: authHeaders() }).then(handle),
    distillKnowledge: () =>
      fetch(`${BASE}/becca/knowledge/distill`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody({}),
      }).then(handle),

    listTopics: () =>
      fetch(`${BASE}/becca/topics`, { headers: authHeaders() }).then(handle),
    addTopic: (data) =>
      fetch(`${BASE}/becca/topics`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    updateTopic: (id, data) =>
      fetch(`${BASE}/becca/topics/${id}`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deleteTopic: (id) =>
      fetch(`${BASE}/becca/topics/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),
    toggleTopicBlog: (id) =>
      fetch(`${BASE}/becca/topics/${id}/toggle-blog`, { method: 'PUT', headers: authHeaders() }).then(handle),
    toggleTopicStatus: (id) =>
      fetch(`${BASE}/becca/topics/${id}/toggle-status`, { method: 'PUT', headers: authHeaders() }).then(handle),
    triggerTopicBrief: (id, data = {}) =>
      fetch(`${BASE}/becca/topics/${id}/trigger-brief`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),

    listBriefings: (limit = 50) =>
      fetch(`${BASE}/becca/briefings?limit=${limit}`, { headers: authHeaders() }).then(handle),

    listBlogDrafts: (status) => {
      let qs = '';
      if (status) qs = `?status=${status}`;
      return fetch(`${BASE}/becca/blog-drafts${qs}`, { headers: authHeaders() }).then(handle);
    },
    updateBlogDraft: (id, data) =>
      fetch(`${BASE}/becca/blog-drafts/${id}`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deleteBlogDraft: (id) =>
      fetch(`${BASE}/becca/blog-drafts/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

    listReminders: () =>
      fetch(`${BASE}/becca/reminders`, { headers: authHeaders() }).then(handle),
    addReminder: (data) =>
      fetch(`${BASE}/becca/reminders`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    updateReminder: (id, data) =>
      fetch(`${BASE}/becca/reminders/${id}`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deleteReminder: (id) =>
      fetch(`${BASE}/becca/reminders/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

    listMemory: () =>
      fetch(`${BASE}/becca/memory`, { headers: authHeaders() }).then(handle),
    addMemory: (data) =>
      fetch(`${BASE}/becca/memory`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deleteMemory: (id) =>
      fetch(`${BASE}/becca/memory/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

    listChat: (limit = 50) =>
      fetch(`${BASE}/becca/chat?limit=${limit}`, { headers: authHeaders() }).then(handle),
    listChatSessions: () =>
      fetch(`${BASE}/becca/chat`, { headers: authHeaders() }).then(handle),
    getChatSession: (sessionId) =>
      fetch(`${BASE}/becca/chat/${sessionId}`, { headers: authHeaders() }).then(handle),
    addChat: (data) =>
      fetch(`${BASE}/becca/chat`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    sendChatMessage: (data) =>
      fetch(`${BASE}/becca/chat/message`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    clearChat: (session) => {
      const qs = session ? `?session=${session}` : '';
      return fetch(`${BASE}/becca/chat${qs}`, { method: 'DELETE', headers: authHeaders() }).then(handle);
    },

    getSettings: () =>
      fetch(`${BASE}/becca/settings`, { headers: authHeaders() }).then(handle),
    saveSettings: (key, value) =>
      fetch(`${BASE}/becca/settings`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: jsonBody({ key, value }),
      }).then(handle),

    getSocialTemplate: () =>
      fetch(`${BASE}/becca/social-template`, { headers: authHeaders() }).then(handle),
    setSocialTemplate: (designId) =>
      fetch(`${BASE}/becca/social-template`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: jsonBody({ designId }),
      }).then(handle),

    // ═══════════════════════════════════════════
    // CONTENT PIPELINE
    // ═══════════════════════════════════════════
    listPosts: (status, limit = 50) => {
      let qs = `limit=${limit}`;
      if (status) qs += `&status=${status}`;
      return fetch(`${BASE}/becca/posts?${qs}`, { headers: authHeaders() }).then(handle);
    },
    getPost: (id) =>
      fetch(`${BASE}/becca/posts/${id}`, { headers: authHeaders() }).then(handle),
    createPost: (data) =>
      fetch(`${BASE}/becca/posts`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    updatePost: (id, data) =>
      fetch(`${BASE}/becca/posts/${id}`, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deletePost: (id) =>
      fetch(`${BASE}/becca/posts/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

    scoutNews: (data) =>
      fetch(`${BASE}/becca/pipeline/scout`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    writePost: (data) =>
      fetch(`${BASE}/becca/pipeline/write`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    generateCover: (data) =>
      fetch(`${BASE}/becca/pipeline/image`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    seoCheck: (data) =>
      fetch(`${BASE}/becca/pipeline/seo/check`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    seoAudit: (url) =>
      fetch(`${BASE}/becca/pipeline/seo`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: jsonBody({ url }),
      }).then(handle),
    runPipeline: (data) =>
      fetch(`${BASE}/becca/pipeline/run`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
  },

  social: {
    getMentions: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return fetch(`${BASE}/social/mentions?${qs}`, { headers: authHeaders() }).then(handle);
    },
    scanTopic: (topicId) =>
      fetch(`${BASE}/social/scan/${topicId}`, {
        method: 'POST', headers: authHeaders(),
      }).then(handle),
    scanAll: () =>
      fetch(`${BASE}/social/scan-all`, {
        method: 'POST', headers: authHeaders(),
      }).then(handle),
    getTrends: (topicId, days = 14) =>
      fetch(`${BASE}/social/trends/${topicId}?days=${days}`, { headers: authHeaders() }).then(handle),
    getSpikes: (topicId) =>
      fetch(`${BASE}/social/spikes/${topicId}`, { headers: authHeaders() }).then(handle),
    getStats: (topicId) =>
      fetch(`${BASE}/social/stats/${topicId}`, { headers: authHeaders() }).then(handle),
    getStubs: () =>
      fetch(`${BASE}/social/stubs`, { headers: authHeaders() }).then(handle),
  },

  buffer: {
    getStatus: () =>
      fetch(`${BASE}/buffer/status`, { headers: authHeaders() }).then(handle),
    getChannels: () =>
      fetch(`${BASE}/buffer/channels`, { headers: authHeaders() }).then(handle),
    getPosts: () =>
      fetch(`${BASE}/buffer/posts`, { headers: authHeaders() }).then(handle),
    createPost: (data) =>
      fetch(`${BASE}/buffer/posts`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    deletePost: (postId) =>
      fetch(`${BASE}/buffer/posts/${postId}`, {
        method: 'DELETE', headers: authHeaders(),
      }).then(handle),
    generate: (data) =>
      fetch(`${BASE}/buffer/generate`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    scheduleAll: (data) =>
      fetch(`${BASE}/buffer/schedule-all`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
    generateImage: (data) =>
      fetch(`${BASE}/buffer/generate-image`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody(data),
      }).then(handle),
  },

  socialAssets: {
    upload: (dataUrl) =>
      fetch(`${BASE}/social-assets`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: jsonBody({ dataUrl }),
      }).then(handle),
  },
};
