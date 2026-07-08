import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fileToImage, imageFilesFromEvent, imageMarkdown, insertAtCursor } from '../lib/image.js';

// Paste AI-generated notes (or any markdown) — or import a .md/.txt file —
// to add a study document to the project library.
export default function AddDocModal({ onCreate, onClose }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const editorRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const loadFile = async (file) => {
    setContent(await file.text());
    if (!title) setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
  };

  // Paste or drop an image → embed it inline at the caret (issue #24). Returns
  // true when images were handled, so callers can fall back to text otherwise.
  const embedImages = async (e) => {
    const files = imageFilesFromEvent(e);
    if (!files.length) return false;
    e.preventDefault();
    try {
      const parts = [];
      for (const f of files) parts.push(imageMarkdown((await fileToImage(f)).src));
      const ta = editorRef.current;
      const { value, caret } = insertAtCursor(ta, parts.join('\n\n'));
      setContent(value);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
    } catch (err) {
      setError(err.message || 'Could not embed image');
    }
    return true;
  };

  const create = async () => {
    if (!content.trim()) {
      setError('Paste some content first.');
      return;
    }
    setBusy(true);
    try {
      await onCreate({ title: title.trim(), content });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const words = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal add-doc" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="book" size={18} />
          <input
            className="modal-title-input"
            placeholder="Document title (taken from the first heading if empty)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>

        {error && <div className="error" style={{ margin: '10px 16px 0' }}>{error}</div>}

        <textarea
          ref={editorRef}
          className="modal-editor add-doc-editor"
          autoFocus
          placeholder={
            'Paste your study material here — AI-generated notes, a chapter summary, ' +
            'paper notes, docs…\n\nMarkdown is rendered: # headings become the outline, ' +
            'code blocks, tables and lists all work. Paste or drop an image to embed it.' +
            '\n\nOnce added, you can read it, highlight passages, annotate them, and send ' +
            'key points to your canvas.'
          }
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={embedImages}
          onDrop={async (e) => {
            if (await embedImages(e)) return; // image → embedded inline
            const f = e.dataTransfer?.files?.[0];
            if (f) {
              e.preventDefault();
              loadFile(f); // .md / .txt → load as the document body
            }
          }}
        />

        <div className="modal-foot">
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Import .md / .txt
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = '';
            }}
          />
          <span className="muted small">{words ? `${words.toLocaleString()} words` : ''}</span>
          <div className="spacer" />
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !content.trim()} onClick={create}>
            {busy ? 'Adding…' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
}
