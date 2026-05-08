# Restaurant Social AI

Automated social media content generation for fine dining restaurants. Upload your restaurant's assets, and the app produces cinematic video content, branded image posts, and a mock weekly posting schedule — ready for Instagram, Facebook, and TikTok.

## Features

- **Asset Manager** — upload logo, food photos (up to 6), and owner portrait
- **Content Generator** — kick off AI-powered generation jobs (video, owner twin clip, image posts)
- **Brand Overlay** — auto-composites logo + caption bar onto image posts at feed (1080×1080) and story (1080×1920) sizes
- **Content Calendar** — 7-day mock schedule with platform-specific captions, no real social API keys required

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/JS (single-file pages) |
| AI / Video | HeyGen API (video & owner twin clips) |
| Image processing | Sharp (logo overlay, resizing) |
| Upload handling | Multer |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Add your HeyGen API key
cp .env.example .env
# Edit .env and set HEYGEN_API_KEY=your_key_here

# 3. Start the server
node server.js
# or for auto-reload:
npm run dev

# 4. Open in browser
open http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEYGEN_API_KEY` | Yes | HeyGen API key for video/avatar generation |
| `PORT` | No | Server port (default: `3000`) |

Copy `.env.example` to `.env` and fill in your values — the `.env` file is gitignored.

## Demo Flow

1. **Asset Manager** (`/`) — Enter restaurant name, cuisine type, brand colors, and target platforms. Upload logo, food photos, and owner photo.
2. **Generate** (`/generate.html`) — Trigger generation jobs:
   - `video` — cinematic dish video
   - `twin` — animated owner welcome clip
   - `image` — branded static posts for feed + story
3. **Schedule** (`/schedule.html`) — View the auto-generated Mon–Sun posting calendar with captions.

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
| `POST` | `/api/generate` | Start a generation job (`{ type: "video" \| "twin" \| "image" }`) |
| `GET` | `/api/output` | List all output jobs with metadata |
| `GET` | `/api/schedule` | Get 7-day mock posting schedule |

## Brand Overlay Rules

- Logo: bottom-right corner, 15% of image width
- Caption bar: bottom 10% of image, filled with primary brand color
- Restaurant name text: accent color
- Feed export: 1080×1080 px
- Story export: 1080×1920 px

## Project Structure

```
restaurant-social-ai/
├── server.js                  # Express app + all API routes
├── pipeline/
│   ├── 1_generate_content.js  # HeyGen calls + Sharp mock generation
│   ├── 2_brand_overlay.js     # Logo + caption composite via Sharp
│   └── 3_mock_scheduler.js    # 7-day schedule builder
├── public/
│   ├── index.html             # Asset Manager (step 1)
│   ├── generate.html          # Content Generator (step 2)
│   └── schedule.html          # Content Calendar (step 3)
├── assets/                    # Uploaded files (gitignored)
└── output/                    # Generated content + job metadata (gitignored)
```

## License

MIT
