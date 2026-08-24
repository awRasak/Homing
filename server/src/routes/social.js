/**
 * Social Listening routes — /api/social
 */

import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import {
  scanTopic,
  fetchTopicMentions,
  detectSpikes,
  analyzeRecentSentiment,
} from '../services/socialListening.js';

const router = Router();

// ── GET /social/mentions — list mentions with filters ──
router.get('/mentions', (req, res) => {
  const ws = req.workspace || 'default';
  const { topic_id, platform, sentiment, limit = 50, offset = 0 } = req.query;

  let where = 'WHERE workspace = ?';
  const params = [ws];

  if (topic_id) { where += ' AND topic_id = ?'; params.push(topic_id); }
  if (platform) { where += ' AND platform = ?'; params.push(platform); }
  if (sentiment) { where += ' AND sentiment = ?'; params.push(sentiment); }

  const rows = db.prepare(`
    SELECT * FROM social_mentions ${where}
    ORDER BY fetched_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const total = db.prepare(`SELECT COUNT(*) as count FROM social_mentions ${where}`).get(...params);

  res.json({ mentions: rows, total: total.count });
});

// ── POST /social/scan/:topicId — scan a single topic ──
router.post('/scan/:topicId', async (req, res) => {
  const ws = req.workspace || 'default';
  const topic = db.prepare('SELECT * FROM becca_topics WHERE id = ? AND workspace = ?').get(req.params.topicId, ws);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  try {
    const result = await scanTopic(topic);
    res.json(result);
  } catch (e) {
    console.error('[Social scan]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /social/scan-all — scan all active topics ──
router.post('/scan-all', async (req, res) => {
  const ws = req.workspace || 'default';
  const topics = db.prepare("SELECT * FROM becca_topics WHERE workspace = ? AND status = 'active'").all(ws);

  const results = [];
  for (const topic of topics) {
    try {
      const result = await scanTopic(topic);
      results.push({ topic: topic.name, ...result });
    } catch (e) {
      results.push({ topic: topic.name, error: e.message });
    }
  }

  res.json({ scanned: results.length, results });
});

// ── GET /social/trends/:topicId — trend data for a topic ──
router.get('/trends/:topicId', (req, res) => {
  const ws = req.workspace || 'default';
  const { days = 14 } = req.query;

  const rows = db.prepare(`
    SELECT * FROM social_trends
    WHERE topic_id = ? AND workspace = ? AND date >= date('now', ?)
    ORDER BY date ASC, platform ASC
  `).all(req.params.topicId, ws, `-${Number(days)} days`);

  res.json({ trends: rows });
});

// ── GET /social/spikes/:topicId — detect spikes ──
router.get('/spikes/:topicId', (req, res) => {
  const ws = req.workspace || 'default';
  const spikes = detectSpikes(req.params.topicId, ws);
  res.json({ spikes });
});

// ── GET /social/stats/:topicId — summary stats for a topic ──
router.get('/stats/:topicId', (req, res) => {
  const ws = req.workspace || 'default';
  const topicId = req.params.topicId;

  const stats = db.prepare(`
    SELECT
      platform,
      COUNT(*) as total_mentions,
      AVG(sentiment_score) as avg_sentiment,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as negative,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) as neutral,
      MAX(fetched_at) as last_fetched
    FROM social_mentions
    WHERE topic_id = ? AND workspace = ?
    GROUP BY platform
  `).all(topicId, ws);

  const totalAll = db.prepare(`
    SELECT COUNT(*) as count FROM social_mentions WHERE topic_id = ? AND workspace = ?
  `).get(topicId, ws);

  res.json({ platforms: stats, totalMentions: totalAll.count });
});

// ── GET /social/stubs — which platforms need API keys ──
router.get('/stubs', (_req, res) => {
  const stubs = [
    { platform: 'twitter', needs: 'TWITTER_BEARER_TOKEN', docs: 'https://developer.x.com/en/docs/twitter-api' },
    { platform: 'tiktok', needs: 'TikTok Research API (academic access)', docs: 'https://developers.tiktok.com/' },
    { platform: 'instagram', needs: 'Meta Graph API approved app + INSTAGRAM_ACCESS_TOKEN', docs: 'https://developers.facebook.com/docs/instagram-api/' },
    { platform: 'facebook', needs: 'Meta Graph API approved app + FACEBOOK_ACCESS_TOKEN', docs: 'https://developers.facebook.com/docs/graph-api/' },
    { platform: 'snapchat', needs: 'No public API available', docs: null },
  ];
  const active = [];
  if (process.env.YOUTUBE_API_KEY) active.push('youtube');
  if (process.env.TWITTER_BEARER_TOKEN) active.push('twitter');
  active.push('reddit'); // always available
  res.json({ stubs, active });
});

export default router;
