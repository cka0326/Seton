import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CanvasBoard from './CanvasBoard.jsx';
import SearchPanel from './SearchPanel.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import DocumentReader from './DocumentReader.jsx';
import AddDocModal from './AddDocModal.jsx';
import AiToolsModal from './AiToolsModal.jsx';
import Icon from './Icon.jsx';
import { DEFAULT_NODE, HL_TO_NODE_COLOR } from '../constants.js';
import { fmtDuration } from '../lib/time.js';
import { confirmDialog } from '../lib/confirm.js';

const newId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const slug = (s) =>
  s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

// Pick a free spot just to the right of `anchor` for a new note, nudging it down
// past anything already there so the sent note lands next to (not on top of) the
// last-modified node (issue #30).
const placeNear = (nodes, anchor) => {
  const GAP = 48;
  const w = DEFAULT_NODE.width;
  const h = DEFAULT_NODE.height;
  const x = anchor.position.x + (anchor.width || DEFAULT_NODE.width) + GAP;
  let y = anchor.position.y;
  const overlaps = (py) =>
    nodes.some((n) => {
      const nw = n.width || DEFAULT_NODE.width;
      const nh = n.height || DEFAULT_NODE.height;
      return (
        x < n.position.x + nw &&
        x + w > n.position.x &&
        py < n.position.y + nh &&
        py + h > n.position.y
      );
    });
  let guard = 0;
  while (overlaps(y) && guard++ < 200) y += h + 16;
  return { x, y };
};

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
  const [returnTo, setReturnTo] = useState(null); // {docId, scrollTop} — reading spot to go back to
  const [initScroll, setInitScroll] = useState(null); // {docId, top} — exact restore on next reader open
  const [initHl, setInitHl] = useState(null); // {docId, hlId} — open the reader at this highlight
  const readerScroll = useRef(0); // live scroll offset inside the open reader
  const canvasViewports = useRef({}); // canvasId → last {x, y, zoom}, kept across board remounts
  const [addingDoc, setAddingDoc] = useState(false);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {type:'project'|'canvas'|'doc', id, value}
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('seton:sidebarOpen') !== '0'
  );
  const [toast, setToast] = useState(null);
  const [syncInfo, setSyncInfo] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.syncStatus().then((s) => alive && setSyncInfo(s)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      localStorage.setItem('seton:sidebarOpen', v ? '0' : '1');
      return !v;
    });
  }, []);

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
    if (openDocId) {
      // remember where reading stopped so the canvas can offer a way back
      setReturnTo({ docId: openDocId, scrollTop: readerScroll.current });
      // returning from the reader refetches the canvas — "send to canvas" may
      // have added notes server-side while the board was unmounted
      setLoadStamp((s) => s + 1);
    }
    setOpenDocId(null);
    setActiveCid(cid);
  };

  const openDoc = (did, at = null) => {
    setInitScroll(at != null ? { docId: did, top: at } : null);
    setInitHl(null);
    setOpenDocId(did);
  };

  const returnToNote = () => {
    const r = returnTo;
    setReturnTo(null);
    openDoc(r.docId, r.scrollTop);
  };

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
    if (!(await confirmDialog(`Delete canvas "${c.name}" and its notes?`))) return;
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
    if (!(await confirmDialog(`Delete "${d.title}" with its highlights and notes?`))) return;
    await api.deleteDoc(projectId, d.id);
    if (openDocId === d.id) setOpenDocId(null);
    refreshDocs();
  };

  // Canvases uploaded through the AI tools panel — refresh and open the first.
  const handleImportedCanvases = async (created) => {
    setAiToolsOpen(false);
    await refreshMeta();
    refreshStats();
    if (created?.length) {
      openCanvas(created[0].id);
      showToast(
        created.length === 1
          ? `Canvas “${created[0].name}” added`
          : `${created.length} canvases added`
      );
    }
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
  // (falling back to the active canvas, then the first one). Notes remember
  // their source annotation, so re-sending updates in place and later
  // annotation edits propagate (see the document PUT handler server-side).
  const sendToCanvas = useCallback(async ({ quote, note, color, section, title: hlTitle, hlId }) => {
    const p = await api.getProject(projectId);
    const has = (id) => id && p.canvases.some((c) => c.id === id);
    const cid = [p.defaultCanvasId, activeCid, p.canvases[0]?.id].find(has);
    if (!cid) throw new Error('no canvas in this project');
    const canvas = await api.getCanvas(projectId, cid);
    const nodes = canvas.nodes || [];
    const docTitle = docs.find((d) => d.id === openDocId)?.title || '';
    const words = quote.split(/\s+/);
    const title =
      hlTitle?.trim() ||
      section?.trim() ||
      words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
    // the source doc is kept internally (data.source + tag), not in the body
    const content =
      `> ${quote.trim()}` + (note?.trim() ? `\n\n${note.trim()}` : '');
    const name = p.canvases.find((c) => c.id === cid)?.name || 'canvas';

    const existing =
      hlId &&
      nodes.find(
        (n) => n.data?.source?.hlId === hlId && n.data?.source?.docId === openDocId
      );
    if (existing) {
      existing.data = {
        ...existing.data,
        title,
        content,
        color: HL_TO_NODE_COLOR[color] || existing.data.color,
      };
      existing.updatedAt = Date.now();
      await api.saveCanvas(projectId, canvas);
      refreshStats();
      showToast(`Note updated on “${name}”`);
      return { canvasId: cid, nodeId: existing.id };
    }

    // drop the note next to the most recently touched node so it lands where
    // the user is working; fall back to stacking at the bottom-left on a canvas
    // with no timestamped nodes yet (issue #30)
    const anchor = nodes.reduce(
      (best, n) => (n.updatedAt && (!best || n.updatedAt > best.updatedAt) ? n : best),
      null
    );
    let position;
    if (anchor) {
      position = placeNear(nodes, anchor);
    } else {
      const bottom = nodes.reduce(
        (m, n) => Math.max(m, n.position.y + (n.height || DEFAULT_NODE.height)),
        0
      );
      position = { x: 0, y: bottom + 48 };
    }
    const node = {
      id: newId('n'),
      type: 'note',
      position,
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      updatedAt: Date.now(),
      data: {
        title,
        content,
        kind: 'note',
        color: HL_TO_NODE_COLOR[color] || 'amber',
        fontSize: DEFAULT_NODE.fontSize,
        textAlign: 'left',
        tags: docTitle ? [slug(docTitle)] : [],
        ...(hlId && openDocId ? { source: { docId: openDocId, hlId } } : {}),
      },
    };
    canvas.nodes = nodes.concat(node);
    await api.saveCanvas(projectId, canvas);
    refreshStats();
    showToast(`Note added to “${name}”`);
    return { canvasId: cid, nodeId: node.id };
  }, [projectId, activeCid, docs, openDocId, refreshStats, showToast]);

  // Jump from a highlight to its note on the canvas, creating the note first
  // if the highlight was never sent. openCanvas records the reading position,
  // so the "back to note" chip can restore it afterwards.
  const viewHlOnCanvas = useCallback(async (payload) => {
    const { canvases } = await api.getAll(projectId);
    let target = null;
    for (const c of canvases) {
      const n = (c.nodes || []).find(
        (nd) =>
          nd.data?.source?.hlId === payload.hlId &&
          nd.data?.source?.docId === openDocId
      );
      if (n) {
        target = { canvasId: c.id, nodeId: n.id };
        break;
      }
    }
    if (!target) target = await sendToCanvas(payload);
    setFocusReq({ canvasId: target.canvasId, nodeId: target.nodeId, ts: Date.now() });
    openCanvas(target.canvasId);
  }, [projectId, openDocId, sendToCanvas]);

  // Link icon on a canvas note → the annotation it mirrors, opened in the reader.
  const openSourceHl = useCallback((source) => {
    if (!source?.docId) return;
    if (!docs.some((d) => d.id === source.docId)) {
      showToast('The source document is no longer in this project');
      return;
    }
    setInitScroll(null);
    setInitHl({ docId: source.docId, hlId: source.hlId });
    setOpenDocId(source.docId);
  }, [docs, showToast]);

  // Esc closes the open Search panel; Cmd/Ctrl+F toggles it. Cmd/Ctrl+E hops
  // between the reader and the canvas (issue #22), restoring the reading spot.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setPanel((p) => (p === 'search' ? null : 'search'));
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        if (openDocId) openCanvas(activeCid);
        else if (returnTo && docs.some((d) => d.id === returnTo.docId)) returnToNote();
      } else if (e.key === 'Escape' && panel && !typing) {
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, toggleSidebar, openDocId, activeCid, returnTo, docs]);

  if (!project) return <div className="loading">Loading project…</div>;

  const returnDoc =
    !openDocId && returnTo ? docs.find((d) => d.id === returnTo.docId) : null;

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
      <aside className={`sidebar ${sidebarOpen ? '' : 'hidden'}`}>
        <div className="sidebar-top">
          <div className="sidebar-top-row">
            <button className="ghost small" onClick={onClose}>
              <Icon name="back" size={14} /> Projects
            </button>
            <span className="sidebar-top-actions">
              <ThemeToggle theme={theme} onToggle={onToggleTheme} className="small" />
              <button
                className="ghost small"
                onClick={toggleSidebar}
                title="Hide sidebar (⌘B)"
              >
                <Icon name="panelLeft" size={14} />
              </button>
            </span>
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
                    title={`${d.percent}% read · ${d.highlightCount} highlights${
                      d.readSeconds ? ` · ${fmtDuration(d.readSeconds)} spent` : ''
                    }`}
                  >
                    {d.percent >= 100 ? <Icon name="check" size={12} /> : `${d.percent}%`}
                  </span>
                  <span className="canvas-actions">
                    <a
                      className="btn ghost tiny"
                      href={`/api/projects/${projectId}/documents/${d.id}/export.md`}
                      onClick={(e) => e.stopPropagation()}
                      title="Download as Markdown"
                    ><Icon name="download" size={12} /></a>
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
          <button
            className={`side-btn ${aiToolsOpen ? 'active' : ''}`}
            onClick={() => setAiToolsOpen(true)}
            title="Export canvases or documents for an AI assistant, download the prompts, and upload the result"
          >
            <Icon name="sparkle" size={14} /> AI tools
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
          {syncInfo?.enabled && (
            <div
              className="stats-row sync-row"
              title={`Projects are mirrored to ${syncInfo.dir} — Google Drive keeps them backed up and synced across machines`}
            >
              <Icon name="cloud" size={12} /> Drive sync
              {syncInfo.lastSyncAt && (
                <> · {new Date(syncInfo.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
              )}
            </div>
          )}
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
            <span><kbd>⌘G</kbd> group</span>
            <span><kbd>l</kbd> link</span>
            <span><kbd>/</kbd> filter</span>
            <span><kbd>r</kbd> recall</span>
            <span><kbd>t</kbd> trace</span>
            <span><kbd>⌘F</kbd> search</span>
            <span><kbd>⌘B</kbd> sidebar</span>
            <span><kbd>⌘E</kbd> note ⇄ canvas</span>
          </div>
        </div>
      </aside>

      {!sidebarOpen && (
        <button
          className="sidebar-reveal"
          onClick={toggleSidebar}
          title="Show sidebar (⌘B)"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      )}

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
            initialScrollTop={initScroll?.docId === openDocId ? initScroll.top : null}
            focusHlId={initHl?.docId === openDocId ? initHl.hlId : null}
            scrollPosRef={readerScroll}
            onBack={() => openCanvas(activeCid)}
            onDeleted={() => { setOpenDocId(null); refreshDocs(); }}
            onMetaChange={refreshDocs}
            onSendToCanvas={sendToCanvas}
            onViewInCanvas={viewHlOnCanvas}
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
            onOpenSource={openSourceHl}
            theme={theme}
            initialViewport={canvasViewports.current[doc.id]}
            onViewportChange={(vp) => { canvasViewports.current[doc.id] = vp; }}
          />
        ) : (
          <div className="loading">Loading canvas…</div>
        )}

        {returnDoc && (
          <div className="return-chip">
            <button
              className="return-chip-btn"
              onClick={returnToNote}
              title="Reopen the note where you left off reading (⌘E)"
            >
              <Icon name="bookOpen" size={14} />
              Back to “{returnDoc.title}”
            </button>
            <button className="ghost tiny" onClick={() => setReturnTo(null)} title="Dismiss">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </main>

      {addingDoc && (
        <AddDocModal onCreate={createDoc} onClose={() => setAddingDoc(false)} />
      )}

      {aiToolsOpen && (
        <AiToolsModal
          projectId={projectId}
          canvases={project.canvases}
          docs={docs}
          onImported={handleImportedCanvases}
          onClose={() => setAiToolsOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
