// SQLite-backed store for Seton, using the Node built-in driver (node:sqlite,
// no native dependencies). All data lives in one file — <dataDir>/seton.db —
// in WAL mode, so every write is durable and atomic.
//
// Projects created by the old JSON-file store (one directory per project in
// the same data dir) are imported automatically the first time the store
// opens; the meta table records that this happened so it only runs once.

import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    default_canvas_id TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS canvases (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    name       TEXT NOT NULL,
    nodes      TEXT NOT NULL DEFAULT '[]',
    edges      TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '[]',
    progress   TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
`;

const projectRow = (r) =>
  r && {
    id: r.id,
    name: r.name,
    defaultCanvasId: r.default_canvas_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

const canvasRow = (r) =>
  r && {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    nodes: JSON.parse(r.nodes),
    edges: JSON.parse(r.edges),
  };

const docRow = (r) =>
  r && {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    highlights: JSON.parse(r.highlights),
    progress: JSON.parse(r.progress),
  };

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'seton.db'));
  db.exec(SCHEMA);

  const q = {
    listProjects: db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM canvases c WHERE c.project_id = p.id) AS canvas_count,
        (SELECT COALESCE(SUM(json_array_length(c.nodes)), 0)
           FROM canvases c WHERE c.project_id = p.id) AS note_count,
        (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS doc_count
      FROM projects p
      ORDER BY p.updated_at DESC
    `),
    getProject: db.prepare(`SELECT * FROM projects WHERE id = ?`),
    insertProject: db.prepare(`
      INSERT INTO projects (id, name, default_canvas_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateProject: db.prepare(`
      UPDATE projects SET name = ?, default_canvas_id = ?, updated_at = ? WHERE id = ?
    `),
    touchProject: db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`),
    deleteProject: db.prepare(`DELETE FROM projects WHERE id = ?`),

    listCanvases: db.prepare(`
      SELECT * FROM canvases WHERE project_id = ? ORDER BY created_at
    `),
    canvasSummaries: db.prepare(`
      SELECT id, name, updated_at, json_array_length(nodes) AS node_count
      FROM canvases WHERE project_id = ? ORDER BY created_at
    `),
    getCanvas: db.prepare(`SELECT * FROM canvases WHERE project_id = ? AND id = ?`),
    upsertCanvas: db.prepare(`
      INSERT INTO canvases (project_id, id, name, nodes, edges, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, id) DO UPDATE SET
        name = excluded.name,
        nodes = excluded.nodes,
        edges = excluded.edges,
        updated_at = excluded.updated_at
    `),
    deleteCanvas: db.prepare(`DELETE FROM canvases WHERE project_id = ? AND id = ?`),
    clearDefaultCanvas: db.prepare(`
      UPDATE projects SET default_canvas_id = NULL
      WHERE id = ? AND default_canvas_id = ?
    `),

    listDocs: db.prepare(`
      SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC
    `),
    getDoc: db.prepare(`SELECT * FROM documents WHERE project_id = ? AND id = ?`),
    upsertDoc: db.prepare(`
      INSERT INTO documents (project_id, id, title, content, highlights, progress, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        highlights = excluded.highlights,
        progress = excluded.progress,
        updated_at = excluded.updated_at
    `),
    deleteDoc: db.prepare(`DELETE FROM documents WHERE project_id = ? AND id = ?`),

    getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
    setMeta: db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`),
    deleteMeta: db.prepare(`DELETE FROM meta WHERE key = ?`),
  };

  const store = {
    getMeta: (key) => q.getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => q.setMeta.run(key, String(value)),
    deleteMeta: (key) => q.deleteMeta.run(key),

    transaction(fn) {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    // ----- projects -----
    listProjects: () =>
      q.listProjects.all().map((r) => ({
        ...projectRow(r),
        canvasCount: r.canvas_count,
        noteCount: r.note_count,
        docCount: r.doc_count,
      })),
    getProject: (pid) => projectRow(q.getProject.get(pid)),
    createProject: (p) =>
      q.insertProject.run(p.id, p.name, p.defaultCanvasId ?? null, p.createdAt, p.updatedAt),
    updateProject: (p) =>
      q.updateProject.run(p.name, p.defaultCanvasId ?? null, p.updatedAt, p.id),
    touchProject: (pid, ts = Date.now()) => q.touchProject.run(ts, pid),
    deleteProject: (pid) => q.deleteProject.run(pid),

    // ----- canvases -----
    listCanvases: (pid) => q.listCanvases.all(pid).map(canvasRow),
    canvasSummaries: (pid) =>
      q.canvasSummaries.all(pid).map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updated_at,
        nodeCount: r.node_count,
      })),
    getCanvas: (pid, cid) => canvasRow(q.getCanvas.get(pid, cid)),
    saveCanvas(pid, canvas, { touch = true } = {}) {
      q.upsertCanvas.run(
        pid,
        canvas.id,
        canvas.name || 'Untitled canvas',
        JSON.stringify(canvas.nodes || []),
        JSON.stringify(canvas.edges || []),
        canvas.createdAt || Date.now(),
        canvas.updatedAt || Date.now()
      );
      if (touch) store.touchProject(pid);
      return canvas;
    },
    deleteCanvas(pid, cid) {
      q.clearDefaultCanvas.run(pid, cid);
      q.deleteCanvas.run(pid, cid);
    },

    // ----- documents -----
    listDocs: (pid) => q.listDocs.all(pid).map(docRow),
    getDoc: (pid, did) => docRow(q.getDoc.get(pid, did)),
    saveDoc(pid, doc, { touch = true } = {}) {
      q.upsertDoc.run(
        pid,
        doc.id,
        doc.title || 'Untitled document',
        doc.content || '',
        JSON.stringify(doc.highlights || []),
        JSON.stringify(doc.progress || {}),
        doc.createdAt || Date.now(),
        doc.updatedAt || Date.now()
      );
      if (touch) store.touchProject(pid);
      return doc;
    },
    deleteDoc: (pid, did) => q.deleteDoc.run(pid, did),
  };

  migrateLegacyJSON(db, store, dataDir);
  return store;
}

// One-time import of the old on-disk layout:
//   <dataDir>/<pid>/project.json
//   <dataDir>/<pid>/canvases/<cid>.json
//   <dataDir>/<pid>/documents/<did>.json
// The JSON files are left untouched as a backup.
function migrateLegacyJSON(db, store, dataDir) {
  const flag = db.prepare(`SELECT value FROM meta WHERE key = 'legacy-json-import'`);
  if (flag.get()) return;

  const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const listJSON = (dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => readJSON(path.join(dir, f)))
      : [];

  let imported = 0;
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(dataDir, entry.name);
    if (!fs.existsSync(path.join(dir, 'project.json'))) continue;
    try {
      store.transaction(() => {
        const p = readJSON(path.join(dir, 'project.json'));
        if (store.getProject(p.id)) return; // already in the db
        const now = Date.now();
        store.createProject({
          id: p.id,
          name: p.name || 'Untitled project',
          defaultCanvasId: p.defaultCanvasId ?? null,
          createdAt: p.createdAt || now,
          updatedAt: p.updatedAt || now,
        });
        for (const c of listJSON(path.join(dir, 'canvases'))) {
          store.saveCanvas(p.id, c, { touch: false });
        }
        for (const d of listJSON(path.join(dir, 'documents'))) {
          store.saveDoc(p.id, d, { touch: false });
        }
        imported++;
      });
    } catch (err) {
      console.error(`legacy import: skipping ${entry.name}: ${err.message}`);
    }
  }
  db.prepare(`INSERT INTO meta (key, value) VALUES ('legacy-json-import', ?)`).run(
    new Date().toISOString()
  );
  if (imported) {
    console.log(`Imported ${imported} project(s) from legacy JSON files into seton.db`);
  }
}
