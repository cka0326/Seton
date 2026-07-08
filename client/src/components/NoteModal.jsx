import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import Icon from './Icon.jsx';
import { KINDS, NODE_COLORS } from '../constants.js';
import { fileToImage, imageFilesFromEvent, imageMarkdown, insertAtCursor } from '../lib/image.js';

export default function NoteModal({ node, onChange, onChangeDims, onDelete, onClose }) {
  // opens in edit mode (split editor + preview); toggle to reading view
  const [reading, setReading] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const editorRef = useRef(null);
  const d = node.data || {};
  const kind = KINDS[d.kind] || KINDS.note;

  // Paste or drop an image into the editor → embed it inline (issue #24).
  const onImageEvent = async (e) => {
    const files = imageFilesFromEvent(e);
    if (!files.length) return; // let normal text paste / file drop proceed
    e.preventDefault();
    setImgBusy(true);
    try {
      const parts = [];
      for (const f of files) parts.push(imageMarkdown((await fileToImage(f)).src));
      const ta = editorRef.current;
      const { value, caret } = insertAtCursor(ta, parts.join('\n\n'));
      onChange({ content: value });
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
    } catch {
      /* oversized / unreadable image — leave the note unchanged */
    } finally {
      setImgBusy(false);
    }
  };

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

  const cardColor = NODE_COLORS[d.color] || NODE_COLORS.slate;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="note-kind">
            <Icon name={kind.icon} size={14} />
          </span>
          <input
            className="modal-title-input"
            value={d.title || ''}
            placeholder="Untitled note"
            onChange={(e) => onChange({ title: e.target.value })}
            autoFocus
          />
          <button className="ghost" onClick={() => setReading((v) => !v)}>
            <Icon name={reading ? 'pencil' : 'bookOpen'} size={14} />{' '}
            {reading ? 'Edit' : 'Read'}
          </button>
          <button className="ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="close" />
          </button>
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
                  <option key={k} value={k}>{v.label}</option>
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
              ref={editorRef}
              className="modal-editor"
              value={d.content || ''}
              placeholder={'Write in Markdown…\n\n# Heading\n- bullet\n**bold**, *italic*, `code`\n\nPaste or drop an image to embed it.'}
              onChange={(e) => onChange({ content: e.target.value })}
              onPaste={onImageEvent}
              onDrop={onImageEvent}
            />
          )}
          <div className="modal-preview">
            <div className="note-preview-card" style={{ background: cardColor }}>
              <div className="note-head">
                <span className="note-kind" title={kind.label}>
                  <Icon name={kind.icon} size={13} />
                </span>
                <span className="note-title">{d.title || 'Untitled'}</span>
              </div>
              <div className="note-preview-body" style={previewStyle}>
                <Markdown className="modal-md">
                  {d.content || '*Empty note — start typing on the left.*'}
                </Markdown>
              </div>
              {d.tags && d.tags.length > 0 && (
                <div className="note-tags">
                  {d.tags.map((t) => (
                    <span key={t} className="tag">#{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          {imgBusy && <span className="muted small">Embedding image…</span>}
          <div className="spacer" />
          <button className="danger" onClick={() => { onDelete(); onClose(); }}>
            Delete note
          </button>
        </div>
      </div>
    </div>
  );
}
