import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import { api } from '../api.js';
import { isDue, schedule, intervalPreview } from '../srs.js';

const GRADES = [
  { key: 'again', label: 'Again', hint: '1' },
  { key: 'hard', label: 'Hard', hint: '2' },
  { key: 'good', label: 'Good', hint: '3' },
  { key: 'easy', label: 'Easy', hint: '4' },
];

export default function ReviewMode({ projectId, onClose }) {
  const [docs, setDocs] = useState(null); // Map canvasId -> canvas doc
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState(null); // 'due' | 'all'
  const [done, setDone] = useState(0);
  const statsRef = useRef({ total: 0, dueCount: 0 });
  const pendingSaves = useRef([]);

  const close = useCallback(
    (count) => {
      // let in-flight grade saves land before the canvas reloads
      Promise.allSettled(pendingSaves.current).then(() => onClose(count));
    },
    [onClose]
  );

  useEffect(() => {
    api.getAll(projectId).then(({ canvases }) => {
      const map = new Map(canvases.map((c) => [c.id, c]));
      const all = [];
      for (const c of canvases) {
        for (const n of c.nodes || []) {
          if (n.data?.flashcard) all.push({ canvasId: c.id, canvasName: c.name, nodeId: n.id });
        }
      }
      const due = all.filter(({ canvasId, nodeId }) => {
        const n = map.get(canvasId).nodes.find((x) => x.id === nodeId);
        return isDue(n.data?.srs);
      });
      statsRef.current = { total: all.length, dueCount: due.length };
      setDocs(map);
      if (due.length > 0) {
        setQueue(shuffle(due));
        setMode('due');
      } else {
        setQueue(all);
        setMode(all.length ? null : 'empty');
      }
    });
  }, [projectId]);

  const card = useMemo(() => {
    if (!docs || !mode || mode === 'empty' || idx >= queue.length) return null;
    const { canvasId, canvasName, nodeId } = queue[idx];
    const node = docs.get(canvasId)?.nodes.find((n) => n.id === nodeId);
    return node ? { canvasId, canvasName, node } : null;
  }, [docs, queue, idx, mode]);

  const grade = useCallback(
    async (g) => {
      if (!card) return;
      const { canvasId, node } = card;
      node.data.srs = schedule(node.data.srs, g);
      const doc = docs.get(canvasId);
      pendingSaves.current.push(api.saveCanvas(projectId, doc).catch(() => {}));
      setDone((n) => n + 1);
      setRevealed(false);
      setIdx((i) => i + 1);
    },
    [card, docs, projectId]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') return close(done);
      if (!card) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        grade(GRADES[Number(e.key) - 1].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, grade, close, done]);

  const finished = mode && mode !== 'empty' && idx >= queue.length;

  return (
    <div className="review-backdrop">
      <div className="review">
        <div className="review-head">
          <strong>🎴 Review</strong>
          {mode && mode !== 'empty' && (
            <span className="muted">
              {Math.min(idx + 1, queue.length)} / {queue.length}
            </span>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={() => close(done)}>✕ Close (Esc)</button>
        </div>

        {!docs && <p className="muted center">Loading cards…</p>}

        {docs && mode === 'empty' && (
          <div className="review-empty">
            <p>No flashcards yet.</p>
            <p className="muted">
              Select a note on the canvas and tick <em>Flashcard</em> in the
              inspector — the title becomes the prompt, the content the answer.
            </p>
          </div>
        )}

        {docs && mode === null && (
          <div className="review-empty">
            <p>🎉 Nothing due right now ({statsRef.current.total} cards scheduled).</p>
            <button className="primary" onClick={() => setMode('all')}>
              Practice all {statsRef.current.total} anyway
            </button>
          </div>
        )}

        {finished && (
          <div className="review-empty">
            <p>✅ Session complete — {done} card{done === 1 ? '' : 's'} reviewed.</p>
            <button className="primary" onClick={() => close(done)}>Back to canvas</button>
          </div>
        )}

        {card && !finished && (
          <div className="review-card">
            <div className="review-canvas-name">{card.canvasName}</div>
            <h2 className="review-prompt">{card.node.data.title || 'Untitled'}</h2>
            {revealed ? (
              <>
                <div className="review-answer">
                  <Markdown>{card.node.data.content || '*No content*'}</Markdown>
                </div>
                <div className="review-grades">
                  {GRADES.map((g) => (
                    <button
                      key={g.key}
                      className={`grade grade-${g.key}`}
                      onClick={() => grade(g.key)}
                    >
                      {g.label}
                      <span className="grade-interval">
                        {intervalPreview(card.node.data.srs, g.key)}
                      </span>
                      <span className="grade-hint">{g.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="primary reveal" onClick={() => setRevealed(true)}>
                Show answer <span className="grade-hint">space</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
