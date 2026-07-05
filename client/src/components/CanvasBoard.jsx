import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  useStoreApi,
  MarkerType,
  ConnectionMode,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import NoteNode from './NoteNode.jsx';
import NoteEdge from './NoteEdge.jsx';
import Inspector from './Inspector.jsx';
import NoteModal from './NoteModal.jsx';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { DEFAULT_NODE, KINDS, NODE_COLORS } from '../constants.js';
import { RecallContext } from '../contexts.js';

const nodeTypes = { note: NoteNode };
const edgeTypes = { note: NoteEdge };

const defaultEdgeOptions = {
  type: 'note',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#4a5061' },
};

const KIND_COLOR = {
  note: 'slate',
  question: 'purple',
  definition: 'blue',
  idea: 'amber',
  resource: 'teal',
};

const newId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// strip volatile React Flow runtime props so they never hit disk / git
const stripNode = ({ measured, selected, dragging, resizing, className, ...n }) => n;
const stripEdge = ({ selected, ...e }) => e;
const serialize = (nodes, edges) =>
  JSON.stringify([nodes.map(stripNode), edges.map(stripEdge)]);

function nodeMatches(node, q) {
  const d = node.data || {};
  return `${d.title || ''}\n${d.content || ''}\n${(d.tags || []).join(' ')}`
    .toLowerCase()
    .includes(q);
}

// Hierarchical auto-layout using dagre. Returns nodes with new positions.
function layoutNodes(nodes, edges, direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 55, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    g.setNode(n.id, {
      width: n.width || n.measured?.width || DEFAULT_NODE.width,
      height: n.height || n.measured?.height || DEFAULT_NODE.height,
    });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.width || n.measured?.width || DEFAULT_NODE.width;
    const h = n.height || n.measured?.height || DEFAULT_NODE.height;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

function Board({ projectId, doc, canvasName, focusRequest, onFocusHandled, theme }) {
  const [nodes, setNodes] = useState(doc.nodes || []);
  const [edges, setEdges] = useState(doc.edges || []);
  const [selNodeId, setSelNodeId] = useState(null);
  const [selEdgeId, setSelEdgeId] = useState(null);
  const [maxNodeId, setMaxNodeId] = useState(null);
  const [recall, setRecall] = useState(false);
  const [filter, setFilter] = useState('');
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error
  const rf = useReactFlow();
  const store = useStoreApi();
  const filterRef = useRef(null);

  // refs so the global key handler reads current selection without re-binding
  const selNodeIdRef = useRef(null);
  selNodeIdRef.current = selNodeId;
  const selEdgeIdRef = useRef(null);
  selEdgeIdRef.current = selEdgeId;
  const maxNodeIdRef = useRef(null);
  maxNodeIdRef.current = maxNodeId;

  const firstRun = useRef(true);
  const latest = useRef({ nodes, edges, dirty: false, name: canvasName || doc.name });
  latest.current.nodes = nodes;
  latest.current.edges = edges;
  latest.current.name = canvasName || doc.name;
  const lastSaved = useRef(serialize(doc.nodes || [], doc.edges || []));

  const persist = useCallback(async () => {
    setSaveState('saving');
    const cleanNodes = latest.current.nodes.map(stripNode);
    const cleanEdges = latest.current.edges.map(stripEdge);
    try {
      await api.saveCanvas(projectId, {
        ...doc,
        name: latest.current.name,
        nodes: cleanNodes,
        edges: cleanEdges,
      });
      lastSaved.current = JSON.stringify([cleanNodes, cleanEdges]);
      latest.current.dirty = false;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [projectId, doc]);

  // debounced autosave — skipped when only volatile props (selection,
  // measurements) changed
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (serialize(nodes, edges) === lastSaved.current) {
      if (!latest.current.dirty) return;
    }
    latest.current.dirty = true;
    setSaveState('dirty');
    const t = setTimeout(persist, 700);
    return () => clearTimeout(t);
  }, [nodes, edges, canvasName, persist]);

  // flush pending changes on unmount (canvas switch, project close)
  useEffect(() => {
    return () => {
      if (latest.current.dirty) persist();
    };
  }, [persist]);

  const onNodesChange = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns)),
    []
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((es) => applyEdgeChanges(changes, es)),
    []
  );
  const onConnect = useCallback(
    (params) =>
      setEdges((es) =>
        addEdge({ ...params, id: newId('e'), type: 'note', data: { label: '' } }, es)
      ),
    []
  );

  // React Flow v12 reports edge selection through onSelectionChange (not through
  // onEdgesChange), so this is the single source of truth for what's selected.
  const selectedRef = useRef({ nodes: [], edges: [] });
  const onSelectionChange = useCallback(({ nodes: sn, edges: se }) => {
    selectedRef.current = { nodes: sn.map((n) => n.id), edges: se.map((e) => e.id) };
    setSelNodeId(sn[0]?.id || null);
    setSelEdgeId(se[0]?.id || null);
  }, []);

  const addNoteAt = useCallback((kind, position) => {
    const id = newId('n');
    const node = {
      id,
      type: 'note',
      position,
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      selected: true,
      data: {
        title: `New ${KINDS[kind]?.label.toLowerCase() || 'note'}`,
        content: '',
        kind,
        color: KIND_COLOR[kind] || 'slate',
        fontSize: DEFAULT_NODE.fontSize,
        textAlign: DEFAULT_NODE.textAlign,
        tags: [],
      },
    };
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })).concat(node));
  }, []);

  const addNote = useCallback(
    (kind) => {
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNoteAt(kind, {
        x: center.x - DEFAULT_NODE.width / 2 + (Math.random() - 0.5) * 60,
        y: center.y - DEFAULT_NODE.height / 2 + (Math.random() - 0.5) * 60,
      });
    },
    [rf, addNoteAt]
  );

  const onPaneClick = useCallback(
    (e) => {
      if (e.detail === 2) {
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNoteAt('note', {
          x: pos.x - DEFAULT_NODE.width / 2,
          y: pos.y - DEFAULT_NODE.height / 2,
        });
      }
    },
    [rf, addNoteAt]
  );

  // Duplicate the selected note(s) with a small offset (Ctrl/Cmd+D)
  const duplicateSelection = useCallback(() => {
    const ids = new Set(selectedRef.current.nodes);
    if (!ids.size) return;
    setNodes((ns) => {
      const copies = ns
        .filter((n) => ids.has(n.id))
        .map((n) => ({
          ...n,
          id: newId('n'),
          position: { x: n.position.x + 36, y: n.position.y + 36 },
          selected: true,
          data: { ...n.data, tags: [...(n.data?.tags || [])] },
        }));
      if (!copies.length) return ns;
      return ns.map((n) => ({ ...n, selected: false })).concat(copies);
    });
  }, []);

  const autoLayout = useCallback(
    (direction = 'TB') => {
      setNodes((ns) => layoutNodes(ns, latest.current.edges, direction));
      requestAnimationFrame(() =>
        rf.fitView({ padding: 0.2, duration: 500 })
      );
    },
    [rf]
  );

  const deselectAll = useCallback(() => {
    // A focused node re-selects itself, so blur it before clearing selection.
    const active = document.activeElement;
    if (
      active &&
      active.blur &&
      (active.classList?.contains('react-flow__node') ||
        active.classList?.contains('react-flow__edge'))
    ) {
      active.blur();
    }
    // clear the store (edge selection lives only there) …
    store.getState().unselectNodesAndEdges();
    // … and our controlled node/edge state, which would otherwise re-select
    setNodes((ns) =>
      ns.some((n) => n.selected) ? ns.map((n) => ({ ...n, selected: false })) : ns
    );
    setEdges((es) =>
      es.some((e) => e.selected) ? es.map((e) => ({ ...e, selected: false })) : es
    );
    selectedRef.current = { nodes: [], edges: [] };
  }, [store]);

  // keyboard shortcuts (deletion is handled by React Flow's deleteKeyCode)
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;

      if (e.key === 'Escape') {
        if (typing) {
          el.blur();
        } else if (!maxNodeIdRef.current) {
          // let the maximized-note modal handle its own Escape
          e.stopPropagation(); // stop React Flow from re-selecting the focused node
          if (filter) setFilter('');
          deselectAll();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing) return; // let the field handle its own backspace
        const selNodes = new Set(selectedRef.current.nodes);
        const selEdges = new Set(selectedRef.current.edges);
        if (!selNodes.size && !selEdges.size) return;
        e.preventDefault();
        if (selNodes.size) {
          setNodes((ns) => ns.filter((n) => !selNodes.has(n.id)));
        }
        setEdges((es) =>
          es.filter(
            (ed) =>
              !selEdges.has(ed.id) &&
              !selNodes.has(ed.source) &&
              !selNodes.has(ed.target)
          )
        );
        selectedRef.current = { nodes: [], edges: [] };
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (typing) return;
        e.preventDefault(); // don't trigger the browser bookmark dialog
        if (selectedRef.current.nodes.length) duplicateSelection();
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'n') {
        e.preventDefault();
        addNote('note');
      } else if (e.key === '/') {
        e.preventDefault();
        filterRef.current?.focus();
      } else if (e.key === 'r') {
        setRecall((v) => !v);
      } else if (e.key === 'e' || e.key === 'Enter') {
        if (selNodeIdRef.current) setMaxNodeId(selNodeIdRef.current);
      }
    };
    // capture phase: intercept Delete/Backspace before React Flow's focusable
    // edge/node accessibility handler consumes the event
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addNote, deselectAll, duplicateSelection, filter]);

  // focus a node requested from search results
  useEffect(() => {
    if (!focusRequest) return;
    const node = latest.current.nodes.find((n) => n.id === focusRequest.nodeId);
    if (!node) return;
    const w = node.width || node.measured?.width || DEFAULT_NODE.width;
    const h = node.height || node.measured?.height || DEFAULT_NODE.height;
    // wait a frame so the pane is measured before centering
    const raf = requestAnimationFrame(() => {
      rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: 1.05,
        duration: 500,
      });
      setNodes((ns) =>
        ns.map((n) => ({ ...n, selected: n.id === focusRequest.nodeId }))
      );
      onFocusHandled?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusRequest, rf, onFocusHandled]);

  const updateNodeData = useCallback((id, patch) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    );
  }, []);

  const updateNodeDims = useCallback((id, dims) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...dims } : n)));
  }, []);

  const updateEdgeData = useCallback((id, patch) => {
    setEdges((es) =>
      es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e))
    );
  }, []);

  const deleteNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const deleteEdge = useCallback((id) => {
    setEdges((es) => es.filter((e) => e.id !== id));
  }, []);

  const q = filter.trim().toLowerCase();
  const displayNodes = useMemo(() => {
    if (!q) return nodes;
    return nodes.map((n) => ({
      ...n,
      className: nodeMatches(n, q) ? 'filter-hit' : 'filter-miss',
    }));
  }, [nodes, q]);

  const selNode = selNodeId ? nodes.find((n) => n.id === selNodeId) : null;
  const selEdge = !selNode && selEdgeId ? edges.find((e) => e.id === selEdgeId) : null;
  const maxNode = maxNodeId ? nodes.find((n) => n.id === maxNodeId) : null;

  const edgeEndpoints = useMemo(() => {
    if (!selEdge) return null;
    const s = nodes.find((n) => n.id === selEdge.source);
    const t = nodes.find((n) => n.id === selEdge.target);
    return {
      source: s?.data?.title || 'Untitled',
      target: t?.data?.title || 'Untitled',
    };
  }, [selEdge, nodes]);

  return (
    <RecallContext.Provider value={recall}>
      <div className={`board ${recall ? 'recall-mode' : ''}`}>
        <div className="board-toolbar">
          {Object.entries(KINDS).map(([k, v]) => (
            <button
              key={k}
              className="ghost"
              title={`Add ${v.label} (n adds a plain note; double-click canvas also works)`}
              onClick={() => addNote(k)}
            >
              {v.icon}<span className="btn-label"> {v.label}</span>
            </button>
          ))}
          <span className="tb-sep" />
          <button
            className="ghost"
            onClick={() => autoLayout('TB')}
            title="Auto-arrange notes into a hierarchy (top-down)"
          >
            <Icon name="layout" /><span className="btn-label"> Arrange</span>
          </button>
          <button
            className="ghost"
            onClick={() => autoLayout('LR')}
            title="Auto-arrange left-to-right"
          >
            <Icon name="layoutLR" /><span className="btn-label"> L→R</span>
          </button>
          <div className="spacer" />
          <input
            ref={filterRef}
            className="filter-input"
            placeholder="Filter this canvas… ( / )"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className={`ghost ${recall ? 'active' : ''}`}
            onClick={() => setRecall((v) => !v)}
            title="Recall mode: blur note bodies, click a note to reveal (r)"
          >
            <Icon name={recall ? 'eye' : 'eyeOff'} /><span className="btn-label"> Recall</span>
          </button>
          <a
            className="btn ghost"
            href={`/api/projects/${projectId}/canvases/${doc.id}/export.md`}
            title="Export this canvas as Markdown"
          >
            <Icon name="download" /> MD
          </a>
          <a
            className="btn ghost"
            href={`/api/projects/${projectId}/canvases/${doc.id}/export.json`}
            title="Export this canvas as JSON"
          >
            <Icon name="download" /> JSON
          </a>
          <span className={`save-state ${saveState}`}>
            {saveState === 'saved' && '● saved'}
            {saveState === 'dirty' && '● editing'}
            {saveState === 'saving' && '● saving…'}
            {saveState === 'error' && '● save failed'}
          </span>
        </div>

        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={(_e, node) => setMaxNodeId(node.id)}
          onPaneClick={onPaneClick}
          connectionMode={ConnectionMode.Loose}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift']}
          fitView
          minZoom={0.05}
          maxZoom={2.5}
          colorMode={theme}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => NODE_COLORS[n.data?.color] || '#262b36'}
            maskColor={
              theme === 'light' ? 'rgba(220, 224, 230, 0.7)' : 'rgba(10, 12, 16, 0.7)'
            }
          />
        </ReactFlow>

        {selEdge && (
          <Inspector
            edge={selEdge}
            edgeEndpoints={edgeEndpoints}
            onChangeData={(patch) => updateEdgeData(selEdge.id, patch)}
            onDelete={() => deleteEdge(selEdge.id)}
          />
        )}

        {maxNode && (
          <NoteModal
            node={maxNode}
            onChange={(patch) => updateNodeData(maxNode.id, patch)}
            onChangeDims={(dims) => updateNodeDims(maxNode.id, dims)}
            onDelete={() => deleteNode(maxNode.id)}
            onClose={() => setMaxNodeId(null)}
          />
        )}
      </div>
    </RecallContext.Provider>
  );
}

export default function CanvasBoard(props) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
