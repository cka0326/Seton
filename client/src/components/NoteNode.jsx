import { memo, useContext, useEffect, useState } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import Markdown from './Markdown.jsx';
import { NODE_COLORS, KINDS } from '../constants.js';
import { RecallContext } from '../contexts.js';

function NoteNode({ data, selected }) {
  const recall = useContext(RecallContext);
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
      <Handle type="target" position={Position.Top} id="tt" />
      <Handle type="target" position={Position.Left} id="tl" />
      <Handle type="source" position={Position.Right} id="sr" />
      <Handle type="source" position={Position.Bottom} id="sb" />

      <div className="note-head">
        <span className="note-kind" title={kind.label}>{kind.icon}</span>
        <span className="note-title">{data.title || 'Untitled'}</span>
        {data.flashcard && <span className="note-flash" title="Flashcard">🎴</span>}
      </div>

      <div
        className="note-body"
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
