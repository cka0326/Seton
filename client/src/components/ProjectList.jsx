import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';
import Icon from './Icon.jsx';
import { confirmDialog } from '../lib/confirm.js';

export default function ProjectList({ onOpen, theme, onToggleTheme }) {
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
    if (!(await confirmDialog(`Delete project "${p.name}" and all its notes? This cannot be undone.`))) return;
    await api.deleteProject(p.id);
    load();
  };

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-top">
          <h1 className="logo">Seton</h1>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <p className="tagline">
          Your second brain for technical learning — read, highlight, connect.
        </p>
        <div className="home-features muted small">
          <span><Icon name="book" size={13} /> Paste notes &amp; papers into a readable library</span>
          <span><Icon name="highlighter" size={13} /> Highlight &amp; annotate while you study</span>
          <span><Icon name="grid" size={13} /> Map concepts on an infinite canvas</span>
        </div>
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
            <Icon name="upload" size={14} /> Import
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
                  {p.noteCount} note{p.noteCount === 1 ? '' : 's'}
                  {p.docCount > 0 && <> · {p.docCount} doc{p.docCount === 1 ? '' : 's'}</>}
                  {' '}· updated {new Date(p.updatedAt).toLocaleDateString()}
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
