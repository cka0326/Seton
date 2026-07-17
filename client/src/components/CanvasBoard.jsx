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
import NoteModal from './NoteModal.jsx';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { DEFAULT_NODE, KINDS, NODE_COLORS } from '../constants.js';
import { EdgeNumContext, FitAllContext, NodeSizeContext, OpenSourceContext, RecallContext } from '../contexts.js';
import { fileToImage, imageFilesFromEvent, imageMarkdown } from '../lib/image.js';

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

// Undo an edge's temporary trace-mode anchoring/elevation: put the real
// handles back and drop the transient zIndex (no-op when untouched).
function untraceEdge(e, savedHandles) {
  const h = savedHandles?.get(e.id);
  if (!h && e.zIndex == null) return e;
  const { zIndex, ...rest } = e;
  return { ...rest, ...(h || {}) };
}
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

// Everything needed to fully understand `focusId` (deep trace): every note it
// feeds, transitively — and every note feeding any of those, transitively. So
// a downstream synthesis note pulls in its *other* sources too, which a
// direct-neighbor trace misses. Siblings' unrelated branches stay out:
// descendants of ancestors are not followed.
function contextClosure(focusId, edges) {
  const out = new Map();
  const inn = new Map();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
    if (!inn.has(e.target)) inn.set(e.target, []);
    inn.get(e.target).push(e.source);
  }
  const all = new Set([focusId]);
  const down = [focusId];
  while (down.length) {
    for (const t of out.get(down.pop()) || []) {
      if (!all.has(t)) {
        all.add(t);
        down.push(t);
      }
    }
  }
  const up = [...all];
  while (up.length) {
    for (const s of inn.get(up.pop()) || []) {
      if (!all.has(s)) {
        all.add(s);
        up.push(s);
      }
    }
  }
  return all;
}

// Outline numbers for every edge, from the graph itself: the k-th edge out of
// a root note is `k` (a shared counter across roots), and the k-th edge out of
// a note reached by edge `1.2` is `1.2.k` — 1, 1.1, 1.2, 1.1.1, 2, 2.1 …
// Roots are notes with no incoming edge; sibling order is connection order
// (data.createdAt, else array position). A note's number is the edge that
// first reached it; extra edges into an already-numbered note still get their
// own number under their source. Cycle-only clusters get a fresh top number.
function edgeNumbers(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const inDeg = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e, i) => {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) return;
    out.get(e.source).push({ e, ord: e.data?.createdAt ?? i });
    inDeg.set(e.target, inDeg.get(e.target) + 1);
  });
  for (const l of out.values()) l.sort((a, b) => a.ord - b.ord);

  const labels = new Map(); // edge id → '1.2.3'
  const nodeNum = new Map(); // node id → '' (root) | '1.2'
  let top = 0;
  const visit = (rootId) => {
    const q = [rootId];
    while (q.length) {
      const cur = q.shift();
      const base = nodeNum.get(cur);
      let k = 0;
      for (const { e } of out.get(cur)) {
        if (labels.has(e.id)) continue;
        const num = base ? `${base}.${++k}` : String(++top);
        labels.set(e.id, num);
        if (!nodeNum.has(e.target)) {
          nodeNum.set(e.target, num);
          q.push(e.target);
        }
      }
    }
  };
  for (const n of nodes) {
    if (!nodeNum.has(n.id) && inDeg.get(n.id) === 0 && out.get(n.id).length) {
      nodeNum.set(n.id, '');
      visit(n.id);
    }
  }
  // whatever is left unreachable from any root can only be cycles
  for (const n of nodes) {
    if (!nodeNum.has(n.id) && out.get(n.id).some(({ e }) => !labels.has(e.id))) {
      nodeNum.set(n.id, '');
      visit(n.id);
    }
  }
  return labels;
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
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target, {});
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.width || n.measured?.width || DEFAULT_NODE.width;
    const h = n.height || n.measured?.height || DEFAULT_NODE.height;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

// Bucket close-together coordinates onto the same grid line. Values within `gap`
// of the previous one share an index; a bigger jump starts a new line. Fed
// dagre's crossing-minimized centers, this snaps them into aligned rows/columns.
function clusterAxis(values, gap) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const index = new Map();
  let idx = -1;
  let prev = null;
  for (const v of sorted) {
    if (prev === null || v - prev > gap) idx++;
    index.set(v, idx);
    prev = v;
  }
  return index;
}

// Grid auto-layout: let dagre decide the ordering (it minimizes crossings), then
// snap the nodes onto a uniform grid so the result reads as a compact, balanced
// grid instead of a tall/wide hierarchy — connected notes stay close, edges stay
// mostly untangled.
function layoutGrid(nodes, edges) {
  if (nodes.length <= 1) return nodes.map((n) => ({ ...n }));
  const laid = layoutNodes(nodes, edges, 'TB');
  // uniform cell = biggest node + gap, so every row and column lines up
  let maxW = 0;
  let maxH = 0;
  for (const n of nodes) {
    const { w, h } = nodeSize(n);
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
  }
  const GAP = 56;
  const cellW = maxW + GAP;
  const cellH = maxH + GAP;
  const centers = laid.map((n) => {
    const { w, h } = nodeSize(n);
    return { id: n.id, cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
  });
  const colOf = clusterAxis(centers.map((c) => c.cx), cellW * 0.6);
  const rowOf = clusterAxis(centers.map((c) => c.cy), cellH * 0.6);
  const cells = new Map(
    centers.map((c) => [c.id, { col: colOf.get(c.cx), row: rowOf.get(c.cy) }])
  );
  // place in reading order and nudge right past any cell already taken, so two
  // notes that snapped to the same cell don't overlap
  const order = [...cells.entries()].sort(
    (a, b) => a[1].row - b[1].row || a[1].col - b[1].col
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const taken = new Set();
  const out = new Map();
  for (const [id, { row, col }] of order) {
    let c = col;
    while (taken.has(`${row}:${c}`)) c++;
    taken.add(`${row}:${c}`);
    const { w, h } = nodeSize(byId.get(id));
    out.set(id, {
      x: c * cellW + (cellW - w) / 2,
      y: row * cellH + (cellH - h) / 2,
    });
  }
  return nodes.map((n) => ({ ...n, position: out.get(n.id) || n.position }));
}

// Undirected adjacency (in edge order) over the given nodes — layout helpers
// only need structure; edge direction is untouched (edges are re-anchored to
// facing handles after any layout, preserving source → target).
function adjacency(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }
  return adj;
}

// Snowflake (radial) layout: each connected component becomes a star — its
// best-connected note in the center, the rest on rings outward by graph
// distance. Angular room is split by subtree size so branches fan out without
// tangling; components sit side by side.
function layoutSnowflake(nodes, edges) {
  if (nodes.length <= 1) return nodes.map((n) => ({ ...n }));
  const adj = adjacency(nodes, edges);
  let maxW = 0;
  let maxH = 0;
  for (const n of nodes) {
    const s = nodeSize(n);
    maxW = Math.max(maxW, s.w);
    maxH = Math.max(maxH, s.h);
  }
  const seen = new Set();
  const centers = new Map();
  let offsetX = 0;
  for (const startNode of nodes) {
    if (seen.has(startNode.id)) continue;
    const comp = [startNode.id];
    seen.add(startNode.id);
    for (let i = 0; i < comp.length; i++) {
      for (const m of adj.get(comp[i])) {
        if (!seen.has(m)) {
          seen.add(m);
          comp.push(m);
        }
      }
    }
    let root = comp[0];
    for (const id of comp) {
      if (adj.get(id).length > adj.get(root).length) root = id;
    }
    // BFS tree from the hub; extra (cycle) edges just draw across the rings
    const depth = new Map([[root, 0]]);
    const children = new Map(comp.map((id) => [id, []]));
    const levelCount = new Map([[0, 1]]);
    const bq = [root];
    while (bq.length) {
      const id = bq.shift();
      for (const m of adj.get(id)) {
        if (depth.has(m)) continue;
        depth.set(m, depth.get(id) + 1);
        levelCount.set(depth.get(m), (levelCount.get(depth.get(m)) || 0) + 1);
        children.get(id).push(m);
        bq.push(m);
      }
    }
    // ring spacing: room for the cards, and for the most crowded ring at its
    // radius (count cards on the circumference 2π·k·ring)
    let ring = Math.max(maxW, maxH) + 100;
    for (const [k, count] of levelCount) {
      if (k > 0) ring = Math.max(ring, (count * (maxW + 48)) / (2 * Math.PI * k));
    }
    const leaves = new Map();
    const countLeaves = (id) => {
      let s = 0;
      for (const k of children.get(id)) s += countLeaves(k);
      leaves.set(id, s || 1);
      return s || 1;
    };
    countLeaves(root);
    const local = new Map();
    const place = (id, a0, a1) => {
      const d = depth.get(id);
      const a = (a0 + a1) / 2;
      local.set(id, { x: Math.cos(a) * d * ring, y: Math.sin(a) * d * ring });
      let from = a0;
      for (const k of children.get(id)) {
        const span = ((a1 - a0) * leaves.get(k)) / leaves.get(id);
        place(k, from, from + span);
        from += span;
      }
    };
    place(root, -Math.PI / 2, Math.PI * 1.5); // first branch points up
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const p of local.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
    }
    for (const [id, p] of local) {
      centers.set(id, { x: p.x - minX + offsetX, y: p.y - minY });
    }
    offsetX += maxX - minX + maxW + 140;
  }
  return nodes.map((n) => {
    const c = centers.get(n.id);
    const { w, h } = nodeSize(n);
    return { ...n, position: { x: c.x - w / 2, y: c.y - h / 2 } };
  });
}

// Circle layout: every note on one ring, in depth-first order so connected
// notes sit next to each other. Arc per note follows its size, so big cards
// get more room; the radius grows until everything fits.
function layoutCircle(nodes, edges) {
  if (nodes.length <= 1) return nodes.map((n) => ({ ...n }));
  const adj = adjacency(nodes, edges);
  const order = [];
  const seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop();
      order.push(id);
      const kids = adj.get(id).filter((m) => !seen.has(m));
      for (const m of kids) seen.add(m);
      // reversed so the first connection comes off the stack first
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const arc = order.map((id) => {
    const { w, h } = nodeSize(byId.get(id));
    return Math.max(w, h) + 64;
  });
  const per = arc.reduce((s, a) => s + a, 0);
  const r = Math.max(per / (2 * Math.PI), 260);
  const pos = new Map();
  let along = 0;
  order.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * (along + arc[i] / 2)) / per;
    along += arc[i];
    const { w, h } = nodeSize(byId.get(id));
    pos.set(id, { x: Math.cos(a) * r - w / 2, y: Math.sin(a) * r - h / 2 });
  });
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) }));
}

// The auto-arrange menu ("Arrange" dropdown in the toolbar). Every layout only
// moves nodes; edges keep their source → target and are re-anchored to facing
// handles afterwards (retargetEdges), so connections and direction survive.
// Snowflake leads: it's the default arrangement, listed first in the menu.
const ARRANGE_LAYOUTS = {
  snowflake: { label: 'Snowflake', fn: layoutSnowflake },
  tb: { label: 'Hierarchy ↓', fn: (n, e) => layoutNodes(n, e, 'TB') },
  lr: { label: 'Hierarchy →', fn: (n, e) => layoutNodes(n, e, 'LR') },
  grid: { label: 'Grid', fn: layoutGrid },
  circle: { label: 'Circle', fn: layoutCircle },
};

// Center of the bounding box of a set of nodes (in flow coords).
function bboxCenter(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { w, h } = nodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
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
  const [maxNodeId, setMaxNodeId] = useState(null);
  const [recall, setRecall] = useState(false);
  const [filter, setFilter] = useState('');
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error
  const [menu, setMenu] = useState(null); // { nodeId, x, y } — node context menu
  const menuRef = useRef(null);
  menuRef.current = menu;
  const boardRef = useRef(null);
  const rf = useReactFlow();
  const store = useStoreApi();
  const filterRef = useRef(null);

  // refs so the global key handler reads current selection without re-binding
  const selNodeIdRef = useRef(null);
  selNodeIdRef.current = selNodeId;
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
  // persisted, so saves map positions back through it. Trace mode also
  // re-anchors edges for readability, so their real handles are kept the same
  // way (and the transient trace numbering is stripped).
  const tempSaved = useRef(null); // Map<nodeId, {x, y}> | null
  const tempEdgeSaved = useRef(null); // Map<edgeId, {sourceHandle, targetHandle}> | null

  const persist = useCallback(async () => {
    setSaveState('saving');
    const saved = tempSaved.current;
    const sourceNodes = saved
      ? latest.current.nodes.map((n) =>
          saved.has(n.id) ? { ...n, position: saved.get(n.id) } : n
        )
      : latest.current.nodes;
    const savedH = tempEdgeSaved.current;
    const sourceEdges = savedH
      ? latest.current.edges.map((e) => untraceEdge(e, savedH))
      : latest.current.edges;
    const cleanNodes = sourceNodes.map(stripNode);
    const cleanEdges = sourceEdges.map(stripEdge);
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
        addEdge(
          // createdAt records connection order, so trace mode can stack a
          // node's connections — and edgeNumbers can order siblings — in the
          // order they were made
          { ...params, id: newId('e'), type: 'note', data: { createdAt: Date.now() } },
          es
        )
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
    setSelCount(sn.length);

    // Grouped notes select as one (PowerPoint-style): selecting any member
    // pulls in the rest of its group, so drag/delete/duplicate treat the
    // group as a unit. Skipped in trace mode, which manages selection itself.
    if (traceRef.current) return;
    const groups = new Set(sn.map((n) => n.data?.group).filter(Boolean));
    if (!groups.size) return;
    const missing = latest.current.nodes
      .filter((n) => groups.has(n.data?.group) && !ids.has(n.id))
      .map((n) => n.id);
    if (!missing.length) return;
    const missingSet = new Set(missing);
    setNodes((ns) =>
      ns.map((n) => (missingSet.has(n.id) ? { ...n, selected: true } : n))
    );
  }, []);

  // ----- groups (issue: move nodes together, like PowerPoint) --------------
  // A group is just a shared data.group id. Selection expansion above makes
  // the group act as one; the drag handlers below cover the case where a drag
  // starts in the same gesture as the click, before the expansion lands.

  const groupSelection = useCallback(() => {
    const ids = new Set(selectedRef.current.nodes);
    if (ids.size < 2) return;
    const gid = newId('g');
    const t = Date.now();
    setNodes((ns) =>
      ns.map((n) =>
        ids.has(n.id) ? { ...n, updatedAt: t, data: { ...n.data, group: gid } } : n
      )
    );
  }, []);

  const ungroupSelection = useCallback(() => {
    const ids = new Set(selectedRef.current.nodes);
    if (!ids.size) return;
    const t = Date.now();
    setNodes((ns) =>
      ns.map((n) => {
        if (!ids.has(n.id) || !n.data?.group) return n;
        const { group, ...data } = n.data;
        return { ...n, updatedAt: t, data };
      })
    );
  }, []);

  // Group mates that React Flow isn't dragging natively (drag began before
  // the selection expanded) follow the dragged node by the same delta.
  const groupDrag = useRef(null); // { baseId, base:{x,y}, mates:[{id,pos}] } | null
  const onNodeDragStart = useCallback((_e, node, dragged) => {
    groupDrag.current = null;
    const draggedIds = new Set(dragged.map((n) => n.id));
    const groups = new Set(dragged.map((n) => n.data?.group).filter(Boolean));
    if (!groups.size) return;
    const mates = latest.current.nodes
      .filter((n) => groups.has(n.data?.group) && !draggedIds.has(n.id))
      .map((n) => ({ id: n.id, pos: { ...n.position } }));
    if (mates.length) {
      groupDrag.current = { baseId: node.id, base: { ...node.position }, mates };
    }
  }, []);
  const onNodeDrag = useCallback((_e, node) => {
    const d = groupDrag.current;
    if (!d || node.id !== d.baseId) return;
    const dx = node.position.x - d.base.x;
    const dy = node.position.y - d.base.y;
    const byId = new Map(d.mates.map((m) => [m.id, m.pos]));
    setNodes((ns) =>
      ns.map((n) => {
        const pos = byId.get(n.id);
        return pos ? { ...n, position: { x: pos.x + dx, y: pos.y + dy } } : n;
      })
    );
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
    const savedH = tempEdgeSaved.current;
    tempSaved.current = null;
    tempEdgeSaved.current = null;
    filterViewRef.current = false;
    if (savedH) setEdges((es) => es.map((e) => untraceEdge(e, savedH)));
    if (!saved) return;
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        hidden: false,
        className: undefined,
        position: saved.get(n.id) || n.position,
      }))
    );
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 450 }));
  }, [rf]);

  // Show only `focusId` and its direct connections: incoming notes stacked on
  // the left, outgoing on the right, the focused note anchored at its real
  // position. Neighbors stack in the order their connection was made (top =
  // first), and edges are temporarily re-anchored to the facing sides so every
  // link reads left→right with no wrap-around (their outline-number badges
  // stay as-is). All of it is display-only — real
  // positions and handles are restored on exit. Clicking a neighbor re-traces
  // from there (see onNodeClick).
  //
  // With `deep`, the view widens from direct connections to the full context
  // closure (contextClosure) and lays it out as a left→right hierarchy, so a
  // downstream note's other feeders show up alongside it.
  //
  // `layout` (an ARRANGE_LAYOUTS key) restyles the trace view with any of the
  // Arrange layouts — still display-only. Defaults: columns (shallow), lr (deep).
  const traceFocus = useCallback(
    (focusId, deep = false, layout = null) => {
      captureOnce();
      const ns = latest.current.nodes;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const focus = byId.get(focusId);
      if (!focus) return;
      // Focus edges in the order the connections were made — data.createdAt
      // when stamped (new edges), else array position (edges append on connect).
      const focusEdges = [];
      latest.current.edges.forEach((e, i) => {
        if ((e.source === focusId) === (e.target === focusId)) return; // untouched or self-loop
        focusEdges.push({ edge: e, ord: e.data?.createdAt ?? i });
      });
      focusEdges.sort((a, b) => a.ord - b.ord);
      const outgoing = new Set();
      const incoming = new Set();
      for (const { edge: e } of focusEdges) {
        if (e.source === focusId) outgoing.add(e.target);
        else incoming.add(e.source);
      }
      for (const id of outgoing) incoming.delete(id); // both ways → right side

      const anchor = tempSaved.current.get(focusId) || focus.position;
      const { w: fw, h: fh } = nodeSize(focus);
      const centerY = anchor.y + fh / 2;
      const GAP = 48; // vertical gap within a column
      const COLGAP = 90; // horizontal gap between columns on the same side
      const COL = 150; // gap between the focus card and the first column
      // Lay a side out as balanced columns rather than one tall stack: a note
      // with 20 connections used to become a kilometer-high column that forced
      // constant zooming. Column count targets a roughly square block per side;
      // the first connections fill the column nearest the focus, top to bottom.
      const place = (ids, side) => {
        const arr = [...ids].map((id) => byId.get(id)).filter(Boolean);
        const pos = new Map();
        if (!arr.length) return pos;
        const colW = Math.max(...arr.map((n) => nodeSize(n).w)) + COLGAP;
        const totalH = arr.reduce((s, n) => s + nodeSize(n).h + GAP, 0);
        const cols = Math.max(
          1,
          Math.min(arr.length, Math.round(Math.sqrt(totalH / colW)))
        );
        const targetH = totalH / cols;
        const columns = [];
        let cur = [];
        let curH = 0;
        for (const n of arr) {
          cur.push(n);
          curH += nodeSize(n).h + GAP;
          if (curH >= targetH && columns.length < cols - 1) {
            columns.push(cur);
            cur = [];
            curH = 0;
          }
        }
        if (cur.length) columns.push(cur);
        columns.forEach((colNodes, ci) => {
          const total =
            colNodes.reduce((s, n) => s + nodeSize(n).h, 0) +
            GAP * (colNodes.length - 1);
          let y = centerY - total / 2;
          for (const n of colNodes) {
            const { w, h } = nodeSize(n);
            // columns grow outward; left-side columns keep their focus-facing
            // edge aligned so the connections stay short and parallel
            const x =
              side === 'right'
                ? anchor.x + fw + COL + ci * colW
                : anchor.x - COL - ci * colW - w;
            pos.set(n.id, { x, y });
            y += h + GAP;
          }
        });
        return pos;
      };
      // visible set: direct neighbors, or the full context closure in deep mode
      const visibleIds = deep
        ? contextClosure(focusId, latest.current.edges)
        : new Set([focusId, ...incoming, ...outgoing]);
      const lay =
        layout && ARRANGE_LAYOUTS[layout] ? layout : deep ? 'lr' : 'columns';
      let placed;
      if (lay === 'columns') {
        placed = new Map([...place(incoming, 'left'), ...place(outgoing, 'right')]);
        placed.set(focusId, anchor);
      } else {
        // any Arrange layout, applied to just the visible notes (real
        // positions as the starting point, so clusters keep their shape) and
        // pinned so the focus card stays where it really sits
        const subset = ns
          .filter((n) => visibleIds.has(n.id))
          .map((n) => ({
            ...n,
            position: tempSaved.current.get(n.id) || n.position,
          }));
        const subEdges = latest.current.edges.filter(
          (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
        );
        const laid = ARRANGE_LAYOUTS[lay].fn(subset, subEdges);
        const laidFocus = laid.find((n) => n.id === focusId);
        const dx = anchor.x - laidFocus.position.x;
        const dy = anchor.y - laidFocus.position.y;
        placed = new Map(
          laid.map((n) => [n.id, { x: n.position.x + dx, y: n.position.y + dy }])
        );
      }

      // Re-anchor visible edges to the sides facing each other in the trace
      // layout (real handles are captured once and restored on exit). The
      // outline-number badges keep labeling them — no trace-specific numbers.
      const placedNodes = new Map(
        [...placed].map(([id, pos]) => [id, { ...byId.get(id), position: pos }])
      );
      if (!tempEdgeSaved.current) tempEdgeSaved.current = new Map();
      const savedHandles = tempEdgeSaved.current;
      setEdges((es) =>
        es.map((e) => {
          const s = placedNodes.get(e.source);
          const t = placedNodes.get(e.target);
          if (!s || !t) return untraceEdge(e, null); // hidden — drop stale badge
          if (!savedHandles.has(e.id)) {
            savedHandles.set(e.id, {
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            });
          }
          const [sh, th] = facingHandles(s, t);
          return {
            ...e,
            zIndex: 1000, // above the cards, so outer-column links stay visible
            sourceHandle: sh,
            targetHandle: th,
          };
        })
      );

      setNodes((prev) =>
        prev.map((n) =>
          placed.has(n.id)
            ? {
                ...n,
                hidden: false,
                position: placed.get(n.id),
                selected: n.id === focusId,
                className: n.id === focusId ? 'trace-focus' : undefined,
              }
            : { ...n, hidden: true, selected: false, className: undefined }
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

  const enterTrace = useCallback((deep = false) => {
    setFilter('');
    const start = selNodeIdRef.current;
    setTrace({ focusId: start || null, deep, layout: null });
    if (start) {
      filterViewRef.current = false; // trace takes over any filter capture
      traceFocus(start, deep);
    } else if (filterViewRef.current) {
      restoreLayout(); // waiting for a click — show the real canvas
    }
  }, [traceFocus, restoreLayout]);

  // Trace a specific note (context menu) — no prior selection needed.
  const traceFrom = useCallback(
    (id, deep = false) => {
      setFilter('');
      filterViewRef.current = false;
      setTrace({ focusId: id, deep, layout: null });
      traceFocus(id, deep);
    },
    [traceFocus]
  );

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
      updatedAt: Date.now(),
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

  // Paste/drop an image onto the canvas → a new note whose body is that image.
  // Sizing follows the image's aspect so it reads as a picture, not a text card.
  const addImageNode = useCallback(
    (img, screenPt) => {
      if (traceRef.current) return; // no new notes while navigating a trace
      const displayW = Math.max(180, Math.min(360, img.width));
      const bodyW = displayW - 24; // note-body horizontal padding
      const imgH = Math.max(1, Math.round(bodyW * (img.height / img.width)));
      const height = Math.round(imgH + 64); // + header + body padding
      const center = rf.screenToFlowPosition(
        screenPt || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      );
      const node = {
        id: newId('n'),
        type: 'note',
        position: { x: center.x - displayW / 2, y: center.y - height / 2 },
        width: displayW,
        height: Math.max(80, height),
        selected: true,
        updatedAt: Date.now(),
        data: {
          title: 'Image',
          content: imageMarkdown(img.src),
          kind: 'note',
          color: 'slate',
          fontSize: DEFAULT_NODE.fontSize,
          textAlign: 'center',
          tags: [],
        },
      };
      setNodes((ns) => ns.map((n) => ({ ...n, selected: false })).concat(node));
    },
    [rf]
  );

  // Paste an image anywhere on the board (not while typing or with the note
  // editor open) to drop it in as an image note (issue #24).
  useEffect(() => {
    const onPaste = async (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
        return; // editors handle their own image paste
      }
      if (maxNodeIdRef.current) return; // note editor modal is open
      const files = imageFilesFromEvent(e);
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) {
        try {
          addImageNode(await fileToImage(f));
        } catch {
          /* skip unreadable / oversized image */
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImageNode]);

  // Drag an image file from the desktop onto the board → image note at the drop
  // point (issue #24). onDragOver must allow the drop for onDrop to fire.
  const onBoardDragOver = useCallback((e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  }, []);
  const onBoardDrop = useCallback(
    async (e) => {
      const files = imageFilesFromEvent(e);
      if (!files.length) return;
      e.preventDefault();
      const pt = { x: e.clientX, y: e.clientY };
      for (const f of files) {
        try {
          addImageNode(await fileToImage(f), pt);
        } catch {
          /* skip unreadable / oversized image */
        }
      }
    },
    [addImageNode]
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

  // Duplicate the given note ids — or the selection (Ctrl/Cmd+D) — with a
  // small offset. Copies of grouped notes form their own new group(s) instead
  // of joining the original.
  const duplicateSelection = useCallback((idsArg) => {
    const ids = new Set(Array.isArray(idsArg) ? idsArg : selectedRef.current.nodes);
    if (!ids.size) return;
    const gmap = new Map();
    const mapGroup = (g) => {
      if (!g) return undefined;
      if (!gmap.has(g)) gmap.set(g, newId('g'));
      return gmap.get(g);
    };
    setNodes((ns) => {
      const copies = ns
        .filter((n) => ids.has(n.id))
        .map((n) => ({
          ...n,
          id: newId('n'),
          position: { x: n.position.x + 36, y: n.position.y + 36 },
          selected: true,
          updatedAt: Date.now(),
          data: { ...n.data, tags: [...(n.data?.tags || [])], group: mapGroup(n.data?.group) },
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
          data: { createdAt: Date.now() },
        });
      }
      return added.length ? es.concat(added) : es;
    });
  }, []);

  // Auto-arrange with `layoutFn`. When 2+ notes are selected, only those are
  // rearranged (kept where they sit, so the rest of the canvas is untouched);
  // otherwise the whole canvas is laid out.
  const runLayout = useCallback(
    (layoutFn) => {
      // arranging commits a real layout — leave any temporary view first so
      // the arrange isn't reverted by its restore (retargetEdges below picks
      // fresh anchors, so the captured trace handles are dropped too)
      if (traceRef.current) setTrace(null);
      tempSaved.current = null;
      tempEdgeSaved.current = null;
      filterViewRef.current = false;
      setFilter('');
      const allNodes = latest.current.nodes;
      const allEdges = latest.current.edges;
      const selIds = new Set(selectedRef.current.nodes);
      const useSel = selIds.size >= 2;
      const subset = useSel ? allNodes.filter((n) => selIds.has(n.id)) : allNodes;
      const subEdges = useSel
        ? allEdges.filter((e) => selIds.has(e.source) && selIds.has(e.target))
        : allEdges;
      let laid = layoutFn(subset, subEdges).map((n) => ({ ...n, hidden: false }));
      if (useSel) {
        // keep the arranged cluster centered where the user had it
        const from = bboxCenter(subset);
        const to = bboxCenter(laid);
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        laid = laid.map((n) => ({
          ...n,
          position: { x: n.position.x + dx, y: n.position.y + dy },
        }));
      }
      const laidById = new Map(laid.map((n) => [n.id, n]));
      const merged = allNodes.map((n) => laidById.get(n.id) || n);
      setNodes(merged);
      // edges keep whatever anchors they were drawn with; after moving nodes
      // those anchors are stale, so re-route each moved edge to facing sides
      // (untraceEdge drops any leftover trace-order badges first)
      setEdges((es) => retargetEdges(merged, es.map((e) => untraceEdge(e, null))));
      requestAnimationFrame(() =>
        rf.fitView({
          padding: 0.2,
          duration: 500,
          ...(useSel ? { nodes: subset.map((n) => ({ id: n.id })) } : {}),
        })
      );
    },
    [rf]
  );

  const arrange = useCallback(
    (kind) => {
      // during a focused trace, arranging restyles the trace view itself
      // (display-only, restored on exit) instead of committing a real layout
      if (traceRef.current?.focusId) {
        const t = traceRef.current;
        if (kind === 'columns' && t.deep) return; // columns is shallow-only
        const layout = kind === 'columns' ? null : kind;
        setTrace({ ...t, layout });
        traceFocus(t.focusId, t.deep, layout);
        return;
      }
      const opt = ARRANGE_LAYOUTS[kind];
      if (opt) runLayout(opt.fn);
    },
    [runLayout, traceFocus]
  );

  // Auto-size every note on the canvas to fit its content (the per-note
  // auto-fit, canvas-wide). Hidden notes aren't mounted, so any temporary
  // trace/filter view is left first; the signal fires once everything is
  // rendered again (double RAF: state commit, then layout).
  const [fitSignal, setFitSignal] = useState(null);
  const fitAll = useCallback(() => {
    if (traceRef.current) setTrace(null);
    if (tempSaved.current) restoreLayout();
    setFilter('');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFitSignal({ ts: Date.now() }))
    );
  }, [restoreLayout]);

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
      // an in-app confirm dialog owns the keyboard — don't delete nodes or
      // run shortcuts underneath it
      if (document.querySelector('.confirm-backdrop')) return;
      const el = e.target;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;

      if (e.key === 'Escape') {
        if (menuRef.current) {
          setMenu(null);
          return;
        }
        if (typing) {
          el.blur();
          return;
        }
        if (maxNodeIdRef.current) return; // maximized-note modal handles its own Escape
        e.stopPropagation(); // stop React Flow from re-selecting the focused node
        if (traceRef.current) {
          if (traceRef.current.focusId) {
            // step 1: leave the traced node, stay armed for the next click
            setTrace({ ...traceRef.current, focusId: null });
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
            setTrace({ ...traceRef.current, focusId: null });
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

      if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        if (typing) return;
        e.preventDefault(); // don't trigger the browser find-again dialog
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
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
      } else if (e.key === 'T') {
        // shift+T: deep trace — the full context of the selected note
        if (traceRef.current) exitTrace();
        else enterTrace(true);
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
  }, [addNote, deselectAll, duplicateSelection, linkSelection, groupSelection, ungroupSelection, filter, enterTrace, exitTrace, restoreLayout]);

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

  // Stamp `updatedAt` on a node whenever it's touched, so "send to canvas"
  // (in ProjectView) can drop new notes next to the last-modified one (#30).
  const stampNodes = useCallback((ids) => {
    const set = ids instanceof Set ? ids : new Set(ids);
    if (!set.size) return;
    const t = Date.now();
    setNodes((ns) => ns.map((n) => (set.has(n.id) ? { ...n, updatedAt: t } : n)));
  }, []);

  const updateNodeData = useCallback((id, patch) => {
    // Linked notes (data.source) stay attached: on save the server mirrors
    // title/note/color edits back to the annotation, and only detaches the
    // note if the quoted text itself was rewritten.
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch }, updatedAt: Date.now() } : n
      )
    );
  }, []);

  const updateNodeDims = useCallback((id, dims) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, ...dims, updatedAt: Date.now() } : n))
    );
  }, []);

  const deleteNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  // the node context menu closes on any press outside it
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.node-menu')) setMenu(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [menu]);

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

  // One toolbar toggle covers both: a selection that is exactly one whole
  // group offers Ungroup, anything else (2+ notes) offers Group.
  const selectedNodes = nodes.filter((n) => n.selected);
  const canUngroup =
    selectedNodes.length >= 2 &&
    selectedNodes.every((n) => n.data?.group) &&
    new Set(selectedNodes.map((n) => n.data.group)).size === 1;

  const selNode = selNodeId ? nodes.find((n) => n.id === selNodeId) : null;
  const maxNode = maxNodeId ? nodes.find((n) => n.id === maxNodeId) : null;
  const menuNode = menu ? nodes.find((n) => n.id === menu.nodeId) : null;

  // outline numbers, recomputed whenever the graph changes and rendered as
  // badges by NoteEdge (labels are display-only, never persisted)
  const edgeNums = useMemo(() => edgeNumbers(nodes, edges), [nodes, edges]);

  return (
    <RecallContext.Provider value={recall}>
      <OpenSourceContext.Provider value={onOpenSource || null}>
      <NodeSizeContext.Provider value={updateNodeDims}>
      <FitAllContext.Provider value={fitSignal}>
      <EdgeNumContext.Provider value={edgeNums}>
      <div
        ref={boardRef}
        className={`board ${recall ? 'recall-mode' : ''}`}
        onDrop={onBoardDrop}
        onDragOver={onBoardDragOver}
      >
        <div className="board-toolbar">
          {/* one compact picker instead of five buttons — choosing a kind adds
              that note (n / double-click still add a plain note) */}
          <label
            className="kind-add"
            title="Add a note of a chosen kind (n adds a plain note; double-click canvas also works)"
          >
            <Icon name="plus" />
            <span className="btn-label">Add</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addNote(e.target.value);
                e.target.blur();
              }}
            >
              <option value="" disabled hidden />
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <span className="tb-sep" />
          {/* one dropdown for every auto-layout — connections and edge
              direction are always preserved, only positions/anchors change */}
          <label
            className="kind-add"
            title={
              trace?.focusId
                ? 'Re-arrange the trace view (display-only — the real layout comes back on exit)'
                : 'Auto-arrange the canvas (or just the selected notes): snowflake, hierarchy, grid, circle'
            }
          >
            <Icon name="layout" />
            <span className="btn-label">Arrange</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) arrange(e.target.value);
                e.target.blur();
              }}
            >
              <option value="" disabled hidden />
              {trace?.focusId && !trace.deep && (
                <option value="columns">Trace columns</option>
              )}
              {Object.entries(ARRANGE_LAYOUTS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <button
            className="ghost"
            onClick={linkSelection}
            disabled={selCount < 2}
            title="Link selected notes in the order they were selected (l)"
          >
            <Icon name="link" /><span className="btn-label"> Link</span>
          </button>
          <button
            className={`ghost ${canUngroup ? 'active' : ''}`}
            onClick={canUngroup ? ungroupSelection : groupSelection}
            disabled={selCount < 2}
            title={
              canUngroup
                ? 'Ungroup the selected notes (⌘⇧G)'
                : 'Group selected notes so they select and move together (⌘G)'
            }
          >
            <Icon name="group" /><span className="btn-label"> {canUngroup ? 'Ungroup' : 'Group'}</span>
          </button>
          <button
            className={`ghost ${trace ? 'active' : ''}`}
            onClick={() => (trace ? exitTrace() : enterTrace())}
            title="Trace mode: click a note to see just its connections, laid out around it (t). Right-click a note for a full-context trace (⇧T)"
          >
            <Icon name="route" /><span className="btn-label"> Trace</span>
          </button>
          <button
            className="ghost"
            onClick={fitAll}
            title="Auto-size every note on the canvas to fit its content"
          >
            <Icon name="autofit" /><span className="btn-label"> Fit</span>
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
            setMenu(null);
            // plain click walks the trace; modified clicks keep multi-select
            if (e.shiftKey || e.metaKey || e.ctrlKey) return;
            if (traceRef.current && traceRef.current.focusId !== node.id) {
              const { deep, layout } = traceRef.current;
              setTrace({ focusId: node.id, deep, layout });
              traceFocus(node.id, deep, layout);
            }
          }}
          onNodeDoubleClick={(_e, node) => setMaxNodeId(node.id)}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            // right-click selects the note it hit (keeps a multi-selection)
            if (!node.selected) {
              setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === node.id })));
            }
            const rect = boardRef.current?.getBoundingClientRect();
            const x = e.clientX - (rect?.left ?? 0);
            const y = e.clientY - (rect?.top ?? 0);
            setMenu({
              nodeId: node.id,
              x: Math.max(8, Math.min(x, (rect?.width ?? x + 1) - 240)),
              y: Math.max(8, Math.min(y, (rect?.height ?? y + 1) - 240)),
            });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={(_e, _node, dragged) => {
            const ids = dragged.map((n) => n.id);
            if (groupDrag.current) {
              ids.push(...groupDrag.current.mates.map((m) => m.id));
              groupDrag.current = null;
            }
            stampNodes(ids);
          }}
          onPaneClick={onPaneClick}
          onInit={onInit}
          onMove={(e, vp) => {
            setMenu(null); // pan/zoom would leave the menu floating off-node
            onMove(e, vp);
          }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={40}
          elevateEdgesOnSelect
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift']}
          // hold Ctrl/Cmd and drag to box-select. Cmd is the working gesture on
          // the Mac app — React Flow's d3-drag filters out ctrl-mousedown as a
          // right-click, so Control only takes effect off macOS.
          selectionKeyCode={['Control', 'Meta']}
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
            <Icon name={trace.deep ? 'network' : 'route'} size={13} />
            {trace.focusId ? (
              <span>
                Tracing {trace.deep ? 'full context of ' : ''}
                <strong>
                  {nodes.find((n) => n.id === trace.focusId)?.data?.title || 'note'}
                </strong>
                {trace.deep
                  ? ' — everything it feeds, plus every note feeding those · click a note to walk · Esc to step back'
                  : ' — in on the left, out on the right · click a note to walk · Esc to step back'}
              </span>
            ) : (
              <span>
                Trace mode — click a note to see its{' '}
                {trace.deep ? 'full context' : 'connections'} · Esc to exit
              </span>
            )}
          </div>
        )}

        {menu && menuNode && (
          <div className="node-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="node-menu-title">{menuNode.data?.title || 'Untitled'}</div>
            <button
              onClick={() => {
                setMenu(null);
                setMaxNodeId(menu.nodeId);
              }}
            >
              <Icon name="pencil" size={13} /> Edit note<kbd>e</kbd>
            </button>
            {!trace && !q && (
              <button
                onClick={() => {
                  setMenu(null);
                  duplicateSelection([menu.nodeId]);
                }}
              >
                <Icon name="copy" size={13} /> Duplicate<kbd>⌘D</kbd>
              </button>
            )}
            <div className="node-menu-sep" />
            <button
              title="Show just this note and its direct connections"
              onClick={() => {
                setMenu(null);
                traceFrom(menu.nodeId, false);
              }}
            >
              <Icon name="route" size={13} /> Trace connections<kbd>t</kbd>
            </button>
            <button
              title="Show everything this note feeds, plus every note feeding those — the full picture, including a downstream note's other sources"
              onClick={() => {
                setMenu(null);
                traceFrom(menu.nodeId, true);
              }}
            >
              <Icon name="network" size={13} /> Trace full context<kbd>⇧T</kbd>
            </button>
            <div className="node-menu-sep" />
            <button
              className="danger"
              onClick={() => {
                const id = menu.nodeId;
                setMenu(null);
                if (traceRef.current?.focusId === id) {
                  setTrace({ ...traceRef.current, focusId: null });
                  restoreLayout();
                }
                deleteNode(id);
              }}
            >
              <Icon name="trash" size={13} /> Delete note<kbd>⌫</kbd>
            </button>
          </div>
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
      </EdgeNumContext.Provider>
      </FitAllContext.Provider>
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
