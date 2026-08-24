/**
 * Social Listening service — orchestrates fetching from all platforms,
 * sentiment analysis, deduplication, and trend tracking.
 */

import { db, nowIso, newId } from '../db.js';
import { searchYouTube } from './youtube.js';
import { searchReddit } from './reddit.js';
import { searchTwitter } from './twitter.js';
import { searchTikTok } from './tiktok.js';
import { searchInstagram } from './instagram.js';
import { searchFacebook } from './facebook.js';
import { searchSnapchat } from './snapchat.js';
import { searchNairaland } from './nairaland.js';
import { batchSentiment } from './sentiment.js';

const PLATFORM_FETCHERS = {
  youtube: searchYouTube,
  reddit: searchReddit,
  twitter: searchTwitter,
  tiktok: searchTikTok,
  instagram: searchInstagram,
  facebook: searchFacebook,
  snapchat: searchSnapchat,
  nairaland: searchNairaland,
};

/**
 * Fetch mentions from all configured platforms for a topic.
 * Returns { mentions: [...], stubs: [...] }
 */
export async function fetchTopicMentions(topic, { maxPerPlatform = 10 } = {}) {
  const platforms = JSON.parse(topic.platforms || '["google_news"]');
  const allMentions = [];
  const stubs = [];

  for (const platform of platforms) {
    const fetcher = PLATFORM_FETCHERS[platform];
    if (!fetcher) continue;

    const query = topic.context ? `${topic.name} ${topic.context}` : topic.name;
    const result = await fetcher(query, { maxResults: maxPerPlatform });

    if (result.stub) {
      stubs.push({ platform, message: result.message });
      continue;
    }

    for (const item of (result.items || [])) {
      allMentions.push({
        id: newId(),
        topicId: topic.id,
        platform: item.platform || platform,
        title: item.title || '',
        snippet: item.snippet || '',
        url: item.url || '',
        author: item.author || '',
        authorUrl: item.authorUrl || '',
        publishedAt: item.publishedAt || null,
        fetchedAt: nowIso(),
      });
    }
  }

  return { mentions: allMentions, stubs };
}

/**
 * Save mentions to DB, deduplicating by URL.
 */
export function saveMentions(mentions) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO social_mentions
      (id, workspace, topic_id, platform, title, snippet, url, author, author_url, published_at, fetched_at, sentiment, sentiment_score)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let saved = 0;
  const insert = db.transaction((items) => {
    for (const m of items) {
      try {
        stmt.run(m.id, m.workspace || 'default', m.topicId, m.platform, m.title, m.snippet, m.url, m.author, m.authorUrl, m.publishedAt, m.fetchedAt, m.sentiment || null, m.sentimentScore || null);
        saved++;
      } catch {
        // skip duplicates
      }
    }
  });
  insert(mentions);
  return saved;
}

/**
 * Run sentiment analysis on recent unanalyzed mentions.
 */
export async function analyzeRecentSentiment(workspace = 'default', limit = 50) {
  const rows = db.prepare(`
    SELECT id, title, snippet FROM social_mentions
    WHERE workspace = ? AND sentiment IS NULL
    ORDER BY fetched_at DESC LIMIT ?
  `).all(workspace, limit);

  if (rows.length === 0) return 0;

  const texts = rows.map((r) => `${r.title}. ${r.snippet}`);
  const results = await batchSentiment(texts);

  const update = db.prepare(`UPDATE social_mentions SET sentiment = ?, sentiment_score = ? WHERE id = ?`);
  let updated = 0;
  db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      update.run(results[i].sentiment, results[i].score, rows[i].id);
      updated++;
    }
  })();
  return updated;
}

/**
 * Update daily trend aggregates for a topic.
 */
export function updateTrends(topicId, workspace = 'default') {
  const today = new Date().toISOString().slice(0, 10);

  const platforms = db.prepare(`
    SELECT DISTINCT platform FROM social_mentions
    WHERE topic_id = ? AND workspace = ?
  `).all(topicId, workspace);

  const upsert = db.prepare(`
    INSERT INTO social_trends (id, workspace, topic_id, platform, date, mention_count, sentiment_avg)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace, topic_id, platform, date) DO UPDATE SET
      mention_count = excluded.mention_count,
      sentiment_avg = excluded.sentiment_avg
  `);

  db.transaction(() => {
    for (const { platform } of platforms) {
      const stats = db.prepare(`
        SELECT COUNT(*) as count, AVG(sentiment_score) as avg_sentiment
        FROM social_mentions
        WHERE topic_id = ? AND workspace = ? AND platform = ?
          AND date(fetched_at) = ?
      `).get(topicId, workspace, platform, today);

      upsert.run(newId(), workspace, topicId, platform, today, stats.count, stats.avg_sentiment);
    }
  })();
}

/**
 * Detect spikes: today's mention count vs 7-day average.
 * Returns array of { platform, todayCount, avgCount, ratio } for spikes > 2x.
 */
export function detectSpikes(topicId, workspace = 'default') {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT platform,
      SUM(CASE WHEN date = ? THEN mention_count ELSE 0 END) as today_count,
      AVG(CASE WHEN date < ? THEN mention_count ELSE NULL END) as avg_count
    FROM social_trends
    WHERE topic_id = ? AND workspace = ?
      AND date >= date(?, '-7 days')
    GROUP BY platform
  `).all(topicId, workspace, topicId, workspace, today);

  return rows
    .filter((r) => r.today_count > 0 && r.avg_count > 0)
    .map((r) => ({
      platform: r.platform,
      todayCount: r.today_count,
      avgCount: Math.round(r.avg_count * 10) / 10,
      ratio: Math.round((r.today_count / r.avg_count) * 10) / 10,
    }))
    .filter((r) => r.ratio >= 2);
}

/**
 * Full scan for a topic: fetch → dedupe → save → sentiment → trends.
 */
export async function scanTopic(topic) {
  const { mentions, stubs } = await fetchTopicMentions(topic);

  // Assign workspace
  mentions.forEach((m) => { m.workspace = topic.workspace || 'default'; });

  const saved = saveMentions(mentions);

  // Sentiment on new mentions
  if (saved > 0) {
    await analyzeRecentSentiment(topic.workspace, saved);
  }

  // Update trends
  updateTrends(topic.id, topic.workspace);

  // Detect spikes
  const spikes = detectSpikes(topic.id, topic.workspace);

  return { fetched: mentions.length, saved, stubs, spikes };
}
