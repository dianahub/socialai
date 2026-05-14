# Restaurant Social AI

Automated social media content generation for fine dining restaurants. Upload your brand assets, generate AI-powered videos and images, write captions with Claude, and publish directly to Instagram — all from one dashboard supporting multiple restaurants with per-owner authentication.

**Live URL:** https://socialai-production-4507.up.railway.app

---

## Pages

| URL | Purpose |
|-----|---------|
| `/index.html` | Asset Manager — restaurant profile, asset uploads, Instagram credentials, login setup |
| `/generate.html` | Content Generator — videos and branded images, manual generation |
| `/schedule.html` | Content Calendar — 7-day grid, scheduling, auto-publish, Instagram posting |
| `/scripts.html` | Script Template Manager — reusable AI voiceover scripts |
| `/approve.html` | Approval queue |
| `/settings.html` | Settings — captions, scheduling preset, Instagram OAuth, account |
| `/login.html` | Restaurant owner login (shown when `JWT_SECRET` is set) |

---

## How to Use

### Step 1 — Asset Manager (`/index.html`)

Fill in restaurant details and upload media assets before generating content.

**Restaurant Info:** name, cuisine type, location, owner name, tagline, brand colors (primary, accent, background), target platforms, twin style/usecase, owner script.

**Assets to upload:**
- **Logo** — watermarked bottom-right on all image posts
- **Food photos** — up to 6 photos used for branded image posts
- **Owner portrait** — used to animate the owner twin video

**Instagram Credentials:** Enter your Account ID and Access Token, or click **Connect with Instagram** (requires `FB_APP_ID` / `FB_APP_SECRET` env vars) to go through Facebook OAuth. The token expiry date is tracked and you'll see a warning banner when it's within 7 days.

**Login Credentials:** Set the email + password restaurant owners use to log in. Only visible/needed when auth is enabled.

---

### Step 2 — Generate Content (`/generate.html`)

Three content types:

#### 🎬 Cinematic Video
AI-generated talking-head video using a HeyGen avatar. Best for broad brand awareness.

#### 👤 Animate Owner Twin
Animated video using the owner's actual uploaded portrait, speaking a welcome script. Most personal content type.

1. Write or AI-generate a script (Claude Haiku writes it; select a saved script template or compose custom)
2. Click **Animate Owner Twin** — HeyGen processes in 2–5 minutes
3. Video appears in gallery below when ready

#### 🖼 Image Posts
Branded static images at 1080×1080 (feed) and 1080×1920 (story) with logo watermark and brand colors.

---

### Step 3 — Content Calendar (`/schedule.html`)

**7-day grid** with posts color-coded by type and status. Navigate weeks with ← / Today / →.

**Generate This Week's Content:**
1. Click **⚡ Generate This Week**
2. Choose a **Posting Schedule Preset** (Smart day-aware, 3× Week Optimal, Daily Lunch, Evening Engagement, Mixed Schedule) — preview shows exact day/time
3. Set frequency (daily, 3×/week, etc.) and content mix sliders
4. Click **⚡ Start Generation** — creates draft posts and queues background generation jobs

**Auto-publish toggle** (top toolbar): when on, the server checks every 5 minutes for scheduled posts whose time has passed and posts them to Instagram automatically (3 retries with backoff).

**Manual posting:**
- Click a post card → **📤 Post to Instagram** → caption modal opens
  - Select voice tone (Elegant / Friendly / Professional / Playful / Casual)
  - Click **✦ Generate Caption** — Claude writes a 125–150 character caption
  - Click **✦ Suggest** for hashtag chips (removable; appended to caption on post)
  - Click **Post to Instagram**
- **Post Now** button — publishes immediately, bypassing the schedule
- Failed posts show the exact Instagram API error in red

---

### Step 4 — Script Templates (`/scripts.html`)

Create and manage reusable voiceover scripts:
- Name each template and tag it with an occasion (Welcome, Weekend Special, Happy Hour, New Menu Item, etc.)
- **Write with AI** — Claude Haiku generates a script from a topic + details; word counter + estimated speak time (target: 40–55 words / 16–22 sec)
- Active templates enter round-robin rotation when generating a batch week; last-used timestamp prevents the same script repeating

---

### Step 5 — Settings (`/settings.html`)

| Tab | Use it to… |
|-----|-----------|
| **Captions** | Set default voice tone and include-location preference; manage default hashtags that auto-fill on "Suggest" |
| **Scheduling** | Choose default posting preset; see 7-day time preview |
| **Instagram** | Check connection status, OAuth connect/reconnect, token expiry, auto-publish toggle, manual credentials |
| **Account** | Update restaurant name/cuisine/location/owner/tagline; change login email + password |

---

## Authentication

Auth is **opt-in** via the `JWT_SECRET` env var.

| Mode | Behavior |
|------|---------|
| `JWT_SECRET` not set | All routes open — admin/dev mode; restaurant switcher in nav |
| `JWT_SECRET` set | All pages redirect to `/login.html`; JWT in localStorage; each owner sees only their restaurant |

**Admin bypass:** Set `ADMIN_SECRET` env var; pass it as `X-Admin-Secret` header on any request to bypass JWT.

**Production setup flow:**
1. Deploy without `JWT_SECRET` — auth is off
2. Go to Asset Manager → Login Credentials → set email + password for each restaurant
3. Set `JWT_SECRET` in Railway → auth activates immediately on next request

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEYGEN_API_KEY` | Yes | HeyGen API key for video generation |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for scripts, captions, hashtags |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary API secret |
| `APP_URL` | Yes | Public base URL (e.g. `https://socialai-production-4507.up.railway.app`) |
| `DATABASE_URL` | Yes | SQLite path — set to `file:/data/restaurant.db` on Railway |
| `JWT_SECRET` | For auth | Any long random string — enables owner login |
| `ADMIN_SECRET` | Optional | Header value to bypass JWT (Diana's admin access) |
| `FB_APP_ID` | For OAuth | Facebook App ID — enables "Connect with Instagram" button |
| `FB_APP_SECRET` | For OAuth | Facebook App Secret |
| `PORT` | No | Railway sets automatically |

---

## Database Schema

SQLite via Prisma 7 + libsql. DB file: `/data/restaurant.db` on Railway persistent volume.

### Restaurant
Core record per restaurant. All other tables have a `restaurantId` FK.

| Field | Type | Notes |
|-------|------|-------|
| `name`, `cuisineType`, `location` | String | Basic identity |
| `ownerName`, `tagline` | String? | Display |
| `brandColorPrimary`, `brandColorAccent`, `brandColorBg` | String? | Hex colors |
| `platforms`, `twinStyle`, `twinUsecase`, `ownerScript` | String? | Content config |
| `logoUrl`, `ownerPortraitUrl` | String? | Cloudinary URLs |
| `instagramAccessToken`, `instagramUserId` | String? | IG credentials |
| `tokenExpiresAt` | DateTime? | IG token expiry |
| `autoPublishEnabled` | Boolean | Default false |
| `loginEmail`, `loginPasswordHash` | String? | Owner auth |
| `voiceTone` | String? | elegant/friendly/professional/playful/casual |
| `defaultHashtags` | String? | JSON array |
| `includeLocation` | Boolean | Default true |

### ScheduledPost
Calendar entries.

| Field | Type | Notes |
|-------|------|-------|
| `postType` | String | owner_twin_video / cinematic_video / branded_image_feed / branded_image_story |
| `status` | String | draft / scheduled / published / failed |
| `contentUrl` | String? | Cloudinary or server URL of media |
| `caption` | String? | |
| `scheduledTime` | DateTime | |
| `instagramPostId` | String? | Set after successful publish |
| `publishedAt` | DateTime? | |
| `publishAttempts` | Int | Incremented on each attempt |
| `lastError` | String? | Last Instagram API error message |

### GenerationJob
Tracks HeyGen / image generation jobs.

| Field | Type | Notes |
|-------|------|-------|
| `jobType` | String | Same types as postType |
| `status` | String | pending / processing / completed / failed |
| `externalJobId` | String? | HeyGen job ID |
| `resultUrl` | String? | Output URL when complete |
| `errorMessage` | String? | |
| `scheduledPostId` | Int? | Links job to its ScheduledPost |

### Migrations

| Migration | Contents |
|-----------|----------|
| `00000000000000_init` | Initial 5-table schema |
| `20260512000000` | Add `scheduledPostId`, `errorMessage` to GenerationJob |
| `20260512010000` | Add `topic`, `lastUsedAt` to ScriptTemplate |
| `20260512020000` | Add profile fields to Restaurant (ownerName, tagline, brandColorBg, platforms, twinStyle, twinUsecase, ownerScript) |
| `20260512030000` | Add `loginEmail`, `loginPasswordHash` to Restaurant |
| `20260512040000` | Add `publishAttempts`, `lastError` to ScheduledPost |
| `20260512050000` | Add `tokenExpiresAt` to Restaurant |
| `20260512060000` | Add `voiceTone`, `defaultHashtags`, `includeLocation` to Restaurant |

---

## API Reference

### Auth
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/auth/config` | Public | `{ authEnabled: bool }` |
| `POST` | `/api/auth/login` | Public | `{ email, password }` → `{ token, restaurantId, restaurantName }` |
| `POST` | `/api/auth/logout` | Public | Stateless |
| `GET` | `/api/auth/me` | JWT | `{ id, name, loginEmail }` |
| `POST` | `/api/auth/set-credentials` | Open/JWT/Admin | Set owner email + password |

### Assets & Config
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/upload/logo` | Upload logo (Cloudinary) |
| `POST` | `/api/upload/photos` | Upload food photos |
| `POST` | `/api/upload/owner` | Upload owner portrait |
| `GET` | `/api/assets` | List all assets for current restaurant |
| `DELETE` | `/api/assets/:type/:filename` | Remove an asset |
| `POST` | `/api/config` | Save restaurant config (writes to DB) |
| `GET` | `/api/config` | Load restaurant config from DB |

### Generation
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/generate` | Start single generation job |
| `GET` | `/api/output` | List output jobs |
| `DELETE` | `/api/output/:jobId` | Delete job + media files |
| `POST` | `/api/output/:jobId/caption` | AI caption for a specific job |
| `POST` | `/api/output/:jobId/post-instagram` | Post job to Instagram |
| `POST` | `/api/generate-week` | Create a full week of posts + generation jobs |
| `GET` | `/api/generate-week/presets` | List scheduling presets |

### Captions & Hashtags
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/generate-caption` | Claude caption (uses restaurant voiceTone/location) |
| `POST` | `/api/generate-hashtags` | Smart hashtag list (branded + location + cuisine + occasion) |

### Instagram OAuth
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/auth/instagram` | Start OAuth flow |
| `GET` | `/auth/instagram/callback` | OAuth callback — saves token to DB |
| `GET` | `/api/instagram/status` | Token status + expiry for current restaurant |
| `POST` | `/api/instagram/refresh` | Manually refresh long-lived token |

### Database (CRUD)
| Route | Operations |
|-------|-----------|
| `/api/db/restaurants` | GET list, POST create, GET/:id, PATCH/:id, DELETE/:id |
| `/api/db/scheduled-posts` | GET list (filter by status/from/to), POST, GET/:id, PATCH/:id, DELETE/:id, POST/:id/post-now |
| `/api/db/script-templates` | GET list, POST, PATCH/:id, DELETE/:id, POST/generate-with-ai |
| `/api/db/food-photos` | GET list, POST, DELETE/:id |
| `/api/db/generation-jobs` | GET list, POST, PATCH/:id |

---

## File Structure

```
restaurant-social-ai/
├── server.js                        # Express app + all inline routes
├── lib/
│   ├── auth.js                      # JWT helpers + requireAuth middleware
│   ├── autopublish.js               # Cron job: auto-publish due posts
│   ├── cloudinary.js                # Cloudinary SDK wrapper
│   ├── db.js                        # Prisma singleton (libsql adapter)
│   ├── jobQueue.js                  # Background generation worker
│   └── schedulingPresets.js        # Research-backed posting time presets
├── pipeline/
│   ├── 1_generate_content.js       # HeyGen video + Sharp image generation
│   ├── 2_brand_overlay.js          # Logo watermark + color composite
│   ├── 3_mock_scheduler.js         # Mock schedule builder
│   └── 4_instagram.js              # Meta Graph API v19.0 (Reels + images)
├── routes/
│   ├── restaurants.js              # /api/db/restaurants CRUD
│   ├── scheduledPosts.js           # /api/db/scheduled-posts CRUD + /post-now
│   ├── scriptTemplates.js          # /api/db/script-templates CRUD + AI generate
│   ├── foodPhotos.js               # /api/db/food-photos CRUD
│   ├── generationJobs.js           # /api/db/generation-jobs CRUD
│   ├── generateWeek.js             # /api/generate-week + /presets
│   └── instagramAuth.js            # OAuth flow + token refresh
├── public/
│   ├── nav.js                      # Restaurant switcher, auth chip, mobile hamburger
│   ├── login.html                  # Owner login page
│   ├── index.html                  # Asset Manager
│   ├── generate.html               # Content Generator
│   ├── schedule.html               # Content Calendar
│   ├── scripts.html                # Script Template Manager
│   ├── approve.html                # Approval queue
│   └── settings.html               # Settings (captions/scheduling/instagram/account)
└── prisma/
    ├── schema.prisma               # 5-table schema
    ├── prisma.config.ts            # Prisma 7 runtime config (datasource URL)
    ├── migrations/                 # SQL migration files
    └── seed.js                     # Demo data seed
```
