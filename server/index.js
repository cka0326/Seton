import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.SETON_DATA_DIR || path.join(ROOT, 'data');
const PORT = process.env.PORT || 4517;

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const ID_RE = /^[a-z0-9-]+$/i;
const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function assertId(id, kind = 'id') {
  if (!id || !ID_RE.test(id)) {
    const err = new Error(`invalid ${kind}`);
    err.status = 400;
    throw err;
  }
  return id;
}

const projDir = (pid) => path.join(DATA_DIR, assertId(pid, 'project id'));
const canvasFile = (pid, cid) =>
  path.join(projDir(pid), 'canvases', `${assertId(cid, 'canvas id')}.json`);
const markdownFile = (pid, cid) =>
  path.join(projDir(pid), 'markdown', `${assertId(cid, 'canvas id')}.md`);

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
// atomic write: never let a concurrent read see a half-written file
async function writeFileAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}
async function writeJSON(file, obj) {
  await writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

async function loadProject(pid) {
  const file = path.join(projDir(pid), 'project.json');
  if (!existsSync(file)) {
    const err = new Error('project not found');
    err.status = 404;
    throw err;
  }
  return readJSON(file);
}

async function listCanvases(pid) {
  const dir = path.join(projDir(pid), 'canvases');
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  const docs = await Promise.all(files.map((f) => readJSON(path.join(dir, f))));
  docs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return docs;
}

// ---------- markdown generation (readable mirror of each canvas) ----------

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

async function saveCanvas(pid, doc) {
  doc.updatedAt = Date.now();
  await writeJSON(canvasFile(pid, doc.id), doc);
  await writeFileAtomic(markdownFile(pid, doc.id), canvasToMarkdown(doc));
  const project = await loadProject(pid);
  project.updatedAt = Date.now();
  await writeJSON(path.join(projDir(pid), 'project.json'), project);
  return doc;
}

// ---------- async route helper ----------

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- projects ----------

app.get('/api/projects', wrap(async (_req, res) => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const projects = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(DATA_DIR, e.name, 'project.json');
    if (!existsSync(file)) continue;
    const p = await readJSON(file);
    const canvases = await listCanvases(p.id);
    projects.push({
      ...p,
      canvasCount: canvases.length,
      noteCount: canvases.reduce((s, c) => s + (c.nodes || []).length, 0),
    });
  }
  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(projects);
}));

app.post('/api/projects', wrap(async (req, res) => {
  const name = (req.body.name || '').trim() || 'Untitled project';
  const id = newId();
  const dir = projDir(id);
  await fs.mkdir(path.join(dir, 'canvases'), { recursive: true });
  await fs.mkdir(path.join(dir, 'markdown'), { recursive: true });
  const now = Date.now();
  const project = { id, name, createdAt: now, updatedAt: now };
  await writeJSON(path.join(dir, 'project.json'), project);

  const canvas = {
    id: newId(),
    name: 'Main',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  };
  await writeJSON(canvasFile(id, canvas.id), canvas);
  await fs.writeFile(markdownFile(id, canvas.id), canvasToMarkdown(canvas), 'utf8');

  res.status(201).json(project);
}));

app.get('/api/projects/:pid', wrap(async (req, res) => {
  const project = await loadProject(req.params.pid);
  const canvases = (await listCanvases(req.params.pid)).map((c) => ({
    id: c.id,
    name: c.name,
    updatedAt: c.updatedAt,
    nodeCount: (c.nodes || []).length,
  }));
  res.json({ ...project, canvases });
}));

app.put('/api/projects/:pid', wrap(async (req, res) => {
  const project = await loadProject(req.params.pid);
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    project.name = req.body.name.trim();
  }
  project.updatedAt = Date.now();
  await writeJSON(path.join(projDir(req.params.pid), 'project.json'), project);
  res.json(project);
}));

app.delete('/api/projects/:pid', wrap(async (req, res) => {
  await loadProject(req.params.pid);
  await fs.rm(projDir(req.params.pid), { recursive: true, force: true });
  res.json({ ok: true });
}));

app.get('/api/projects/:pid/all', wrap(async (req, res) => {
  const project = await loadProject(req.params.pid);
  const canvases = await listCanvases(req.params.pid);
  res.json({ project, canvases });
}));

// ---------- canvases ----------

app.post('/api/projects/:pid/canvases', wrap(async (req, res) => {
  await loadProject(req.params.pid);
  const now = Date.now();
  const canvas = {
    id: newId(),
    name: (req.body.name || '').trim() || 'Untitled canvas',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  };
  await saveCanvas(req.params.pid, canvas);
  res.status(201).json(canvas);
}));

app.get('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  res.json(await readJSON(canvasFile(req.params.pid, req.params.cid)));
}));

app.put('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  const doc = req.body;
  if (!doc || doc.id !== req.params.cid) {
    const err = new Error('canvas id mismatch');
    err.status = 400;
    throw err;
  }
  res.json(await saveCanvas(req.params.pid, doc));
}));

app.delete('/api/projects/:pid/canvases/:cid', wrap(async (req, res) => {
  await fs.rm(canvasFile(req.params.pid, req.params.cid), { force: true });
  await fs.rm(markdownFile(req.params.pid, req.params.cid), { force: true });
  res.json({ ok: true });
}));

// ---------- search ----------

app.get('/api/projects/:pid/search', wrap(async (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (!q) return res.json([]);
  const canvases = await listCanvases(req.params.pid);
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
  res.json(results.slice(0, 100));
}));

// ---------- export ----------

function download(res, filename, mime, body) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

app.get('/api/projects/:pid/export.json', wrap(async (req, res) => {
  const project = await loadProject(req.params.pid);
  const canvases = await listCanvases(req.params.pid);
  download(
    res,
    `${project.name.replace(/[^\w-]+/g, '_')}.seton.json`,
    'application/json',
    JSON.stringify({ format: 'seton/v1', project, canvases }, null, 2)
  );
}));

app.get('/api/projects/:pid/export.md', wrap(async (req, res) => {
  const project = await loadProject(req.params.pid);
  const canvases = await listCanvases(req.params.pid);
  download(
    res,
    `${project.name.replace(/[^\w-]+/g, '_')}.md`,
    'text/markdown',
    projectToMarkdown(project, canvases)
  );
}));

app.get('/api/projects/:pid/canvases/:cid/export.json', wrap(async (req, res) => {
  const doc = await readJSON(canvasFile(req.params.pid, req.params.cid));
  download(res, `${doc.name.replace(/[^\w-]+/g, '_')}.canvas.json`,
    'application/json', JSON.stringify(doc, null, 2));
}));

app.get('/api/projects/:pid/canvases/:cid/export.md', wrap(async (req, res) => {
  const doc = await readJSON(canvasFile(req.params.pid, req.params.cid));
  download(res, `${doc.name.replace(/[^\w-]+/g, '_')}.md`,
    'text/markdown', canvasToMarkdown(doc));
}));

// ---------- import ----------

app.post('/api/projects/import', wrap(async (req, res) => {
  const bundle = req.body;
  if (!bundle || bundle.format !== 'seton/v1' || !bundle.project) {
    const err = new Error('not a seton/v1 bundle');
    err.status = 400;
    throw err;
  }
  const id = newId();
  const dir = projDir(id);
  await fs.mkdir(path.join(dir, 'canvases'), { recursive: true });
  await fs.mkdir(path.join(dir, 'markdown'), { recursive: true });
  const now = Date.now();
  const project = { ...bundle.project, id, name: `${bundle.project.name} (imported)`, updatedAt: now };
  await writeJSON(path.join(dir, 'project.json'), project);
  for (const c of bundle.canvases || []) {
    await writeJSON(canvasFile(id, assertId(c.id, 'canvas id')), c);
    await fs.writeFile(markdownFile(id, c.id), canvasToMarkdown(c), 'utf8');
  }
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
  console.log(`Seton server on http://localhost:${PORT} (data: ${DATA_DIR})`);
});
