---
name: verify
description: Build, launch, and drive Seton to verify a change end-to-end in the real UI.
---

# Verifying Seton changes

Seton is an Express server (`server/index.js`, port 4517) that serves the built
React client from `client/dist`. The UI is the surface — drive it in a browser.

## Build + launch (isolated)

Never run a test server against the repo `data/` dir or the user's Google Drive
mirror — both are live. Override both:

```bash
npm run build                          # builds client → client/dist
SP=<scratch dir>
mkdir -p "$SP/data" "$SP/drive"
SETON_DATA_DIR="$SP/data" SETON_SYNC_DIR="$SP/drive" PORT=4599 node server/index.js &
```

Without `SETON_SYNC_DIR` the server finds the real Google Drive folder,
restores the user's projects into your scratch DB, and mirrors writes back.

## Seed data via API

`POST /api/projects {name}` (auto-creates a "Main" canvas),
`POST /api/projects/:pid/documents {title, content}`,
`PUT /api/projects/:pid/canvases/:cid` to write nodes/edges.
Highlights ride on the document: `{id, start, quote, prefix, suffix, color, note}` —
`start` may be approximate; the client re-locates by quote text.

## Drive the UI

`playwright-core` + system Chrome works (`chromium.launch({ channel: 'chrome', headless: true })`).
No project fixture — install playwright-core in the scratch dir.

Gotchas:
- `.reader-scroll` has `scroll-behavior: smooth` — use
  `scrollTo({top, behavior: 'instant'})` in scripts and poll scrollTop until
  stable before asserting positions.
- To create a highlight programmatically: set a DOM Range selection inside
  `.reader-content`, then dispatch a bubbling `mouseup` on the paragraph —
  the popover appears; click a `.pen-dot`.
- Canvas saves are debounced ~700ms; reader highlight saves ~400ms — wait
  before asserting server state.
- Selected/centered canvas node: `.react-flow__node.selected`, compare its
  bounding-box center to the `.react-flow` pane center.
