# Changelog — May 10–11, 2026

## New Features

### Owner Twin Video (HeyGen Talking Photo)
The "Animate Owner Twin" button now generates a real video using the owner's uploaded portrait photo (Francoise's face), not just a generic avatar. HeyGen's Talking Photo API animates the face to match the spoken script.

**Fix history:**
- Initial attempt: multipart form upload with `file` field name → HeyGen rejected with `40001`
- Switched field name to `talking_photo` → still rejected (multipart format issue)
- Switched to temp file + ReadStream → still rejected
- **Fixed:** Send image as raw binary (`Content-Type: image/jpeg`) instead of multipart — HeyGen accepted it and returned `talking_photo_id`
- Image is resized to max 1024px wide before upload (original 5712px photo was too large)
- Falls back to HeyGen Avatar (real video, generic face) if talking photo upload fails

### Instagram Posting Pipeline (`pipeline/4_instagram.js`)
Full Meta Graph API v19.0 integration for posting to Instagram:
- Reels (video): 3-step flow (create container → poll until FINISHED → publish)
- Static image posts
- Fetches permalink after publish

**UI:** "📤 Post to Instagram" button on each generated content card opens a modal with:
- AI-generated caption via Claude Haiku (`POST /api/output/:id/caption`)
- Editable textarea before posting
- Posts in background; card updates to "✓ On Instagram" with permalink when done

Requires `INSTAGRAM_ACCOUNT_ID` + `INSTAGRAM_ACCESS_TOKEN` env vars on Railway.

### Script Persistence
The owner twin welcome script now persists across page reloads:
- Saved to server config (`/api/config` → `ownerScript` field in `config.json` on the Railway volume)
- Also backed up to `localStorage` in the browser
- Restored automatically on page load — no need to re-write the script every session

### Delete Jobs
Each output card now has a red **✕ Delete** button that removes the job metadata and associated media files from the Railway volume immediately.

Backend: `DELETE /api/output/:jobId`

### HeyGen API Timeouts
All HeyGen API calls now have explicit timeouts to prevent infinite hangs:
- 30s on the talking photo upload (axios)
- 20s on all GET/POST calls (AbortSignal)

## Bug Fixes

- **Owner twin falling back to mock** — HeyGen Avatar (real video) is now used as fallback instead of a static placeholder image when talking photo upload fails
- **Photo uploads not persisting** — confirmed `DATA_DIR=/data` and `RAILWAY_VOLUME_MOUNT_PATH=/data` are set; uploads now go to the persistent Railway volume. Photos uploaded during a redeploy cycle may be lost — re-upload after the deploy settles
- **Script lost on reload** — fixed by saving to server config + localStorage

## Environment Variables Added

| Variable | Value | Purpose |
|----------|-------|---------|
| `APP_URL` | `https://socialai-production-4507.up.railway.app` | Used to build public URLs for Instagram media upload |
| `INSTAGRAM_ACCOUNT_ID` | *(pending)* | Meta Business Instagram account ID |
| `INSTAGRAM_ACCESS_TOKEN` | *(pending)* | Long-lived Meta Graph API token |
