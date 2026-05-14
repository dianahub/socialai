# Restaurant Social AI — User Manual

**Production URL:** https://socialai-production-4507.up.railway.app

**Login:** https://socialai-production-4507.up.railway.app/login.html
- Email: `owner@osteria.com`
- Password: `pasta1234`

---

## What this app does

Automates social media content for fine dining restaurants. You upload your restaurant's assets (logo, food photos, owner portrait), and the app generates:

- **Owner twin videos** — a short talking-head video of the owner (via HeyGen) delivering a script
- **Cinematic videos** — a branded video showcasing the restaurant
- **Branded image posts** — food photos with your logo, colors, and caption overlaid
- **Scheduled calendar** — a week-by-week posting schedule for Instagram

---

## First-time setup (new restaurant)

### Step 1 — Create a login

There is no public sign-up page. To create credentials for a restaurant, run this API call once (you'll need the `ADMIN_SECRET` from Railway):

```bash
curl -X POST https://socialai-production-4507.up.railway.app/api/auth/set-credentials \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -d '{"restaurantId": 1, "email": "owner@yourrestaurant.com", "password": "yourpassword"}'
```

After that, the restaurant owner can log in at the **Sign In** page using that email and password.

### Step 2 — Sign in

Go to the production URL. If credentials are set, you'll land on the **Sign In** page. Enter your email and password. You stay logged in for 30 days.

---

## The five pages

### 1. Assets (`/index.html`)

This is where you set up the restaurant profile and upload all media.

**Restaurant info (left panel):**
- Name, cuisine type, location
- Brand primary color (used for caption bars)
- Brand accent color (used for restaurant name text)

**Logo** — Upload your restaurant logo (PNG with transparency works best). Appears in the bottom-right corner of all image posts.

**Owner Portrait** — Upload a clear photo of the owner facing camera. This is used by HeyGen to generate the talking-head owner twin video.

**Food Photos** — Upload multiple food/atmosphere photos. These are used as the base for branded image posts. Add a caption describing each dish — Claude uses these descriptions when generating captions.

> All uploads are stored in Cloudinary and persist across server restarts.

---

### 2. Generate (`/generate.html`)

This is where you kick off content creation.

**How it works:**
1. Choose what to generate using the checkboxes:
   - **Owner Twin Video** — HeyGen renders the owner portrait speaking a script (~5–8 min)
   - **Cinematic Video** — HeyGen renders a branded presenter video (~5–8 min)
   - **Feed Image** — Branded 1080×1080 image (fast, ~30 sec)
   - **Story Image** — Branded 1080×1920 image (fast, ~30 sec)
2. Click **Generate**
3. The page polls for progress — videos take the longest (HeyGen queues them)
4. When complete, output appears below with a preview

**Scripts for videos:**
- The owner twin video uses your active **Script Templates** (see Scripts page)
- If no templates are active, it falls back to a generic welcome script

**AI captions:**
- Claude automatically writes a caption for each generated piece
- You can edit the caption before approving

---

### 3. Approve (`/approve.html`)

Review everything before it goes on the schedule.

**Filter tabs:** Pending / Approved / All

**Each card shows:**
- Thumbnail or video preview
- Content type badge (Feed, Story, Owner Video, Cinematic)
- The AI-generated script (for videos)
- An editable caption field
- ✓ Approve / ✗ Reject buttons

**Approve** — moves the post to `approved` status; it's now eligible to be scheduled.

**Reject** — removes it from the queue.

> Edit the caption directly in the text field before approving — whatever is in the box when you click Approve is what gets saved.

---

### 4. Schedule (`/schedule.html`)

A weekly calendar view of all posts.

**Status colors:**
- **Gold** — scheduled (set for a future time, will auto-post if enabled)
- **Green** — published (already posted)
- **Amber** — draft (not yet scheduled)
- **Red** — failed

**Clicking a post** opens a modal where you can:
- Edit the caption
- Change the scheduled time
- Change the platform (Instagram, Facebook, TikTok)
- Toggle auto-publish on/off for that post
- Delete the post

**Generate Week button** — bulk-creates a week's worth of scheduled slots using a preset pattern (e.g. 3× per week at optimal times). Choose a preset and frequency, then confirm.

**Auto-publish toggle** — when enabled (per post), the system checks every 5 minutes and posts to Instagram automatically when the scheduled time arrives.

---

### 5. Scripts (`/scripts.html`)

Manage the script templates used for owner twin videos.

**Each template has:**
- A name (e.g. "Weekend Welcome")
- A topic/occasion (welcome, weekend promo, seasonal menu, etc.)
- The script text (aim for 40–55 words = ~15–20 seconds of speech)
- Active/Inactive toggle — only active templates are used during generation

**AI script writing:**
- Click **✦ Write with AI** on any template
- Describe what you want to say (optional details like pricing, dates, specials)
- Claude writes a 15–20 second script in the restaurant's voice

**Rotation:** When generating videos, the system picks an active template (rotating by least-recently-used). You can have multiple active templates so content varies.

---

### 6. Settings (`/settings.html`)

Four tabs:

**Captions tab:**
- Voice tone — Elegant / Friendly / Bold / Playful
- Include location — whether to mention the city in captions
- Default hashtags — chips you manage; added to every AI-generated caption
- Click **Save Caption Settings** to apply

**Scheduling tab:**
- Default preset — the posting pattern used when generating a week
- Default frequency — Daily / 3× Week / Every Other Day / etc.

**Instagram tab:**
- Connect Instagram via OAuth (walks through Facebook login → grants Instagram access)
- Shows token status and expiry
- Manual token entry if you already have a token
- **Auto-publish toggle** — master switch; enables the 5-minute cron that posts scheduled content

**Account tab:**
- Change your login email and password

---

## Typical workflow

```
1. Assets      → upload logo, owner photo, food photos
2. Scripts     → write 2–3 active script templates
3. Settings    → set voice tone, hashtags, connect Instagram
4. Generate    → kick off a generation run (all 4 types)
5. Approve     → review, edit captions, approve what looks good
6. Schedule    → assign approved posts to time slots
7. Settings    → enable auto-publish
```

From that point on, the app posts automatically on schedule.

---

## Instagram connection

1. Go to **Settings → Instagram tab**
2. Click **Connect Instagram** — you'll be redirected to Facebook login
3. Grant the requested permissions (Instagram publish, pages)
4. The app stores your Instagram Account ID and access token automatically
5. Tokens last ~60 days — the app attempts a daily refresh automatically

> Your Instagram account must be a **Professional account** (Business or Creator) linked to a Facebook Page for the API to work.

---

## Tips

- **Videos take 5–8 minutes** — HeyGen queues them server-side; leave the Generate page open or check back
- **Generate one of each type first** to make sure everything looks right before generating a full week
- **Captions are editable** at every stage — on the Approve page, in the Schedule modal, and before posting
- **Script length matters** — keep scripts under 60 words; HeyGen clips that run too long can sound rushed
- **Owner portrait quality** — a well-lit, forward-facing photo gives HeyGen the best result for the twin video
