/**
 * TikTok — stub. No official search API available.
 * Options for future: TikTok Research API (academic), Apify/RapidAPI scrapers.
 */
export async function searchTikTok(query, { maxResults = 10 } = {}) {
  return {
    items: [],
    error: null,
    stub: true,
    message: 'TikTok has no public search API. Options: TikTok Research API (academic access) or third-party scrapers (Apify, RapidAPI).',
  };
}
