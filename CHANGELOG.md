# Changelog

## May 12, 2026 (Session 6) — Multi-Restaurant, Auth, Auto-Publishing, Scheduling, Captions, Settings

### Multi-restaurant support

Every page now handles multiple restaurants simultaneously. A nav switcher (admin/dev mode) or a restaurant name chip + logout button (auth mode) appears in the top nav on every page.

**Changes:**
- `public/nav.js` — completely rewritten. Fetches `/api/auth/config` on load. If auth is enabled and no token → redirect to `/login.html`. If token → show restaurant name chip + logout. If no token → show restaurant switcher dropdown + "+" new restaurant modal.
- `window.getRestaurantId()` — decodes restaurantId from JWT payload in auth mode; falls back to `localStorage.selectedRestaurantId`.
- All `index.html`, `generate.html`, `schedule.html`, `scripts.html`, `approve.html` pages pass `restaurantId: getRestaurantId()` on every API call.
- Cloudinary paths moved to per-restaurant: `restaurant-social-ai/{restaurantId}/logo|owner|photos/`. Restaurant 1 falls back to old shared paths for backward compat until re-upload.
- Upload endpoints save `logoUrl` / `ownerPortraitUrl` back to the Restaurant DB record.
- `GET /api/assets` reads Restaurant DB for asset URLs first, then falls back to Cloudinary per-restaurant path, then old shared path.
- `POST /api/config` / `GET /api/config` now read/write from the Restaurant DB record via `restaurantToConfig(r)` helper (maps `brandColorPrimary/Accent` → `primaryColor/accentColor`, etc.).
- `POST /api/generate` loads config from Restaurant DB and passes `restaurantId` to `runGeneration`.

### Per-restaurant Instagram credentials

Restaurant owners set their own Instagram Account ID and Access Token, stored in the Restaurant DB record.

- Asset Manager: "Instagram Credentials" section with Account ID + token inputs → `PATCH /api/db/restaurants/:id`.
- `pipeline/4_instagram.js`: `postReel()` and `postImage()` accept optional `creds = { accountId, accessToken }` — falls back to env vars if blank.
- All Instagram posting endpoints load per-restaurant credentials before calling the pipeline.

### JWT Authentication (`lib/auth.js`)

Owner authentication — enabled only when `JWT_SECRET` env var is set; disabled = all routes open (admin mode).

**Auth flow:**
- `GET /api/auth/config` → `{ authEnabled: bool }` — always public
- `POST /api/auth/login` → validates email+password (bcrypt), returns 30-day JWT containing `{ restaurantId }`
- `POST /api/auth/logout` → stateless (client removes token)
- `GET /api/auth/me` → `{ id, name, loginEmail }` from JWT
- `POST /api/auth/set-credentials` → sets email+password; open when auth disabled; requires own JWT or `X-Admin-Secret` when enabled

**Global middleware** registered after auth endpoints, before all other routes:
- Auth disabled (no `JWT_SECRET`) → all routes pass through
- `X-Admin-Secret` header matching `ADMIN_SECRET` env var → bypass JWT (Diana's admin operations)
- Valid `Authorization: Bearer <token>` → sets `req.restaurantId` from JWT payload and overrides `req.query.restaurantId` / `req.body.restaurantId` so all route handlers are automatically scoped

**Fetch interceptor** in `nav.js`: monkey-patches `window.fetch` to add `Authorization: Bearer <token>` to all `/api/` calls except public auth paths; on 401 → clears token + redirects to login.

**New files:**
- `lib/auth.js` — `isAuthEnabled()`, `createToken()`, `verifyToken()`, `requireAuth` middleware
- `public/login.html` — dark-themed login form; stores token in localStorage on success

**Schema additions** (migrations `20260512020000` + `20260512030000`):
```
Restaurant: ownerName, tagline, brandColorBg, platforms, twinStyle, twinUsecase,
            ownerScript, loginEmail (unique), loginPasswordHash
```

**Dependencies added:** `jsonwebtoken ^9.0.3`, `bcryptjs ^3.0.3`

**Production setup:**
1. While `JWT_SECRET` is NOT set, open Asset Manager → Login Credentials section → set email + password.
2. Set `JWT_SECRET` in Railway → all pages immediately require login.
3. `ADMIN_SECRET` (optional) — lets Diana access all routes without logging in.

**Mock credentials (restaurant 1, Osteria della Luna):** `owner@osteria.com` / `pasta1234`

---

### Auto-publishing (`lib/autopublish.js`)

node-cron job runs every 5 minutes checking for due scheduled posts.

**New endpoint:** `POST /api/db/scheduled-posts/:id/post-now` — triggers immediate publish to Instagram (posts in background, returns immediately).

**Publish logic:**
- Finds all `scheduled` posts where `scheduledTime ≤ now` and `contentUrl` is set, for restaurants with `autoPublishEnabled = true`
- Detects video vs image from `postType` (`owner_twin_video`, `cinematic_video` → Reel; `branded_image_feed`, `branded_image_story` → image post)
- 3 attempts with 2s / 4s exponential backoff
- On success: sets `status = published`, `instagramPostId`, `publishedAt`
- On permanent failure: sets `status = failed`, `lastError`

**schedule.html changes:**
- "Post Now" button calls the real Instagram API (was: mark as published only)
- Failed posts show a red error banner in the detail modal with the exact API error message
- Auto-refreshes calendar 4s after "Post Now"

**Schema addition** (migration `20260512040000`):
```
ScheduledPost: publishAttempts Int @default(0), lastError String?
```

**Dependencies added:** `node-cron ^3.x`

---

### Intelligent scheduling presets (`lib/schedulingPresets.js`)

Research-backed posting time presets for restaurants. Replaces hardcoded `TYPE_HOURS` in generateWeek.

**5 presets:**

| ID | Label | Times |
|----|-------|-------|
| `smart` | Smart (day-aware) | Best time per day of week — Wed 12pm, Fri 5pm, Sat 11am… |
| `optimal_3x` | 3× Week Optimal | Mon 5pm · Wed 12pm · Fri 5pm |
| `lunch` | Daily Lunch Push | Every day 11am |
| `evening` | Evening Engagement | Every day 6pm |
| `mixed` | Mixed Schedule | Mon/Wed/Fri 12pm · Tue/Thu 6pm |

**Day-aware logic:**
- Stories → always 9am (morning scroll)
- Videos/Reels → 9am Mon, 12pm Wed, 3pm Thu (break times)
- Feed images → 5pm Mon/Thu/Fri, 12pm Tue/Wed (lunch)

**New endpoint:** `GET /api/generate-week/presets` — returns preset list for the frontend

**`routes/generateWeek.js`** now accepts `schedulePreset` param; uses `getOptimalHour(postType, date, preset)` for each slot

**schedule.html — Generate Week modal changes:**
- New "Posting Schedule Preset" dropdown at the top, populated from `/api/generate-week/presets`
- Preview text shows the preset description ("Mon 5pm · Wed 12pm · Fri 5pm")
- New Post modal shows a green hint when a date is selected: "Optimal for Wednesday: 11am–1pm, 5pm–7pm"

---

### Instagram OAuth + token management (`routes/instagramAuth.js`)

Full Facebook OAuth flow for connecting Instagram — works alongside existing manual token entry.

**Routes:**
- `GET /auth/instagram?restaurantId=X` → redirect to Facebook OAuth dialog
- `GET /auth/instagram/callback` → exchanges code for long-lived token (60 days), gets IG account ID, saves to DB, redirects to `/index.html?ig_connected=true`
- `GET /api/instagram/status` → `{ connected, oauthEnabled, daysLeft, expireSoon, expired }`
- `POST /api/instagram/refresh` → manually refresh an expiring long-lived token

**Daily cron (midnight):** auto-refreshes any token expiring within 7 days.

**Schema addition** (migration `20260512050000`):
```
Restaurant: tokenExpiresAt DateTime?
```

**index.html — Instagram Credentials section changes:**
- "Connect with Instagram" button (purple gradient) — appears when `FB_APP_ID`/`FB_APP_SECRET` are set
- Connected status chip: "✓ Connected · 42d left"
- Yellow warning banner when < 7 days: "Refresh Now" button
- Red expired banner with reconnect prompt
- Handles `?ig_connected` / `?ig_error` query params on redirect back

**Required env vars (optional — manual token entry still works without):**
```
FB_APP_ID=...
FB_APP_SECRET=...
APP_URL=https://socialai-production-4507.up.railway.app  (already set)
```

**Redirect URI to whitelist in Facebook App dashboard:**
```
https://socialai-production-4507.up.railway.app/auth/instagram/callback
```

---

### AI Caption Generation + Hashtag Chips

**New endpoints:**
- `POST /api/generate-caption` — Claude Haiku generates 125–150 character captions; uses restaurant's saved `voiceTone`, `location`, and `includeLocation` preference; accepts `postType`, `contentDescription`, `occasion`
- `POST /api/generate-hashtags` — builds 15 smart hashtags: branded + location + cuisine + occasion + general food tags, seeded from restaurant's `defaultHashtags`

**Redesigned Instagram modal (schedule.html):**
- Voice tone selector (Elegant / Friendly / Professional / Playful / Casual) — pre-populated from restaurant settings
- Character counter: `0 / 150` — turns amber >120, red >150
- **Generate Caption** → first click; **Regenerate** → appears after first generation
- **Hashtag section:** `✦ Suggest` fills chips from API; `+ Add` input with Enter support; `×` removes individual chips; chips appended as `\n\n#tag1 #tag2 …` when posting

**Schema addition** (migration `20260512060000`):
```
Restaurant: voiceTone String?, defaultHashtags String?, includeLocation Boolean @default(true)
```

---

### Settings Page (`public/settings.html`)

New dedicated settings page accessible from every page's nav ("Settings" link).

**Tabs:**

| Tab | Contents |
|-----|----------|
| **Captions** | Voice tone dropdown, include-location toggle, default hashtag chip editor (add/remove/save) |
| **Scheduling** | Preset dropdown, frequency selector, live 7-day schedule preview (day + optimal time) |
| **Instagram** | Connection status chip, OAuth connect/reconnect buttons, token expiry warning + Refresh Now, auto-publish toggle, manual Account ID + token entry |
| **Account** | Restaurant name/cuisine/location/owner/tagline · Login email + password update |

---

### Mobile nav hamburger

`nav.js` now injects on every page:
- A `☰` hamburger button (hidden on desktop, visible on mobile < 768px)
- CSS that collapses `.nav-links` on mobile and toggles `.mobile-open` class on click
- Closes on outside click
- "Settings" link automatically added to every page's nav-links if not already present

---

## May 12, 2026 (Session 5) — Script Template Management

### New page: `/scripts.html`
Full template management UI accessible from every page's nav.

**Sidebar (left):**
- Lists all templates sorted by `lastUsedAt ASC` (rotation order)
- Each card: name, topic badge (color-coded), first 55 chars of script, active/inactive dot, "Last used" date
- + New button

**Editor (main area):**
- Template Name input
- Topic / Occasion dropdown: Welcome, Weekend Special, Happy Hour, New Menu Item, Holiday, General Update, Behind the Scenes, Seasonal Menu
- Script textarea with live word counter + estimated speak time (green = 40–55 words / ~16–22 sec, amber = outside range)
- **Write with AI** — expands inline panel with details input; calls `POST /api/db/script-templates/generate-with-ai` → Claude Haiku
- Active toggle (only active templates enter rotation)
- Save / Delete / Cancel

### Schema changes (migration `20260512010000_script_template_topic_lastused`)
Two new columns on `ScriptTemplate`:
- `topic String?` — occasion tag (welcome, weekend_special, happy_hour, new_menu_item, holiday, general_update, behind_the_scenes, seasonal_menu)
- `lastUsedAt DateTime?` — stamped each time the template is used in a generated video

### Rotation logic
- `GET /api/db/script-templates` now sorts by `lastUsedAt ASC NULLS FIRST` → never-used templates go first, then least-recently-used → true round-robin
- `lib/jobQueue.js`: stamps `lastUsedAt = now()` on the template after each completed video job
- `routes/generateWeek.js`: fetches templates in rotation order before assigning to batch slots

### Backend: `POST /api/db/script-templates/generate-with-ai`
Added to `routes/scriptTemplates.js` (must be defined before `/:id` routes to avoid Express param collision).
Body: `{ restaurantId, topic, details }` → returns `{ script }` from Claude Haiku.
Falls back to a template script if `ANTHROPIC_API_KEY` is not set.

### Generate page updates
- Template picker dropdown appears above the AI script writer when active DB templates exist
- Selecting a template pre-fills the script textarea
- "Manage templates →" link to scripts.html
- "Scripts" nav link added to all pages (index, generate, schedule, scripts, approve)

---

## May 12, 2026 (Session 4) — Batch Week Generation

### POST /api/generate-week (`routes/generateWeek.js`)
New endpoint that creates a full week of content in one click.

**Parameters:**
| Field | Default | Options |
|-------|---------|---------|
| `restaurantId` | 1 | — |
| `startDate` | tomorrow | YYYY-MM-DD |
| `days` | 7 | integer |
| `postFrequency` | `3x_week` | `daily`, `twice_daily`, `5x_week`, `3x_week`, `every_other_day` |
| `contentMix` | `{owner_twin_video:40, cinematic_video:30, branded_image_feed:20, branded_image_story:10}` | percentage per type |

**What it does:**
1. Calculates day slots from frequency (e.g. 3x_week → Mon/Wed/Fri)
2. Distributes types across slots using interleaved round-robin from mix percentages
3. Assigns preferred hours per type (twin=6pm, cinematic=10am, feed=12pm, story=7pm)
4. Rotates active script templates across video posts
5. Creates `ScheduledPost` (status=`draft`) + `GenerationJob` (status=`pending`) linked via `scheduledPostId`
6. Returns `{ scheduledPosts, generationJobs, totalPosts, estimatedMinutes }`

### Background Worker (`lib/jobQueue.js`)
In-process job queue using `setInterval` (no Redis/Bull required).

- Starts automatically inside `app.listen()` callback in `server.js`
- Polls DB every 10s for the oldest `pending` GenerationJob
- Claims it atomically (`updateMany` on `status=pending`) to avoid double-processing
- Builds restaurant config from DB (maps `brandColorPrimary/Accent` → `primaryColor/accentColor`)
- Calls the same `generateTwinClip` / `generateVideo` / `generateImagePost` + `brandOverlay` pipeline
- On complete: sets `generationJob.resultUrl`, `scheduledPost.contentUrl`, `scheduledPost.status=scheduled`
- On failure: sets `generationJob.errorMessage`, `scheduledPost.status=failed`
- On startup: resets any stuck `processing` jobs to `failed` (handles server restarts mid-job)

### Schema change (migration `20260512000000_add_generation_job_fields`)
Two new columns on `GenerationJob`:
- `scheduledPostId Int?` — links job to its target scheduled post
- `errorMessage Text?` — stores failure reason

### Frontend (`schedule.html`)
- **"⚡ Generate This Week" button** replaces old "⚡ Generate Content" link
- **Config modal:** start date picker, frequency dropdown, four content-mix sliders with live % labels and ETA preview
- **Progress banner** (between toolbar and stats):
  - Appears after starting a batch
  - Polls `/api/db/generation-jobs?restaurantId=1` every 12s
  - Shows overall progress bar + per-type chips (`👤 Twin 0/1`, `🎬 Cinematic 1/1`, etc.)
  - Auto-refreshes calendar when all jobs finish; auto-hides banner 5s later

---

## May 11, 2026 (Session 3) — Commit & Deploy

- Restored `prisma.config.ts` (accidentally deleted during abandoned Prisma 5 downgrade attempt; required for `prisma migrate deploy` on Railway)
- Committed all session 2 work: content calendar, migration SQL, CHANGELOG, removed `.node-version` and `nixpacks.toml`
- Pushed 6 commits (`e74c285`→`583e4a5`) to `origin/main` — Railway auto-deploy triggered
- Live URL: `https://socialai-production-4507.up.railway.app/schedule.html`

---

## May 11, 2026 (Session 2) — Database Layer + Content Calendar

### SQLite Database via Prisma 7

Added a full relational database layer (5 tables) using Prisma 7 + libsql (SQLite).

**Schema** (`prisma/schema.prisma`):

| Table | Purpose |
|-------|---------|
| `restaurants` | Brand settings, colors, logo/owner URLs, Instagram credentials, auto-publish flag |
| `food_photos` | Photo library with captions, linked to restaurant |
| `script_templates` | Reusable voiceover scripts (named, active/inactive) |
| `scheduled_posts` | Content calendar entries — type, caption, scheduled time, status, Instagram post ID |
| `generation_jobs` | HeyGen / image generation job tracking (status, external job ID, result URL) |

**Key decisions:**
- Prisma 7 requires Node ≥ 20 and a driver adapter — uses `@prisma/adapter-libsql` (no binary engine)
- Datasource URL is in `prisma.config.ts` only (not in `schema.prisma`) — this is Prisma 7 convention
- Generated client output → `lib/generated/prisma/` (gitignored; regenerated via `postinstall`)
- Local DB: `file:./data/restaurant.db` · Railway DB: `file:/data/restaurant.db` (persistent volume)

**New files:**
- `prisma/schema.prisma` — five models with FK relationships
- `prisma.config.ts` — Prisma 7 runtime config (datasource URL)
- `prisma/migrations/` — migration SQL files (auto-generated)
- `lib/db.js` — Prisma singleton using libsql adapter
- `prisma/seed.js` — seeds "Osteria della Luna" with photos, templates, posts, and jobs
- `routes/restaurants.js` — `GET/POST /api/db/restaurants`, `GET/PATCH/DELETE /api/db/restaurants/:id`
- `routes/scheduledPosts.js` — full CRUD + filters (`?status=&from=&to=`); auto-sets `publishedAt`
- `routes/scriptTemplates.js` — CRUD + `?isActive=` filter
- `routes/foodPhotos.js` — CRUD + `?restaurantId=` filter
- `routes/generationJobs.js` — CRUD; auto-sets `completedAt` when status → `completed|failed`

**`server.js` additions:**
```js
app.use('/api/db/restaurants',      require('./routes/restaurants'));
app.use('/api/db/scheduled-posts',  require('./routes/scheduledPosts'));
app.use('/api/db/script-templates', require('./routes/scriptTemplates'));
app.use('/api/db/food-photos',      require('./routes/foodPhotos'));
app.use('/api/db/generation-jobs',  require('./routes/generationJobs'));
```

### Railway Deployment (DB layer)

- `railway.toml` start command updated to `npx prisma migrate deploy && node server.js`
- `NIXPACKS_NODE_VERSION=20` added as Railway env var (Prisma 7 requires Node 20; Railway was defaulting to Node 18)
- Production DB seeded via HTTP API (`/tmp/seed-production.js`) because `railway run` does not mount volumes — cannot reach `file:/data/restaurant.db` from a one-off container
- Confirmed: all 5 tables populated at `https://socialai-production-4507.up.railway.app/api/db/...`

**Errors encountered and fixed:**

| Error | Fix |
|-------|-----|
| `Prisma only supports Node.js >= 20.19` | Set `NIXPACKS_NODE_VERSION=20` Railway env var |
| `PrismaLibSQL is not a constructor` | Correct casing: `PrismaLibSql` (lowercase 's') |
| `datasources` not a valid constructor option | Prisma 7 uses adapter pattern, not `datasources` |
| `url = env("DATABASE_URL")` in schema.prisma errors | URL belongs in `prisma.config.ts` only in Prisma 7 |
| `SQLITE_CANTOPEN` when running `railway run db:seed` | `railway run` has no volume mount; seeded via live API instead |
| dotenv not loading in `prisma/seed.js` | Used explicit path: `require('dotenv').config({ path: resolve(__dirname, '../.env') })` |

### Content Calendar UI (`public/schedule.html`)

Complete rewrite of the schedule page from a static mock into a fully DB-backed content calendar.

**Features:**
- **7-day grid** — one column per day, posts sorted by scheduled time
- **Post cards** — type icon (👤 owner twin · 🎬 cinematic · 🖼 branded feed · 📱 story), color-coded status badge, time, truncated caption, Edit / Delete buttons on hover
- **Detail modal** — media preview (video or image from `contentUrl`), editable caption, datetime-local picker, status select dropdown, footer actions: Save / Delete / Post to Instagram / View on Instagram / Post Now
- **New post modal** — type select, datetime-local, caption → `POST /api/db/scheduled-posts`
- **Toolbar** — week navigation (← / Today / →), current week label, filter chips (All · Draft · Scheduled · Published · Failed), auto-publish toggle (PATCHes `/api/db/restaurants/:id`)
- **Stats bar** — live counts for Scheduled / Published / Draft / This Week
- **Data source** — `GET /api/db/scheduled-posts?restaurantId=1&from=...&to=...` (one fetch per week navigation)
- **CRUD** — PATCH edits, DELETE removes, POST creates; all reflected immediately in grid

**Note:** This existing restaurant config (config.json, Cloudinary assets, HeyGen output jobs) is a completely separate system from the DB layer. The DB `restaurants` table contains seed data ("Osteria della Luna") — it does not replace or affect the file-based restaurant config used on the generate/assets pages.

---

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
