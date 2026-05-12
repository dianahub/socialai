/**
 * Instagram posting via Meta Graph API v19.0.
 * Supports Reels (video) and single image posts.
 *
 * Flow for Reels:
 *   1. POST /{ig_user_id}/media  (media_type=REELS, video_url=...) → creation_id
 *   2. Poll /{creation_id}?fields=status_code until FINISHED
 *   3. POST /{ig_user_id}/media_publish → media_id
 *
 * Requires env vars:
 *   INSTAGRAM_ACCOUNT_ID   — numeric IG Business account ID
 *   INSTAGRAM_ACCESS_TOKEN — long-lived Meta Graph API token
 *   APP_URL                — public base URL (used to build absolute media URLs)
 */

const GRAPH = 'https://graph.facebook.com/v19.0';

// creds = { accountId, accessToken } — falls back to env vars if not provided
function resolveCreds(creds = {}) {
  return {
    id:    creds.accountId    || process.env.INSTAGRAM_ACCOUNT_ID  || '',
    token: creds.accessToken  || process.env.INSTAGRAM_ACCESS_TOKEN || '',
  };
}

function checkCreds(creds) {
  if (!creds.id || !creds.token)
    throw new Error('Instagram Account ID and Access Token must be set (per-restaurant or via env vars)');
}

async function pollContainer(creationId, token, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const res  = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${token}`);
    const data = await res.json();
    console.log(`[instagram] container ${creationId} → ${data.status_code}`);
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Container errored: ${JSON.stringify(data)}`);
  }
  throw new Error('Instagram container did not finish within 2 minutes');
}

async function getPermalink(mediaId, token) {
  const res  = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${token}`);
  const data = await res.json();
  return data.permalink || '';
}

/** Post a Reel. videoUrl must be a publicly accessible URL. */
async function postReel(videoUrl, caption, creds = {}) {
  const c = resolveCreds(creds);
  checkCreds(c);
  console.log('[instagram] Creating Reel container...');
  const createRes = await fetch(`${GRAPH}/${c.id}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption, access_token: c.token }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id)
    throw new Error(`Create container failed: ${JSON.stringify(createData)}`);

  await pollContainer(createData.id, c.token);

  console.log('[instagram] Publishing Reel...');
  const publishRes = await fetch(`${GRAPH}/${c.id}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: c.token }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id)
    throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);

  const permalink = await getPermalink(publishData.id, c.token);
  console.log('[instagram] Posted! Media ID:', publishData.id, 'URL:', permalink);
  return { mediaId: publishData.id, permalink };
}

/** Post a static image. imageUrl must be publicly accessible. */
async function postImage(imageUrl, caption, creds = {}) {
  const c = resolveCreds(creds);
  checkCreds(c);
  console.log('[instagram] Creating image container...');
  const createRes = await fetch(`${GRAPH}/${c.id}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: c.token }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id)
    throw new Error(`Create image container failed: ${JSON.stringify(createData)}`);

  console.log('[instagram] Publishing image...');
  const publishRes = await fetch(`${GRAPH}/${c.id}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: c.token }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id)
    throw new Error(`Image publish failed: ${JSON.stringify(publishData)}`);

  const permalink = await getPermalink(publishData.id, c.token);
  return { mediaId: publishData.id, permalink };
}

module.exports = { postReel, postImage };
