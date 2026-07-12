import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

// Standalone AI workflows (issue #32). Nothing here calls an AI: the user
// downloads an export plus a ready-made prompt, runs both through any
// assistant (Claude, ChatGPT, Gemini, …), and uploads the seton-canvases/v1
// file the assistant produces back into this project.
export default function AiToolsModal({ projectId, canvases, docs, onImported, onClose }) {
  const [selected, setSelected] = useState(() => new Set(canvases.map((c) => c.id)));
  const [docId, setDocId] = useState(docs[0]?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

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

  const toggleCanvas = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canvasesHref =
    `/api/projects/${projectId}/export/canvases.json` +
    (selected.size === canvases.length ? '' : `?ids=${[...selected].join(',')}`);

  // Assistants don't always reply with bare JSON — the file may carry
  // commentary or ```json fences around the bundle. Fall back to the
  // outermost {...} block before giving up.
  const parseBundle = (text) => {
    try {
      return JSON.parse(text);
    } catch { /* try to dig the JSON out */ }
    const block = text.match(/\{[\s\S]*\}/);
    if (block) {
      try {
        return JSON.parse(block[0]);
      } catch { /* fall through */ }
    }
    // Gemini's download button can save a truncated file that ends in an
    // "immersive_entry_chip" placeholder instead of the full JSON.
    if (/immersive_entry_chip/.test(text) || (text.trim().startsWith('{') && !text.trim().endsWith('}'))) {
      throw new Error(
        'the file is incomplete — the assistant\'s download cut it off. ' +
        'Copy the full JSON out of the chat into a file and upload that instead.'
      );
    }
    throw new Error('the file is not valid JSON — save the assistant\'s JSON reply on its own');
  };

  const uploadFile = async (file) => {
    setBusy(true);
    setError('');
    try {
      const bundle = parseBundle(await file.text());
      const { canvases: created } = await api.importCanvases(projectId, bundle);
      onImported(created);
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ai-tools" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="sparkle" size={18} />
          <h2 className="ai-tools-title">AI tools</h2>
          <button className="ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>

        <div className="ai-tools-body">
          <p className="muted small ai-intro">
            These workflows run outside Seton: download an export and its
            prompt, give both to Claude, ChatGPT or Gemini, then upload the
            canvas the assistant produces below.
          </p>
          {error && <div className="error">{error}</div>}

          <section className="ai-step">
            <h3>Merge canvases</h3>
            <p className="muted small">
              Export canvases with every note and connection, and a prompt
              that has the assistant combine them into one canvas — linking
              related notes it finds along the way.
            </p>
            <div className="ai-canvas-picker">
              {canvases.map((c) => (
                <label key={c.id} className={selected.has(c.id) ? 'checked' : ''}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleCanvas(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <div className="ai-row">
              <a
                className={`btn ghost small ${selected.size ? '' : 'disabled'}`}
                href={canvasesHref}
                onClick={(e) => selected.size || e.preventDefault()}
                title="Download the selected canvases as a seton-canvases/v1 JSON bundle"
              >
                <Icon name="download" size={13} /> Canvases (.json)
              </a>
              <a
                className="btn ghost small"
                href="/api/prompts/merge-canvases.md"
                title="Download the prompt to give the assistant along with the canvases"
              >
                <Icon name="note" size={13} /> Merge prompt (.md)
              </a>
            </div>
          </section>

          <section className="ai-step">
            <h3>Document → canvas</h3>
            <p className="muted small">
              Export a library document together with your highlights and
              annotations, and a prompt that has the assistant build a canvas
              from your reading.
            </p>
            {docs.length === 0 ? (
              <p className="muted small hint">
                Add a document to the library first.
              </p>
            ) : (
              <div className="ai-row">
                <select
                  className="ai-doc-select"
                  value={docId}
                  onChange={(e) => setDocId(e.target.value)}
                >
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                <a
                  className="btn ghost small"
                  href={`/api/projects/${projectId}/documents/${docId}/export.json`}
                  title="Download the document and its annotations as seton-doc/v1 JSON"
                >
                  <Icon name="download" size={13} /> Document (.json)
                </a>
                <a
                  className="btn ghost small"
                  href="/api/prompts/doc-to-canvas.md"
                  title="Download the prompt to give the assistant along with the document"
                >
                  <Icon name="note" size={13} /> Canvas prompt (.md)
                </a>
              </div>
            )}
          </section>

          <section className="ai-step">
            <h3>Upload canvases</h3>
            <p className="muted small">
              Upload a seton-canvases .json file — from an assistant or an
              earlier export. Each canvas in the file is added to this project.
            </p>
            <div className="ai-row">
              <button
                className="btn ghost small"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" size={13} /> {busy ? 'Uploading…' : 'Upload canvases (.json)'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.txt,.md,application/json,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
