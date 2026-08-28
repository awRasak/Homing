// Tavily — real web search, built for feeding LLM answers rather than
// returning raw links. Used in place of the Google News RSS scrape
// (fetchTopicNews in routes/becca.js) for one-off SEARCH lookups, where the
// question is often reference/factual rather than genuinely news-shaped.
// News-scouting for the Watchlist/Briefings/content-pipeline features stays
// on Google News RSS — that's what it's actually suited for.

const TAVILY_URL = 'https://api.tavily.com/search';

export function isTavilyAvailable() {
  return !!process.env.TAVILY_API_KEY;
}

// Returns { answer, results: [{ title, url, content }] }, or null if Tavily
// isn't configured — callers fall back to the news-scrape path in that case.
export async function tavilySearch(query, { region = '', maxResults = 5 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const fullQuery = region ? `${query} ${region}` : query;
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: fullQuery,
      search_depth: 'basic',
      include_answer: true,
      max_results: maxResults,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tavily search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    answer: data.answer || '',
    results: (data.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || '',
    })),
  };
}
