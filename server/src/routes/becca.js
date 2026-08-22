import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';

const router = Router();

// ═══════════════════════════════════════════
// GROQ — OpenAI-compatible LLM calls
// ═══════════════════════════════════════════
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = {
  'gpt-oss-20b': 'openai/gpt-oss-20b',
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'qwen-3.6-27b': 'qwen/qwen3.6-27b',
  'compound-mini': 'groq/compound-mini',
  'compound': 'groq/compound',
};

function resolveGroqModel(model) {
  if (GROQ_MODELS[model]) return GROQ_MODELS[model];
  if (model && typeof model === 'string') return model;
  return 'openai/gpt-oss-20b';
}

const COUNTRY_LOCALES = {
  nigeria: { hl: 'en-NG', gl: 'NG', ceid: 'NG:en' },
  usa: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  'united states': { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  america: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  uk: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  'united kingdom': { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  britain: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  canada: { hl: 'en-CA', gl: 'CA', ceid: 'CA:en' },
  ghana: { hl: 'en-GH', gl: 'GH', ceid: 'GH:en' },
  kenya: { hl: 'en-KE', gl: 'KE', ceid: 'KE:en' },
  'south africa': { hl: 'en-ZA', gl: 'ZA', ceid: 'ZA:en' },
  australia: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en' },
  india: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  singapore: { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
  germany: { hl: 'de-DE', gl: 'DE', ceid: 'DE:de' },
  france: { hl: 'fr-FR', gl: 'FR', ceid: 'FR:fr' },
  spain: { hl: 'es-ES', gl: 'ES', ceid: 'ES:es' },
  mexico: { hl: 'es-MX', gl: 'MX', ceid: 'MX:es' },
  brazil: { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt' },
  china: { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh' },
  japan: { hl: 'ja-JP', gl: 'JP', ceid: 'JP:ja' },
  italy: { hl: 'it-IT', gl: 'IT', ceid: 'IT:it' },
  netherlands: { hl: 'nl-NL', gl: 'NL', ceid: 'NL:nl' },
};

function resolveNewsLocale(region) {
  const key = String(region || '').trim().toLowerCase();
  const locale = COUNTRY_LOCALES[key];
  if (locale) return locale;
  const matches = key.split(/[\s,]+/).map(w => w.toLowerCase()).filter(Boolean);
  for (const m of matches) {
    const hit = COUNTRY_LOCALES[m];
    if (hit) return hit;
  }
  return { hl: 'en-US', gl: 'US', ceid: 'US:en' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripThink(s) {
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*$/gi, '');
  return out.trim();
}

async function fetchTopicNews(topicName, region = '', maxItems = 5) {
  const loc = resolveNewsLocale(region);
  const scopedQuery = region ? `${topicName} ${region}` : topicName;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(scopedQuery)}&hl=${loc.hl}&gl=${loc.gl}&ceid=${loc.ceid}`;
  const rssRes = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!rssRes.ok) throw new Error(`News feed unavailable (${rssRes.status})`);
  const xml = await rssRes.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) && items.length < maxItems) {
    const block = m[1];
    const grab = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!match) return '';
      return match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    };
    const title = grab('title');
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const source = sourceMatch ? sourceMatch[1].trim() : 'News';
    const link = grab('link') || grab('guid');
    items.push({ title, source, url: link });
  }
  return items;
}

async function callGroq({ model, system, user, temperature = 0.6, maxTokens = 4096 }, retriesLeft = 2) {
  const key = process.env.GROQ_API_KEY || '';
  if (!key) throw new Error('GROQ_API_KEY is not configured');

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: resolveGroqModel(model),
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    // Groq's 429 body includes "Please try again in Xs" — honor that instead
    // of guessing, so we don't hammer an already-throttled account.
    if (response.status === 429 && retriesLeft > 0) {
      const waitMatch = errText.match(/try again in ([\d.]+)s/i);
      const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 250 : 4000;
      await sleep(waitMs);
      return callGroq({ model, system, user, temperature, maxTokens }, retriesLeft - 1);
    }
    throw new Error(`Groq API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ═══════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════
router.get('/profile', (req, res) => {
  const ws = req.query.workspace || 'default';
  const row = db.prepare('SELECT * FROM becca_profile WHERE workspace = ?').get(ws);
  if (!row) return res.json(null);
  res.json({
    ...row,
    industries: JSON.parse(row.industries || '[]'),
    usecases: JSON.parse(row.usecases || '[]'),
    links: JSON.parse(row.links || '[]'),
    key_products: JSON.parse(row.key_products || '[]'),
    competitors: JSON.parse(row.competitors || '[]'),
  });
});

router.put('/profile', (req, res) => {
  const ws = req.body.workspace || 'default';
  const existing = db.prepare('SELECT id FROM becca_profile WHERE workspace = ?').get(ws);
  const now = nowIso();
  const website = (req.body.website || '').trim();
  const links = (req.body.links || []).filter(Boolean);
  const key_products = (req.body.key_products || []).filter(Boolean);
  const competitors = (req.body.competitors || []).filter(Boolean);
  const b = req.body;
  if (existing) {
    db.prepare(`UPDATE becca_profile SET name=?, role=?, location=?, website=?, links=?, bio=?, industries=?, usecases=?, company_name=?, company_description=?, company_size=?, key_products=?, competitors=?, target_market=?, value_proposition=?, updated_at=? WHERE workspace=?`).run(
      b.name || '', b.role || '', b.location || '', website,
      JSON.stringify(links), b.bio || '',
      JSON.stringify(b.industries || []), JSON.stringify(b.usecases || []),
      b.company_name || '', b.company_description || '', b.company_size || '',
      JSON.stringify(key_products), JSON.stringify(competitors),
      b.target_market || '', b.value_proposition || '',
      now, ws
    );
  } else {
    db.prepare(`INSERT INTO becca_profile (id, workspace, name, role, location, website, links, bio, industries, usecases, company_name, company_description, company_size, key_products, competitors, target_market, value_proposition, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newId(), ws, b.name || '', b.role || '', b.location || '', website,
      JSON.stringify(links), b.bio || '',
      JSON.stringify(b.industries || []), JSON.stringify(b.usecases || []),
      b.company_name || '', b.company_description || '', b.company_size || '',
      JSON.stringify(key_products), JSON.stringify(competitors),
      b.target_market || '', b.value_proposition || '',
      now, now
    );
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// KNOWLEDGE BASE DOCUMENTS
// ═══════════════════════════════════════════
router.get('/knowledge', (req, res) => {
  const ws = req.query.workspace || 'default';
  const rows = db.prepare('SELECT id, workspace, filename, doc_type, created_at FROM becca_knowledge_docs WHERE workspace = ? ORDER BY created_at DESC').all(ws);
  res.json(rows);
});

router.get('/knowledge/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM becca_knowledge_docs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Document not found' });
  res.json(row);
});

router.post('/knowledge', (req, res) => {
  const ws = req.body.workspace || 'default';
  const filename = (req.body.filename || '').trim();
  const content = (req.body.content || '').trim();
  const docType = req.body.doc_type || 'text';
  if (!filename || !content) return res.status(400).json({ error: 'Filename and content required' });
  const id = newId();
  db.prepare('INSERT INTO becca_knowledge_docs (id, workspace, filename, content, doc_type, created_at) VALUES (?,?,?,?,?,?)').run(
    id, ws, filename, content, docType, nowIso()
  );
  res.json({ id, ok: true });
});

router.delete('/knowledge/:id', (req, res) => {
  db.prepare('DELETE FROM becca_knowledge_docs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// TOPICS
// ═══════════════════════════════════════════
router.get('/topics', (req, res) => {
  const ws = req.query.workspace || 'default';
  const status = req.query.status; // optional: 'active', 'paused', or undefined for all
  let rows;
  if (status) {
    rows = db.prepare('SELECT * FROM becca_topics WHERE workspace = ? AND status = ? ORDER BY sort_order ASC, created_at ASC').all(ws, status);
  } else {
    rows = db.prepare('SELECT * FROM becca_topics WHERE workspace = ? ORDER BY sort_order ASC, created_at ASC').all(ws);
  }
  res.json(rows);
});

router.post('/topics', (req, res) => {
  const ws = req.body.workspace || 'default';
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Topic name required' });

  const existing = db.prepare('SELECT id FROM becca_topics WHERE workspace = ? AND LOWER(normalized_topic) = LOWER(?) AND status = ?').get(ws, name, 'active');
  if (existing) return res.status(409).json({ error: 'Topic already exists' });

  const id = newId();
  const now = nowIso();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as mx FROM becca_topics WHERE workspace = ?').get(ws);
  db.prepare('INSERT INTO becca_topics (id, workspace, name, normalized_topic, context, priority, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, ws, name, name.toLowerCase().trim(), req.body.context || '', req.body.priority || 'medium', (maxOrder?.mx || 0) + 1, now, now
  );
  res.json({ id, ok: true });
});

router.put('/topics/:id', (req, res) => {
  const { id } = req.params;
  const now = nowIso();
  const sets = [];
  const vals = [];
  if (req.body.name !== undefined) { sets.push('name = ?'); vals.push(req.body.name); }
  if (req.body.context !== undefined) { sets.push('context = ?'); vals.push(req.body.context); }
  if (req.body.priority !== undefined) { sets.push('priority = ?'); vals.push(req.body.priority); }
  if (req.body.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(req.body.sort_order); }
  if (sets.length === 0) return res.json({ ok: true });
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(id);
  db.prepare(`UPDATE becca_topics SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/topics/:id', (req, res) => {
  db.prepare('UPDATE becca_topics SET status = ?, updated_at = ? WHERE id = ?').run('paused', nowIso(), req.params.id);
  res.json({ ok: true });
});

// Toggle blog generation for a topic
router.put('/topics/:id/toggle-blog', (req, res) => {
  const topic = db.prepare('SELECT id, blog_generation_enabled FROM becca_topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });
  const newVal = topic.blog_generation_enabled ? 0 : 1;
  db.prepare('UPDATE becca_topics SET blog_generation_enabled = ?, updated_at = ? WHERE id = ?').run(newVal, nowIso(), req.params.id);
  res.json({ ok: true, blog_generation_enabled: newVal });
});

// Pause/resume a topic
router.put('/topics/:id/toggle-status', (req, res) => {
  const topic = db.prepare('SELECT id, status FROM becca_topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });
  const newStatus = topic.status === 'active' ? 'paused' : 'active';
  db.prepare('UPDATE becca_topics SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, nowIso(), req.params.id);
  res.json({ ok: true, status: newStatus });
});

// Manual brief trigger for a single topic
router.post('/topics/:id/trigger-brief', async (req, res) => {
  const ws = req.body.workspace || 'default';
  const model = req.body.model || 'gpt-oss-20b';
  const region = req.body.region || '';
  const topic = db.prepare('SELECT * FROM becca_topics WHERE id = ? AND workspace = ?').get(req.params.id, ws);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });
  try {
    const items = await fetchTopicNews(topic.name, region, 5);
    if (items.length === 0) return res.json({ ok: true, summary: 'No recent news found for this topic.', items: [] });
    let summary = '';
    try {
      summary = await callGroq({
        model,
        system: `You are a news analyst. Given search results for a topic, write a concise 2-4 sentence briefing. Be factual. No markdown headers.`,
        user: `Topic: ${topic.name}\n${items.map(i => `- ${i.title} [${i.source}]`).join('\n')}`,
        temperature: 0.3,
        maxTokens: 512,
      });
      summary = stripThink(summary).trim();
    } catch {
      summary = items.map(i => `- ${i.title} [${i.source}]`).join('\n');
    }
    db.prepare('UPDATE becca_topics SET last_fetch_status = ?, consecutive_fetch_failures = 0, last_briefed_at = ? WHERE id = ?').run('success', nowIso(), topic.id);
    // Save as a briefing
    const briefingId = newId();
    db.prepare('INSERT INTO becca_briefings (id, workspace, topics_included, summary, topics_skipped, created_at) VALUES (?,?,?,?,?,?)').run(
      briefingId, ws, JSON.stringify([topic.id]), summary, '[]', nowIso()
    );
    res.json({ ok: true, summary, itemCount: items.length });
  } catch (err) {
    db.prepare('UPDATE becca_topics SET last_fetch_status = ?, last_fetch_error = ?, consecutive_fetch_failures = consecutive_fetch_failures + 1 WHERE id = ?').run('failed', err.message, topic.id);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// BRIEFINGS
// ═══════════════════════════════════════════
router.get('/briefings', (req, res) => {
  const ws = req.query.workspace || 'default';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare('SELECT * FROM becca_briefings WHERE workspace = ? ORDER BY created_at DESC LIMIT ?').all(ws, limit);
  res.json(rows.map(r => ({
    ...r,
    topics_included: JSON.parse(r.topics_included || '[]'),
    topics_skipped: JSON.parse(r.topics_skipped || '[]'),
  })));
});

// ═══════════════════════════════════════════
// BLOG DRAFTS
// ═══════════════════════════════════════════
router.get('/blog-drafts', (req, res) => {
  const ws = req.query.workspace || 'default';
  const status = req.query.status;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  let rows;
  if (status) {
    rows = db.prepare('SELECT * FROM becca_blog_drafts WHERE workspace = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(ws, status, limit);
  } else {
    rows = db.prepare('SELECT * FROM becca_blog_drafts WHERE workspace = ? ORDER BY created_at DESC LIMIT ?').all(ws, limit);
  }
  res.json(rows.map(r => ({ ...r, headers: JSON.parse(r.headers || '[]') })));
});

router.put('/blog-drafts/:id', (req, res) => {
  const sets = [];
  const vals = [];
  if (req.body.status !== undefined) { sets.push('status = ?'); vals.push(req.body.status); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE becca_blog_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/blog-drafts/:id', (req, res) => {
  db.prepare('DELETE FROM becca_blog_drafts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════
router.get('/reminders', (req, res) => {
  const ws = req.query.workspace || 'default';
  const rows = db.prepare('SELECT * FROM becca_reminders WHERE workspace = ? ORDER BY created_at DESC').all(ws);
  res.json(rows);
});

router.post('/reminders', (req, res) => {
  const ws = req.body.workspace || 'default';
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO becca_reminders (id, workspace, text, due, when_raw, fired, dismissed, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    id, ws, req.body.text || '', req.body.due || null, req.body.when_raw || '', 0, 0, now
  );
  res.json({ id, ok: true });
});

router.put('/reminders/:id', (req, res) => {
  const sets = [];
  const vals = [];
  if (req.body.fired !== undefined) { sets.push('fired = ?'); vals.push(req.body.fired ? 1 : 0); }
  if (req.body.dismissed !== undefined) { sets.push('dismissed = ?'); vals.push(req.body.dismissed ? 1 : 0); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE becca_reminders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/reminders/:id', (req, res) => {
  db.prepare('DELETE FROM becca_reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// MEMORY
// ═══════════════════════════════════════════
router.get('/memory', (req, res) => {
  const ws = req.query.workspace || 'default';
  const rows = db.prepare('SELECT * FROM becca_memory WHERE workspace = ? ORDER BY created_at ASC').all(ws);
  res.json(rows);
});

router.post('/memory', (req, res) => {
  const ws = req.body.workspace || 'default';
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Content required' });
  const id = newId();
  db.prepare('INSERT INTO becca_memory (id, workspace, content, created_at) VALUES (?,?,?,?)').run(id, ws, content, nowIso());
  res.json({ id, ok: true });
});

router.delete('/memory/:id', (req, res) => {
  db.prepare('DELETE FROM becca_memory WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// CHAT HISTORY — sessions by day
// ═══════════════════════════════════════════
function todaySessionId(ws) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${ws}:${y}-${m}-${day}`;
}

router.get('/chat', (req, res) => {
  const ws = req.query.workspace || 'default';
  const session = req.query.session;
  if (session) {
    const rows = db.prepare('SELECT * FROM becca_chat_history WHERE workspace = ? AND session_id = ? ORDER BY created_at ASC').all(ws, session);
    return res.json(rows);
  }
  // Return sessions list (grouped by day)
  const sessions = db.prepare(`SELECT session_id, MIN(created_at) as started, COUNT(*) as message_count FROM becca_chat_history WHERE workspace = ? GROUP BY session_id ORDER BY started DESC LIMIT 30`).all(ws);
  res.json(sessions);
});

router.get('/chat/:sessionId', (req, res) => {
  const ws = req.query.workspace || 'default';
  const rows = db.prepare('SELECT * FROM becca_chat_history WHERE workspace = ? AND session_id = ? ORDER BY created_at ASC').all(ws, req.params.sessionId);
  res.json(rows);
});

// ═══════════════════════════════════════════
// EXPORT — full knowledge base (markdown)
// ═══════════════════════════════════════════
router.get('/export', (req, res) => {
  const ws = req.query.workspace || 'default';

  const profile = db.prepare('SELECT * FROM becca_profile WHERE workspace = ?').get(ws);
  const memory = db.prepare('SELECT * FROM becca_memory WHERE workspace = ? ORDER BY created_at ASC').all(ws);
  const topics = db.prepare('SELECT * FROM becca_topics WHERE workspace = ? ORDER BY sort_order ASC').all(ws);
  const reminders = db.prepare('SELECT * FROM becca_reminders WHERE workspace = ? ORDER BY created_at ASC').all(ws);
  const sessions = db.prepare(`SELECT session_id, MIN(created_at) as started FROM becca_chat_history WHERE workspace = ? GROUP BY session_id ORDER BY started ASC`).all(ws);

  const parts = [];
  parts.push('# Homing Knowledge Base');
  parts.push(`\n_Exported ${nowIso()}_\n`);

  parts.push('## Profile');
  if (profile) {
    parts.push(`- Name: ${profile.name || ''}`);
    parts.push(`- Role: ${profile.role || ''}`);
    parts.push(`- Location: ${profile.location || ''}`);
    parts.push(`- Website: ${profile.website || ''}`);
    parts.push(`- Industries: ${JSON.parse(profile.industries || '[]').join(', ') || '—'}`);
    parts.push(`- Uses: ${JSON.parse(profile.usecases || '[]').join(', ') || '—'}`);
    const links = JSON.parse(profile.links || '[]');
    if (links.length) parts.push(`- Reference links: ${links.join(', ')}`);
    parts.push(`\n> ${profile.bio || ''}\n`);
  } else {
    parts.push('_No profile set up._');
  }

  parts.push('## Tracked Topics');
  if (topics.length) {
    topics.forEach(t => parts.push(`- **${t.name}**${t.context ? ` — ${t.context}` : ''}`));
  } else {
    parts.push('_None._');
  }

  parts.push('\n## Memory');
  if (memory.length) {
    memory.forEach(m => parts.push(`- ${m.content}`));
  } else {
    parts.push('_None._');
  }

  parts.push('\n## Reminders');
  if (reminders.length) {
    reminders.forEach(r => parts.push(`- ${r.text}${r.due ? ` (due ${r.due})` : ''}`));
  } else {
    parts.push('_None._');
  }

  parts.push('\n## Conversations');
  if (sessions.length) {
    for (const s of sessions) {
      const msgs = db.prepare('SELECT role, content, created_at FROM becca_chat_history WHERE workspace = ? AND session_id = ? ORDER BY created_at ASC').all(ws, s.session_id);
      parts.push(`\n### ${s.session_id}`);
      parts.push(`_${s.started}_`);
      for (const m of msgs) {
        const who = m.role === 'user' ? 'You' : 'Homin';
        parts.push(`\n**${who}:** ${m.content}`);
      }
      parts.push('');
    }
  } else {
    parts.push('_No conversations yet._');
  }

  const md = parts.join('\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="homing-knowledge-base.md"');
  res.send(md);
});

router.post('/chat', (req, res) => {
  const ws = req.body.workspace || 'default';
  const id = newId();
  const sessionId = req.body.session_id || todaySessionId(ws);
  db.prepare('INSERT INTO becca_chat_history (id, workspace, session_id, role, content, created_at) VALUES (?,?,?,?,?,?)').run(
    id, ws, sessionId, req.body.role || 'user', req.body.content || '', nowIso()
  );
  res.json({ id, session_id: sessionId, ok: true });
});

router.delete('/chat', (req, res) => {
  const ws = req.query.workspace || 'default';
  const session = req.query.session;
  if (session) {
    db.prepare('DELETE FROM becca_chat_history WHERE workspace = ? AND session_id = ?').run(ws, session);
  } else {
    db.prepare('DELETE FROM becca_chat_history WHERE workspace = ?').run(ws);
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// CHAT — Intent-aware message handler
// ═══════════════════════════════════════════
router.post('/chat/message', async (req, res) => {
  try {
    const { message, workspace, model } = req.body;
    const ws = workspace || 'default';
    const sessionId = todaySessionId(ws);

    // Save user message
    const userId = newId();
    const now = nowIso();
    db.prepare('INSERT INTO becca_chat_history (id, workspace, session_id, role, content, created_at) VALUES (?,?,?,?,?,?)').run(
      userId, ws, sessionId, 'user', message, now
    );

    // Get context: topics, profile, memory, knowledge base
    const topics = db.prepare('SELECT name, context FROM becca_topics WHERE workspace = ? ORDER BY sort_order ASC').all(ws);
    const profile = db.prepare('SELECT * FROM becca_profile WHERE workspace = ?').get(ws);
    const memory = db.prepare('SELECT content FROM becca_memory WHERE workspace = ? ORDER BY created_at ASC LIMIT 20').all(ws);
    const recentChat = db.prepare('SELECT role, content FROM becca_chat_history WHERE workspace = ? AND session_id = ? ORDER BY created_at DESC LIMIT 10').all(ws).reverse();
    const kbDocs = db.prepare('SELECT filename, content FROM becca_knowledge_docs WHERE workspace = ? ORDER BY created_at ASC LIMIT 10').all(ws);

    const settingsRow = db.prepare("SELECT value FROM becca_settings WHERE workspace = ? AND key = 'daily'").get(ws);
    let dailySettings = {};
    try { dailySettings = settingsRow ? JSON.parse(settingsRow.value) : {}; } catch {}
    const region = dailySettings.country || profile?.location || '';

    const topicList = topics.map(t => `- ${t.name}${t.context ? ': ' + t.context : ''}`).join('\n');
    const memoryList = memory.map(m => `- ${m.content}`).join('\n');
    const chatContext = recentChat.map(m => `${m.role}: ${m.content}`).join('\n');

    // Parse JSON fields from profile (DB stores them as strings)
    const profileLinks = JSON.parse(profile?.links || '[]');
    const profileProducts = JSON.parse(profile?.key_products || '[]');
    const profileCompetitors = JSON.parse(profile?.competitors || '[]');

    // Build company context block
    let companyContext = '';
    if (profile) {
      const parts = [];
      if (profile.company_name) parts.push(`Company: ${profile.company_name}`);
      if (profile.company_description) parts.push(`About: ${profile.company_description}`);
      if (profile.company_size) parts.push(`Size: ${profile.company_size}`);
      if (profile.target_market) parts.push(`Target market: ${profile.target_market}`);
      if (profile.value_proposition) parts.push(`Value proposition: ${profile.value_proposition}`);
      if (profileProducts.length) parts.push(`Key products/services: ${profileProducts.join(', ')}`);
      if (profileCompetitors.length) parts.push(`Competitors: ${profileCompetitors.join(', ')}`);
      if (parts.length) companyContext = `\nCompany context:\n${parts.join('\n')}\n`;
    }

    // Build knowledge base context
    let kbContext = '';
    if (kbDocs.length) {
      kbContext = `\nKnowledge base documents (reference these when answering questions about the company):\n${kbDocs.map(d => `[${d.filename}]\n${d.content.slice(0, 2000)}`).join('\n---\n')}\n`;
    }

    // Intent detection + response
    const systemPrompt = `You are Homin, a personal intelligence assistant. You help with research, content creation, and task management.

Current user profile: ${profile ? `${profile.name || 'Unknown'}, ${profile.role || ''}, ${profile.location || ''}` : 'Not set up yet'}
User's region/country (scope research, news, and recommendations here unless the user asks for elsewhere): ${region || 'unspecified'}
User's website: ${profile?.website || 'none'}
Reference links the user trusts (use these as context/sources when relevant):
${profileLinks.length ? profileLinks.map((l, i) => `- ${i + 1}. ${l}`).join('\n') : 'none'}
${companyContext}${kbContext}
Tracked topics:
${topicList || 'No topics tracked yet'}
Memory:
${memoryList || 'No memories stored'}

Recent conversation:
${chatContext}

You have these capabilities:
- SEARCH/RESEARCH: Search the web for news on any topic
- BRIEFING: Generate a briefing on tracked topics
- ADD_TOPIC: Add a new topic to the watchlist
- REMOVE_TOPIC: Remove a topic from the watchlist
- PIPELINE: Run the content pipeline (scout → write → image → seo)
- REMINDER: Set a reminder
- MEMORY: Remember something important
- CHAT: Just have a conversation

CRITICAL RULES:
1. ALWAYS respond with a JSON action block. NEVER respond with just plain text.
2. NEVER say "I'll search", "I'll look up", "I'll find" without actually emitting a SEARCH action.
3. NEVER say "I'll turn this into a blog post" without actually emitting a PIPELINE action.
4. Your reply field is shown to the user AFTER the action completes. Write it as if the action already happened.
5. If the user asks you to do something, you MUST emit the corresponding JSON action. Talking about doing it is NOT the same as doing it.

Format your ENTIRE response as:
{
  "action": "ACTION_TYPE",
  "params": { ... },
  "reply": "Your natural language response to the user"
}

IMPORTANT: When the user says things like "turn this into a blog post", "write this up", "make an article from this", or refers to content you just found via SEARCH, use the PIPELINE action with the topic extracted from that content. Do NOT ask the user to paste content again — use the search results from the conversation above.

Action types and params:
- SEARCH: { "query": "search terms" }
- BRIEFING: { "topics": ["topic1", "topic2"] } (or empty array for all)
- ADD_TOPIC: { "name": "topic name", "context": "optional context" }
IMPORTANT: These phrases all mean ADD_TOPIC: "keep tabs on", "keep an eye on", "keep track of", "follow up on", "follow", "track", "monitor", "watch", "scout for", "look into", "check in on", "check up on", "add to watchlist", "put on my radar", "start tracking", "set up tracking", "give me updates on", "send me updates on", "keep me posted on", "keep me updated on", "keep me informed on", "let me know about", "notify me about", "alert me about", "fill me in on", "stay on top of", "stay updated on", "I want to track", "I want to follow". NEVER just say you'll add it — actually emit the ADD_TOPIC JSON.
- REMOVE_TOPIC: { "name": "topic name" }
IMPORTANT: These phrases all mean REMOVE_TOPIC: "stop tracking", "stop watching", "stop monitoring", "remove from watchlist", "unfollow", "I don't care about anymore", "take off my radar", "no more updates on". Actually emit the REMOVE_TOPIC JSON.
- PIPELINE: { "topic": "topic name or short summary of the content to turn into a post", "tone": "optional tone" }
- REMINDER: { "text": "reminder text", "when": "tomorrow at 3pm" }
- MEMORY: { "content": "what to remember" }
- CHAT: {} (no params needed)

If it's just a conversation, use CHAT with an empty params object.
Always reply naturally and helpfully. Be concise.`;

    const response = await callGroq({
      model,
      system: systemPrompt,
      user: message,
      temperature: 0.6,
      maxTokens: 2048,
    });

    const rawResponse = response;

    const text = stripThink(rawResponse);

    // Parse action from RAW response (JSON may follow unclosed think block)
    let actionResult = null;
    let reply = text;
    try {
      let jsonStr = null;
      // First try: JSON in a code block
      const codeBlock = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (codeBlock) {
        try { JSON.parse(codeBlock[1]); jsonStr = codeBlock[1]; } catch {}
      }
      // Second try: find balanced JSON objects that contain "action"
      if (!jsonStr) {
        let pos = 0;
        while (pos < rawResponse.length) {
          const idx = rawResponse.indexOf('{', pos);
          if (idx === -1) break;
          let depth = 0; let end = -1;
          for (let i = idx; i < rawResponse.length; i++) {
            if (rawResponse[i] === '{') depth++;
            else if (rawResponse[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end > idx) {
            const candidate = rawResponse.slice(idx, end + 1);
            try {
              const parsed = JSON.parse(candidate);
              if (parsed && parsed.action) { jsonStr = candidate; break; }
            } catch {}
            pos = end + 1;
          } else break;
        }
      }
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        reply = stripThink(parsed.reply || text);
        if (parsed.action && parsed.action !== 'CHAT') {
          actionResult = await executeAction(parsed.action, parsed.params || {}, ws, model, region);
        }
      }
    } catch {}

    // Fallback: if AI didn't emit a JSON action, detect intent from user message
    if (!actionResult) {
      const lower = message.toLowerCase();

      // ── REMOVE_TOPIC ──
      const REMOVE_PHRASES = 'stop (?:tracking|watching|monitoring)|remove|unfollow|no more updates on|I don\'t care about|take (?:off|away)';
      const removeMatch = lower.match(new RegExp(`(?:(?:${REMOVE_PHRASES}))\\s+(.+?)(?:\\s+anymore|\\s+from (?:my )?(?:watchlist|radar|tracking)|[.!?]|$)`, 'i'));
      if (removeMatch) {
        let topicName = removeMatch[1].replace(/[.!?]+$/, '').trim();
        if (topicName) {
          actionResult = await executeAction('REMOVE_TOPIC', { name: topicName }, ws, model, region);
          reply = actionResult;
        }
      }

      // ── ADD_TOPIC ──
      if (!actionResult) {
        const ADD_PHRASES = [
          'keep tabs on', 'keep an eye on', 'keep track of', 'keep watching',
          'stay on top of', 'stay updated on', 'stay abreast of', 'stay vigilant about',
          'follow up on', 'follow', 'track', 'monitor', 'watch', 'watching',
          'scout for', 'look into', 'check in on', 'check up on',
          'add to (?:my )?watchlist', 'put on (?:my )?(?:radar|watchlist)',
          'start tracking (?:for )?', 'set up tracking (?:for )?',
          'give me updates on', 'give me alerts on', 'give me news on',
          'send me updates on', 'send me alerts on',
          'every time.*news.*on', 'whenever.*updates?.*on',
          'I want to (?:stay updated|track|follow|monitor|watch) on?',
          'I\'d like to (?:stay updated|track|follow|monitor|watch) on?',
          'I need to (?:stay updated|track|follow|monitor|watch) on?',
          'keep me posted on', 'keep me updated on', 'keep me informed on',
          'let me know about', 'let me know when', 'let me know if',
          'notify me about', 'notify me of', 'notify me on',
          'alert me about', 'alert me to',
          'fill me in on',
          'don\'t let me miss', 'not letting.*slip',
          'keeping a pulse on', 'keeping an ear to the ground on',
          'making sure nothing.*with',
        ].join('|');
        const addMatch = lower.match(new RegExp(`(?:(?:${ADD_PHRASES}))(?:\\s+(?:on|about|for))?\\s+(.+)`, 'i'));
        if (addMatch) {
          let topicName = addMatch[1].replace(/[.!?]+$/, '')
            .replace(/\s+(?:going forward|for me|regularly|from now on).*$/i, '').trim();
          if (topicName) {
            actionResult = await executeAction('ADD_TOPIC', { name: topicName, context: `User requested to track: ${message}` }, ws, model, region);
            reply = actionResult;
          }
        }
      }
    }
    if (!actionResult) {
      const lower = message.toLowerCase();
      const searchMatch = lower.match(/(?:search|look up|find|google|research|check)\s+(?:for\s+)?(.+)/i);
      if (searchMatch) {
        const query = searchMatch[1].replace(/[.!?]+$/, '').trim();
        actionResult = await executeAction('SEARCH', { query }, ws, model, region);
        reply = actionResult;
      }
    }
    if (!actionResult) {
      const lower = message.toLowerCase();
      const pipelineMatch = lower.match(/(?:turn|make|write|create|convert)\s+(?:this|that|it|the(?:se)?\s+results?)\s+(?:into|as|to)\s+(?:a\s+)?(?:blog\s*post|article|post|draft|content)/i);
      if (pipelineMatch) {
        const recentTopic = recentChat.filter(m => m.role === 'assistant').map(m => m.content).join(' ').slice(0, 200);
        actionResult = await executeAction('PIPELINE', { topic: recentTopic || message }, ws, model, region);
        reply = actionResult;
      }
    }

    // Last resort: if model said it would do something but didn't emit JSON, detect from reply text
    if (!actionResult) {
      const replyLower = (reply || '').toLowerCase();
      const msgLower = message.toLowerCase();

      // Detect ADD_TOPIC intent from reply text (AI often claims it added but didn't emit JSON)
      const replyAddMatch = replyLower.match(/(?:added|adding|started|set up)\s+(?:a\s+)?(?:watch|topic|track(?:ing)?|monitor(?:ing)?)\s+(?:on|for)\s+(.+?)(?:\.|,|\s+to your|\s+i'll|\s+covering)/i)
        || replyLower.match(/(?:added|adding)\s+["""]?(.+?)["""]?\s+to\s+(?:your\s+)?(?:watchlist|track(?:ing)?)?/i)
        || replyLower.match(/(?:i(?:'ve| have))\s+(?:added|set up|started)\s+(?:a\s+)?(?:watch|track(?:ing)?|monitor(?:ing)?)\s+(?:on|for)\s+(.+?)(?:\.|,|\s+to your|\s+i'll)/i)
        || replyLower.match(/(?:got it|okay|sure|alright)[.!]?\s+(?:i(?:'ve| have))?\s*(?:added|tracking|monitoring|watching)\s+(.+)/i);

      // Build same ADD_PHRASES list for msg matching
      const _ADD = [
        'keep tabs on', 'keep an eye on', 'keep track of', 'keep watching',
        'stay on top of', 'stay updated on', 'stay abreast of', 'stay vigilant about',
        'follow up on', 'follow', 'track', 'monitor', 'watch', 'watching',
        'scout for', 'look into', 'check in on', 'check up on',
        'add to (?:my |your )?watchlist', 'put on (?:my )?(?:radar|watchlist)',
        'start tracking (?:for )?', 'set up tracking (?:for )?',
        'give me updates on', 'send me updates on',
        'keep me posted on', 'keep me updated on', 'keep me informed on',
        'let me know about', 'let me know when', 'let me know if',
        'notify me about', 'notify me of', 'alert me about', 'alert me to',
        'fill me in on', "don't let me miss",
      ].join('|');
      const msgAddMatch = msgLower.match(new RegExp(`(?:(?:${_ADD}))(?:\\s+(?:on|about|for))?\\s+(.+)`, 'i'));

      if (replyAddMatch || msgAddMatch) {
        let topicName = (replyAddMatch?.[1] || msgAddMatch?.[1] || '').replace(/[.!?]+$/, '').replace(/["""]/g, '').trim();
        // Clean up common trailing phrases
        topicName = topicName.replace(/\s+(?:covering|including|and related|related).+$/i, '').trim();
        if (topicName) {
          actionResult = await executeAction('ADD_TOPIC', { name: topicName, context: `User requested to track: ${message}` }, ws, model, region);
          reply = actionResult;
        }
      }

      // Detect SEARCH intent from model's reply or user message
      const wantsSearch = /(?:search|look\s*up|find|google|research|check)\s+(?:for\s+)?/i.test(replyLower)
        || /(?:search|look\s*up|find|google|research|check)\s+(?:for\s+)?/i.test(msgLower);
      // Detect PIPELINE intent
      const wantsPipeline = /(?:blog\s*post|article|turn.*into|create.*post|write.*up|pipeline)/i.test(replyLower)
        || /(?:turn|make|write|create|convert)\s+(?:this|that|it|the)/i.test(msgLower);

      if (wantsSearch) {
        // Extract just the search query, stripping pipeline-related text
        let query = message.replace(/^(?:search|look up|find|google|research|check)\s+(?:for\s+)?/i, '').replace(/[.!?]+$/, '').trim();
        query = query.replace(/\s+(?:and|then|also)\s+(?:turn|make|write|create|convert)\s+.*$/i, '').trim();
        actionResult = await executeAction('SEARCH', { query: query || message }, ws, model, region);
        reply = actionResult;
      }
      // If user also wants pipeline after search, queue it
      if (wantsPipeline && wantsSearch) {
        try {
          const recentTopic = recentChat.filter(m => m.role === 'assistant').map(m => m.content).join(' ').slice(0, 200);
          const pipelineResult = await executeAction('PIPELINE', { topic: recentTopic || message }, ws, model, region);
          reply += '\n\n' + pipelineResult;
          actionResult = pipelineResult;
        } catch { /* pipeline may fail if server self-call times out */ }
      } else if (wantsPipeline && !wantsSearch) {
        const recentTopic = recentChat.filter(m => m.role === 'assistant').map(m => m.content).join(' ').slice(0, 200);
        actionResult = await executeAction('PIPELINE', { topic: recentTopic || message }, ws, model, region);
        reply = actionResult;
      }
    }

    // Append action result to reply if any
    if (actionResult) {
      actionResult = actionResult.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>/gi, '').trim();
      // Use action result directly — model's reply is usually just a promise like "I'll search..."
      reply = actionResult;
    }

    // Strip <think>...</think> tags from final reply (handle unclosed tags)
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>/gi, '').trim();

    // Save assistant response
    const assistantId = newId();
    db.prepare('INSERT INTO becca_chat_history (id, workspace, session_id, role, content, created_at) VALUES (?,?,?,?,?,?)').run(
      assistantId, ws, sessionId, 'assistant', reply, nowIso()
    );

    res.json({ reply, session_id: sessionId, action: actionResult ? 'executed' : 'chat' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function executeAction(action, params, ws, model, region = '') {
  try {
    switch (action) {
      case 'ADD_TOPIC': {
        const name = (params.name || '').trim();
        if (!name) return 'Could not add topic — no name provided.';
        const existing = db.prepare('SELECT id FROM becca_topics WHERE workspace = ? AND LOWER(normalized_topic) = LOWER(?) AND status = ?').get(ws, name, 'active');
        if (existing) return `Topic "${name}" is already on your watchlist.`;
        const id = newId();
        const now = nowIso();
        const maxOrder = db.prepare('SELECT MAX(sort_order) as mx FROM becca_topics WHERE workspace = ?').get(ws);
        db.prepare(`INSERT INTO becca_topics (id, workspace, name, normalized_topic, context, priority, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
          id, ws, name, name.toLowerCase().trim(), params.context || '', 'medium', (maxOrder?.mx || 0) + 1, now, now
        );
        return `Added "${name}" to your watchlist.`;
      }
      case 'REMOVE_TOPIC': {
        const name = (params.name || '').trim();
        const topic = db.prepare('SELECT id FROM becca_topics WHERE workspace = ? AND LOWER(normalized_topic) = LOWER(?) AND status = ?').get(ws, name, 'active');
        if (!topic) return `Topic "${name}" not found on your watchlist.`;
        db.prepare('UPDATE becca_topics SET status = ?, updated_at = ? WHERE id = ?').run('paused', nowIso(), topic.id);
        return `Removed "${name}" from your watchlist.`;
      }
      case 'MEMORY': {
        const content = (params.content || '').trim();
        if (!content) return 'Nothing saved — no content provided.';
        db.prepare('INSERT INTO becca_memory (id, workspace, content, created_at) VALUES (?,?,?,?)').run(newId(), ws, content, nowIso());
        return `Remembered: "${content.slice(0, 80)}${content.length > 80 ? '…' : ''}"`;
      }
      case 'REMINDER': {
        const text = (params.text || '').trim();
        if (!text) return 'No reminder text provided.';
        db.prepare('INSERT INTO becca_reminders (id, workspace, text, due, when_raw, fired, dismissed, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
          newId(), ws, text, params.when || null, params.when || '', 0, 0, nowIso()
        );
        return `Reminder set: "${text}"${params.when ? ' — ' + params.when : ''}`;
      }
      case 'PIPELINE': {
        const topicName = (params.topic || '').trim();
        if (!topicName) return 'No topic provided for the pipeline.';
        const port = process.env.PORT || 4000;
        try {
          const pipelineRes = await fetch(`http://localhost:${port}/api/becca/pipeline/run`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: ws, topicName, tone: params.tone || '', model })
          });
          const result = await pipelineRes.json();
          if (result.error) return `Pipeline failed: ${result.error}`;
          return `Pipeline complete! Post "${result.title}" created (${result.newsCount} sources, SEO score: ${result.seoScore}). Check your posts dashboard.`;
        } catch (e) {
          return `Pipeline failed: ${e.message}`;
        }
      }
      case 'SEARCH': {
        let query = (params.query || params.name || '').trim();
        if (!query) return 'Could not search — no query provided.';
        // Clean query: strip pipeline/article-related suffixes the model may have appended
        query = query.replace(/\s+(?:and|then|also)\s+(?:turn|make|write|create|convert)\s+(?:this|that|it|the)?\s*(?:into|to|as)?\s*(?:a\s+)?(?:blog\s*post|article|post|draft|content|pipeline).*$/i, '').trim();
        query = query.replace(/\s*[-–—]\s*(?:turn|make|write|create|convert)\s+.*$/i, '').trim();
        const regionQuery = (params.region || region || '').trim();
        let items;
        try {
          items = await fetchTopicNews(query, regionQuery, 5);
        } catch (err) {
          return `Search failed — ${err.message}.`;
        }
        if (items.length === 0) return `No results found for "${query}".`;
        let formatted = '';
        try {
          const summarized = await callGroq({
            model,
            system: `You are a research assistant. Given raw search results${regionQuery ? ` scoped to ${regionQuery}` : ''}, return a concise bullet-point summary of up to 5 findings, each on its own line starting with "- ". Include the source name in brackets and keep it factual. No markdown headers.`,
            user: JSON.stringify(items),
            temperature: 0.3,
            maxTokens: 1024,
          });
          formatted = stripThink(summarized);
          if (/<think/i.test(formatted) || !formatted) {
            formatted = items.map(i => `- ${i.title} [${i.source}]`).join('\n');
          }
        } catch {
          formatted = items.map(i => `- ${i.title} [${i.source}]`).join('\n');
        }
        return formatted;
      }
      case 'BRIEFING': {
        // Fetch + summarize all active topics for this workspace
        const topics = db.prepare('SELECT * FROM becca_topics WHERE workspace = ? AND status = ? ORDER BY sort_order ASC').all(ws, 'active');
        if (topics.length === 0) return 'No active topics to brief on. Add some topics to your watchlist first.';
        const included = [];
        const skipped = [];
        for (const t of topics) {
          try {
            const items = await fetchTopicNews(t.name, region, 3);
            if (items.length === 0) {
              skipped.push({ id: t.id, name: t.name, reason: 'no_new_info' });
              continue;
            }
            included.push({ ...t, items });
            db.prepare('UPDATE becca_topics SET last_fetch_status = ?, consecutive_fetch_failures = 0, last_briefed_at = ? WHERE id = ?').run('success', nowIso(), t.id);
          } catch (err) {
            skipped.push({ id: t.id, name: t.name, reason: 'fetch_failed' });
            db.prepare('UPDATE becca_topics SET last_fetch_status = ?, last_fetch_error = ?, consecutive_fetch_failures = consecutive_fetch_failures + 1 WHERE id = ?').run('failed', err.message, t.id);
          }
        }
        if (included.length === 0) return 'Could not fetch updates for any topics. All fetches failed or returned no new info.';
        // Summarize combined brief
        const briefInput = included.map(t => `TOPIC: ${t.name}\n${t.items.map(i => `- ${i.title} [${i.source}]`).join('\n')}`).join('\n\n');
        let summary = '';
        try {
          summary = await callGroq({
            model,
            system: `You are a news analyst. Given search results for multiple topics, write ONE combined daily briefing. Use each topic name as a bold sub-heading, then 2-4 sentence summary per topic. Be factual and concise. No markdown headers (#), just bold text for topic names. If a topic has little news, say so briefly.`,
            user: briefInput,
            temperature: 0.3,
            maxTokens: 2048,
          });
          summary = stripThink(summary).trim();
        } catch {
          summary = included.map(t => `**${t.name}**\n${t.items.map(i => `- ${i.title} [${i.source}]`).join('\n')}`).join('\n\n');
        }
        // Save briefing
        const briefingId = newId();
        db.prepare('INSERT INTO becca_briefings (id, workspace, topics_included, summary, topics_skipped, created_at) VALUES (?,?,?,?,?,?)').run(
          briefingId, ws, JSON.stringify(included.map(t => t.id)), summary, JSON.stringify(skipped), nowIso()
        );
        // Check for 5+ consecutive failures → auto-pause
        for (const s of skipped) {
          if (s.reason === 'fetch_failed') {
            const topic = db.prepare('SELECT consecutive_fetch_failures FROM becca_topics WHERE id = ?').get(s.id);
            if (topic && topic.consecutive_fetch_failures >= 5) {
              db.prepare('UPDATE becca_topics SET status = ?, updated_at = ? WHERE id = ?').run('paused', nowIso(), s.id);
              skipped.push({ ...s, paused: true });
            }
          }
        }
        return summary;
      }
      default:
        return null;
    }
  } catch (err) {
    return `Action failed: ${err.message}`;
  }
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════
router.get('/settings', (req, res) => {
  const ws = req.query.workspace || 'default';
  const row = db.prepare("SELECT value FROM becca_settings WHERE workspace = ? AND key = 'daily'").get(ws);
  res.json(row ? JSON.parse(row.value) : { dailyOn: false, dailyTime: '07:00', quietFrom: '22:00', quietTo: '07:00', country: 'Nigeria' });
});

router.put('/settings', (req, res) => {
  const ws = req.body.workspace || 'default';
  const key = req.body.key || 'daily';
  const val = JSON.stringify(req.body.value || {});
  const existing = db.prepare('SELECT workspace FROM becca_settings WHERE workspace = ? AND key = ?').get(ws, key);
  if (existing) {
    db.prepare('UPDATE becca_settings SET value = ? WHERE workspace = ? AND key = ?').run(val, ws, key);
  } else {
    db.prepare('INSERT INTO becca_settings (workspace, key, value) VALUES (?,?,?)').run(ws, key, val);
  }
  res.json({ ok: true });
});

// Ensure becca_settings table exists
db.exec(`CREATE TABLE IF NOT EXISTS becca_settings (
  workspace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(workspace, key)
)`);

// ═══════════════════════════════════════════
// CONTENT PIPELINE — Posts CRUD
// ═══════════════════════════════════════════
router.get('/posts', (req, res) => {
  const ws = req.query.workspace || 'default';
  const status = req.query.status;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  let sql = 'SELECT * FROM becca_posts WHERE workspace = ?';
  const params = [ws];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]'), news_sources: JSON.parse(r.news_sources || '[]'), seo_data: JSON.parse(r.seo_data || '{}') })));
});

router.get('/posts/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM becca_posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json({ ...row, tags: JSON.parse(row.tags || '[]'), news_sources: JSON.parse(row.news_sources || '[]'), seo_data: JSON.parse(row.seo_data || '{}') });
});

router.post('/posts', (req, res) => {
  const ws = req.body.workspace || 'default';
  const id = newId();
  const now = nowIso();
  db.prepare(`INSERT INTO becca_posts (id, workspace, topic_name, title, slug, body, excerpt, tags, cover_url, status, published_url, seo_score, seo_data, news_sources, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, ws, req.body.topic_name || '', req.body.title || '', req.body.slug || '',
    req.body.body || '', req.body.excerpt || '', JSON.stringify(req.body.tags || []),
    req.body.cover_url || '', req.body.status || 'draft', req.body.published_url || '',
    req.body.seo_score || 0, JSON.stringify(req.body.seo_data || {}),
    JSON.stringify(req.body.news_sources || []), now, now
  );
  res.json({ id, ok: true });
});

router.put('/posts/:id', (req, res) => {
  const sets = [];
  const vals = [];
  const fields = ['topic_name', 'title', 'slug', 'body', 'excerpt', 'cover_url', 'status', 'published_url', 'seo_score'];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (req.body.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(req.body.tags)); }
  if (req.body.seo_data !== undefined) { sets.push('seo_data = ?'); vals.push(JSON.stringify(req.body.seo_data)); }
  if (req.body.news_sources !== undefined) { sets.push('news_sources = ?'); vals.push(JSON.stringify(req.body.news_sources)); }
  if (req.body.published_at !== undefined) { sets.push('published_at = ?'); vals.push(req.body.published_at); }
  if (sets.length === 0) return res.json({ ok: true });
  sets.push('updated_at = ?'); vals.push(nowIso());
  vals.push(req.params.id);
  db.prepare(`UPDATE becca_posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/posts/:id', (req, res) => {
  db.prepare('DELETE FROM becca_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// CONTENT PIPELINE — Scout (news search)
// ═══════════════════════════════════════════
router.post('/pipeline/scout', async (req, res) => {
  try {
    const { topic, topicContext, model } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic required' });

    // Plain (unquoted) search on the topic alone — wrapping it in exact-phrase
    // quotes made Google News match almost nothing, since real articles rarely
    // contain the literal topic phrase verbatim. topicContext is deliberately
    // excluded here too: it's meant to steer the write step's angle/tone, but
    // folding it into the news search made the query so specific it matched
    // zero articles.
    const searchQuery = topic;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;

    const rssRes = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!rssRes.ok) return res.status(502).json({ error: 'News feed unavailable' });
    const xml = await rssRes.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) && items.length < 8) {
      const block = m[1];
      const grab = (tag) => {
        const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        if (!match) return '';
        return match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
      };
      const title = grab('title');
      const dateRaw = grab('pubDate');
      const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      const source = sourceMatch ? sourceMatch[1].trim() : 'News';
      const link = grab('link') || grab('guid');
      items.push({
        title,
        source,
        url: link,
        date: dateRaw,
        summary: title,
      });
    }

    let newsItems = items;
    try {
      const summarized = await callGroq({
        model,
        system: 'You are a news editor. Given a list of raw news headlines, return ONLY valid JSON: an array of up to 5 items, each { title, source, url, date, summary } where summary is 1-2 informative sentences written from the headline. Keep source and url exactly as provided. No markdown.',
        user: JSON.stringify(items.slice(0, 8)),
        temperature: 0.3,
        maxTokens: 2048,
      });
      const parsed = JSON.parse(summarized.match(/\[[\s\S]*\]/)?.[0] || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) newsItems = parsed;
    } catch { /* fall back to raw RSS items */ }

    res.json({ items: newsItems, raw: JSON.stringify(items) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// CONTENT PIPELINE — Write (blog post)
// ═══════════════════════════════════════════
router.post('/pipeline/write', async (req, res) => {
  try {
    const { topic, topicContext, newsItems, tone, wordCount, model } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic required' });

    const newsContext = (newsItems || []).map((n, i) => `${i + 1}. ${n.title} - ${n.summary} (${n.source})`).join('\n');

    const prompt = `You are an expert blog writer. Write a blog post about "${topic}"${topicContext ? '. Context: ' + topicContext : ''}.

Use these news sources as reference:
${newsContext || 'No specific news sources provided.'}

Requirements:
- HARD REQUIREMENT: The "body" field MUST be ${wordCount || 800} words minimum. This is non-negotiable. If your first draft is short, add more sections, expand each section with concrete examples and analysis, and elaborate until you exceed the minimum. Count your words before finishing.
- Tone: ${tone || 'Professional yet approachable'}
- Include an engaging title (not generic)
- Write a compelling excerpt (1-2 sentences)
- Structure with clear sections using ## headers (use 6-8 sections)
- Include a strong intro hook and conclusion with call to action
- Suggest 3-5 relevant tags

Return ONLY valid JSON with this exact structure:
{
  "title": "Blog post title",
  "slug": "blog-post-slug",
  "body": "Full markdown blog post body, ${wordCount || 800}+ words",
  "excerpt": "1-2 sentence excerpt",
  "tags": ["tag1", "tag2", "tag3"]
}`;

    const text = await callGroq({
      model: model || 'gpt-oss-120b',
      system: 'You are an expert blog writer. Always respond with valid JSON only, no markdown.',
      user: prompt,
      temperature: 0.7,
      // Room for a 1200+ word post plus JSON wrapper overhead
      maxTokens: 4000,
    });

    let post = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) post = JSON.parse(jsonMatch[0]);
    } catch {}

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// CONTENT PIPELINE — Cover image (Pollinations.ai)
// ═══════════════════════════════════════════
router.post('/pipeline/image', async (req, res) => {
  try {
    const { title, topic, style } = req.body;
    const prompt = `Professional blog post cover image for "${title || topic}". ${style || 'Modern minimalist design, clean composition, professional photography style'}. 1200x630 aspect ratio, high quality, no text overlay.`;
    const encoded = encodeURIComponent(prompt);
    // Pollinations.ai rejects seeds above the 32-bit signed int max (2147483647);
    // Date.now() is a 13-digit ms timestamp and overflows that, so the API
    // silently failed image generation while a HEAD check still looked fine.
    const seed = Math.floor(Math.random() * 2147483647);
    const url = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1200&height=630&nologo=true&seed=${seed}`;

    // Verify image is accessible — a GET, not HEAD: pollinations.ai returns 200
    // on HEAD even when the actual generation subsequently fails (e.g. bad
    // params), so HEAD alone was a false-positive check.
    const imgRes = await fetch(url, { redirect: 'follow' });
    const contentType = imgRes.headers.get('content-type') || '';
    if (!imgRes.ok || !contentType.startsWith('image/')) {
      const body = await imgRes.text().catch(() => '');
      throw new Error(`Image generation failed (${imgRes.status}): ${body.slice(0, 200)}`);
    }
    const finalUrl = imgRes.url || url;

    res.json({ url: finalUrl, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// CONTENT PIPELINE — SEO audit (RankNibbler)
// ═══════════════════════════════════════════
router.post('/pipeline/seo', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required for SEO audit' });

    const response = await fetch(`https://api.ranknibble.com/api/analyze?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEO check for draft content (on-page analysis without live URL)
router.post('/pipeline/seo/check', async (req, res) => {
  try {
    const { title, body, excerpt, tags } = req.body;
    // Basic on-page SEO analysis
    const issues = [];
    let score = 100;

    if (!title || title.length < 10) { issues.push({ severity: 'high', message: 'Title is too short (minimum 10 characters)', fix: 'Write a more descriptive title' }); score -= 20; }
    if (title && title.length > 60) { issues.push({ severity: 'medium', message: 'Title may be too long for SERPs (>60 characters)', fix: 'Shorten to under 60 characters' }); score -= 10; }
    if (!excerpt || excerpt.length < 50) { issues.push({ severity: 'high', message: 'Excerpt/meta description is missing or too short', fix: 'Write a 150-160 character excerpt' }); score -= 15; }
    if (excerpt && excerpt.length > 160) { issues.push({ severity: 'medium', message: 'Excerpt may be truncated in SERPs (>160 characters)', fix: 'Shorten to under 160 characters' }); score -= 5; }
    if (!body || body.length < 300) { issues.push({ severity: 'high', message: 'Content is too thin (<300 words)', fix: 'Write at least 800 words for good SEO' }); score -= 25; }
    if (!tags || tags.length === 0) { issues.push({ severity: 'medium', message: 'No tags/categories assigned', fix: 'Add relevant tags for topic clustering' }); score -= 5; }

    // Check for headers
    const headers = (body || '').match(/^#{1,3}\s+.+/gm) || [];
    if (headers.length < 2) { issues.push({ severity: 'medium', message: 'Few subheadings found', fix: 'Add H2/H3 headers to improve readability' }); score -= 10; }

    // Check word count
    const words = (body || '').split(/\s+/).filter(Boolean).length;
    if (words > 0 && words < 300) { issues.push({ severity: 'high', message: `Only ${words} words - aim for 800+`, fix: 'Expand the content with more detail' }); score -= 15; }
    if (words > 2000) { issues.push({ severity: 'low', message: `Long content (${words} words) - ensure it stays focused`, fix: 'Consider breaking into a series' }); }

    // Slug check
    const slugIssues = [];
    if (title) {
      const suggestedSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      slugIssues.push({ suggested: suggestedSlug });
    }

    res.json({ score: Math.max(0, score), issues, wordCount: words, headerCount: headers.length, slugSuggestions: slugIssues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// CONTENT PIPELINE — Full run
// ═══════════════════════════════════════════
router.post('/pipeline/run', async (req, res) => {
  try {
    const { workspace, topicName, topicContext, tone, wordCount, model } = req.body;
    const ws = workspace || 'default';

    // Step 1: Scout news
    const scoutRes = await fetch(`http://localhost:${process.env.PORT || 4000}/api/becca/pipeline/scout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topicName, topicContext, model })
    });
    const { items: newsItems } = await scoutRes.json();

    // Step 2: Write blog post
    const writeRes = await fetch(`http://localhost:${process.env.PORT || 4000}/api/becca/pipeline/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topicName, topicContext, newsItems, tone, wordCount, model })
    });
    const post = await writeRes.json();
    // Abort rather than silently saving an empty draft — a failed write step
    // (rate limit, bad JSON from the model, etc.) used to fall through and
    // save a blank "Untitled" post with no visible error.
    if (!writeRes.ok || post.error || !post.title || !post.body) {
      throw new Error(post.error || 'Write step returned no content');
    }

    // Step 3: Generate cover image
    const imgRes = await fetch(`http://localhost:${process.env.PORT || 4000}/api/becca/pipeline/image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: post.title, topic: topicName })
    });
    const imgData = await imgRes.json();
    if (!imgRes.ok || imgData.error) {
      throw new Error(imgData.error || 'Image generation failed');
    }
    const coverUrl = imgData.url;

    // Step 4: SEO check on draft
    const seoRes = await fetch(`http://localhost:${process.env.PORT || 4000}/api/becca/pipeline/seo/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: post.title, body: post.body, excerpt: post.excerpt, tags: post.tags })
    });
    const seoData = await seoRes.json();

    // Step 5: Save post
    const id = newId();
    const now = nowIso();
    db.prepare(`INSERT INTO becca_posts (id, workspace, topic_name, title, slug, body, excerpt, tags, cover_url, status, published_url, seo_score, seo_data, news_sources, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, ws, topicName, post.title || '', post.slug || '',
      post.body || '', post.excerpt || '', JSON.stringify(post.tags || []),
      coverUrl, 'draft', '', seoData.score || 0, JSON.stringify(seoData),
      JSON.stringify(newsItems || []), now, now
    );

    res.json({ id, title: post.title, slug: post.slug, excerpt: post.excerpt, tags: post.tags, coverUrl, seoScore: seoData.score, seoData, newsCount: newsItems?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
