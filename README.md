# Restaurant Social AI

Automated social media content generation for fine dining restaurants. Upload your restaurant's assets, generate AI-powered videos and images, write captions, and post directly to Instagram — all from one dashboard.

**Live URL:** https://socialai-production-4507.up.railway.app

---

## How to Use

### Step 1 — Asset Manager (Home Page)

Fill in your restaurant details and upload your media assets before generating any content.

**Restaurant Info**
- Restaurant name, cuisine type, location
- Primary color and accent color (used in branded image overlays)
- Target platforms (Instagram, Facebook, TikTok)
- Owner name and a short tagline

**Upload your assets:**
- **Logo** — used as a watermark on all image posts (bottom-right corner)
- **Food photos** — up to 6 photos used for branded image posts
- **Owner portrait** — used to animate the owner twin video (Francoise's face)

> **Important:** Assets are saved to a persistent volume on Railway. If you upload during a server restart/redeploy, re-upload after the deploy settles.

---

### Step 2 — Generate Content (`/generate.html`)

There are three types of content you can generate:

#### 🎬 Cinematic Video
An AI-generated talking-head video using a HeyGen avatar. Best for broad brand awareness posts.

#### 👤 Animate Owner Twin
An animated video using the **owner's actual face** (from the uploaded portrait) speaking a welcome message directly to camera. This is the most personal and high-performing content type.

**How to use the Owner Twin:**
1. Write a welcome script — click **✦ Write Script**, choose a topic and any details, and let Claude draft it. Or type your own directly in the text box.
2. The script is saved automatically — it will be there the next time you reload the page.
3. Click **Animate Owner Twin** — HeyGen processes the video (takes 2–5 minutes).
4. The video appears in the gallery below when ready.

#### 🖼 Image Posts
Branded static images at feed (1080×1080) and story (1080×1920) sizes with your logo and brand colors overlaid. Good for daily posting between videos.

---

### Step 3 — Post to Instagram

Once a video or image is generated and appears in the gallery:

1. Click **📤 Post to Instagram** on the card.
2. A modal opens with an AI-generated caption (editable).
3. Click **✦ Generate caption with AI** to get a new Claude-written caption, or type your own.
4. Click **Post to Instagram** — the video is submitted to Meta in the background.
5. After ~1–2 minutes the button changes to **✓ On Instagram** with a link to the post.

> **Requires:** `INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_ACCESS_TOKEN` set on Railway (see Setup below).

---

### Step 4 — Content Calendar (`/schedule.html`)

A mock 7-day posting schedule showing recommended content types per platform per day. Used for planning — not connected to Instagram scheduling yet.

---

## Setup (Railway Environment Variables)

| Variable | Required | Description |
|----------|----------|-------------|
| `HEYGEN_API_KEY` | Yes | HeyGen API key for video generation |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for scripts and captions |
| `INSTAGRAM_ACCOUNT_ID` | For posting | Numeric Instagram Business account ID |
| `INSTAGRAM_ACCESS_TOKEN` | For posting | Long-lived Meta Graph API token |
| `APP_URL` | Yes | Public URL of this app (e.g. `https://socialai-production-4507.up.railway.app`) |
| `DATA_DIR` | Yes | Path to persistent volume (set to `/data` on Railway) |
| `PORT` | No | Server port (Railway sets this automatically) |

To set a variable via Railway CLI:
```bash
railway variables set INSTAGRAM_ACCOUNT_ID=your_id_here
railway variables set INSTAGRAM_ACCESS_TOKEN=your_token_here
```

---

## Getting Your Instagram Credentials

1. Go to [Meta for Developers](https://developers.facebook.com) and create an app (Business type).
2. Add the **Instagram Graph API** product.
3. Connect your Instagram Business account to a Facebook Page.
4. Generate a long-lived access token (valid 60 days — you'll need to refresh it).
5. Find your `INSTAGRAM_ACCOUNT_ID`: call `GET /me?fields=id&access_token=YOUR_TOKEN` — the `id` field is your account ID.

---

## File Structure

```
restaurant-social-ai/
├── server.js                  # Express app + all API routes
├── pipeline/
│   ├── 1_generate_content.js  # HeyGen video + Sharp image generation
│   ├── 2_brand_overlay.js     # Logo + caption composite via Sharp
│   ├── 3_mock_scheduler.js    # 7-day schedule builder
│   └── 4_instagram.js         # Meta Graph API posting (Reels + images)
├── public/
│   ├── index.html             # Asset Manager (Step 1)
│   ├── generate.html          # Content Generator + gallery (Step 2–3)
│   └── schedule.html          # Content Calendar (Step 4)
├── assets/                    # Uploaded files (on Railway volume at /data/assets)
│   ├── logo/
│   ├── photos/
│   └── owner/
└── output/                    # Generated content + job metadata (on Railway volume)
```

---

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/upload/logo` | Upload restaurant logo |
| `POST` | `/api/upload/photos` | Upload up to 6 food photos |
| `POST` | `/api/upload/owner` | Upload owner portrait |
| `GET` | `/api/assets` | List all uploaded assets |
| `DELETE` | `/api/assets/:type/:filename` | Remove an asset |
| `POST` | `/api/config` | Save restaurant config |
| `GET` | `/api/config` | Load restaurant config |
| `POST` | `/api/generate/script` | AI-generate an owner twin script |
| `POST` | `/api/generate` | Start a generation job (`{ type: "video" \| "twin" \| "image" }`) |
| `GET` | `/api/output` | List all output jobs with metadata |
| `DELETE` | `/api/output/:jobId` | Delete a job and its media files |
| `POST` | `/api/output/:jobId/caption` | AI-generate an Instagram caption for a job |
| `POST` | `/api/output/:jobId/post-instagram` | Post the job to Instagram |
| `GET` | `/api/schedule` | Get 7-day mock posting schedule |
