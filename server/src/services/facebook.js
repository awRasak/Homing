/**
 * Facebook — stub. Meta Graph API requires app review.
 * Page search is limited. Group search is not available.
 */
export async function searchFacebook(query, { maxResults = 10, accessToken } = {}) {
  if (!accessToken && !process.env.FACEBOOK_ACCESS_TOKEN) {
    return {
      items: [],
      error: null,
      stub: true,
      message: 'Facebook Graph API requires a Meta app with approved permissions.',
    };
  }
  return { items: [], error: null, stub: true, message: 'Facebook search not yet implemented.' };
}
