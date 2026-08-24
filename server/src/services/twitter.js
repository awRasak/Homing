/**
 * Twitter/X API — stub for when API key is available.
 * Requires TWITTER_BEARER_TOKEN env var.
 * Free tier: 1,500 tweets/mo read. Basic: $100/mo for 10,000 tweets.
 */

const BASE = 'https://api.twitter.com/2';

export async function searchTwitter(query, { maxResults = 10, bearerToken } = {}) {
  const token = bearerToken || process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    return {
      items: [],
      error: null,
      stub: true,
      message: 'Twitter/X API requires a Bearer Token. Set TWITTER_BEARER_TOKEN to enable.',
    };
  }

  const params = new URLSearchParams({
    query: `${query} -is:retweet lang:en`,
    max_results: String(Math.min(maxResults, 100)),
    'tweet.fields': 'created_at,author_id,public_metrics',
    'user.fields': 'name,username',
    expansions: 'author_id',
  });

  try {
    const res = await fetch(`${BASE}/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { items: [], error: `Twitter API ${res.status}: ${body}` };
    }
    const data = await res.json();
    const users = {};
    (data.includes?.users || []).forEach((u) => { users[u.id] = u; });

    const items = (data.data || []).map((tweet) => {
      const user = users[tweet.author_id] || {};
      return {
        platform: 'twitter',
        title: tweet.text.slice(0, 100),
        snippet: tweet.text,
        url: `https://x.com/${user.username || '_/status'}/${tweet.id}`,
        author: user.name || tweet.author_id,
        authorUrl: `https://x.com/${user.username || '__'}`,
        publishedAt: tweet.created_at,
        metrics: tweet.public_metrics,
      };
    });
    return { items, error: null };
  } catch (e) {
    return { items: [], error: e.message };
  }
}
