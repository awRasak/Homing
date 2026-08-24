/**
 * Snapchat — stub. No public content search API exists.
 * Spotlight content is not accessible via API.
 */
export async function searchSnapchat(query, { maxResults = 10 } = {}) {
  return {
    items: [],
    error: null,
    stub: true,
    message: 'Snapchat has no public content search API.',
  };
}
