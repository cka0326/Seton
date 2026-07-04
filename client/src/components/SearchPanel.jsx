import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SearchPanel({ projectId, activeCanvasId, onJump, onClose }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('project'); // project | canvas
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.search(projectId, query);
        setResults(r);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, projectId]);

  const visible =
    scope === 'canvas'
      ? results.filter((r) => r.canvasId === activeCanvasId)
      : results;

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <strong>Search</strong>
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <input
        autoFocus
        placeholder="Search titles, notes, tags, edge labels…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="scope-row">
        <label>
          <input
            type="radio"
            checked={scope === 'project'}
            onChange={() => setScope('project')}
          />
          Whole project
        </label>
        <label>
          <input
            type="radio"
            checked={scope === 'canvas'}
            onChange={() => setScope('canvas')}
          />
          This canvas
        </label>
      </div>
      <div className="drawer-list">
        {busy && <p className="muted small">Searching…</p>}
        {!busy && q.trim() && visible.length === 0 && (
          <p className="muted small">No matches.</p>
        )}
        {visible.map((r, i) => (
          <button
            key={`${r.canvasId}:${r.nodeId}:${i}`}
            className="result"
            onClick={() => onJump(r.canvasId, r.nodeId)}
          >
            <div className="result-title">
              {r.type === 'edge' ? '↦ ' : ''}{r.title}
            </div>
            <div className="result-snippet">{r.snippet}</div>
            <div className="result-canvas">{r.canvasName}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
