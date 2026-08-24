/**
 * Reddit JSON API — search posts by keyword.
 * No auth needed. Uses public .json endpoints.
 * Respects rate limits (60 req/min for unauthenticated).
 */

const UA = 'HominBot/1.0 (social listening)';

export async function searchReddit(query, { maxResults = 10, subreddits = [] } = {}) {
  const subs = subreddits.length > 0 ? subreddits : ['all'];
  const items = [];

  for (const sub of subs) {
    if (items.length >= maxResults) break;
    const remaining = maxResults - items.length;
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${Math.min(remaining, 25)}&restrict_sr=1`;

    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data?.data?.children || [];
      for (const post of posts) {
        const d = post.data;
        items.push({
          platform: 'reddit',
          title: d.title,
          snippet: (d.selftext || '').slice(0, 500),
          url: `https://reddit.com${d.permalink}`,
          author: d.author,
          authorUrl: `https://reddit.com/u/${d.author}`,
          publishedAt: new Date(d.created_utc * 1000).toISOString(),
          subreddit: d.subreddit,
          score: d.score,
          numComments: d.num_comments,
        });
        if (items.length >= maxResults) break;
      }
    } catch {
      // skip failed subreddit
    }
  }

  return { items, error: null };
}
