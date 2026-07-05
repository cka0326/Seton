import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.SETON_DATA_DIR || path.join(ROOT, 'data');
const PORT = process.env.PORT || 4517;

const store = createStore(DATA_DIR);

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

// ---------- markdown generation (for exports) ----------

function canvasToMarkdown(canvas) {
  const lines = [`# ${canvas.name || 'Untitled canvas'}`, ''];
  const byId = new Map((canvas.nodes || []).map((n) => [n.id, n]));
  for (const n of canvas.nodes || []) {
    const d = n.data || {};
    lines.push(`## ${d.title || 'Untitled note'}`);
    const meta = [];
    if (d.kind && d.kind !== 'note') meta.push(`kind: ${d.kind}`);
    if (d.tags && d.tags.length) meta.push(`tags: ${d.tags.join(', ')}`);
    if (meta.length) lines.push(`*${meta.join(' · ')}*`);
    lines.push('');
    if (d.content) lines.push(d.content, '');
    const out = (canvas.edges || []).filter((e) => e.source === n.id);
    if (out.length) {
      lines.push('**Connections:**');
      for (const e of out) {
        const target = byId.get(e.target);
        const label = e.data && e.data.label ? ` — ${e.data.label}` : '';
        lines.push(`- → ${(target && target.data && target.data.title) || e.target}${label}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function projectToMarkdown(project, canvases) {
  const parts = [`# ${project.name}`, '', `_Exported ${new Date().toISOString()}_`, ''];
  for (const c of canvases) {
    parts.push('---', '', canvasToMarkdown(c));
  }
  return parts.join('\n');
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
  res.json(project);
}));

app.delete('/api/projects/:pid', wrap(async (req, res) => {
  mustProject(req.params.pid);
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
  res.json(store.saveCanvas(req.params.pid, doc));
}));

app.delete('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  mustProject(req.params.pid);
  store.deleteCanvas(req.params.pid, assertId(req.params.cid, 'canvas id'));
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
  res.json(doc);
}));

app.delete('/api/projects/:pid/documents/:did', wrap(async (req, res) => {
  mustProject(req.params.pid);
  store.deleteDoc(req.params.pid, assertId(req.params.did, 'document id'));
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
    parts.push('---', '', `# ${d.title}`, '', d.content, '');
    if ((d.highlights || []).length) {
      parts.push('## Highlights & annotations', '');
      for (const h of d.highlights) {
        parts.push(`- > ${h.quote.replace(/\s+/g, ' ')}`);
        if (h.note) parts.push(`  - ${h.note}`);
      }
      parts.push('');
    }
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

app.listen(PORT, () => {
  console.log(`Seton server on http://localhost:${PORT} (db: ${path.join(DATA_DIR, 'seton.db')})`);
});
