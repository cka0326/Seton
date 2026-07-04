async function req(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  listProjects: () => req('/api/projects'),
  createProject: (name) =>
    req('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (pid) => req(`/api/projects/${pid}`),
  renameProject: (pid, name) =>
    req(`/api/projects/${pid}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteProject: (pid) => req(`/api/projects/${pid}`, { method: 'DELETE' }),
  getAll: (pid) => req(`/api/projects/${pid}/all`),
  importProject: (bundle) =>
    req('/api/projects/import', { method: 'POST', body: JSON.stringify(bundle) }),

  createCanvas: (pid, name) =>
    req(`/api/projects/${pid}/canvases`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  getCanvas: (pid, cid) => req(`/api/projects/${pid}/canvases/${cid}`),
  saveCanvas: (pid, doc) =>
    req(`/api/projects/${pid}/canvases/${doc.id}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    }),
  deleteCanvas: (pid, cid) =>
    req(`/api/projects/${pid}/canvases/${cid}`, { method: 'DELETE' }),

  search: (pid, q) =>
    req(`/api/projects/${pid}/search?q=${encodeURIComponent(q)}`),

  gitLog: (pid) => req(`/api/projects/${pid}/git/log`),
  gitStatus: (pid) => req(`/api/projects/${pid}/git/status`),
  gitCommit: (pid, message) =>
    req(`/api/projects/${pid}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  gitCanvasAt: (pid, cid, rev) =>
    req(`/api/projects/${pid}/git/canvas/${cid}?rev=${rev}`),
  gitRestore: (pid, cid, rev) =>
    req(`/api/projects/${pid}/git/restore`, {
      method: 'POST',
      body: JSON.stringify({ cid, rev }),
    }),
};
