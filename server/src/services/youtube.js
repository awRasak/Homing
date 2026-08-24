/**
 * YouTube Data API v3 — search for videos by keyword.
 * Free tier: 10,000 units/day. Each search costs ~100 units.
 * Needs YOUTUBE_API_KEY env var.
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

export async function searchYouTube(query, { maxResults = 10, apiKey } = {}) {
  const key = apiKey || process.env.YOUTUBE_API_KEY;
  if (!key) return { items: [], error: 'No YOUTUBE_API_KEY set' };

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    order: 'date',
    key,
  });

  try {
    const res = await fetch(`${BASE}/search?${params}`);
    if (!res.ok) {
      const body = await res.text();
      return { items: [], error: `YouTube API ${res.status}: ${body}` };
    }
    const data = await res.json();
    const items = (data.items || []).map((item) => ({
      platform: 'youtube',
      title: item.snippet.title,
      snippet: item.snippet.description,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
      author: item.snippet.channelTitle,
      authorUrl: `https://youtube.com/channel/${item.snippet.channelId}`,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url || null,
    }));
    return { items, error: null };
  } catch (e) {
    return { items: [], error: e.message };
  }
}
