/**
 * Instagram — stub. Meta Graph API requires app review + business account.
 * Hashtag search is severely restricted since 2024.
 */
export async function searchInstagram(query, { maxResults = 10, accessToken } = {}) {
  if (!accessToken && !process.env.INSTAGRAM_ACCESS_TOKEN) {
    return {
      items: [],
      error: null,
      stub: true,
      message: 'Instagram Graph API requires a Meta app with approved permissions and a business/creator account.',
    };
  }
  // Future: Graph API hashtag search
  return { items: [], error: null, stub: true, message: 'Instagram search not yet implemented.' };
}
