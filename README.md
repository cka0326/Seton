# Seton

Learn, revise and retain — on an infinite canvas.

Seton is a local-first learning tool: an unlimited canvas of connected
markdown notes (Obsidian-canvas style), with spaced-repetition flashcards,
active-recall mode, full-text search and git-backed version history built in.
It runs entirely on your machine today; the server/client split means it can
move to the cloud later without rearchitecting.

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

## Features

**Canvas & notes**
- Unlimited pan/zoom canvas per project, multiple canvases per project.
- Notes are markdown (GFM: tables, task lists, code blocks…), rendered live.
- Per-note styling: color, font size, text alignment, width/height (drag the
  corners of a selected note or type exact dimensions).
- Note kinds — 📝 note, ❓ question, 📖 definition, 💡 idea, 🔗 resource —
  each with its own default color.
- Tags on every note.
- Edges carry short one-line labels (“causes”, “contrasts with”…).
- Long notes: the inspector shows the full text, and **double-clicking a note
  maximizes it to the whole viewport** with a distraction-free editor.
- Double-click empty canvas to drop a note there. Keyboard: `n` new note,
  `/` filter, `r` recall mode, `Backspace` delete selection.

**Learning tools**
- 🎴 **Flashcards**: tick “Flashcard” on any note — the title becomes the
  prompt, the content the answer. Reviews are scheduled with an SM-2-style
  spaced-repetition algorithm (Again / Hard / Good / Easy, keys 1–4).
  The sidebar badge shows how many cards are due across the project.
- 🧠 **Recall mode**: blurs every note body so you can quiz yourself from the
  titles; click a note to reveal it.
- Canvas filter dims non-matching notes so matches pop out visually.

**Search**
- Project-wide full-text search over titles, contents, tags and edge labels,
  with a one-click scope toggle for the current canvas. Clicking a result
  jumps to and centers the note — even across canvases.

**Version control (git)**
- Every project is its own git repository under `data/<project>/`.
- Alongside the canonical JSON, Seton writes a generated markdown mirror of
  each canvas, so `git diff` stays human-readable.
- Snapshot from the toolbar or the History panel (with a message), browse the
  full commit log, and restore any canvas to any snapshot — the pre-restore
  state is committed first, so nothing is ever lost.
- Review sessions auto-commit, giving you a learning trail in `git log`.

**Import / export**
- Whole project as JSON (re-importable) or as a single markdown document.
- Individual canvases as JSON or markdown.

## Layout

```
server/   Express API — projects, canvases, search, export, git (simple-git)
client/   React + Vite + React Flow (@xyflow/react) + react-markdown
data/     Your projects (gitignored here; each project is its own git repo)
```

Point `SETON_DATA_DIR` somewhere else (e.g. a synced folder) to relocate your
notes. `PORT` overrides the server port.

## Data model

- `data/<pid>/project.json` — project metadata
- `data/<pid>/canvases/<cid>.json` — nodes (notes) + edges, the source of truth
- `data/<pid>/markdown/<cid>.md` — generated markdown mirror for readable diffs

## Roadmap ideas

- Cloze deletions inside a note (`{{hidden}}`) as extra flashcards
- Backlink panel and orphan-note detector
- Node grouping / frames, canvas templates
- Push project repos to a remote (GitHub) for sync
- Multi-user cloud deployment (the API is already stateless over the data dir)
