import { db, nowIso, newId } from './db.js';
import { scanTopic } from './services/socialListening.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callGroqLocal({ model, system, user, temperature = 0.3, maxTokens = 2048 }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Groq API error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function stripThink(s) {
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*$/gi, '');
  return out.trim();
}

function resolveNewsLocale(region) {
  const COUNTRY_LOCALES = {
    nigeria: { hl: 'en-NG', gl: 'NG', ceid: 'NG:en' },
    usa: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
    uk: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  };
  const key = String(region || '').trim().toLowerCase();
  return COUNTRY_LOCALES[key] || { hl: 'en-US', gl: 'US', ceid: 'US:en' };
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

async function generateBlogDraft(topic, items, model) {
  const newsText = items.map(i => `- ${i.title} [${i.source}]`).join('\n');
  const raw = await callGroqLocal({
    model,
    system: `You are an SEO content writer. Given recent news about a topic, generate a blog post draft.
Return ONLY valid JSON with these fields:
{
  "title": "SEO-optimized title under 60 chars",
  "meta_description": "150-160 char meta description with target keyword",
  "target_keyword": "primary keyword phrase",
  "headers": ["H2 header 1", "H2 header 2", ...],
  "body": "Full markdown content, 800-1500 words, natural keyword usage, short paragraphs, scannable formatting"
}
No markdown code fences. Just the JSON object.`,
    user: `Topic: ${topic.name}\n\nRecent news:\n${newsText}`,
    temperature: 0.4,
    maxTokens: 4096,
  });
  const cleaned = stripThink(raw);
  // Extract JSON from response
  let json;
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = JSON.parse(fenceMatch[1].trim());
  } else {
    // Try balanced brace parsing
    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON found in blog generation response');
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { json = JSON.parse(cleaned.slice(start, i + 1)); break; } }
    }
  }
  if (!json || !json.body) throw new Error('Invalid blog draft JSON');
  const wordCount = json.body.split(/\s+/).length;
  return { ...json, word_count: wordCount };
}

async function runBriefingForWorkspace(ws, model, region = '') {
  const topics = db.prepare('SELECT * FROM becca_topics WHERE workspace = ? AND status = ? ORDER BY sort_order ASC').all(ws, 'active');
  if (topics.length === 0) return null;

  // Check idempotency: already ran today?
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const existing = db.prepare('SELECT id FROM becca_briefings WHERE workspace = ? AND created_at >= ? AND created_at < ?').get(ws, todayStr, todayStr + 'T23:59:59');
  if (existing) return null; // Already ran today

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
      // Auto-pause after 5 consecutive failures
      const topic = db.prepare('SELECT consecutive_fetch_failures FROM becca_topics WHERE id = ?').get(t.id);
      if (topic && topic.consecutive_fetch_failures >= 5) {
        db.prepare('UPDATE becca_topics SET status = ?, updated_at = ? WHERE id = ?').run('paused', nowIso(), t.id);
      }
    }
  }

  if (included.length === 0) return null;

  // Generate combined brief
  const briefInput = included.map(t => `TOPIC: ${t.name}\n${t.items.map(i => `- ${i.title} [${i.source}]`).join('\n')}`).join('\n\n');
  let summary = '';
  try {
    summary = await callGroqLocal({
      model,
      system: `You are a news analyst. Given search results for multiple topics, write ONE combined daily briefing. Use each topic name as a bold sub-heading, then 2-4 sentence summary per topic. Be factual and concise. No markdown headers (#), just bold text for topic names.`,
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

  // Generate blog drafts for topics with blog_generation_enabled
  for (const t of included) {
    if (!t.blog_generation_enabled) continue;
    // Freshness gate: skip if last blog was generated with same material
    if (t.last_blog_generated_at && t.last_briefed_at && t.last_blog_generated_at >= t.last_briefed_at) continue;
    try {
      const draft = await generateBlogDraft(t, t.items, model);
      const draftId = newId();
      db.prepare('INSERT INTO becca_blog_drafts (id, workspace, watchlist_item_id, title, meta_description, target_keyword, headers, body, status, word_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        draftId, ws, t.id, draft.title, draft.meta_description, draft.target_keyword,
        JSON.stringify(draft.headers), draft.body, 'draft', draft.word_count, nowIso()
      );
      db.prepare('UPDATE becca_topics SET last_blog_generated_at = ? WHERE id = ?').run(nowIso(), t.id);
    } catch (err) {
      console.error(`Blog generation failed for topic "${t.name}":`, err.message);
    }
  }

  return { briefingId, topicCount: included.length, skippedCount: skipped.length };
}

let isRunning = false;

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    // Get all unique workspaces that have briefs enabled
    const rows = db.prepare(`
      SELECT DISTINCT s.workspace, s.value
      FROM becca_settings s
      WHERE s.key = 'daily'
    `).all();

    for (const row of rows) {
      try {
        const settings = JSON.parse(row.value);
        if (!settings.dailyOn) continue;

        const dailyTime = settings.dailyTime || '07:00';
        const [targetHour, targetMin] = dailyTime.split(':').map(Number);

        const now = new Date();
        // Use workspace timezone if set, otherwise UTC
        const tz = settings.timezone || 'UTC';
        let localHour, localMin;
        try {
          const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: tz });
          const parts = formatter.formatToParts(now);
          localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
          localMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        } catch {
          localHour = now.getUTCHours();
          localMin = now.getUTCMinutes();
        }

        // Fire if within 1 minute of target time
        if (localHour === targetHour && Math.abs(localMin - targetMin) <= 0) {
          const region = settings.country || '';
          console.log(`[Scheduler] Running daily brief for workspace "${row.workspace}" (region: ${region || 'global'})`);
          await runBriefingForWorkspace(row.workspace, 'openai/gpt-oss-20b', region);
        }
      } catch (err) {
        console.error(`[Scheduler] Error processing workspace "${row.workspace}":`, err.message);
      }
    }
  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  console.log('[Scheduler] Started — checking every 60 seconds');
  setInterval(tick, 60_000);
  // Also run once on startup (after 5s delay to let server start)
  setTimeout(tick, 5_000);
}

// Export for manual triggering via API
export { runBriefingForWorkspace };

// ── Social listening scan (runs every 30 min) ──
let socialRunning = false;
async function socialTick() {
  if (socialRunning) return;
  socialRunning = true;
  try {
    const topics = db.prepare("SELECT * FROM becca_topics WHERE status = 'active' AND platforms != '[]'").all();
    for (const topic of topics) {
      try {
        const result = await scanTopic(topic);
        if (result.saved > 0) {
          console.log(`[Social] Scanned "${topic.name}": ${result.fetched} fetched, ${result.saved} saved`);
        }
        if (result.spikes?.length) {
          console.log(`[Social] Spikes detected for "${topic.name}":`, result.spikes);
        }
      } catch (err) {
        console.error(`[Social] Error scanning "${topic.name}":`, err.message);
      }
      // Rate-limit between topics
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    socialRunning = false;
  }
}

export function startSocialScheduler() {
  console.log('[Social Scheduler] Started — scanning every 30 minutes');
  setInterval(socialTick, 30 * 60_000);
  setTimeout(socialTick, 15_000); // first scan 15s after boot
}

// ── Social assets pruning (storage-growth guard) ──
function pruneSocialAssets() {
  try {
    const expired = db.prepare("DELETE FROM social_assets WHERE created_at < datetime('now','-30 days')").run();
    if (expired.changes) console.log(`[Prune] Removed ${expired.changes} expired social_assets (>30d)`);
    // Cap at 500 most-recent rows — keeps the DB bounded even under heavy use
    const count = db.prepare('SELECT COUNT(*) as c FROM social_assets').get().c;
    if (count > 500) {
      const excess = db.prepare('DELETE FROM social_assets WHERE id NOT IN (SELECT id FROM social_assets ORDER BY created_at DESC LIMIT 500)').run();
      if (excess.changes) console.log(`[Prune] Trimmed ${excess.changes} social_assets to 500-row cap`);
    }
  } catch (e) {
    console.warn('[Prune] social_assets cleanup failed:', e.message);
  }
}

export function startSocialAssetsPruner() {
  console.log('[Prune] Social assets pruner — daily, 30d TTL + 500-row cap');
  pruneSocialAssets(); // run once on boot to catch any backlog
  setInterval(pruneSocialAssets, 24 * 60 * 60 * 1000);
}
