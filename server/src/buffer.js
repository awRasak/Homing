const BUFFER_API = 'https://api.buffer.com';
const token = () => process.env.BUFFER_API_KEY || '';

export function isBufferAvailable() {
  return !!token();
}

export async function bufferQuery(query, variables = {}) {
  if (!isBufferAvailable()) throw new Error('BUFFER_API_KEY not configured');
  const res = await fetch(BUFFER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    throw new Error(msg);
  }
  return json.data;
}

// ── Organizations & channels ──

export async function getOrganizations() {
  const data = await bufferQuery(`{
    account {
      organizations { id name }
    }
  }`);
  return data?.account?.organizations || [];
}

export async function getChannels(organizationId) {
  const data = await bufferQuery(`query($oid: OrganizationId!) {
    channels(input: { organizationId: $oid }) {
      id service displayName name avatar type
      isDisconnected isLocked isQueuePaused
    }
  }`, { oid: organizationId });
  return data?.channels || [];
}

// ── Posts ──

export async function getPosts(organizationId, { status, channelIds, limit = 50 } = {}) {
  const filter = {};
  if (status?.length) filter.status = status;
  if (channelIds?.length) filter.channelIds = channelIds;

  const data = await bufferQuery(`query($oid: OrganizationId!, $filter: PostsFiltersInput) {
    posts(input: {
      organizationId: $oid,
      sort: [{ field: dueAt, direction: asc }, { field: createdAt, direction: desc }],
      filter: $filter
    }) {
      edges {
        node {
          id text status dueAt sentAt createdAt channelService
          channel { id service displayName name avatar }
          metrics { type value }
        }
      }
    }
  }`, { oid: organizationId, filter: Object.keys(filter).length ? filter : undefined });
  return (data?.posts?.edges || []).map((e) => e.node);
}

// ── Create post ──

export async function createPost({ channelId, text, mode = 'addToQueue', dueAt, schedulingType = 'automatic', imageUrl }) {
  const input = { channelId, text, schedulingType, mode };
  if (dueAt && mode === 'customScheduled') input.dueAt = dueAt;
  // Buffer's CreatePostInput takes an ordered `assets` list; exactly one
  // variant (image/video/link/document) must be set per asset.
  if (imageUrl) input.assets = [{ image: { url: imageUrl } }];

  const data = await bufferQuery(`mutation($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post { id text status dueAt channelService channel { id service displayName name avatar } }
      }
      ... on MutationError {
        message
      }
    }
  }`, { input });

  const result = data?.createPost;
  if (result?.message) throw new Error(result.message);
  return result?.post || null;
}

// ── Delete post ──

export async function deletePost(postId) {
  const data = await bufferQuery(`mutation($id: PostId!) {
    deletePost(input: { id: $id }) {
      ... on DeletePostSuccess { id }
      ... on MutationError { message }
    }
  }`, { id: postId });

  const result = data?.deletePost;
  if (result?.message) throw new Error(result.message);
  return !!result?.id;
}
