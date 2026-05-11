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

function igId()    { return process.env.INSTAGRAM_ACCOUNT_ID || ''; }
function igToken() { return process.env.INSTAGRAM_ACCESS_TOKEN || ''; }

function checkCreds() {
  if (!igId() || !igToken())
    throw new Error('INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN must be set');
}

async function pollContainer(creationId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const res  = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${igToken()}`);
    const data = await res.json();
    console.log(`[instagram] container ${creationId} → ${data.status_code}`);
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Container errored: ${JSON.stringify(data)}`);
  }
  throw new Error('Instagram container did not finish within 2 minutes');
}

async function getPermalink(mediaId) {
  const res  = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${igToken()}`);
  const data = await res.json();
  return data.permalink || '';
}

/** Post a Reel. videoUrl must be a publicly accessible URL. */
async function postReel(videoUrl, caption) {
  checkCreds();
  console.log('[instagram] Creating Reel container...');
  const createRes = await fetch(`${GRAPH}/${igId()}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption, access_token: igToken() }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id)
    throw new Error(`Create container failed: ${JSON.stringify(createData)}`);

  await pollContainer(createData.id);

  console.log('[instagram] Publishing Reel...');
  const publishRes = await fetch(`${GRAPH}/${igId()}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: igToken() }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id)
    throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);

  const permalink = await getPermalink(publishData.id);
  console.log('[instagram] Posted! Media ID:', publishData.id, 'URL:', permalink);
  return { mediaId: publishData.id, permalink };
}

/** Post a static image. imageUrl must be publicly accessible. */
async function postImage(imageUrl, caption) {
  checkCreds();
  console.log('[instagram] Creating image container...');
  const createRes = await fetch(`${GRAPH}/${igId()}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken() }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id)
    throw new Error(`Create image container failed: ${JSON.stringify(createData)}`);

  console.log('[instagram] Publishing image...');
  const publishRes = await fetch(`${GRAPH}/${igId()}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: createData.id, access_token: igToken() }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id)
    throw new Error(`Image publish failed: ${JSON.stringify(publishData)}`);

  const permalink = await getPermalink(publishData.id);
  return { mediaId: publishData.id, permalink };
}

module.exports = { postReel, postImage };
