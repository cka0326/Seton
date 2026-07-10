import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import Markdown from './Markdown.jsx';
import Icon from './Icon.jsx';
import { NODE_COLORS, KINDS } from '../constants.js';
import { NodeSizeContext, OpenSourceContext, RecallContext } from '../contexts.js';

// Auto-size bounds. Width is kept in a readable band (never a thin column, never
// a banner) so notes stay legible and don't hog canvas real estate; height then
// flows to whatever the content needs.
const MIN_W = 200;
const MAX_W = 460;
const MIN_H = 80;
// target body aspect ratio (width : height) when balancing an auto-fit
const FIT_RATIO = 1.5;

function NoteNode({ id, data, selected }) {
  const recall = useContext(RecallContext);
  const openSource = useContext(OpenSourceContext);
  const setNodeDims = useContext(NodeSizeContext);
  const [revealed, setRevealed] = useState(false);
  const nodeRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!recall) setRevealed(false);
  }, [recall]);

  // `nowheel` on the body lets the wheel scroll overflowing note content, but
  // it also blocks trackpad pinch-zoom (delivered as ctrl+wheel) whenever the
  // cursor sits on a note. Flip the class per event — pinch (or a body with
  // nothing to scroll) hands the wheel back to the canvas zoom. This runs in
  // the capture phase, so the class is right before React Flow's zoom filter
  // (which honors it) sees the event on the way back up.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const pinch = e.ctrlKey || e.metaKey;
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      el.classList.toggle('nowheel', !pinch && scrollable);
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  // Measures — at `targetWidth` (or the current width when null) — the chrome
  // height (header + tags + borders) and the TRUE content height. The body is
  // briefly collapsed while reading scrollHeight because scrollHeight is floored
  // at the element's own height; without collapsing, a note whose box is taller
  // than its content would report the box height and hide the wasted space.
  // Reads live DOM so it's exact regardless of images, code blocks or wrapping.
  const measure = useCallback((targetWidth) => {
    const el = nodeRef.current;
    const body = bodyRef.current;
    if (!el || !body) return null;
    const wrapper = el.closest('.react-flow__node');
    let prevW;
    if (targetWidth != null && wrapper) {
      prevW = wrapper.style.width;
      wrapper.style.width = `${targetWidth}px`;
    }
    // note-body is flex:1, so (node height − body box) is exactly the chrome
    const chromeH = el.offsetHeight - body.offsetHeight;
    const prevFlex = body.style.flex;
    const prevHeight = body.style.height;
    body.style.flex = 'none';
    body.style.height = '0px';
    const contentH = body.scrollHeight; // content + body padding, no box floor
    body.style.flex = prevFlex;
    body.style.height = prevHeight;
    if (prevW !== undefined) wrapper.style.width = prevW;
    return { chromeH, contentH };
  }, []);

  // Height needed to show all content with no scroll, at the given/current width.
  const measureFitHeight = useCallback(
    (targetWidth) => {
      const m = measure(targetWidth);
      return m ? Math.max(MIN_H, Math.round(m.chromeH + m.contentH + 1)) : null;
    },
    [measure]
  );

  // Auto-fit button: grow/shrink the node to show all content with no scroll,
  // balancing width and height so it doesn't become a thin column or a banner.
  const autoSize = useCallback(
    (e) => {
      e.stopPropagation();
      const el = nodeRef.current;
      const body = bodyRef.current;
      if (!el || !body || !setNodeDims) return;
      const wrapper = el.closest('.react-flow__node');
      const curW = wrapper ? wrapper.offsetWidth : el.offsetWidth;
      const m = measure(null); // true content height at the current width
      if (!m) return;
      const cs = getComputedStyle(body);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const innerW = Math.max(1, curW - padX);
      const innerH = Math.max(1, m.contentH - padY);
      // text roughly conserves area across reflow, so sqrt(area·ratio) lands the
      // width at the desired aspect; then measure the true height at that width
      const area = innerW * innerH;
      let targetW = Math.round(Math.sqrt(area * FIT_RATIO) + padX);
      targetW = Math.max(MIN_W, Math.min(MAX_W, targetW));
      setNodeDims(id, { width: targetW, height: measureFitHeight(targetW) });
    },
    [id, setNodeDims, measure, measureFitHeight]
  );

  // After a manual resize, never leave empty space below the content: trim the
  // height down to what the content needs (widening a sparse note used to keep
  // its old tall height). Only shrinks — a deliberately short note still scrolls.
  const onResizeEnd = useCallback(
    (_e, params) => {
      if (!setNodeDims) return;
      requestAnimationFrame(() => {
        const fitH = measureFitHeight(null);
        if (fitH == null) return;
        const h = Math.max(MIN_H, Math.min(params.height, fitH));
        if (Math.abs(h - params.height) > 1) setNodeDims(id, { height: h });
      });
    },
    [id, setNodeDims, measureFitHeight]
  );

  const kind = KINDS[data.kind] || KINDS.note;
  const concealed = recall && !revealed;

  return (
    <div
      ref={nodeRef}
      className={`note-node ${concealed ? 'concealed' : ''} ${selected ? 'selected' : ''}`}
      style={{ background: NODE_COLORS[data.color] || NODE_COLORS.slate }}
      onClick={() => recall && setRevealed((r) => !r)}
      title={recall ? 'Recall mode: click to reveal / hide' : undefined}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={MIN_H}
        onResizeEnd={onResizeEnd}
      />
      {/* Every side is a source handle; with ConnectionMode.Loose it can also
          receive, so the arrow direction follows the drag (start → drop). */}
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />

      <div className="note-head">
        <span className="note-kind" title={kind.label}>
          <Icon name={kind.icon} size={13} />
        </span>
        <span className="note-title">{data.title || 'Untitled'}</span>
        {data.source && (
          <button
            className="note-link-flag nodrag"
            title="Mirrors a reader annotation — click to open the highlight in the reader (edits here sync back; rewriting the quoted text detaches it)"
            onClick={(e) => {
              e.stopPropagation();
              openSource?.(data.source);
            }}
          >
            <Icon name="link" size={11} />
          </button>
        )}
        <button
          className="note-fit-btn nodrag"
          title="Auto-size to fit the content (no scrolling)"
          onClick={autoSize}
        >
          <Icon name="autofit" size={13} />
        </button>
      </div>

      {/* nowheel: let the wheel scroll overflowing note content instead of
          zooming the canvas */}
      <div
        ref={bodyRef}
        className="note-body nowheel"
        style={{
          fontSize: data.fontSize || 14,
          textAlign: data.textAlign || 'left',
        }}
      >
        <Markdown>{data.content}</Markdown>
      </div>

      {data.tags && data.tags.length > 0 && (
        <div className="note-tags">
          {data.tags.map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(NoteNode);
