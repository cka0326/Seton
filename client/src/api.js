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
  updateProject: (pid, patch) =>
    req(`/api/projects/${pid}`, { method: 'PUT', body: JSON.stringify(patch) }),
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

  listDocs: (pid) => req(`/api/projects/${pid}/documents`),
  createDoc: (pid, doc) =>
    req(`/api/projects/${pid}/documents`, {
      method: 'POST',
      body: JSON.stringify(doc),
    }),
  getDoc: (pid, did) => req(`/api/projects/${pid}/documents/${did}`),
  saveDoc: (pid, did, patch) =>
    req(`/api/projects/${pid}/documents/${did}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteDoc: (pid, did) =>
    req(`/api/projects/${pid}/documents/${did}`, { method: 'DELETE' }),

  syncStatus: () => req('/api/sync/status'),

  search: (pid, q) =>
    req(`/api/projects/${pid}/search?q=${encodeURIComponent(q)}`),
};
