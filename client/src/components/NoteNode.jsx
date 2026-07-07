import { memo, useContext, useEffect, useState } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import Markdown from './Markdown.jsx';
import Icon from './Icon.jsx';
import { NODE_COLORS, KINDS } from '../constants.js';
import { OpenSourceContext, RecallContext } from '../contexts.js';

function NoteNode({ data, selected }) {
  const recall = useContext(RecallContext);
  const openSource = useContext(OpenSourceContext);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!recall) setRevealed(false);
  }, [recall]);

  const kind = KINDS[data.kind] || KINDS.note;
  const concealed = recall && !revealed;

  return (
    <div
      className={`note-node ${concealed ? 'concealed' : ''} ${selected ? 'selected' : ''}`}
      style={{ background: NODE_COLORS[data.color] || NODE_COLORS.slate }}
      onClick={() => recall && setRevealed((r) => !r)}
      title={recall ? 'Recall mode: click to reveal / hide' : undefined}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={80} />
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
            title="Mirrors a reader annotation — click to open the highlight in the reader (editing the body here detaches it)"
            onClick={(e) => {
              e.stopPropagation();
              openSource?.(data.source);
            }}
          >
            <Icon name="link" size={11} />
          </button>
        )}
      </div>

      {/* nowheel: let the wheel scroll overflowing note content instead of
          zooming the canvas */}
      <div
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
