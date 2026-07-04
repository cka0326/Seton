import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function GitPanel({ projectId, activeCanvasId, onRestored, onClose }) {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([
        api.gitLog(projectId),
        api.gitStatus(projectId),
      ]);
      setLog(l);
      setStatus(s);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commit = async () => {
    setBusy(true);
    try {
      await api.gitCommit(projectId, message);
      setMessage('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (c) => {
    if (
      !confirm(
        `Restore the current canvas to snapshot "${c.message}" (${c.shortHash})?\n\nCurrent state is committed first, so nothing is lost.`
      )
    )
      return;
    setBusy(true);
    try {
      await api.gitCommit(projectId, 'Before restore');
      const r = await api.gitRestore(projectId, activeCanvasId, c.hash);
      onRestored(r.canvas);
      await refresh();
    } catch (e) {
      setError(`Restore failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <strong>History (git)</strong>
        <button className="ghost" onClick={onClose}>✕</button>
      </div>

      {error && <div className="error small">{error}</div>}

      <div className="commit-box">
        <input
          placeholder="Snapshot message (optional)…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <button className="primary" disabled={busy} onClick={commit}>
          Commit
        </button>
      </div>
      {status && (
        <p className="muted small">
          {status.dirty
            ? `${status.changed.length} file(s) changed since last snapshot`
            : 'Everything committed ✓'}
        </p>
      )}

      <div className="drawer-list">
        {log.map((c) => (
          <div key={c.hash} className="commit">
            <div className="commit-msg">{c.message}</div>
            <div className="commit-meta">
              <code>{c.shortHash}</code> · {new Date(c.date).toLocaleString()}
            </div>
            <button
              className="ghost small"
              disabled={busy}
              onClick={() => restore(c)}
              title="Restore the currently open canvas to this snapshot"
            >
              ⟲ Restore canvas to this point
            </button>
          </div>
        ))}
        {log.length === 0 && <p className="muted small">No commits yet.</p>}
      </div>
    </aside>
  );
}
