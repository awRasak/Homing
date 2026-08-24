/**
 * Nairaland — Nigeria's largest forum.
 * No official API. Uses Google site search + direct page scraping.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/**
 * Search Nairaland via Google site:nairaland.com
 */
async function googleSiteSearch(query, maxResults) {
  const params = new URLSearchParams({
    q: `site:nairaland.com ${query}`,
    num: String(maxResults),
    tbs: 'qdr:m', // last month
  });

  const res = await fetch(`https://www.google.com/search?${params}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) return [];

  const html = await res.text();
  const items = [];

  // Extract search results — Google wraps them in <div class="g">
  const resultRegex = /<div class="g"[^>]*>[\s\S]*?<a href="([^"]*nairaland\.com[^"]*)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?(?:<div[^>]*>([\s\S]*?)<\/div>)?/gi;
  let m;
  while ((m = resultRegex.exec(html)) && items.length < maxResults) {
    const url = m[1];
    const title = (m[2] || '').replace(/<[^>]+>/g, '').trim();
    const snippet = (m[3] || '').replace(/<[^>]+>/g, '').trim();
    if (title && url.includes('nairaland.com')) {
      items.push({ title, snippet, url });
    }
  }

  return items;
}

/**
 * Scrape a Nairaland thread page for content.
 */
async function scrapeThread(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract thread title
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(' - Nairaland', '').trim() : '';

    // Extract posts — Nairaland uses <div class="msg">
    const posts = [];
    const msgRegex = /<div class="msg"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    let pm;
    while ((pm = msgRegex.exec(html))) {
      const content = pm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (content.length > 10) posts.push(content);
    }

    // Fallback: extract any substantial text blocks
    if (posts.length === 0) {
      const bodyMatch = html.match(/<div id="main"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
      if (bodyMatch) {
        const text = bodyMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text.length > 20) posts.push(text);
      }
    }

    return { title, posts: posts.slice(0, 10) };
  } catch {
    return null;
  }
}

export async function searchNairaland(query, { maxResults = 10 } = {}) {
  try {
    const results = await googleSiteSearch(query, maxResults);
    const items = results.map((r) => ({
      platform: 'nairaland',
      title: r.title,
      snippet: r.snippet,
      url: r.url,
      author: '',
      authorUrl: '',
      publishedAt: null,
      source: 'Nairaland',
    }));

    return { items, error: null };
  } catch (e) {
    return { items: [], error: e.message };
  }
}
