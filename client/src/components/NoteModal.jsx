import { useEffect, useState } from 'react';
import Markdown from './Markdown.jsx';
import { KINDS, NODE_COLORS } from '../constants.js';

export default function NoteModal({ node, onChange, onChangeDims, onDelete, onClose }) {
  // opens in edit mode (split editor + preview); toggle to reading view
  const [reading, setReading] = useState(false);
  const d = node.data || {};
  const kind = KINDS[d.kind] || KINDS.note;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const previewStyle = {
    fontSize: (d.fontSize || 14) + 2,
    textAlign: d.textAlign || 'left',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="note-kind">{kind.icon}</span>
          <input
            className="modal-title-input"
            value={d.title || ''}
            placeholder="Untitled note"
            onChange={(e) => onChange({ title: e.target.value })}
            autoFocus
          />
          <button className="ghost" onClick={() => setReading((v) => !v)}>
            {reading ? '✏️ Edit' : '👁 Read'}
          </button>
          <button className="ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {!reading && (
          <div className="modal-toolbar">
            <label className="tb-field">
              <span>Kind</span>
              <select
                value={d.kind || 'note'}
                onChange={(e) => onChange({ kind: e.target.value })}
              >
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </label>

            <label className="tb-field">
              <span>Align</span>
              <select
                value={d.textAlign || 'left'}
                onChange={(e) => onChange({ textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>

            <label className="tb-field">
              <span>Font {d.fontSize || 14}px</span>
              <input
                type="range"
                min={11}
                max={28}
                value={d.fontSize || 14}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              />
            </label>

            <div className="tb-field">
              <span>Color</span>
              <div className="swatches">
                {Object.entries(NODE_COLORS).map(([name, hex]) => (
                  <button
                    key={name}
                    className={`swatch ${d.color === name ? 'selected' : ''}`}
                    style={{ background: hex }}
                    title={name}
                    onClick={() => onChange({ color: name })}
                  />
                ))}
              </div>
            </div>

            <label className="tb-field grow">
              <span>Tags</span>
              <input
                value={(d.tags || []).join(', ')}
                placeholder="physics, chapter-3"
                onChange={(e) =>
                  onChange({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim().replace(/^#/, ''))
                      .filter(Boolean),
                  })
                }
              />
            </label>

            <label className="tb-field">
              <span>W</span>
              <input
                type="number"
                min={160}
                step={20}
                value={Math.round(node.width || 280)}
                onChange={(e) => onChangeDims({ width: Number(e.target.value) })}
              />
            </label>
            <label className="tb-field">
              <span>H</span>
              <input
                type="number"
                min={80}
                step={20}
                value={Math.round(node.height || 190)}
                onChange={(e) => onChangeDims({ height: Number(e.target.value) })}
              />
            </label>
          </div>
        )}

        <div className={`modal-main ${reading ? 'reading' : ''}`}>
          {!reading && (
            <textarea
              className="modal-editor"
              value={d.content || ''}
              placeholder={'Write in Markdown…\n\n# Heading\n- bullet\n**bold**, *italic*, `code`'}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          )}
          <div className="modal-preview" style={previewStyle}>
            <Markdown className="modal-md">
              {d.content || '*Empty note — start typing on the left.*'}
            </Markdown>
          </div>
        </div>

        <div className="modal-foot">
          <div className="spacer" />
          <button className="danger" onClick={() => { onDelete(); onClose(); }}>
            Delete note
          </button>
        </div>
      </div>
    </div>
  );
}
