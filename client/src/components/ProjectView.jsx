import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CanvasBoard from './CanvasBoard.jsx';
import SearchPanel from './SearchPanel.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import DocumentReader from './DocumentReader.jsx';
import AddDocModal from './AddDocModal.jsx';
import Icon from './Icon.jsx';
import { DEFAULT_NODE, HL_TO_NODE_COLOR } from '../constants.js';

const newId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const slug = (s) =>
  s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export default function ProjectView({ projectId, theme, onToggleTheme, onClose, onMissing }) {
  const [project, setProject] = useState(null);
  const [activeCid, setActiveCid] = useState(null);
  const [openDocId, setOpenDocId] = useState(null); // non-null → reader view
  const [docs, setDocs] = useState([]);
  const [doc, setDoc] = useState(null); // active canvas document
  const [loadStamp, setLoadStamp] = useState(0);
  const [panel, setPanel] = useState(null); // 'search' | null
  const [stats, setStats] = useState(null);
  const [focusReq, setFocusReq] = useState(null); // {canvasId, nodeId, ts}
  const [addingDoc, setAddingDoc] = useState(false);
  const [editing, setEditing] = useState(null); // {type:'project'|'canvas'|'doc', id, value}
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

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

  const refreshDocs = useCallback(async () => {
    try {
      setDocs(await api.listDocs(projectId));
    } catch { /* non-fatal */ }
  }, [projectId]);

  const refreshStats = useCallback(async () => {
    try {
      const { canvases } = await api.getAll(projectId);
      let notes = 0, words = 0;
      for (const c of canvases) {
        for (const n of c.nodes || []) {
          notes += 1;
          words += (n.data?.content || '').split(/\s+/).filter(Boolean).length;
        }
      }
      setStats({ notes, words });
    } catch { /* non-fatal */ }
  }, [projectId]);

  useEffect(() => {
    refreshMeta().then((p) => {
      if (p && p.canvases.length > 0) setActiveCid((cid) => cid || p.canvases[0].id);
    });
    refreshDocs();
    refreshStats();
  }, [refreshMeta, refreshDocs, refreshStats]);

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

  const openCanvas = (cid) => {
    // returning from the reader refetches the canvas — "send to canvas" may
    // have added notes server-side while the board was unmounted
    if (openDocId) setLoadStamp((s) => s + 1);
    setOpenDocId(null);
    setActiveCid(cid);
  };

  const openDoc = (did) => setOpenDocId(did);

  const addCanvas = async () => {
    const c = await api.createCanvas(projectId, 'New canvas');
    await refreshMeta();
    openCanvas(c.id);
    setEditing({ type: 'canvas', id: c.id, value: c.name });
  };

  const commitEdit = async () => {
    if (!editing) return;
    const value = editing.value.trim();
    const e = editing;
    setEditing(null);
    if (!value) return;
    if (e.type === 'project' && value !== project.name) {
      await api.updateProject(projectId, { name: value });
      refreshMeta();
    } else if (e.type === 'canvas') {
      const full = await api.getCanvas(projectId, e.id);
      if (full.name === value) return;
      await api.saveCanvas(projectId, { ...full, name: value });
      await refreshMeta();
      if (e.id === activeCid && !openDocId) setLoadStamp((s) => s + 1);
    } else if (e.type === 'doc') {
      await api.saveDoc(projectId, e.id, { title: value });
      refreshDocs();
    }
  };

  // Toggle which canvas receives notes sent from the document reader.
  const setDefaultCanvas = async (c) => {
    const next = project.defaultCanvasId === c.id ? null : c.id;
    await api.updateProject(projectId, { defaultCanvasId: next });
    await refreshMeta();
    showToast(
      next
        ? `Reader notes will be added to “${c.name}”`
        : 'Default canvas cleared — notes go to the active canvas'
    );
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

  const deleteDocFromList = async (d) => {
    if (!confirm(`Delete "${d.title}" with its highlights and notes?`)) return;
    await api.deleteDoc(projectId, d.id);
    if (openDocId === d.id) setOpenDocId(null);
    refreshDocs();
  };

  const createDoc = async ({ title, content }) => {
    const created = await api.createDoc(projectId, { title, content });
    setAddingDoc(false);
    refreshDocs();
    setOpenDocId(created.id);
  };

  const jumpTo = (result) => {
    if (result.type === 'doc') {
      openDoc(result.docId);
      return;
    }
    setFocusReq({ canvasId: result.canvasId, nodeId: result.nodeId, ts: Date.now() });
    if (result.canvasId !== activeCid || openDocId) openCanvas(result.canvasId);
  };

  // Turn a highlight into a note node on the project's default canvas
  // (falling back to the active canvas, then the first one).
  const sendToCanvas = useCallback(async ({ quote, note, color, section }) => {
    const p = await api.getProject(projectId);
    const has = (id) => id && p.canvases.some((c) => c.id === id);
    const cid = [p.defaultCanvasId, activeCid, p.canvases[0]?.id].find(has);
    if (!cid) throw new Error('no canvas in this project');
    const canvas = await api.getCanvas(projectId, cid);
    const nodes = canvas.nodes || [];
    const bottom = nodes.reduce(
      (m, n) => Math.max(m, n.position.y + (n.height || DEFAULT_NODE.height)),
      0
    );
    const docTitle = docs.find((d) => d.id === openDocId)?.title || '';
    const words = quote.split(/\s+/);
    const title =
      section?.trim() ||
      words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
    const content =
      `> ${quote.trim()}` +
      (note?.trim() ? `\n\n${note.trim()}` : '') +
      (docTitle ? `\n\n— *${docTitle}*` : '');
    canvas.nodes = nodes.concat({
      id: newId('n'),
      type: 'note',
      position: { x: 0, y: bottom + 48 },
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      data: {
        title,
        content,
        kind: 'note',
        color: HL_TO_NODE_COLOR[color] || 'amber',
        fontSize: DEFAULT_NODE.fontSize,
        textAlign: 'left',
        tags: docTitle ? [slug(docTitle)] : [],
      },
    });
    await api.saveCanvas(projectId, canvas);
    refreshStats();
    const name = p.canvases.find((c) => c.id === cid)?.name || 'canvas';
    showToast(`Note added to “${name}”`);
  }, [projectId, activeCid, docs, openDocId, refreshStats, showToast]);

  // Esc closes the open Search panel; Cmd/Ctrl+F toggles it.
  useEffect(() => {
    const onKey = (e) => {
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
  }, [panel]);

  if (!project) return <div className="loading">Loading project…</div>;

  const editInput = (
    <input
      className="inline-rename"
      autoFocus
      value={editing?.value || ''}
      onChange={(e) => setEditing((ed) => ({ ...ed, value: e.target.value }))}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitEdit();
        if (e.key === 'Escape') setEditing(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-top-row">
            <button className="ghost small" onClick={onClose}>
              <Icon name="back" size={14} /> Projects
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} className="small" />
          </div>
          {editing?.type === 'project' ? (
            <div className="project-name">{editInput}</div>
          ) : (
            <h2
              className="project-name"
              onClick={() => setEditing({ type: 'project', value: project.name })}
              title="Click to rename"
            >
              {project.name}
            </h2>
          )}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <span>Canvases</span>
            <button className="ghost small" onClick={addCanvas} title="New canvas">
              <Icon name="plus" size={14} />
            </button>
          </div>
          <ul className="canvas-list">
            {project.canvases.map((c) => (
              <li
                key={c.id}
                className={c.id === activeCid && !openDocId ? 'active' : ''}
                onClick={() => openCanvas(c.id)}
              >
                <Icon name="grid" size={13} className="row-icon" />
                {editing?.type === 'canvas' && editing.id === c.id ? (
                  editInput
                ) : (
                  <span className="canvas-name">{c.name}</span>
                )}
                {project.defaultCanvasId === c.id && (
                  <span className="default-flag" title="Notes sent from the reader land here">
                    <Icon name="inbox" size={12} />
                  </span>
                )}
                <span className="canvas-count">{c.nodeCount}</span>
                <span className="canvas-actions">
                  <button
                    className={`ghost tiny ${project.defaultCanvasId === c.id ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setDefaultCanvas(c); }}
                    title={
                      project.defaultCanvasId === c.id
                        ? 'Default target for reader notes — click to clear'
                        : 'Make this the default canvas for notes sent from the reader'
                    }
                  ><Icon name="inbox" size={12} /></button>
                  <button
                    className="ghost tiny"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ type: 'canvas', id: c.id, value: c.name });
                    }}
                    title="Rename"
                  ><Icon name="pencil" size={12} /></button>
                  <button
                    className="ghost tiny"
                    onClick={(e) => { e.stopPropagation(); deleteCanvas(c); }}
                    title="Delete"
                  ><Icon name="trash" size={12} /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <span>Library</span>
            <button
              className="ghost small"
              onClick={() => setAddingDoc(true)}
              title="Add study material (paste markdown or import a file)"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          {docs.length === 0 ? (
            <p className="muted small hint">
              Paste AI-generated notes, paper summaries or docs here — then
              read, highlight and annotate them.
            </p>
          ) : (
            <ul className="canvas-list doc-list">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className={openDocId === d.id ? 'active' : ''}
                  onClick={() => openDoc(d.id)}
                  title={d.title}
                >
                  <Icon name="book" size={13} className="row-icon" />
                  {editing?.type === 'doc' && editing.id === d.id ? (
                    editInput
                  ) : (
                    <span className="canvas-name">{d.title}</span>
                  )}
                  <span
                    className={`doc-progress ${d.percent >= 100 ? 'done' : ''}`}
                    title={`${d.percent}% read · ${d.highlightCount} highlights`}
                  >
                    {d.percent >= 100 ? <Icon name="check" size={12} /> : `${d.percent}%`}
                  </span>
                  <span className="canvas-actions">
                    <button
                      className="ghost tiny"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({ type: 'doc', id: d.id, value: d.title });
                      }}
                      title="Rename"
                    ><Icon name="pencil" size={12} /></button>
                    <button
                      className="ghost tiny"
                      onClick={(e) => { e.stopPropagation(); deleteDocFromList(d); }}
                      title="Delete"
                    ><Icon name="trash" size={12} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sidebar-section">
          <button
            className={`side-btn ${panel === 'search' ? 'active' : ''}`}
            onClick={() => setPanel(panel === 'search' ? null : 'search')}
          >
            <Icon name="search" size={14} /> Search
            <span className="spacer" />
            <kbd>⌘F</kbd>
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head"><span>Export project</span></div>
          <div className="export-row">
            <a className="btn ghost small" href={`/api/projects/${projectId}/export.json`}>
              <Icon name="download" size={13} /> JSON
            </a>
            <a className="btn ghost small" href={`/api/projects/${projectId}/export.md`}>
              <Icon name="download" size={13} /> Markdown
            </a>
          </div>
        </div>

        <div className="sidebar-foot">
          {stats && (
            <div className="stats-row">
              {stats.notes} notes · {stats.words.toLocaleString()} words
              {docs.length > 0 && <> · {docs.length} doc{docs.length === 1 ? '' : 's'}</>}
            </div>
          )}
          <div className="shortcuts">
            <span><kbd>n</kbd> new note</span>
            <span><kbd>e</kbd> edit</span>
            <span><kbd>⌘D</kbd> duplicate</span>
            <span><kbd>/</kbd> filter</span>
            <span><kbd>r</kbd> recall</span>
            <span><kbd>⌘F</kbd> search</span>
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

      <main className="main">
        {openDocId ? (
          <DocumentReader
            key={openDocId}
            projectId={projectId}
            docId={openDocId}
            onBack={() => openCanvas(activeCid)}
            onDeleted={() => { setOpenDocId(null); refreshDocs(); }}
            onMetaChange={refreshDocs}
            onSendToCanvas={sendToCanvas}
          />
        ) : doc ? (
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
            theme={theme}
          />
        ) : (
          <div className="loading">Loading canvas…</div>
        )}
      </main>

      {addingDoc && (
        <AddDocModal onCreate={createDoc} onClose={() => setAddingDoc(false)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
