# Restaurant Social AI — Claude Code Project

## What this project does
Automated social media content generation for fine dining restaurants.
Takes restaurant assets (logo, food photos, owner photo) and produces:
1. Cinematic video content (wow moment) via HeyGen
2. Branded image posts for Instagram / Facebook / TikTok
3. Simulated posting queue (mock scheduler, no real auth needed for demo)

## Stack
- Frontend: Single-file HTML/JS served by Express
- Backend: Node.js + Express
- AI/Video: HeyGen API (avatar video + talking photo)
- Image processing: Sharp (logo overlay, resizing)
- Asset storage: Cloudinary (persistent across server restarts)
- Database: SQLite via Prisma 7 + libsql driver adapter (`data/restaurant.db`)
- Scheduling UI: DB-backed scheduled_posts table; mock fallback at GET /api/schedule

## How to run
```
npm install
node server.js
```
Open http://localhost:3000

## Deployed URL
https://socialai-production-4507.up.railway.app

## Environment variables
```
HEYGEN_API_KEY=...
ANTHROPIC_API_KEY=...
CLOUDINARY_CLOUD_NAME=dlbqagijb
CLOUDINARY_API_KEY=593464484614269
CLOUDINARY_API_SECRET=...
PORT=3000
DATABASE_URL=file:./data/restaurant.db   # local; Railway: file:/data/restaurant.db
# DATA_DIR=/data  (only needed for local output/config without Cloudinary)
```
All variables are set in Railway (production) and in local `.env`.

## Database — Prisma + SQLite
Schema: `prisma/schema.prisma` — 5 tables: Restaurant, FoodPhoto, ScriptTemplate, ScheduledPost, GenerationJob.
Migrations: `prisma/migrations/` — run `npm run db:migrate` on first deploy.
Seed: `npm run db:seed` — inserts demo restaurant "Osteria della Luna" with photos, templates, and 10 scheduled posts.
Client: `lib/db.js` — Prisma singleton using `@prisma/adapter-libsql`.
DB API routes (all under `/api/db/`):
- `GET/POST /api/db/restaurants` + `GET/PATCH/DELETE /api/db/restaurants/:id`
- `GET/POST /api/db/scheduled-posts` + `PATCH/DELETE /api/db/scheduled-posts/:id` (filter by restaurantId, status, from, to)
- `GET/POST /api/db/script-templates` + `PATCH/DELETE /api/db/script-templates/:id`
- `GET/POST /api/db/food-photos` + `DELETE /api/db/food-photos/:id`
- `GET/POST /api/db/generation-jobs` + `PATCH /api/db/generation-jobs/:id`
Railway: set `DATABASE_URL=file:/data/restaurant.db` and mount a volume at `/data`.

## Asset storage — Cloudinary
Uploaded assets are stored in Cloudinary and survive Railway server restarts.
Local filesystem is used as fallback when Cloudinary env vars are not set.

Cloudinary public ID conventions:
- Logo:   `restaurant-social-ai/logo`   (overwritten on each upload)
- Owner:  `restaurant-social-ai/owner`  (overwritten on each upload)
- Photos: `restaurant-social-ai/photos/photo_{timestamp}_{rand}`

Key files:
- `lib/cloudinary.js` — Cloudinary SDK wrapper (uploadBuffer, deleteAsset, getAssetUrl, listFolder)
- Upload endpoints use `multer.memoryStorage()` → buffer → Cloudinary
- `GET /api/assets` queries Cloudinary for live URLs; falls back to local dir scan
- `DELETE /api/assets/:type/:filename` calls `cloudinary.uploader.destroy`
- `runGeneration` fetches `_logoUrl` / `_ownerUrl` from Cloudinary and injects into config
- `pipeline/2_brand_overlay.js` downloads logo from `config._logoUrl` via fetch → Sharp
- `pipeline/1_generate_content.js` downloads owner photo from `config._ownerUrl` to temp file before HeyGen upload

## HeyGen integration
- `generateVideo` — Avatar presenter video (16:9)
- `generateTwinClip` — Talking Photo from owner portrait (9:16); falls back to Avatar if upload fails
- `generateImagePost` — branded static images via Sharp (HeyGen is video-only)
- All generation is async: POST /api/generate returns a jobId immediately, polls via GET /api/output

## Demo flow
1. Asset manager: fill restaurant info, upload logo + food photos + owner portrait
2. Generate page: kick off HeyGen calls, poll for completion
3. Schedule tab: shows the week's posts mocked out with generated content

## Brand overlay rules
- Logo: bottom-right corner, 15% of image width
- Primary color: caption background bar
- Accent color: restaurant name text
- Export at 1080x1080 (feed) and 1080x1920 (story)

## Key decisions
- No real Instagram API for demo — mock scheduler shows the concept
- Owner twin: still photo → HeyGen Talking Photo → animated welcome clip
- All output (videos/images + metadata JSON) saved to /output on the server filesystem
- Asset uploads (logo, photos, owner) persist in Cloudinary across restarts
- config.json (restaurant name, colors, etc.) is still stored on local filesystem — re-enter after a cold restart if no DATA_DIR volume is mounted
- Prisma 7 uses the libsql driver adapter — no binary engine; `PrismaLibSql` takes a `{ url }` config, not a pre-created client
- `GET /api/schedule` (mock) is kept as-is; new DB-backed schedule lives at `/api/db/scheduled-posts`
