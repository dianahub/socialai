/**
 * Instagram OAuth flow + token management.
 *
 * Required env vars (only needed for OAuth — manual token entry still works without):
 *   FB_APP_ID      — Facebook App ID
 *   FB_APP_SECRET  — Facebook App Secret
 *   APP_URL        — Public base URL (e.g. https://socialai-production-4507.up.railway.app)
 *
 * Scopes requested:
 *   instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement
 */

const { Router } = require('express');
const db = require('../lib/db');

const router = Router();
const GRAPH  = 'https://graph.facebook.com/v19.0';

function oauthEnabled() {
  return !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET && process.env.APP_URL);
}

// GET /auth/instagram?restaurantId=X — redirect to Facebook OAuth
router.get('/', (req, res) => {
  if (!oauthEnabled()) {
    return res.status(400).send('Facebook OAuth not configured (FB_APP_ID / FB_APP_SECRET missing).');
  }
  const restaurantId = req.query.restaurantId || 1;
  const redirectUri  = `${process.env.APP_URL}/auth/instagram/callback`;
  const scopes       = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';
  const url = `https://www.facebook.com/v19.0/dialog/oauth?` +
    `client_id=${process.env.FB_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${encodeURIComponent(restaurantId)}`;
  res.redirect(url);
});

// GET /auth/instagram/callback — exchange code for long-lived token, save to DB
router.get('/callback', async (req, res) => {
  const { code, state: restaurantId, error } = req.query;

  if (error) {
    console.error('[ig-oauth] denied:', error);
    return res.redirect('/index.html?ig_error=' + encodeURIComponent(error));
  }
  if (!code) return res.redirect('/index.html?ig_error=no_code');

  try {
    const redirectUri = `${process.env.APP_URL}/auth/instagram/callback`;

    // 1. Exchange code for short-lived token
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
      `client_id=${process.env.FB_APP_ID}` +
      `&client_secret=${process.env.FB_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(tokenData));

    // 2. Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${process.env.FB_APP_ID}` +
      `&client_secret=${process.env.FB_APP_SECRET}` +
      `&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    if (!longData.access_token) throw new Error('Long-lived exchange failed: ' + JSON.stringify(longData));

    const longToken    = longData.access_token;
    const expiresInSec = longData.expires_in || 5184000; // default 60 days
    const expiresAt    = new Date(Date.now() + expiresInSec * 1000);

    // 3. Get the Instagram Business Account ID via the user's FB pages
    const pagesRes  = await fetch(`${GRAPH}/me/accounts?access_token=${longToken}`);
    const pagesData = await pagesRes.json();

    let igUserId = null;
    if (pagesData.data?.length) {
      // Find the page linked to an IG business account
      for (const page of pagesData.data) {
        const igRes  = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token || longToken}`);
        const igData = await igRes.json();
        if (igData.instagram_business_account?.id) {
          igUserId = igData.instagram_business_account.id;
          break;
        }
      }
    }

    // 4. Save to DB
    await db.restaurant.update({
      where: { id: Number(restaurantId) },
      data: {
        instagramAccessToken: longToken,
        instagramUserId:      igUserId || undefined,
        tokenExpiresAt:       expiresAt,
      },
    });

    console.log(`[ig-oauth] Restaurant ${restaurantId} connected. IG user: ${igUserId}, expires: ${expiresAt.toISOString()}`);
    res.redirect('/index.html?ig_connected=true');
  } catch (err) {
    console.error('[ig-oauth] callback error:', err.message);
    res.redirect('/index.html?ig_error=' + encodeURIComponent(err.message));
  }
});

// POST /api/instagram/refresh — manually refresh a restaurant's long-lived token
router.post('/refresh', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;
  try {
    const r = await db.restaurant.findUnique({ where: { id: restaurantId } });
    if (!r?.instagramAccessToken) return res.status(400).json({ error: 'No Instagram token to refresh' });

    const refreshRes  = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${r.instagramAccessToken}`);
    const refreshData = await refreshRes.json();

    if (!refreshData.access_token) throw new Error(refreshData.error?.message || 'Refresh failed');

    const expiresInSec = refreshData.expires_in || 5184000;
    const expiresAt    = new Date(Date.now() + expiresInSec * 1000);

    await db.restaurant.update({
      where: { id: restaurantId },
      data:  { instagramAccessToken: refreshData.access_token, tokenExpiresAt: expiresAt },
    });

    res.json({ success: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/instagram/status — token status for the current restaurant
router.get('/status', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.query.restaurantId) || 1;
  try {
    const r = await db.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { instagramUserId: true, instagramAccessToken: true, tokenExpiresAt: true },
    });
    if (!r) return res.status(404).json({ error: 'Not found' });

    const connected  = !!(r.instagramAccessToken);
    const expiresAt  = r.tokenExpiresAt;
    const daysLeft   = expiresAt ? Math.floor((new Date(expiresAt) - Date.now()) / 86400000) : null;
    const expireSoon = daysLeft !== null && daysLeft <= 7;
    const expired    = daysLeft !== null && daysLeft < 0;

    res.json({
      connected,
      oauthEnabled: oauthEnabled(),
      instagramUserId: r.instagramUserId,
      tokenExpiresAt:  expiresAt,
      daysLeft,
      expireSoon,
      expired,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/instagram/lookup-id — resolve IG username → business account ID
// Strategy 1: walk the restaurant's own saved token through their FB pages.
// Strategy 2: use the system INSTAGRAM_ACCESS_TOKEN + Business Discovery API.
router.post('/lookup-id', async (req, res) => {
  const { instagramUrl, restaurantId } = req.body;
  const rid = restaurantId || req.restaurantId;

  let username = (instagramUrl || '').trim();
  const match = username.match(/instagram\.com\/([^/?#]+)/);
  if (match) username = match[1].replace(/\/$/, '');
  if (!username) return res.status(400).json({ error: 'No Instagram username found in URL' });

  try {
    // Strategy 1: restaurant's own saved token → walk their FB pages
    const r = await db.restaurant.findUnique({
      where:  { id: Number(rid) },
      select: { instagramAccessToken: true },
    });
    if (r?.instagramAccessToken) {
      const token     = r.instagramAccessToken;
      const pagesRes  = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(token)}`);
      const pagesData = await pagesRes.json();
      if (!pagesData.error) {
        for (const page of (pagesData.data || [])) {
          const igRes  = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`);
          const igData = await igRes.json();
          const ig     = igData.instagram_business_account;
          if (ig?.username?.toLowerCase() === username.toLowerCase()) {
            return res.json({ accountId: ig.id, username: ig.username });
          }
        }
      }
    }

    // Strategy 2: system token + Business Discovery API (looks up any public IG business account)
    const sysToken     = process.env.INSTAGRAM_ACCESS_TOKEN;
    const sysAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    if (sysToken && sysAccountId) {
      const bdRes  = await fetch(`${GRAPH}/${sysAccountId}?fields=business_discovery.fields(id,username)&username=${encodeURIComponent(username)}&access_token=${encodeURIComponent(sysToken)}`);
      const bdData = await bdRes.json();
      if (bdData.business_discovery?.id) {
        return res.json({ accountId: bdData.business_discovery.id, username: bdData.business_discovery.username });
      }
      if (bdData.error) return res.status(400).json({ error: bdData.error.message });
    }

    res.status(404).json({ error: `Could not find Instagram business account for @${username}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily token refresh for restaurants whose tokens expire within 7 days
async function refreshExpiringTokens() {
  if (!oauthEnabled()) return;
  const soon = new Date(Date.now() + 7 * 86400000);
  try {
    const restaurants = await db.restaurant.findMany({
      where: {
        instagramAccessToken: { not: null },
        tokenExpiresAt:       { lte: soon },
      },
    });
    for (const r of restaurants) {
      try {
        const refreshRes  = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${r.instagramAccessToken}`);
        const refreshData = await refreshRes.json();
        if (!refreshData.access_token) throw new Error(refreshData.error?.message || 'Refresh failed');
        const expiresAt = new Date(Date.now() + (refreshData.expires_in || 5184000) * 1000);
        await db.restaurant.update({
          where: { id: r.id },
          data:  { instagramAccessToken: refreshData.access_token, tokenExpiresAt: expiresAt },
        });
        console.log(`[ig-token] Refreshed token for restaurant ${r.id}, new expiry: ${expiresAt.toISOString()}`);
      } catch (err) {
        console.error(`[ig-token] Failed to refresh token for restaurant ${r.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[ig-token] refresh cron error:', err.message);
  }
}

module.exports = { router, refreshExpiringTokens };
