// Turn a library document into canvas nodes/edges: one note per section or
// sub-section (split at ATX headings, fence-aware), connected as the outline
// tree — every topic links to each of its subtopics, recursively. Sibling
// order follows the document; no other structure is inferred. The layout
// mirrors the outline: reading order top-to-bottom, one column of indent per
// tree level.

const newId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Split markdown into { depth, title, body } sections. Heading-looking lines
// inside fenced code blocks don't split. The text before the first heading
// becomes a depth-0 preamble section (dropped later when empty).
export function splitSections(md) {
  const sections = [{ depth: 0, title: '', body: [] }];
  let fence = null;
  for (const line of (md || '').split('\n')) {
    if (fence) {
      sections[sections.length - 1].body.push(line);
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence = null;
      }
      continue;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      sections[sections.length - 1].body.push(line);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) sections.push({ depth: h[1].length, title: h[2].trim(), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  return sections;
}

// Rough card height for a section body so the stacked layout doesn't overlap:
// text wraps at ~44 chars per line at the default width/font.
function estimateHeight(content) {
  let lines = 0;
  for (const block of content.split('\n')) {
    lines += Math.max(1, Math.ceil(block.length / 44));
  }
  return Math.max(110, Math.min(460, 64 + lines * 19));
}

// Parent of each part: the nearest preceding section with a shallower heading
// level. Also assigns `col`, the tree depth (root = 0) — used for indentation,
// it absorbs skipped heading levels (an h3 right under an h1 indents once).
function buildTree(parts) {
  const stack = [];
  for (const p of parts) {
    while (stack.length && stack[stack.length - 1].depth >= p.depth) stack.pop();
    p.parent = stack.length ? stack[stack.length - 1] : null;
    p.col = stack.length;
    stack.push(p);
  }
}

// Build the canvas for a document. Returns { nodes, edges } — empty when the
// document has no content at all.
export function outlineCanvas(doc, tag) {
  const sections = splitSections(doc.content);
  const docTitle = (doc.title || 'Untitled').replace(/[*_`]/g, '').slice(0, 120);
  const parts = [];
  for (const s of sections) {
    const content = s.body.join('\n').trim();
    if (!s.title && !content) continue; // empty preamble (or blank doc)
    parts.push({
      depth: s.depth, // preamble keeps 0 so it roots the tree
      title: (s.title || docTitle).replace(/[*_`]/g, '').slice(0, 120),
      content,
    });
  }
  if (!parts.length) return { nodes: [], edges: [] };

  buildTree(parts);
  // several top-level sections and no preamble → add a title note as the
  // root, so the canvas is one connected tree instead of a forest
  if (parts.filter((p) => !p.parent).length > 1) {
    parts.unshift({ depth: 0, title: docTitle, content: '' });
    buildTree(parts);
  }

  const WIDTH = 300;
  const COLW = 340; // indent per outline level
  const GAP = 40;
  const now = Date.now();
  let y = 0;
  const nodes = parts.map((p) => {
    const height = estimateHeight(p.content);
    p.node = {
      id: newId('n'),
      type: 'note',
      position: { x: p.col * COLW, y },
      width: WIDTH,
      height,
      updatedAt: now,
      data: {
        title: p.title,
        content: p.content,
        kind: 'note',
        color: 'slate',
        fontSize: 14,
        textAlign: 'left',
        tags: tag ? [tag] : [],
      },
    };
    y += height + GAP;
    return p.node;
  });

  // topic → subtopic, recursively; createdAt ascends in document order so
  // trace mode numbers a topic's subtopics as they appear in the outline
  const edges = parts
    .filter((p) => p.parent)
    .map((p, i) => ({
      id: newId('e'),
      source: p.parent.node.id,
      target: p.node.id,
      // the child sits below and one column right of its topic — leave from
      // the bottom, arrive at the left side, like an outline connector
      sourceHandle: 'b',
      targetHandle: 'l',
      type: 'note',
      data: { createdAt: now + i },
    }));
  return { nodes, edges };
}
