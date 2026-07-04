// Edge inspector only. Notes are edited in the maximized NoteModal
// (open it by double-clicking a note, or select one and press `e`).
export default function Inspector({ edge, edgeEndpoints, onChangeData, onDelete }) {
  if (!edge) return null;
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <strong>Edge</strong>
        <span className="muted small">
          {edgeEndpoints?.source} → {edgeEndpoints?.target}
        </span>
      </div>
      <label className="field">
        <span className="field-label">Label (short note on the connection)</span>
        <input
          value={edge.data?.label || ''}
          placeholder="e.g. causes, contrasts with…"
          onChange={(e) => onChangeData({ label: e.target.value })}
        />
      </label>
      <button className="danger" onClick={onDelete}>Delete edge</button>
    </aside>
  );
}
