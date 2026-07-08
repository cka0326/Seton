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
import { NodeSizeContext, OpenSourceContext, RecallContext } from '../contexts.js';

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
// (`hidden` is only ever set by the temporary trace/filter views)
const stripNode = ({ measured, selected, dragging, resizing, className, hidden, ...n }) => n;
const stripEdge = ({ selected, ...e }) => e;
const serialize = (nodes, edges) =>
  JSON.stringify([nodes.map(stripNode), edges.map(stripEdge)]);

function nodeMatches(node, q) {
  const d = node.data || {};
  return `${d.title || ''}\n${d.content || ''}\n${(d.tags || []).join(' ')}`
    .toLowerCase()
    .includes(q);
}

const nodeSize = (n) => ({
  w: n.width || n.measured?.width || DEFAULT_NODE.width,
  h: n.height || n.measured?.height || DEFAULT_NODE.height,
});
const nodeCenter = (n) => {
  const { w, h } = nodeSize(n);
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
};

// Pick the pair of handles on the sides facing each other, so edges leave and
// enter nodes where you'd expect instead of wrapping around them.
function facingHandles(source, target) {
  const cs = nodeCenter(source);
  const ct = nodeCenter(target);
  const dx = ct.x - cs.x;
  const dy = ct.y - cs.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? dx >= 0 ? ['r', 'l'] : ['l', 'r']
    : dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

// Re-anchor all edges to the facing sides of their (re)positioned nodes.
function retargetEdges(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return e;
    const [sh, th] = facingHandles(s, t);
    if (e.sourceHandle === sh && e.targetHandle === th) return e;
    return { ...e, sourceHandle: sh, targetHandle: th };
  });
}

// Hierarchical auto-layout using dagre. Returns nodes with new positions.
function layoutNodes(nodes, edges, direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 70, ranksep: 120, marginx: 40, marginy: 40 });
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

function Board({
  projectId,
  doc,
  canvasName,
  focusRequest,
  onFocusHandled,
  onOpenSource,
  theme,
  initialViewport,
  onViewportChange,
}) {
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

  // While a temporary view (trace mode / filter results) is active this holds
  // every node's real position; the view is display-only and must never be
  // persisted, so saves map positions back through it.
  const tempSaved = useRef(null); // Map<nodeId, {x, y}> | null

  const persist = useCallback(async () => {
    setSaveState('saving');
    const saved = tempSaved.current;
    const sourceNodes = saved
      ? latest.current.nodes.map((n) =>
          saved.has(n.id) ? { ...n, position: saved.get(n.id) } : n
        )
      : latest.current.nodes;
    const cleanNodes = sourceNodes.map(stripNode);
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
    if (tempSaved.current) {
      // temporary trace/filter layout — don't autosave the moved nodes; any
      // real edits are flushed (with original positions) on exit or unmount
      latest.current.dirty = true;
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

  // Remember the pan/zoom so hopping to the reader and back (which remounts this
  // board) returns to the exact same view instead of resetting to fitView.
  const lastViewport = useRef(initialViewport || null);
  const onMove = useCallback((_e, vp) => {
    lastViewport.current = vp;
  }, []);
  useEffect(() => {
    return () => {
      if (lastViewport.current) onViewportChange?.(lastViewport.current);
    };
  }, [onViewportChange]);

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
  // Node ids are kept in the order they were selected (React Flow reports them
  // in array order), so "link selection" can chain notes the way they were picked.
  const selectedRef = useRef({ nodes: [], edges: [] });
  const [selCount, setSelCount] = useState(0);
  const onSelectionChange = useCallback(({ nodes: sn, edges: se }) => {
    const ids = new Set(sn.map((n) => n.id));
    const kept = selectedRef.current.nodes.filter((id) => ids.has(id));
    const keptSet = new Set(kept);
    const ordered = kept.concat(sn.map((n) => n.id).filter((id) => !keptSet.has(id)));
    selectedRef.current = { nodes: ordered, edges: se.map((e) => e.id) };
    setSelNodeId(sn[0]?.id || null);
    setSelEdgeId(se[0]?.id || null);
    setSelCount(sn.length);
  }, []);

  // ----- temporary views: trace mode & filter results -----------------------
  // Both views reposition/hide nodes for navigation only. Real positions are
  // captured once in tempSaved and put back by restoreLayout.

  const [trace, setTrace] = useState(null); // null | { focusId: string|null }
  const traceRef = useRef(null);
  traceRef.current = trace;
  const filterViewRef = useRef(false);

  const captureOnce = useCallback(() => {
    if (!tempSaved.current) {
      tempSaved.current = new Map(latest.current.nodes.map((n) => [n.id, n.position]));
    }
  }, []);

  const restoreLayout = useCallback(() => {
    const saved = tempSaved.current;
    tempSaved.current = null;
    filterViewRef.current = false;
    if (!saved) return;
    setNodes((ns) =>
      ns.map((n) => ({ ...n, hidden: false, position: saved.get(n.id) || n.position }))
    );
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 450 }));
  }, [rf]);

  // Show only `focusId` and its direct connections: incoming notes stacked on
  // the left, outgoing on the right, the focused note anchored at its real
  // position. Clicking a neighbor re-traces from there (see onNodeClick).
  const traceFocus = useCallback(
    (focusId) => {
      captureOnce();
      const ns = latest.current.nodes;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const focus = byId.get(focusId);
      if (!focus) return;
      const outgoing = new Set();
      const incoming = new Set();
      for (const e of latest.current.edges) {
        if (e.source === focusId && e.target !== focusId) outgoing.add(e.target);
        else if (e.target === focusId && e.source !== focusId) incoming.add(e.source);
      }
      for (const id of outgoing) incoming.delete(id); // both ways → right side

      const anchor = tempSaved.current.get(focusId) || focus.position;
      const { w: fw, h: fh } = nodeSize(focus);
      const centerY = anchor.y + fh / 2;
      const GAP = 48;
      const COL = 150; // gap between the focus card and each column
      const place = (ids, side) => {
        const arr = [...ids].map((id) => byId.get(id)).filter(Boolean);
        const total =
          arr.reduce((s, n) => s + nodeSize(n).h, 0) + GAP * Math.max(0, arr.length - 1);
        let y = centerY - total / 2;
        const pos = new Map();
        for (const n of arr) {
          const { w, h } = nodeSize(n);
          pos.set(n.id, { x: side === 'right' ? anchor.x + fw + COL : anchor.x - COL - w, y });
          y += h + GAP;
        }
        return pos;
      };
      const placed = new Map([...place(incoming, 'left'), ...place(outgoing, 'right')]);
      placed.set(focusId, anchor);

      setNodes((prev) =>
        prev.map((n) =>
          placed.has(n.id)
            ? { ...n, hidden: false, position: placed.get(n.id), selected: n.id === focusId }
            : { ...n, hidden: true, selected: false }
        )
      );
      requestAnimationFrame(() =>
        rf.fitView({
          padding: 0.3,
          duration: 450,
          nodes: [...placed.keys()].map((id) => ({ id })),
        })
      );
    },
    [captureOnce, rf]
  );

  const enterTrace = useCallback(() => {
    setFilter('');
    const start = selNodeIdRef.current;
    setTrace({ focusId: start || null });
    if (start) {
      filterViewRef.current = false; // trace takes over any filter capture
      traceFocus(start);
    } else if (filterViewRef.current) {
      restoreLayout(); // waiting for a click — show the real canvas
    }
  }, [traceFocus, restoreLayout]);

  const exitTrace = useCallback(() => {
    setTrace(null);
    restoreLayout(); // no-op when nothing was repositioned
  }, [restoreLayout]);

  // Filter results view: gather matching notes into a compact grid and hide
  // the rest — far easier to scan on large canvases than fading non-matches.
  const applyFilterView = useCallback(
    (query) => {
      captureOnce();
      filterViewRef.current = true;
      const matches = latest.current.nodes.filter((n) => nodeMatches(n, query));
      const cols = Math.max(1, Math.ceil(Math.sqrt(matches.length)));
      let cw = 0;
      let ch = 0;
      for (const n of matches) {
        const s = nodeSize(n);
        cw = Math.max(cw, s.w);
        ch = Math.max(ch, s.h);
      }
      const pos = new Map();
      matches.forEach((n, i) => {
        pos.set(n.id, { x: (i % cols) * (cw + 60), y: Math.floor(i / cols) * (ch + 60) });
      });
      setNodes((prev) =>
        prev.map((n) =>
          pos.has(n.id)
            ? { ...n, hidden: false, position: pos.get(n.id) }
            : { ...n, hidden: true }
        )
      );
      if (matches.length) {
        requestAnimationFrame(() =>
          rf.fitView({
            padding: 0.25,
            duration: 400,
            nodes: matches.map((m) => ({ id: m.id })),
          })
        );
      }
    },
    [captureOnce, rf]
  );

  const addNoteAt = useCallback((kind, position) => {
    if (traceRef.current) return; // no new notes while navigating a trace
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

  // Chain the selected notes with edges in the order they were selected
  // (first → second → third …), skipping pairs that are already connected.
  const linkSelection = useCallback(() => {
    const order = selectedRef.current.nodes;
    if (order.length < 2) return;
    const byId = new Map(latest.current.nodes.map((n) => [n.id, n]));
    setEdges((es) => {
      const linked = new Set(es.map((e) => `${e.source}→${e.target}`));
      const added = [];
      for (let i = 0; i < order.length - 1; i++) {
        const s = byId.get(order[i]);
        const t = byId.get(order[i + 1]);
        if (!s || !t) continue;
        if (linked.has(`${s.id}→${t.id}`) || linked.has(`${t.id}→${s.id}`)) continue;
        // attach to the sides facing each other so the chain reads cleanly
        const [sh, th] = facingHandles(s, t);
        linked.add(`${s.id}→${t.id}`);
        added.push({
          id: newId('e'),
          source: s.id,
          target: t.id,
          sourceHandle: sh,
          targetHandle: th,
          type: 'note',
          data: { label: '' },
        });
      }
      return added.length ? es.concat(added) : es;
    });
  }, []);

  const autoLayout = useCallback(
    (direction = 'TB') => {
      // arranging commits a real layout — leave any temporary view first so
      // the arrange isn't reverted by its restore
      if (traceRef.current) setTrace(null);
      tempSaved.current = null;
      filterViewRef.current = false;
      setFilter('');
      const laid = layoutNodes(latest.current.nodes, latest.current.edges, direction)
        .map((n) => ({ ...n, hidden: false }));
      setNodes(laid);
      // edges keep whatever anchors they were drawn with; after moving every
      // node those anchors are stale, so re-route each edge to facing sides
      setEdges((es) => retargetEdges(laid, es));
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
          return;
        }
        if (maxNodeIdRef.current) return; // maximized-note modal handles its own Escape
        e.stopPropagation(); // stop React Flow from re-selecting the focused node
        if (traceRef.current) {
          if (traceRef.current.focusId) {
            // step 1: leave the traced node, stay armed for the next click
            setTrace({ focusId: null });
            restoreLayout();
          } else {
            // step 2: leave trace mode entirely
            setTrace(null);
          }
          deselectAll();
          return;
        }
        if (filter) setFilter('');
        deselectAll();
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
          if (traceRef.current?.focusId && selNodes.has(traceRef.current.focusId)) {
            // the traced node is gone — fall back to the full canvas
            setTrace({ focusId: null });
            restoreLayout();
          }
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
      } else if (e.key === 't') {
        if (traceRef.current) exitTrace();
        else enterTrace();
      } else if (e.key === 'l') {
        linkSelection();
      } else if (e.key === 'e' || e.key === 'Enter') {
        if (selNodeIdRef.current) setMaxNodeId(selNodeIdRef.current);
      }
    };
    // capture phase: intercept Delete/Backspace before React Flow's focusable
    // edge/node accessibility handler consumes the event
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addNote, deselectAll, duplicateSelection, linkSelection, filter, enterTrace, exitTrace, restoreLayout]);

  // Focus a node requested from search results or a highlight jump. On a
  // fresh mount React Flow isn't initialized yet and its initial fitView
  // would override setCenter, so the request waits for onInit (and the
  // initial fitView is skipped — see the fitView prop below).
  const applyFocus = useCallback(
    (req) => {
      // a temporary trace/filter view would hide or misplace the target
      if (traceRef.current) setTrace(null);
      if (tempSaved.current) restoreLayout();
      // wait a frame so restored positions and pane measurements are in
      requestAnimationFrame(() => {
        const node = latest.current.nodes.find((n) => n.id === req.nodeId);
        if (!node) {
          rf.fitView({ padding: 0.2 }); // stand in for the skipped initial fit
          onFocusHandled?.();
          return;
        }
        const { w, h } = nodeSize(node);
        rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: 1.05,
          duration: 500,
        });
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === req.nodeId })));
        onFocusHandled?.();
      });
    },
    [rf, onFocusHandled, restoreLayout]
  );

  const rfReady = useRef(false);
  const pendingFocus = useRef(focusRequest);

  useEffect(() => {
    if (!focusRequest) return;
    if (rfReady.current) applyFocus(focusRequest);
    else pendingFocus.current = focusRequest;
  }, [focusRequest, applyFocus]);

  const onInit = useCallback(() => {
    rfReady.current = true;
    if (pendingFocus.current) {
      applyFocus(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, [applyFocus]);

  const updateNodeData = useCallback((id, patch) => {
    // Linked notes (data.source) stay attached: on save the server mirrors
    // title/note/color edits back to the annotation, and only detaches the
    // note if the quoted text itself was rewritten.
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

  // filter → temporary results view (debounced so it doesn't thrash per key)
  useEffect(() => {
    const t = setTimeout(() => {
      if (q) {
        if (traceRef.current) setTrace(null); // typing a filter leaves trace mode
        applyFilterView(q);
      } else if (filterViewRef.current) {
        restoreLayout();
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, applyFilterView, restoreLayout]);

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
      <OpenSourceContext.Provider value={onOpenSource || null}>
      <NodeSizeContext.Provider value={updateNodeDims}>
      <div className={`board ${recall ? 'recall-mode' : ''}`}>
        <div className="board-toolbar">
          {Object.entries(KINDS).map(([k, v]) => (
            <button
              key={k}
              className="ghost"
              title={`Add ${v.label} (n adds a plain note; double-click canvas also works)`}
              onClick={() => addNote(k)}
            >
              <Icon name={v.icon} /><span className="btn-label"> {v.label}</span>
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
          <button
            className="ghost"
            onClick={linkSelection}
            disabled={selCount < 2}
            title="Link selected notes in the order they were selected (l)"
          >
            <Icon name="link" /><span className="btn-label"> Link</span>
          </button>
          <button
            className={`ghost ${trace ? 'active' : ''}`}
            onClick={() => (trace ? exitTrace() : enterTrace())}
            title="Trace mode: click a note to see just its connections, laid out around it (t)"
          >
            <Icon name="route" /><span className="btn-label"> Trace</span>
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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onNodeClick={(e, node) => {
            // plain click walks the trace; modified clicks keep multi-select
            if (e.shiftKey || e.metaKey || e.ctrlKey) return;
            if (traceRef.current && traceRef.current.focusId !== node.id) {
              setTrace({ focusId: node.id });
              traceFocus(node.id);
            }
          }}
          onNodeDoubleClick={(_e, node) => setMaxNodeId(node.id)}
          onPaneClick={onPaneClick}
          onInit={onInit}
          onMove={onMove}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={40}
          elevateEdgesOnSelect
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift']}
          fitView={!focusRequest && !initialViewport}
          defaultViewport={initialViewport || undefined}
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

        {trace && (
          <div className="trace-banner">
            <Icon name="route" size={13} />
            {trace.focusId ? (
              <span>
                Tracing{' '}
                <strong>
                  {nodes.find((n) => n.id === trace.focusId)?.data?.title || 'note'}
                </strong>
                {' '}— in on the left, out on the right · click a note to walk · Esc to step back
              </span>
            ) : (
              <span>Trace mode — click a note to see its connections · Esc to exit</span>
            )}
          </div>
        )}

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
      </NodeSizeContext.Provider>
      </OpenSourceContext.Provider>
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
