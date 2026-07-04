import { NODE_COLORS, KINDS } from '../constants.js';
import { newSrs } from '../srs.js';

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export default function Inspector({
  node,
  edge,
  edgeEndpoints,
  onChangeData,
  onChangeDims,
  onDelete,
  onMaximize,
}) {
  if (edge) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <strong>Edge</strong>
          <span className="muted small">
            {edgeEndpoints?.source} → {edgeEndpoints?.target}
          </span>
        </div>
        <Field label="Label (short note on the connection)">
          <input
            value={edge.data?.label || ''}
            placeholder="e.g. causes, contrasts with…"
            onChange={(e) => onChangeData({ label: e.target.value })}
            autoFocus
          />
        </Field>
        <button className="danger" onClick={onDelete}>Delete edge</button>
      </aside>
    );
  }

  if (!node) return null;
  const d = node.data || {};

  const toggleFlashcard = () => {
    if (d.flashcard) onChangeData({ flashcard: false });
    else onChangeData({ flashcard: true, srs: d.srs || newSrs() });
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <strong>Note</strong>
        <button className="ghost small" onClick={onMaximize} title="Open full screen">
          ⤢ Expand
        </button>
      </div>

      <Field label="Title">
        <input
          value={d.title || ''}
          onChange={(e) => onChangeData({ title: e.target.value })}
        />
      </Field>

      <Field label="Content (Markdown)">
        <textarea
          rows={10}
          value={d.content || ''}
          placeholder={'# Heading\n- bullet\n**bold**, *italic*, `code`…'}
          onChange={(e) => onChangeData({ content: e.target.value })}
        />
      </Field>

      <div className="field-row">
        <Field label="Kind">
          <select
            value={d.kind || 'note'}
            onChange={(e) => onChangeData({ kind: e.target.value })}
          >
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Text align">
          <select
            value={d.textAlign || 'left'}
            onChange={(e) => onChangeData({ textAlign: e.target.value })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </Field>
      </div>

      <Field label={`Font size: ${d.fontSize || 14}px`}>
        <input
          type="range"
          min={11}
          max={28}
          value={d.fontSize || 14}
          onChange={(e) => onChangeData({ fontSize: Number(e.target.value) })}
        />
      </Field>

      <Field label="Color">
        <div className="swatches">
          {Object.entries(NODE_COLORS).map(([name, hex]) => (
            <button
              key={name}
              className={`swatch ${d.color === name ? 'selected' : ''}`}
              style={{ background: hex }}
              title={name}
              onClick={() => onChangeData({ color: name })}
            />
          ))}
        </div>
      </Field>

      <div className="field-row">
        <Field label="Width">
          <input
            type="number"
            min={160}
            step={20}
            value={Math.round(node.width || 280)}
            onChange={(e) => onChangeDims({ width: Number(e.target.value) })}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            min={80}
            step={20}
            value={Math.round(node.height || 190)}
            onChange={(e) => onChangeDims({ height: Number(e.target.value) })}
          />
        </Field>
      </div>

      <Field label="Tags (comma separated)">
        <input
          value={(d.tags || []).join(', ')}
          placeholder="physics, chapter-3"
          onChange={(e) =>
            onChangeData({
              tags: e.target.value
                .split(',')
                .map((t) => t.trim().replace(/^#/, ''))
                .filter(Boolean),
            })
          }
        />
      </Field>

      <label className="check">
        <input type="checkbox" checked={!!d.flashcard} onChange={toggleFlashcard} />
        <span>
          Flashcard — title is the prompt, content is the answer.
          {d.flashcard && d.srs && (
            <span className="muted small">
              {' '}Due {new Date(d.srs.due).toLocaleDateString()}
            </span>
          )}
        </span>
      </label>

      <button className="danger" onClick={onDelete}>Delete note</button>
    </aside>
  );
}
