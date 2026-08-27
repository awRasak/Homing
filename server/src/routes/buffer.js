/**
 * Buffer Autopilot routes — /api/buffer
 */
import { Router } from 'express';
import { db } from '../db.js';
import {
  isBufferAvailable,
  getOrganizations,
  getChannels,
  getPosts,
  createPost as bufferCreatePost,
  deletePost as bufferDeletePost,
} from '../buffer.js';
import { generateBrandImage } from '../ai/brandImage.js';

const router = Router();

// ── GET /buffer/status — is Buffer connected? ──
router.get('/status', (_req, res) => {
  res.json({ connected: isBufferAvailable() });
});

// ── GET /buffer/channels — list all connected channels ──
router.get('/channels', async (_req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });
  try {
    const orgs = await getOrganizations();
    if (!orgs.length) return res.json({ channels: [], organizationId: null });
    const orgId = orgs[0].id;
    const channels = await getChannels(orgId);
    res.json({ channels, organizationId: orgId, organizationName: orgs[0].name });
  } catch (err) {
    console.error('[Buffer channels]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /buffer/posts — scheduled posts ──
router.get('/posts', async (req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });
  try {
    const orgs = await getOrganizations();
    if (!orgs.length) return res.json({ posts: [] });
    const posts = await getPosts(orgs[0].id, { status: ['scheduled'] });
    res.json({ posts });
  } catch (err) {
    console.error('[Buffer posts]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /buffer/posts — schedule a post ──
router.post('/posts', async (req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });
  const { channelId, text, mode = 'addToQueue', dueAt, imageUrl } = req.body;
  if (!channelId || !text?.trim()) return res.status(400).json({ error: 'channelId and text required' });

  try {
    const post = await bufferCreatePost({ channelId, text: text.trim(), mode, dueAt, imageUrl });
    res.json({ post });
  } catch (err) {
    console.error('[Buffer create post]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /buffer/posts/:id — remove a scheduled post ──
router.delete('/posts/:id', async (req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });
  try {
    await bufferDeletePost(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Buffer delete post]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /buffer/generate-image — on-demand brand image for the manual composer ──
router.post('/generate-image', async (req, res) => {
  const { text, topic, designId } = req.body;
  if (!text?.trim() && !topic?.trim()) return res.status(400).json({ error: 'text or topic required' });
  try {
    const { url, prompt } = await generateBrandImage({ headline: (text || topic).slice(0, 120), designId });
    res.json({ url, prompt });
  } catch (err) {
    console.error('[Buffer generate-image]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /buffer/generate — AI writes social posts from Becca's knowledge ──
router.post('/generate', async (req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });

  const { channelIds, topic, tone, designId, postId } = req.body;
  if (!channelIds?.length) return res.status(400).json({ error: 'channelIds required' });

  // Build context from Becca's knowledge
  const ws = req.workspace || 'default';

  // 0. A specific blog post to announce, when triggered from the content
  // pipeline ("draft a social post about this") — takes priority over the
  // generic last-3-drafts angle scan below.
  let announcePost = null;
  if (postId) {
    announcePost = db.prepare('SELECT title, excerpt, tags FROM becca_posts WHERE id = ? AND workspace = ?').get(postId, ws);
  }

  // 1. Profile
  const profile = db.prepare('SELECT * FROM becca_profile WHERE workspace = ?').get(ws);
  const profileFields = [];
  if (profile?.company_name) profileFields.push(`Company: ${profile.company_name}`);
  if (profile?.company_description) profileFields.push(`Description: ${profile.company_description}`);
  if (profile?.value_proposition) profileFields.push(`Value proposition: ${profile.value_proposition}`);
  if (profile?.key_products && profile.key_products !== '[]') {
    try { profileFields.push(`Products: ${JSON.parse(profile.key_products).join(', ')}`); } catch {}
  }
  if (profile?.target_market) profileFields.push(`Target market: ${profile.target_market}`);
  if (profile?.competitors && profile.competitors !== '[]') {
    try { profileFields.push(`Competitors: ${JSON.parse(profile.competitors).join(', ')}`); } catch {}
  }
  if (profile?.industries && profile.industries !== '[]') {
    try { profileFields.push(`Industry: ${JSON.parse(profile.industries).join(', ')}`); } catch {}
  }
  if (profile?.bio) profileFields.push(`Bio: ${profile.bio}`);

  // 2. Recent chat context (last 30 messages)
  const chats = db.prepare(
    "SELECT role, content FROM becca_chat_history WHERE workspace = ? ORDER BY created_at DESC LIMIT 30"
  ).all(ws).reverse();
  const chatContext = chats.map((m) => `${m.role === 'user' ? 'User' : 'Becca'}: ${m.content.slice(0, 400)}`).join('\n');

  // 3. Recent briefings
  const briefings = db.prepare(
    'SELECT summary FROM becca_briefings WHERE workspace = ? ORDER BY created_at DESC LIMIT 3'
  ).all(ws);
  const briefingText = briefings.map((b) => b.summary.slice(0, 800)).join('\n---\n');

  // 4. Recent blog drafts (may contain good angles)
  const posts = db.prepare(
    "SELECT title, excerpt FROM becca_posts WHERE workspace = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 3"
  ).all(ws);
  const postAngles = posts.map((p) => `- ${p.title}: ${p.excerpt?.slice(0, 200) || ''}`).join('\n');

  const contextParts = [
    profileFields.length ? `## Company Profile\n${profileFields.join('\n')}` : '',
    announcePost ? `## Blog Post To Announce (write ONLY about this)\nTitle: ${announcePost.title}\nExcerpt: ${announcePost.excerpt || ''}` : '',
    chatContext ? `## Recent Conversation\n${chatContext}` : '',
    briefingText ? `## Market Intelligence\n${briefingText}` : '',
    !announcePost && postAngles ? `## Blog Drafts\n${postAngles}` : '',
  ].filter(Boolean).join('\n\n');

  if (!contextParts.trim()) {
    return res.status(400).json({ error: 'No context available yet. Chat with Becca or scan competitors first.' });
  }

  const { generateText } = await import('../ai/providers.js');

  const channelSpecs = channelIds.map((c) => {
    const limits = { twitter: 280, linkedin: 3000, instagram: 2200, facebook: 63206, threads: 500, tiktok: 2200, pinterest: 500, mastodon: 500, bluesky: 300, google_business: 1500 };
    return `- ${c.service} (${c.displayName || c.name}) — max ${limits[c.service?.toLowerCase()] || 2200} characters`;
  }).join('\n');

  const prompt = `You are a social media content strategist writing for a real company. Write ONE engaging social media post for each channel listed below.

Use ONLY the company context provided. Write posts that feel authentic, not generic — reference specific products, competitors, market insights, or conversation themes you find in the context.

${contextParts}

Channels to write for:
${channelSpecs}

${topic ? `Topic/focus for these posts: ${topic}` : ''}

Style guidelines:
- Tone: ${tone || 'professional, warm, authentic'}
- Reference specific details from the context (products, competitors, market insights)
- Avoid generic filler or corporate jargon
- LinkedIn: thought-leadership, 2-4 paragraphs, insight-driven
- Twitter/X: concise, punchy, hashtags if natural
- Instagram: caption style, emoji-friendly, hashtags
- Facebook: conversational, community-building
- Threads/Bluesky: conversational, concise
- Pinterest: descriptive, keyword-rich
- Google Business: announcement-style, concise

Return a JSON array: [{ "channelId": "<id>", "text": "<post>", "service": "<service>" }]
Return ONLY the JSON array. No markdown fences, no explanation.`;

  try {
    const result = await generateText(prompt);
    let parsed = [];
    try {
      let text = result.trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) text = text.slice(arrStart, arrEnd + 1);
      parsed = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'AI returned unparseable content. Try again.', raw: result.slice(0, 500) });
    }

    const channelMap = {};
    for (const c of channelIds) channelMap[c.service?.toLowerCase()] = c;

    const prepared = parsed.map((p) => {
      const key = p.service?.toLowerCase();
      const ch = channelMap[key] || channelIds.find((c) => c.id === p.channelId) || channelIds[0];
      return { ...p, channelId: ch.id, channelName: ch.displayName || ch.name, service: ch.service };
    });

    // One shared brand image per batch — every channel in this generation
    // round gets the same visual, same as a real campaign asset would.
    let imageUrl = null;
    try {
      const headline = announcePost?.title || topic || prepared[0]?.text?.slice(0, 120);
      const img = await generateBrandImage({ headline, designId });
      imageUrl = img.url;
    } catch (err) {
      console.error('[Buffer generate image]', err.message);
      // Text posts are still usable without an image — don't fail the batch.
    }

    res.json({ posts: prepared.map((p) => ({ ...p, imageUrl })), imageUrl });
  } catch (err) {
    console.error('[Buffer generate]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /buffer/schedule-all — schedule a batch of generated posts ──
router.post('/schedule-all', async (req, res) => {
  if (!isBufferAvailable()) return res.status(503).json({ error: 'Buffer not configured' });
  const { posts, proposalId } = req.body;
  if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ error: 'posts array required' });

  const results = [];
  for (const p of posts) {
    try {
      const post = await bufferCreatePost({
        channelId: p.channelId,
        text: p.text,
        mode: p.dueAt ? 'customScheduled' : 'addToQueue',
        dueAt: p.dueAt,
        imageUrl: p.imageUrl,
      });
      results.push({ ok: true, postId: post?.id, channelName: p.channelName });
      // Record in local DB
      try {
        db.prepare(`INSERT INTO buffer_scheduled_posts (buffer_post_id, proposal_id, channel_id, channel_name, service, text, image_url, scheduled_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(post?.id || null, proposalId || null, p.channelId, p.channelName || '', p.service || '', p.text, p.imageUrl || null, p.dueAt || null);
      } catch { /* best effort */ }
    } catch (err) {
      results.push({ ok: false, error: err.message, channelName: p.channelName });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  res.json({ succeeded, failed, total: posts.length, results });
});

export default router;
