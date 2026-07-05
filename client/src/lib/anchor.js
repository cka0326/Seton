// Text anchoring for reader highlights.
//
// A highlight is stored as { start, quote, prefix, suffix } where `start` is
// the character offset into the reader container's textContent. Offsets are
// stable because the same markdown renders to the same text; if the document
// is edited, the quote + surrounding context is used to re-locate the
// highlight, so most marks survive edits elsewhere in the text.

const CONTEXT = 32;

function textNodesIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Describe the current DOM selection relative to `root`.
// Returns null when the selection is collapsed or escapes the root.
export function describeSelection(root) {
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

  const text = root.textContent;
  return {
    start,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    rect: range.getBoundingClientRect(),
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
