# Working on Seton (agent guide)

Instructions for any AI coding agent (and humans) working in this repo. This
file is tool-agnostic; `CLAUDE.md` points here so Claude Code reads it too.

## Orient yourself first

**[ARCHITECTURE.md](ARCHITECTURE.md) is the component map** — the names of every
component, module, and data shape, plus the API routes and data model. Read it
before making a change so you edit the right place and use the same vocabulary
the user does.

## ⚠️ Keep ARCHITECTURE.md in sync

`ARCHITECTURE.md` is the shared vocabulary the user relies on to talk to agents.
It is only useful if it stays true. **In the same change that you:**

- add / remove / rename a component or module → update its table row;
- add / change / remove an API route → update the routes list;
- change a stored data shape (node/edge/document/highlight fields) → update the
  data model;
- add a new cross-cutting behavior (autosave, sync, a new context, etc.) → note
  it under "Cross-cutting notes".

Keep entries to one line. If a change doesn't touch structure (a bug fix, a
style tweak), you don't need to touch `ARCHITECTURE.md`.

## Commands

```bash
npm install            # install workspaces (root, client, server)
npm run dev            # server on :4517 + client on :5173 (open :5173)
npm run build          # build client → client/dist
npm start              # serve built client from the server on :4517
npm run app            # build client + launch the Electron Mac app (dev)
npm run dist           # package the Mac app (.dmg + .app) into release/
```

There is no unit-test suite. Verify UI changes by driving the running app — the
`verify` skill in `.claude/skills/verify` documents how (isolated server with
`SETON_DATA_DIR`/`SETON_SYNC_DIR` overrides + Playwright against system Chrome).
**Never run a test server against the repo `data/` dir or the real Drive folder
— both are live**; always override both env vars.

## Conventions

- **Stack:** React 18 function components + hooks, Vite, plain CSS (one
  `styles.css`, CSS variables for theming — no CSS framework). ES modules
  everywhere (`"type": "module"`). Node's built-in `node:sqlite`; no ORM.
- **Style:** 2-space indent, single quotes, semicolons. Match the surrounding
  file — comment density, naming, and idioms. Comments explain *why*, not *what*.
- **Canvas:** the board is `@xyflow/react`. Nodes/edges are controlled state in
  `CanvasBoard`; volatile React Flow props (`measured`, `selected`, `dragging`,
  `resizing`) are stripped before saving (`stripNode`/`stripEdge`).
- **Markdown** is the storage format for note bodies and documents. Anything
  markdown can express (including embedded `data:` images) just works — don't
  invent parallel storage for content.
- **Persistence:** all writes go through `client/src/api.js` → `server/index.js`
  → `server/db.js`. Saves are debounced client-side; the server mirrors to Drive.
- **Icons:** add SVG glyphs to `client/src/components/Icon.jsx`; don't use emoji
  in the UI chrome.
- **Git:** branch off `main`; only commit/push when the user asks.

## Where things live (quick index)

- New canvas interaction → `CanvasBoard.jsx` (+ `NoteNode.jsx` for the card).
- Note editor field/control → `NoteModal.jsx`.
- Reader / highlighting → `DocumentReader.jsx` (+ `lib/anchor.js`).
- New API endpoint → `server/index.js` (+ `server/db.js` if it touches storage).
- Export / Drive mirror formatting → `server/markdown.js`.
- Shared constants (colors, kinds, defaults) → `client/src/constants.js`.
