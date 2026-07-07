import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';
import { createSync } from './sync.js';
import { canvasToMarkdown, docToMarkdown, projectToMarkdown } from './markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.SETON_DATA_DIR || path.join(ROOT, 'data');
const PORT = process.env.PORT || 4517;

const store = createStore(DATA_DIR);
const sync = createSync(store);
sync.restoreIfEmpty();
sync.syncAll();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const ID_RE = /^[a-z0-9-]+$/i;
const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertId(id, kind = 'id') {
  if (!id || !ID_RE.test(id)) throw httpError(400, `invalid ${kind}`);
  return id;
}

function mustProject(pid) {
  const project = store.getProject(assertId(pid, 'project id'));
  if (!project) throw httpError(404, 'project not found');
  return project;
}

function mustCanvas(pid, cid) {
  mustProject(pid);
  const canvas = store.getCanvas(pid, assertId(cid, 'canvas id'));
  if (!canvas) throw httpError(404, 'canvas not found');
  return canvas;
}

function mustDoc(pid, did) {
  mustProject(pid);
  const doc = store.getDoc(pid, assertId(did, 'document id'));
  if (!doc) throw httpError(404, 'document not found');
  return doc;
}

const docSummary = (d) => ({
  id: d.id,
  title: d.title,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  words: (d.content || '').split(/\s+/).filter(Boolean).length,
  highlightCount: (d.highlights || []).length,
  percent: d.progress?.percent || 0,
  lastReadAt: d.progress?.lastReadAt || null,
  readSeconds: d.progress?.readSeconds || 0,
});

// Body of a canvas note that mirrors an annotation. Must match what the
// client builds in sendToCanvas so server refreshes are byte-identical.
// The source document is tracked in data.source, not in the body (issue #22).
const annotationContent = (hl) =>
  `> ${(hl.quote || '').trim()}` +
  (hl.note?.trim() ? `\n\n${hl.note.trim()}` : '');

// Issue #11: notes sent to a canvas keep data.source = { docId, hlId }.
// When a document's highlights change, refresh every linked note so edited
// annotations show up on the canvas.
function syncAnnotationNodes(pid, doc) {
  const byId = new Map((doc.highlights || []).map((h) => [h.id, h]));
  for (const canvas of store.listCanvases(pid)) {
    let changed = false;
    for (const n of canvas.nodes || []) {
      const src = n.data?.source;
      if (!src || src.docId !== doc.id) continue;
      const hl = byId.get(src.hlId);
      if (!hl) continue; // highlight deleted — leave the note as it was
      const content = annotationContent(hl);
      if (n.data.content !== content) {
        n.data = { ...n.data, content };
        changed = true;
      }
    }
    if (changed) store.saveCanvas(pid, canvas, { touch: false });
  }
}

// Title fallback: first markdown heading, else first non-empty line.
function inferDocTitle(content) {
  for (const line of (content || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^#{1,6}\s+(.*)/);
    return (m ? m[1] : t).replace(/[*_`#]/g, '').slice(0, 120);
  }
  return 'Untitled document';
}

// ---------- async route helper ----------

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ---------- projects ----------

app.get('/api/projects', wrap(async (_req, res) => {
  res.json(store.listProjects());
}));

app.post('/api/projects', wrap(async (req, res) => {
  const name = (req.body.name || '').trim() || 'Untitled project';
  const now = Date.now();
  const project = { id: newId(), name, createdAt: now, updatedAt: now };
  store.transaction(() => {
    store.createProject(project);
    store.saveCanvas(
      project.id,
      { id: newId(), name: 'Main', createdAt: now, updatedAt: now, nodes: [], edges: [] },
      { touch: false }
    );
  });
  sync.schedule(project.id);
  res.status(201).json(project);
}));

app.get('/api/projects/:pid', wrap(async (req, res) => {
  const project = mustProject(req.params.pid);
  res.json({ ...project, canvases: store.canvasSummaries(project.id) });
}));

app.put('/api/projects/:pid', wrap(async (req, res) => {
  const project = mustProject(req.params.pid);
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    project.name = req.body.name.trim();
  }
  if ('defaultCanvasId' in req.body) {
    project.defaultCanvasId = req.body.defaultCanvasId || null;
  }
  project.updatedAt = Date.now();
  store.updateProject(project);
  sync.schedule(project.id);
  res.json(project);
}));

app.delete('/api/projects/:pid', wrap(async (req, res) => {
  mustProject(req.params.pid);
  sync.removeProject(req.params.pid);
  store.deleteProject(req.params.pid);
  res.json({ ok: true });
}));

app.get('/api/projects/:pid/all', wrap(async (req, res) => {
  const project = mustProject(req.params.pid);
  res.json({ project, canvases: store.listCanvases(project.id) });
}));

// ---------- canvases ----------

app.post('/api/projects/:pid/canvases', wrap(async (req, res) => {
  mustProject(req.params.pid);
  const now = Date.now();
  const canvas = {
    id: newId(),
    name: (req.body.name || '').trim() || 'Untitled canvas',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  };
  store.saveCanvas(req.params.pid, canvas);
  sync.schedule(req.params.pid);
  res.status(201).json(canvas);
}));

app.get('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  res.json(mustCanvas(req.params.pid, req.params.cid));
}));

app.put('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  const doc = req.body;
  if (!doc || doc.id !== req.params.cid) {
    throw httpError(400, 'canvas id mismatch');
  }
  mustProject(req.params.pid);
  doc.updatedAt = Date.now();
  const saved = store.saveCanvas(req.params.pid, doc);
  sync.schedule(req.params.pid);
  res.json(saved);
}));

app.delete('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  mustProject(req.params.pid);
  store.deleteCanvas(req.params.pid, assertId(req.params.cid, 'canvas id'));
  sync.schedule(req.params.pid);
  res.json({ ok: true });
}));

// ---------- documents ----------

app.get('/api/projects/:pid/documents', wrap(async (req, res) => {
  mustProject(req.params.pid);
  res.json(store.listDocs(req.params.pid).map(docSummary));
}));

app.post('/api/projects/:pid/documents', wrap(async (req, res) => {
  mustProject(req.params.pid);
  const content = typeof req.body.content === 'string' ? req.body.content : '';
  if (!content.trim()) throw httpError(400, 'document content is empty');
  const now = Date.now();
  const doc = {
    id: newId(),
    title: (req.body.title || '').trim() || inferDocTitle(content),
    content,
    createdAt: now,
    updatedAt: now,
    highlights: [],
    progress: { scroll: 0, percent: 0, lastReadAt: null },
  };
  store.saveDoc(req.params.pid, doc);
  sync.schedule(req.params.pid);
  res.status(201).json(doc);
}));

app.get('/api/projects/:pid/documents/:did', wrap(async (req, res) => {
  res.json(mustDoc(req.params.pid, req.params.did));
}));

// Partial update: only the provided fields (title, content, highlights,
// progress) are merged. Progress-only saves don't bump updatedAt so that
// "last edited" stays meaningful.
app.put('/api/projects/:pid/documents/:did', wrap(async (req, res) => {
  const doc = mustDoc(req.params.pid, req.params.did);
  const b = req.body || {};
  let touched = false;
  if (typeof b.title === 'string' && b.title.trim()) {
    doc.title = b.title.trim();
    touched = true;
  }
  if (typeof b.content === 'string') {
    doc.content = b.content;
    touched = true;
  }
  if (Array.isArray(b.highlights)) {
    doc.highlights = b.highlights;
    touched = true;
  }
  if (b.progress && typeof b.progress === 'object') {
    doc.progress = { ...doc.progress, ...b.progress };
  }
  if (touched) doc.updatedAt = Date.now();
  store.saveDoc(req.params.pid, doc);
  if (touched) syncAnnotationNodes(req.params.pid, doc); // annotation/title edits → linked notes
  sync.schedule(req.params.pid);
  res.json(doc);
}));

app.delete('/api/projects/:pid/documents/:did', wrap(async (req, res) => {
  mustProject(req.params.pid);
  store.deleteDoc(req.params.pid, assertId(req.params.did, 'document id'));
  sync.schedule(req.params.pid);
  res.json({ ok: true });
}));

// ---------- search ----------

app.get('/api/projects/:pid/search', wrap(async (req, res) => {
  mustProject(req.params.pid);
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (!q) return res.json([]);
  const canvases = store.listCanvases(req.params.pid);
  const results = [];
  const snippet = (text, idx) => {
    const start = Math.max(0, idx - 40);
    const s = text.slice(start, idx + q.length + 60).replace(/\s+/g, ' ');
    return (start > 0 ? '…' : '') + s + '…';
  };
  for (const c of canvases) {
    for (const n of c.nodes || []) {
      const d = n.data || {};
      const title = d.title || '';
      const content = d.content || '';
      const tags = (d.tags || []).join(' ');
      const hay = `${title}\n${content}\n${tags}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx === -1) continue;
      results.push({
        type: 'node',
        canvasId: c.id,
        canvasName: c.name,
        nodeId: n.id,
        title: title || 'Untitled note',
        snippet: snippet(`${title} ${content} ${tags}`, Math.min(idx, title.length + content.length)),
      });
    }
    for (const e of c.edges || []) {
      const label = (e.data && e.data.label) || '';
      if (!label.toLowerCase().includes(q)) continue;
      results.push({
        type: 'edge',
        canvasId: c.id,
        canvasName: c.name,
        nodeId: e.source,
        title: `Edge: ${label}`,
        snippet: label,
      });
    }
  }
  for (const d of store.listDocs(req.params.pid)) {
    const text = `${d.title || ''}\n${d.content || ''}`;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    results.push({
      type: 'doc',
      docId: d.id,
      title: d.title || 'Untitled document',
      snippet: snippet(text, idx),
    });
  }
  res.json(results.slice(0, 100));
}));

// ---------- export ----------

function download(res, filename, mime, body) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

app.get('/api/projects/:pid/export.json', wrap(async (req, res) => {
  const project = mustProject(req.params.pid);
  const canvases = store.listCanvases(project.id);
  const documents = store.listDocs(project.id);
  download(
    res,
    `${project.name.replace(/[^\w-]+/g, '_')}.seton.json`,
    'application/json',
    JSON.stringify({ format: 'seton/v1', project, canvases, documents }, null, 2)
  );
}));

app.get('/api/projects/:pid/export.md', wrap(async (req, res) => {
  const project = mustProject(req.params.pid);
  const canvases = store.listCanvases(project.id);
  const documents = store.listDocs(project.id);
  const parts = [projectToMarkdown(project, canvases)];
  for (const d of documents) {
    parts.push('---', '', docToMarkdown(d));
  }
  download(
    res,
    `${project.name.replace(/[^\w-]+/g, '_')}.md`,
    'text/markdown',
    parts.join('\n')
  );
}));

app.get('/api/projects/:pid/canvases/:cid/export.json', wrap(async (req, res) => {
  const doc = mustCanvas(req.params.pid, req.params.cid);
  download(res, `${doc.name.replace(/[^\w-]+/g, '_')}.canvas.json`,
    'application/json', JSON.stringify(doc, null, 2));
}));

app.get('/api/projects/:pid/canvases/:cid/export.md', wrap(async (req, res) => {
  const doc = mustCanvas(req.params.pid, req.params.cid);
  download(res, `${doc.name.replace(/[^\w-]+/g, '_')}.md`,
    'text/markdown', canvasToMarkdown(doc));
}));

app.get('/api/projects/:pid/documents/:did/export.md', wrap(async (req, res) => {
  const doc = mustDoc(req.params.pid, req.params.did);
  download(res, `${doc.title.replace(/[^\w-]+/g, '_')}.md`,
    'text/markdown', docToMarkdown(doc));
}));

// ---------- drive sync ----------

app.get('/api/sync/status', wrap(async (_req, res) => {
  res.json(sync.status());
}));

// ---------- import ----------

app.post('/api/projects/import', wrap(async (req, res) => {
  const bundle = req.body;
  if (!bundle || bundle.format !== 'seton/v1' || !bundle.project) {
    throw httpError(400, 'not a seton/v1 bundle');
  }
  const now = Date.now();
  const project = {
    id: newId(),
    name: `${bundle.project.name} (imported)`,
    defaultCanvasId: bundle.project.defaultCanvasId ?? null,
    createdAt: bundle.project.createdAt || now,
    updatedAt: now,
  };
  store.transaction(() => {
    store.createProject(project);
    for (const c of bundle.canvases || []) {
      assertId(c.id, 'canvas id');
      store.saveCanvas(project.id, c, { touch: false });
    }
    for (const d of bundle.documents || []) {
      assertId(d.id, 'document id');
      store.saveDoc(project.id, d, { touch: false });
    }
  });
  sync.schedule(project.id);
  res.status(201).json(project);
}));

// ---------- static client (production / cloud) ----------

const clientDist = path.join(ROOT, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) =>
    res.sendFile(path.join(clientDist, 'index.html')));
}

// ---------- errors ----------

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'internal error' });
});

// Exported so the desktop app (desktop/main.js) can wait for "listening" and
// read the real port — it starts us with PORT=0 to grab any free one.
export const server = app.listen(PORT, () => {
  const { port } = server.address();
  console.log(`Seton server on http://localhost:${port} (db: ${path.join(DATA_DIR, 'seton.db')})`);
  if (sync.enabled) console.log(`Drive sync: mirroring projects to ${sync.dir}`);
});
