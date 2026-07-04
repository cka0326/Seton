import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { isDue } from '../srs.js';
import CanvasBoard from './CanvasBoard.jsx';
import SearchPanel from './SearchPanel.jsx';
import GitPanel from './GitPanel.jsx';
import ReviewMode from './ReviewMode.jsx';

export default function ProjectView({ projectId, onClose, onMissing }) {
  const [project, setProject] = useState(null);
  const [activeCid, setActiveCid] = useState(null);
  const [doc, setDoc] = useState(null);
  const [loadStamp, setLoadStamp] = useState(0);
  const [panel, setPanel] = useState(null); // 'search' | 'git' | null
  const [reviewing, setReviewing] = useState(false);
  const [stats, setStats] = useState(null);
  const [focusReq, setFocusReq] = useState(null); // {canvasId, nodeId, ts}

  const refreshMeta = useCallback(async () => {
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      return p;
    } catch {
      onMissing();
      return null;
    }
  }, [projectId, onMissing]);

  const refreshStats = useCallback(async () => {
    try {
      const { canvases } = await api.getAll(projectId);
      let notes = 0, words = 0, cards = 0, due = 0;
      for (const c of canvases) {
        for (const n of c.nodes || []) {
          notes += 1;
          words += (n.data?.content || '').split(/\s+/).filter(Boolean).length;
          if (n.data?.flashcard) {
            cards += 1;
            if (isDue(n.data.srs)) due += 1;
          }
        }
      }
      setStats({ notes, words, cards, due });
    } catch { /* non-fatal */ }
  }, [projectId]);

  useEffect(() => {
    refreshMeta().then((p) => {
      if (p && p.canvases.length > 0) setActiveCid((cid) => cid || p.canvases[0].id);
    });
    refreshStats();
  }, [refreshMeta, refreshStats]);

  useEffect(() => {
    if (!activeCid) return;
    let cancelled = false;
    setDoc(null); // unmount the board so it always remounts with fresh data
    api.getCanvas(projectId, activeCid).then((d) => {
      if (!cancelled) setDoc(d);
    }).catch(() => setDoc(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, activeCid, loadStamp]);

  const addCanvas = async () => {
    const name = prompt('Canvas name:', 'New canvas');
    if (name === null) return;
    const c = await api.createCanvas(projectId, name);
    await refreshMeta();
    setActiveCid(c.id);
  };

  const renameCanvas = async (c) => {
    const name = prompt('Rename canvas:', c.name);
    if (!name || name === c.name) return;
    const full = await api.getCanvas(projectId, c.id);
    await api.saveCanvas(projectId, { ...full, name });
    await refreshMeta();
    if (c.id === activeCid) setLoadStamp((s) => s + 1);
  };

  const deleteCanvas = async (c) => {
    if (!confirm(`Delete canvas "${c.name}" and its notes?`)) return;
    await api.deleteCanvas(projectId, c.id);
    const p = await refreshMeta();
    if (!p) return;
    if (c.id === activeCid) {
      if (p.canvases.length > 0) setActiveCid(p.canvases[0].id);
      else {
        const nc = await api.createCanvas(projectId, 'Main');
        await refreshMeta();
        setActiveCid(nc.id);
      }
    }
  };

  const renameProject = async () => {
    const name = prompt('Rename project:', project.name);
    if (!name || name === project.name) return;
    await api.renameProject(projectId, name);
    refreshMeta();
  };

  const jumpTo = (canvasId, nodeId) => {
    setFocusReq({ canvasId, nodeId, ts: Date.now() });
    if (canvasId !== activeCid) setActiveCid(canvasId);
  };

  const onRestored = (restoredDoc) => {
    refreshMeta();
    if (restoredDoc.id === activeCid) setLoadStamp((s) => s + 1);
  };

  const closeReview = (reviewed) => {
    setReviewing(false);
    if (reviewed > 0) {
      setLoadStamp((s) => s + 1); // reload canvas: srs data changed on disk
      api.gitCommit(projectId, `Review session: ${reviewed} card(s)`).catch(() => {});
    }
    refreshStats();
  };

  // Esc closes an open side panel (Search / History); Cmd/Ctrl+F opens Search.
  // The canvas board and the review overlay handle their own Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (reviewing) return;
      const el = e.target;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setPanel((p) => (p === 'search' ? null : 'search'));
      } else if (e.key === 'Escape' && panel && !typing) {
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, reviewing]);

  if (!project) return <div className="loading">Loading project…</div>;

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="ghost small" onClick={onClose}>← Projects</button>
          <h2 className="project-name" onClick={renameProject} title="Click to rename">
            {project.name}
          </h2>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <span>Canvases</span>
            <button className="ghost small" onClick={addCanvas} title="New canvas">＋</button>
          </div>
          <ul className="canvas-list">
            {project.canvases.map((c) => (
              <li
                key={c.id}
                className={c.id === activeCid ? 'active' : ''}
                onClick={() => setActiveCid(c.id)}
              >
                <span className="canvas-name">{c.name}</span>
                <span className="canvas-count">{c.nodeCount}</span>
                <span className="canvas-actions">
                  <button
                    className="ghost tiny"
                    onClick={(e) => { e.stopPropagation(); renameCanvas(c); }}
                    title="Rename"
                  >✎</button>
                  <button
                    className="ghost tiny"
                    onClick={(e) => { e.stopPropagation(); deleteCanvas(c); }}
                    title="Delete"
                  >🗑</button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-section">
          <button
            className={`side-btn ${panel === 'search' ? 'active' : ''}`}
            onClick={() => setPanel(panel === 'search' ? null : 'search')}
          >
            🔍 Search
          </button>
          <button className="side-btn" onClick={() => { setReviewing(true); }}>
            🎴 Review
            {stats && stats.due > 0 && <span className="badge">{stats.due}</span>}
          </button>
          <button
            className={`side-btn ${panel === 'git' ? 'active' : ''}`}
            onClick={() => setPanel(panel === 'git' ? null : 'git')}
          >
            🕘 History
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head"><span>Export project</span></div>
          <div className="export-row">
            <a className="btn ghost small" href={`/api/projects/${projectId}/export.json`}>
              ⬇ JSON
            </a>
            <a className="btn ghost small" href={`/api/projects/${projectId}/export.md`}>
              ⬇ Markdown
            </a>
          </div>
        </div>

        <div className="sidebar-foot">
          {stats && (
            <>
              <div>{stats.notes} notes · {stats.words} words</div>
              <div>
                {stats.cards} flashcards
                {stats.cards > 0 && <> · <strong>{stats.due} due</strong></>}
              </div>
            </>
          )}
          <div className="muted tiny-text">
            n new · e/dbl-click expand · Del delete · Esc deselect · / filter ·
            r recall · ⌘F search · drag handle→handle to link
          </div>
        </div>
      </aside>

      {panel === 'search' && (
        <SearchPanel
          projectId={projectId}
          activeCanvasId={activeCid}
          onJump={jumpTo}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'git' && (
        <GitPanel
          projectId={projectId}
          activeCanvasId={activeCid}
          onRestored={onRestored}
          onClose={() => setPanel(null)}
        />
      )}

      <main className="main">
        {doc ? (
          <CanvasBoard
            key={`${doc.id}:${loadStamp}`}
            projectId={projectId}
            doc={doc}
            canvasName={project.canvases.find((c) => c.id === doc.id)?.name || doc.name}
            focusRequest={
              focusReq && focusReq.canvasId === doc.id
                ? { nodeId: focusReq.nodeId, ts: focusReq.ts }
                : null
            }
            onFocusHandled={() => setFocusReq(null)}
          />
        ) : (
          <div className="loading">Loading canvas…</div>
        )}
      </main>

      {reviewing && <ReviewMode projectId={projectId} onClose={closeReview} />}
    </div>
  );
}
