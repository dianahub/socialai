# Restaurant Social AI — Claude Code Project

## What this project does
Automated social media content generation for fine dining restaurants.
Takes restaurant assets (logo, food photos, owner photo) and produces:
1. Cinematic video content (wow moment) via Higgsfield
2. Branded image posts for Instagram / Facebook / TikTok
3. Simulated posting queue (mock scheduler, no real auth needed for demo)

## Stack
- Frontend: Single-file HTML/JS served by Express
- Backend: Node.js + Express
- AI/Video: Higgsfield MCP (already registered at user scope)
- Image processing: Sharp (logo overlay, resizing)
- Scheduling UI: Mock only, no real social API keys needed for demo

## How to run
npm install
node server.js
Open http://localhost:3000

## Higgsfield MCP
Already registered. Confirm with /mcp inside Claude Code.
Models to use:
- Cinematic dish video: Seedance 2.0 or Veo
- Owner digital twin: Soul or Cinema Studio
- Image posts: GPT Image 2 or Flux
- Stories/reels: Nano Banana Pro or Kling

Always confirm credit cost before triggering a paid Higgsfield run.

## Demo flow
1. Asset manager: fill restaurant info, upload logo + photos + owner photo
2. Generate page: kick off Higgsfield calls, show cinematic video first
3. Schedule tab: show the week's posts mocked out with generated content

## Brand overlay rules
- Logo: bottom-right corner, 15% of image width
- Primary color: caption background bar
- Accent color: restaurant name text
- Export at 1080x1080 (feed) and 1080x1920 (story)

## Key decisions
- No real Instagram API for demo, mock scheduler shows the concept
- Owner twin: still photo to Higgsfield Soul to animated welcome clip
- All output saved to /output with JSON metadata sidecar
- Uploads persist in /assets between sessions
