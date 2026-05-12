# Changelog

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
