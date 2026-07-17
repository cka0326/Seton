// Text anchoring for reader highlights.
//
// A highlight is stored as { start, quote, prefix, suffix } where `start` is
// the character offset into the reader container's textContent. Offsets are
// stable because the same markdown renders to the same text; if the document
// is edited, the quote + surrounding context is used to re-locate the
// highlight, so most marks survive edits elsewhere in the text.

const CONTEXT = 32;

// Structural blocks that should come out whole when a selection touches them —
// a few highlighted cells are useless without the rest of the table.
const SNAP = 'table, pre, ul, ol, blockquote';
// Anything whose formatting a plain-text quote would lose.
const RICH =
  'table, pre, img, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, hr, strong, em, del, code, a';

// Innermost element carrying data-srcpos at a range endpoint, expanded to the
// outermost structural block so tables/lists/code fences are captured whole.
function srcposAt(container, offset, root, side) {
  let node = container;
  // element endpoints (triple-click) point between children — step onto the
  // child actually inside the selection
  if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length) {
    const i = Math.min(
      side === 'end' ? Math.max(offset - 1, 0) : offset,
      node.childNodes.length - 1
    );
    node = node.childNodes[i] || node;
  }
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  el = el?.closest?.('[data-srcpos]') || null;
  if (!el || !root.contains(el)) return null;
  for (let cur = el.parentElement; cur && cur !== root; cur = cur.parentElement) {
    if (cur.matches?.(SNAP) && cur.hasAttribute('data-srcpos')) el = cur;
  }
  return el;
}

// Markdown-source slice covering the selection, or null when the plain quote
// is already faithful (text-only selection) or positions are unavailable.
// Requires the content to be rendered with <Markdown sourcePos>.
function markdownQuote(root, range, source) {
  if (!source) return null;
  const a = srcposAt(range.startContainer, range.startOffset, root, 'start');
  const b = srcposAt(range.endContainer, range.endOffset, root, 'end');
  if (!a || !b) return null;
  // formatting inside the selection, or an endpoint inside a structural block
  // (a partial code-block selection clones as bare text) → plain text lies
  const rich =
    range.cloneContents().querySelector(RICH) || a.matches(SNAP) || b.matches(SNAP);
  if (!rich) return null;
  const [s1, e1] = a.dataset.srcpos.split('-').map(Number);
  const [s2, e2] = b.dataset.srcpos.split('-').map(Number);
  const start = Math.min(s1, s2);
  const end = Math.max(e1, e2);
  if (!(end > start) || end > source.length) return null;
  const md = source.slice(start, end).trim();
  return md && md !== range.toString().trim() ? md : null;
}

function textNodesIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Describe the current DOM selection relative to `root`.
// Returns null when the selection is collapsed or escapes the root.
// When the markdown `source` is given (and the content was rendered with
// <Markdown sourcePos>), also returns `quoteMd` — the exact source slice —
// whenever the plain-text quote would lose formatting.
export function describeSelection(root, source) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  let start = -1;
  let end = -1;
  let offset = 0;
  for (const node of textNodesIn(root)) {
    if (node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) end = offset + range.endOffset;
    offset += node.textContent.length;
  }
  // selection endpoints can be element nodes (e.g. triple-click); fall back
  // to measuring a clone of the range
  if (start === -1 || end === -1) {
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    start = pre.toString().length;
    end = start + range.toString().length;
  }
  if (end <= start) return null;

  let quoteMd = null;
  try {
    quoteMd = markdownQuote(root, range, source);
  } catch {
    // srcpos mapping is best-effort — never let it break highlighting
  }

  const text = root.textContent;
  return {
    start,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    rect: range.getBoundingClientRect(),
    quoteMd,
  };
}

// Find the character range of a stored highlight in the current text.
// Tries the exact stored offset first, then re-locates by quote with
// prefix/suffix scoring (handles edited documents and repeated phrases).
export function locate(text, hl) {
  const { start, quote, prefix = '', suffix = '' } = hl;
  if (!quote) return null;
  if (text.slice(start, start + quote.length) === quote) {
    return { start, end: start + quote.length };
  }
  let best = null;
  let bestScore = -1;
  let idx = text.indexOf(quote);
  while (idx !== -1) {
    let score = 0;
    if (prefix && text.slice(Math.max(0, idx - prefix.length), idx) === prefix) score += 2;
    if (suffix && text.slice(idx + quote.length, idx + quote.length + suffix.length) === suffix) score += 2;
    score -= Math.abs(idx - start) / Math.max(text.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = { start: idx, end: idx + quote.length };
    }
    idx = text.indexOf(quote, idx + 1);
  }
  return best;
}

// Wrap the character range [start, end) in <mark> elements — one per
// intersected text node so highlights can span block boundaries.
function wrapRange(root, start, end, makeMark) {
  const nodes = textNodesIn(root);
  let offset = 0;
  for (const node of nodes) {
    const len = node.textContent.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    if (!node.parentNode) continue;
    // never wrap text inside an existing mark twice — split marks stack fine,
    // but skipping keeps the DOM shallow when highlights overlap
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(len, end - nodeStart);
    if (localEnd <= localStart) continue;

    let target = node;
    if (localStart > 0) target = target.splitText(localStart);
    if (localEnd - localStart < target.textContent.length) {
      target.splitText(localEnd - localStart);
    }
    const mark = makeMark();
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

// (Re)paint all highlights inside root. Existing marks are unwrapped first,
// so this is safe to run whenever the highlight list changes.
export function paintHighlights(root, highlights) {
  for (const mark of [...root.querySelectorAll('mark[data-hl]')]) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
  if (!highlights.length) return;

  const text = root.textContent;
  // paint in reverse offset order so earlier splits don't shift later ranges
  const located = highlights
    .map((hl) => ({ hl, range: locate(text, hl) }))
    .filter((x) => x.range)
    .sort((a, b) => b.range.start - a.range.start);

  for (const { hl, range } of located) {
    wrapRange(root, range.start, range.end, () => {
      const mark = document.createElement('mark');
      mark.className = `hl hl-${hl.color || 'yellow'}${hl.note ? ' has-note' : ''}`;
      mark.dataset.hl = hl.id;
      return mark;
    });
  }
}
