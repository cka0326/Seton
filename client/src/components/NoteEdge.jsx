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
      {/* halo behind the selected edge so it stays traceable where it
          crosses nodes (selection also elevates it above the node layer) */}
      {selected && (
        <path
          d={path}
          fill="none"
          stroke="var(--bg)"
          strokeWidth={8}
          strokeOpacity={0.85}
          strokeLinecap="round"
        />
      )}
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
      {data?.label || data?.traceOrder ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label-stack nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {/* trace mode: connection-order badge (1 = connected first) */}
            {data?.traceOrder ? <span className="edge-order">{data.traceOrder}</span> : null}
            {data?.label ? (
              <div className={`edge-label ${selected ? 'selected' : ''}`}>{data.label}</div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
