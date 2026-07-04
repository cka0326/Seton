import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function ProjectList({ onOpen }) {
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = () =>
    api.listProjects().then(setProjects).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      onOpen(p.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const importFile = async (file) => {
    try {
      const bundle = JSON.parse(await file.text());
      const p = await api.importProject(bundle);
      onOpen(p.id);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete project "${p.name}" and all its notes? This cannot be undone.`)) return;
    await api.deleteProject(p.id);
    load();
  };

  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="logo">Seton</h1>
        <p className="tagline">Learn, revise and retain — on an infinite canvas.</p>
        {error && <div className="error">{error}</div>}

        <form className="new-project" onSubmit={create}>
          <input
            placeholder="New project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="primary">Create</button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Import a .seton.json export"
          >
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </form>

        {projects === null ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Create one above to start learning.</p>
        ) : (
          <ul className="project-cards">
            {projects.map((p) => (
              <li key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
                <div className="project-card-name">{p.name}</div>
                <div className="project-card-meta">
                  {p.canvasCount} canvas{p.canvasCount === 1 ? '' : 'es'} ·{' '}
                  {p.noteCount} note{p.noteCount === 1 ? '' : 's'} · updated{' '}
                  {new Date(p.updatedAt).toLocaleDateString()}
                </div>
                <button
                  className="ghost danger card-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
