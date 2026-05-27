const db = require('./db');
const { postReel, postImage } = require('../pipeline/4_instagram');

const VIDEO_TYPES = new Set(['owner_twin_video', 'cinematic_video']);

// Publish a single scheduled post to Instagram with up to 3 attempts (exponential backoff).
async function publishPost(postId) {
  const post = await db.scheduledPost.findUnique({
    where:   { id: postId },
    include: { business: true },
  });
  if (!post)           throw new Error('Post not found');
  if (!post.contentUrl) throw new Error('No content URL on this post');

  const r = post.business;
  const creds = {
    accountId:   r.instagramUserId     || '',
    accessToken: r.instagramAccessToken || '',
  };

  const isVideo = VIDEO_TYPES.has(post.postType);
  const caption = post.caption || '';

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = isVideo
        ? await postReel(post.contentUrl, caption, creds)
        : await postImage(post.contentUrl, caption, creds);

      await db.scheduledPost.update({
        where: { id: postId },
        data: {
          status:          'published',
          instagramPostId: result.mediaId,
          publishedAt:     new Date(),
          publishAttempts: { increment: attempt },
          lastError:       null,
        },
      });
      console.log(`[autopublish] Post ${postId} published: ${result.permalink}`);
      return result;
    } catch (err) {
      lastErr = err;
      console.error(`[autopublish] Post ${postId} attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  await db.scheduledPost.update({
    where: { id: postId },
    data: {
      status:          'failed',
      publishAttempts: { increment: 3 },
      lastError:       lastErr.message,
    },
  });
  throw lastErr;
}

// Called by cron every 5 minutes — publishes all due posts for businesses with auto-publish on.
async function runAutoPublish() {
  try {
    const enabledBusinesses = await db.business.findMany({
      where:  { autoPublishEnabled: true },
      select: { id: true },
    });
    if (!enabledBusinesses.length) return;

    const enabledIds = enabledBusinesses.map(r => r.id);
    const now        = new Date();
    const posts      = await db.scheduledPost.findMany({
      where: {
        status:        'scheduled',
        scheduledTime: { lte: now },
        contentUrl:    { not: null },
        businessId:    { in: enabledIds },
      },
      include: { business: true },
    });

    if (!posts.length) return;
    console.log(`[autopublish] ${posts.length} post(s) due for publishing`);

    for (const post of posts) {
      await publishPost(post.id).catch(err =>
        console.error(`[autopublish] Post ${post.id} permanently failed: ${err.message}`)
      );
    }
  } catch (err) {
    console.error('[autopublish] cron error:', err.message);
  }
}

module.exports = { publishPost, runAutoPublish };
