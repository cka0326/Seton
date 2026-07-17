import { useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore } from '@xyflow/react';
import { EdgeNumContext } from '../contexts.js';

// Cap on the zoom compensation so badges keep a constant on-screen size down
// to zoom 0.1, then stop growing so a far-out overview isn't all badges.
const MAX_BADGE_SCALE = 10;

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
  const edgeNums = useContext(EdgeNumContext);
  const zoom = useStore((s) => s.transform[2]);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // trace mode's connection-order badge wins while tracing; otherwise the
  // auto-computed outline number (1, 1.1, 1.2.3 …) — display-only, derived
  // from the graph in CanvasBoard, so it re-numbers itself as edges change
  const badge = data?.traceOrder ?? edgeNums?.get(id);
  // counter the viewport zoom so the badge reads the same at every zoom level
  const scale = Math.min(1 / Math.max(zoom, 0.01), MAX_BADGE_SCALE);

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
      {badge != null && (
        <EdgeLabelRenderer>
          <div
            className="edge-label-stack nodrag nopan"
            style={{
              transform: `translate(${labelX}px, ${labelY}px) scale(${scale}) translate(-50%, -50%)`,
            }}
          >
            <span className={`edge-order ${data?.traceOrder ? '' : 'edge-num'}`}>
              {badge}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
