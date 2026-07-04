import { useEffect, useState } from 'react';
import Markdown from './Markdown.jsx';
import { KINDS } from '../constants.js';

export default function NoteModal({ node, onChange, onClose }) {
  const [editing, setEditing] = useState(false);
  const d = node.data || {};
  const kind = KINDS[d.kind] || KINDS.note;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="note-kind">{kind.icon}</span>
          {editing ? (
            <input
              className="modal-title-input"
              value={d.title || ''}
              onChange={(e) => onChange({ title: e.target.value })}
              autoFocus
            />
          ) : (
            <h2 className="modal-title">{d.title || 'Untitled'}</h2>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? '👁 Preview' : '✏️ Edit'}
          </button>
          <button className="ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="modal-body">
          {editing ? (
            <textarea
              className="modal-editor"
              value={d.content || ''}
              placeholder="Write your note in Markdown…"
              onChange={(e) => onChange({ content: e.target.value })}
            />
          ) : (
            <Markdown className="modal-md">{d.content || '*Empty note — hit Edit.*'}</Markdown>
          )}
        </div>
        {d.tags && d.tags.length > 0 && (
          <div className="modal-foot">
            {d.tags.map((t) => (
              <span key={t} className="tag">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
