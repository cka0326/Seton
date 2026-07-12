# Seton — architecture & component map

A shared vocabulary for talking about the app precisely. When you ask an agent
to change something, name the component or module from this file (e.g. "the
`NoteNode` auto-fit button" or "`server/db.js` `saveCanvas`") so it edits the
right place the first time.

> **Keep this file current.** When you add, remove, rename, or materially change
> a component or module, update the matching entry here in the same change.
> See [AGENTS.md](AGENTS.md).

## Big picture

Seton is a local-first learning tool: an infinite canvas of connected markdown
notes, plus a reading library where you highlight documents and send passages
to the canvas.

```text
┌─────────────┐   HTTP/JSON    ┌──────────────┐   SQLite    ┌───────────┐
│   client/   │ ─────────────▶ │   server/    │ ──────────▶ │ seton.db  │
│ React + RF  │ ◀───────────── │  Express API │             │ (WAL)     │
└─────────────┘                └──────┬───────┘             └───────────┘
                                      │ mirror (markdown + json bundle)
                                      ▼
                              Google Drive folder (backup / cross-machine sync)
```

- **client/** — React + Vite SPA. Canvas is [`@xyflow/react`](https://reactflow.dev)
  (React Flow); markdown via `react-markdown`; auto-layout via `dagre`.
- **server/** — Express API over a single SQLite file. Serves the built client
  in production. Mirrors each project to a Drive-synced folder.
- **desktop/** — Electron shell that boots the same server + client as a Mac app.

Run: `npm run dev` (server :4517 + client :5173). Build: `npm run build`. See
[AGENTS.md](AGENTS.md) for the full command list and how to verify changes.

## Data model

Stored in `<SETON_DATA_DIR>/seton.db` (SQLite, WAL). Three tables:
`projects`, `canvases`, `documents` (see `server/db.js` `SCHEMA`).

- **Project** — `{ id, name, defaultCanvasId, createdAt, updatedAt }`. Has many
  canvases and documents. `defaultCanvasId` is where reader-sent notes land.
- **Canvas** — `{ id, name, nodes[], edges[] }`. The source of truth for the
  board. `nodes`/`edges` are stored as JSON text.
  - **Node** — `{ id, type:'note', position:{x,y}, width, height, updatedAt?, data }` where
    `updatedAt` (ms) is stamped on create/edit/drag so "send to canvas" can drop
    new notes next to the last-modified one (issue #30). It has
    `data = { title, content (markdown), kind, color, fontSize, textAlign,
    tags[], source?, group? }`. `source = { docId, hlId }` marks a note that
    mirrors a reader highlight. `group` is a shared id — grouped notes select
    and move as one (⌘G / ⌘⇧G, PowerPoint-style). Images are embedded in `content` as `data:` URLs, so an
    image note is just a note whose markdown is an image (issue #24).
  - **Edge** — `{ id, source, target, sourceHandle, targetHandle, type:'note',
    data:{ label, createdAt? } }`. `createdAt` (ms) records when the connection
    was made so trace mode can stack and number a note's connections in the
    order they were drawn (older edges fall back to array order).
- **Document** — `{ id, title, content (markdown), highlights[], progress }`.
  - **Highlight** — `{ id, start, quote, prefix, suffix, color, note, title }`.
    Anchored by character offset + surrounding text (see `client/src/lib/anchor.js`).
  - **progress** — `{ scroll, percent, lastReadAt, readSeconds }`.

`kind` ∈ note · question · definition · idea · resource. Colors and kinds are
defined in `client/src/constants.js`.

## Client components (`client/src/components/`)

| Component | Purpose |
|-----------|---------|
| **ProjectList** | Home screen: list / create / open / import / delete projects. |
| **ProjectView** | Main workspace shell. Owns the sidebar (canvases, library, search, export), routes between `CanvasBoard` and `DocumentReader`, remembers each canvas's viewport, and coordinates note⇄reader navigation (`sendToCanvas`, `viewHlOnCanvas`, `openSourceHl`, "back to note" chip). |
| **CanvasBoard** | The React Flow canvas. Owns nodes/edges state + debounced autosave, selection, keyboard shortcuts, add notes via a compact kind dropdown ("Add"), duplicate / link / group notes (⌘G groups, ⌘⇧G ungroups; a group selects, drags and deletes as one), box-select (Ctrl/Cmd-drag), image paste & drop (issue #24), auto-layout (dagre hierarchy + crossing-minimizing grid, whole-canvas or selected-only), fit-all ("Fit" button broadcasts `FitAllContext` so every note auto-sizes to its content), trace mode (focus halo, neighbors wrapped into balanced columns in connection order, edges temporarily re-anchored to facing sides, numbered, and elevated above cards — all display-only, restored on exit), filter view, recall mode, and viewport persistence. Wraps the board in `RecallContext`, `OpenSourceContext`, `NodeSizeContext`. |
| **NoteNode** | A single note card — a custom React Flow node. Renders the note's markdown, connection handles, the resizer, and the **auto-fit** button that sizes the node to its content (issue #23). Toggles the body's `nowheel` class per wheel event so trackpad pinch zooms the canvas while plain scroll still scrolls overflowing content. |
| **NoteEdge** | Custom edge (bezier) with a wrapping label (edited via `Inspector`), a selection halo, and — in trace mode — a connection-order badge (`data.traceOrder`, display-only). |
| **NoteModal** | Full-screen note editor: split markdown editor + live preview, plus title, kind, color, font size, alignment, tags, width/height, delete. Paste/drop images to embed them. Opened by double-click or `e`. |
| **Inspector** | Small side panel to edit/delete a selected **edge's** label. |
| **DocumentReader** | Reads a library document: outline/TOC with scrollspy, text selection → highlight popover, highlights & annotations panel, reading-time clock, progress bar, send/view-highlight-on-canvas, and an edit mode (pencil in the header) that swaps the article for a markdown textarea — highlights re-anchor by quote + context after a save (issue #32). Restores the reading position on open. |
| **AddDocModal** | Add a library document by pasting markdown or importing a `.md`/`.txt` file. Paste/drop images to embed them. |
| **AiToolsModal** | Standalone AI workflows (issue #32): download selected canvases (`seton-canvases/v1`) or a document + annotations (`seton-doc/v1`) with a ready-made prompt for an external assistant, and upload the resulting canvases JSON into the project. Opened from the sidebar "AI tools" button. |
| **SearchPanel** | Project-wide search UI (project or current-canvas scope); clicking a result jumps to the node/edge/doc. |
| **Markdown** | Shared `react-markdown` wrapper (GFM + line breaks). Allows `data:` image URLs and renders images lazily. |
| **Icon** | Inline stroke-based SVG icon set (`PATHS` map). Add new glyphs here. |
| **ThemeToggle** | Light/dark toggle button. |

## Client core & libraries (`client/src/`)

| File | Purpose |
|------|---------|
| **App.jsx** | Top level: selected project + theme, switches `ProjectList` ⇄ `ProjectView`. |
| **main.jsx** | React root; imports React Flow + app styles. |
| **api.js** | Thin `fetch` wrapper — one method per server endpoint (`api.*`). |
| **constants.js** | `NODE_COLORS`, `KINDS`, `HL_COLORS`, `HL_SWATCH`, `HL_TO_NODE_COLOR`, `DEFAULT_NODE`. |
| **contexts.js** | `RecallContext`, `OpenSourceContext`, `NodeSizeContext`, `FitAllContext`. |
| **lib/anchor.js** | Highlight anchoring: `describeSelection`, `locate`, `paintHighlights`. |
| **lib/image.js** | Inline image support: extract image files from paste/drop, downscale to a `data:` URL, and insert markdown at a textarea caret (issue #24). |
| **lib/time.js** | `fmtDuration` for reading-time labels. |
| **lib/confirm.js** | `confirmDialog(message)` — promise-based in-app confirm modal used for all destructive actions (delete project/canvas/document). Replaces `window.confirm`, which hangs the Electron renderer. |
| **styles.css** | All styles (single stylesheet, CSS variables for theming). |

## Server (`server/`)

| File | Purpose |
|------|---------|
| **index.js** | Express app + every REST route (projects, canvases, documents, search, export, import, sync status) and the annotation⇄note sync helpers. Serves `client/dist` in production. |
| **db.js** | SQLite store (`node:sqlite`). `createStore(dataDir)` returns `getProject`, `saveCanvas`, `saveDoc`, … One-time import of the legacy per-project JSON layout. |
| **markdown.js** | `canvasToMarkdown`, `docToMarkdown`, `projectToMarkdown` — used by export endpoints and the Drive mirror. |
| **prompts.js** | Downloadable prompt texts for the standalone AI workflows (merge canvases, document → canvas), each embedding the `seton-canvases/v1` format spec (issue #32). |
| **sync.js** | Google Drive mirror: debounced per-project export to a synced folder, prune-on-write, and restore-if-empty on first run. |

### Key API routes (see `server/index.js`)

```text
GET/POST     /api/projects                         list / create
GET/PUT/DEL  /api/projects/:pid                     read / rename / delete
GET          /api/projects/:pid/all                 project + every canvas (for stats/search)
POST         /api/projects/:pid/canvases            create canvas
GET/PUT/DEL  /api/projects/:pid/canvases/:cid       read / save / delete canvas
GET/POST     /api/projects/:pid/documents           list / create document
GET/PUT/DEL  /api/projects/:pid/documents/:did      read / patch / delete document
GET          /api/projects/:pid/search?q=           full-text search
GET          /api/projects/:pid[/canvases/:cid|/documents/:did]/export.(md|json)
GET          /api/projects/:pid/export/canvases.json[?ids=]  seton-canvases/v1 bundle (selected or all)
GET          /api/projects/:pid/documents/:did/export.json   seton-doc/v1 (content + annotations)
GET          /api/prompts/(merge-canvases|doc-to-canvas).md  AI workflow prompts
POST         /api/projects/import                   import a seton/v1 bundle
POST         /api/projects/:pid/canvases/import     add canvases to a project (seton-canvases/v1, a single canvas export, or a seton/v1 bundle)
GET          /api/sync/status                        Drive sync status
```

## Desktop (`desktop/`)

| File | Purpose |
|------|---------|
| **main.js** | Electron main process — starts the bundled server on a free port and loads it in a `BrowserWindow`. Data lives in `~/Library/Application Support/Seton/data`. |
| **icon.icns / icon.svg** | App icon. |

## Cross-cutting notes

- **Autosave.** `CanvasBoard` serializes nodes/edges and PUTs after a ~700ms
  debounce; `DocumentReader` saves highlights (~400ms) and progress separately.
- **Annotation ⇄ note sync.** A note with `data.source` mirrors a highlight.
  Editing the highlight updates the note (`syncAnnotationNodes`, server) and
  editing the note's body/title/color flows back to the highlight
  (`syncAnnotationsFromCanvas`, server). Rewriting the quoted line detaches the
  note.
- **Images** are embedded as `data:` URLs inside markdown `content`, so they
  need no separate storage and travel through search, export, sync and import
  unchanged (issue #24).
- **Theming** is CSS variables in `styles.css`, toggled via `data-theme` on
  `<html>`; React Flow gets `colorMode` too.
- **AI exchange (issue #32).** No AI runs inside the app. `seton-canvases/v1`
  (canvas bundle) and `seton-doc/v1` (document + annotations) are the exchange
  formats; `server/prompts.js` ships prompts that make an external assistant
  emit `seton-canvases/v1`, and the canvases import endpoint sanitizes whatever
  comes back (defaults, grid positions, dangling edges dropped). Imported
  nodes never keep `data.source` — reader links stay a manual send-to-canvas
  feature.
