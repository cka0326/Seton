# Seton

Learn, revise and retain — on an infinite canvas.

Seton is a local-first learning tool: an unlimited canvas of connected
markdown notes (Obsidian-canvas style), with active-recall mode, auto-layout,
light/dark themes and full-text search. Notes are stored on disk as plain
JSON + Markdown files. It runs entirely on your machine today; the
server/client split means it can move to the cloud later without
rearchitecting.

## Quick start

```bash
npm install
npm run dev        # server on :4517, client on :5173 (open this one)
```

Production-style (single port, serves the built client):

```bash
npm run build
npm start          # open http://localhost:4517
```

## Mac app

Seton also runs as a native Mac app (Electron shell around the same
server + client — see `desktop/`):

```bash
npm run app        # dev: build client, launch the app against ./data
npm run dist       # package: release/Seton-<version>-arm64.dmg + Seton.app
```

The packaged app starts its own server on a free port (no clash with
`npm run dev`) and keeps its data in
`~/Library/Application Support/Seton/data`. Google Drive sync works the
same as in dev — on first launch with an empty database it restores your
projects from the Drive folder.

## Features

**Canvas & notes**
- Unlimited pan/zoom canvas per project, multiple canvases per project.
- Notes are markdown (GFM: tables, task lists, code blocks…), rendered live.
- **Images**: paste or drop an image onto the canvas to drop it in as a note,
  or paste/drop into a note or document editor to embed it inline. An
  image note behaves exactly like a text note (same styling, sizing, export).
- **Double-click a note to open the full-screen editor** — it opens in edit
  mode with a live split preview and every control in one place: title,
  markdown body, kind, color, font size, text alignment, width/height, tags,
  delete. (Single-click just selects; there's no separate side panel to
  manage.)
- Per-note styling: color, font size, text alignment, width/height (drag the
  corners of a selected note, or set exact values in the editor).
- Note kinds — 📝 note, ❓ question, 📖 definition, 💡 idea, 🔗 resource —
  each with its own default color.
- Tags on every note.
- Edges carry short one-line labels (“causes”, “contrasts with”…).
- **Auto-layout**: one click arranges the notes into a clean hierarchy from
  their connections (top-down or left-to-right), powered by dagre.
- **Light and dark themes**, toggled from the sidebar (or the home screen) and
  remembered between sessions.
- Double-click empty canvas to drop a note there. Keyboard: `n` new note,
  `e` / double-click edit, `⌘/Ctrl+D` duplicate selection, `Del` delete,
  `Esc` deselect, `/` filter, `r` recall mode, `⌘/Ctrl+F` search.
- Drag from any side of a note to any side of another to connect them; the
  arrow follows your drag direction.

**Revise & retain**
- 🧠 **Recall mode**: blurs every note body so you can quiz yourself from the
  titles; click a note to reveal it.
- Canvas filter dims non-matching notes so matches pop out visually.

**Search**
- Project-wide full-text search over titles, contents, tags and edge labels,
  with a one-click scope toggle for the current canvas. Clicking a result
  jumps to and centers the note — even across canvases.

**Storage**
- Notes are saved to disk automatically as plain files: canonical JSON plus a
  human-readable Markdown mirror of each canvas.
- Whole project exports as JSON (re-importable) or as a single Markdown
  document; individual canvases export as JSON or Markdown too.

## Layout

```
server/   Express API — projects, canvases, search, export (files on disk)
client/   React + Vite + React Flow (@xyflow/react) + react-markdown + dagre
data/     Your projects (gitignored here)
```

Point `SETON_DATA_DIR` somewhere else (e.g. a synced folder) to relocate your
notes. `PORT` overrides the server port.

For a component-by-component map of the codebase (and the shared vocabulary to
use when directing an AI agent), see [ARCHITECTURE.md](ARCHITECTURE.md).
Contributor/agent guidelines are in [AGENTS.md](AGENTS.md).

## Data model

- `data/<pid>/project.json` — project metadata
- `data/<pid>/canvases/<cid>.json` — nodes (notes) + edges, the source of truth
- `data/<pid>/markdown/<cid>.md` — generated Markdown mirror

## Roadmap ideas

- Backlink panel and orphan-note detector
- Node grouping / frames, canvas templates
- Push project repos to a remote (GitHub) for sync
- Multi-user cloud deployment (the API is already stateless over the data dir)
