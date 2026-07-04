import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

export default function NoteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? '#7aa2f7' : '#4a5061',
          strokeWidth: selected ? 2.2 : 1.6,
        }}
      />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${selected ? 'selected' : ''} nodrag nopan`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
