import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { HL_COLORS, HL_SWATCH } from '../constants.js';
import { describeSelection, locate, paintHighlights } from '../lib/anchor.js';
import { fmtDuration } from '../lib/time.js';

const READ_TICK_MS = 5_000; // how often active reading time is counted
const READ_IDLE_MS = 60_000; // no input for this long → the clock pauses
const READ_SAVE_MS = 30_000; // how often accumulated time is persisted

const newId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Table of contents from the markdown source (skips code fences).
function parseToc(md) {
  const items = [];
  let inFence = false;
  for (const line of (md || '').split('\n')) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) {
      items.push({ level: m[1].length, text: m[2].replace(/[*_`]+/g, '').trim() });
    }
  }
  return items;
}

function popoverPosition(rect) {
  const pad = 8;
  const width = 264;
  let x = rect.left + rect.width / 2 - width / 2;
  x = Math.max(pad, Math.min(x, window.innerWidth - width - pad));
  const below = rect.bottom + 10;
  const flip = below > window.innerHeight - 180;
  return { x, y: flip ? Math.max(pad, rect.top - 10) : below, flip, width };
}

export default function DocumentReader({
  projectId,
  docId,
  onBack,
  onDeleted,
  onMetaChange,
  onSendToCanvas,
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [tocOpen, setTocOpen] = useState(true);
  const [tocCollapsed, setTocCollapsed] = useState(() => new Set());
  const [notesOpen, setNotesOpen] = useState(true);
  const [activeHead, setActiveHead] = useState(0);
  const [percent, setPercent] = useState(0);
  const [popover, setPopover] = useState(null); // {mode:'new'|'edit', ...}
  const [fontSize, setFontSize] = useState(
    () => Number(localStorage.getItem('seton:readerFont')) || 17
  );
  const penRef = useRef(localStorage.getItem('seton:pen') || 'yellow');

  // reading-time clock: base = persisted seconds, session = this visit
  const [readSecs, setReadSecs] = useState(0);
  const readBase = useRef(0);
  const readSession = useRef(0);
  const readSaved = useRef(0); // session seconds already persisted
  const lastActivity = useRef(Date.now());

  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const restoredRef = useRef(false);
  const progressTimer = useRef(null);
  const titleTimer = useRef(null);
  const docRef = useRef(null);
  docRef.current = doc;

  useEffect(() => {
    restoredRef.current = false;
    setDoc(null);
    setPopover(null);
    setError('');
    api
      .getDoc(projectId, docId)
      .then((d) => {
        setDoc(d);
        setPercent(d.progress?.percent || 0);
        readBase.current = d.progress?.readSeconds || 0;
        readSession.current = 0;
        readSaved.current = 0;
        lastActivity.current = Date.now();
        setReadSecs(readBase.current);
      })
      .catch((e) => setError(e.message));
  }, [projectId, docId]);

  useEffect(() => {
    localStorage.setItem('seton:readerFont', String(fontSize));
  }, [fontSize]);

  const toc = useMemo(() => parseToc(doc?.content), [doc?.content]);

  // Flatten the outline, skipping descendants of collapsed sections.
  const tocRows = useMemo(() => {
    const rows = [];
    let hiddenBelow = null; // level of the nearest collapsed ancestor
    toc.forEach((h, i) => {
      if (hiddenBelow != null) {
        if (h.level > hiddenBelow) return;
        hiddenBelow = null;
      }
      const hasChildren = toc[i + 1] && toc[i + 1].level > h.level;
      rows.push({ ...h, i, hasChildren });
      if (hasChildren && tocCollapsed.has(i)) hiddenBelow = h.level;
    });
    return rows;
  }, [toc, tocCollapsed]);

  const toggleTocSection = (i) => {
    setTocCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  // memoized so highlight marks aren't disturbed by unrelated re-renders
  const body = useMemo(
    () => <Markdown className="reader-md">{doc?.content || ''}</Markdown>,
    [doc?.content]
  );

  // paint highlights whenever content or the highlight list changes
  useLayoutEffect(() => {
    if (doc && contentRef.current) {
      paintHighlights(contentRef.current, doc.highlights || []);
    }
  }, [doc?.content, doc?.highlights, doc]);

  // restore the reading position once per document
  useLayoutEffect(() => {
    if (!doc || restoredRef.current || !scrollRef.current) return;
    restoredRef.current = true;
    const el = scrollRef.current;
    el.scrollTop = (doc.progress?.scroll || 0) * (el.scrollHeight - el.clientHeight);
  }, [doc]);

  const hlTimer = useRef(null);
  const saveHighlights = useCallback(
    (next) => {
      setDoc((d) => (d ? { ...d, highlights: next } : d));
      clearTimeout(hlTimer.current);
      hlTimer.current = setTimeout(() => {
        api
          .saveDoc(projectId, docId, { highlights: next })
          .then(() => onMetaChange?.())
          .catch((e) => setError(`Save failed: ${e.message}`));
      }, 400);
    },
    [projectId, docId, onMetaChange]
  );

  // Count active reading time. The clock ticks while the tab is visible and
  // there was input (pointer, keys, wheel) within the last READ_IDLE_MS.
  useEffect(() => {
    const mark = () => { lastActivity.current = Date.now(); };
    window.addEventListener('pointermove', mark, { passive: true });
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark, true);
    window.addEventListener('wheel', mark, { passive: true });
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity.current >= READ_IDLE_MS) return;
      readSession.current += READ_TICK_MS / 1000;
      setReadSecs(Math.round(readBase.current + readSession.current));
    }, READ_TICK_MS);
    return () => {
      clearInterval(tick);
      window.removeEventListener('pointermove', mark);
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('wheel', mark);
    };
  }, []);

  // Persist accumulated reading time. It rides on `progress`, which the
  // server merges and which doesn't bump the document's updatedAt.
  useEffect(() => {
    const save = () => {
      if (readSession.current <= readSaved.current) return;
      readSaved.current = readSession.current;
      api
        .saveDoc(projectId, docId, {
          progress: { readSeconds: Math.round(readBase.current + readSession.current) },
        })
        .then(() => onMetaChange?.())
        .catch(() => {});
    };
    const t = setInterval(save, READ_SAVE_MS);
    return () => {
      clearInterval(t);
      save(); // flush on unmount / doc switch
    };
  }, [projectId, docId, onMetaChange]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !docRef.current) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 1;
    const seen = max > 0 ? Math.min(1, (el.scrollTop + el.clientHeight) / el.scrollHeight) : 1;
    const pct = Math.max(
      docRef.current.progress?.percent || 0,
      Math.round(seen * 100)
    );
    setPercent(pct);

    // scrollspy for the outline
    const heads = contentRef.current?.querySelectorAll('h1, h2, h3, h4') || [];
    let active = 0;
    heads.forEach((h, i) => {
      if (h.offsetTop <= el.scrollTop + 90) active = i;
    });
    setActiveHead(active);

    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      const progress = { scroll: ratio, percent: pct, lastReadAt: Date.now() };
      setDoc((d) => (d ? { ...d, progress } : d));
      api.saveDoc(projectId, docId, { progress }).then(() => onMetaChange?.()).catch(() => {});
    }, 800);
  }, [projectId, docId, onMetaChange]);

  useEffect(() => () => {
    clearTimeout(progressTimer.current);
    clearTimeout(titleTimer.current);
    clearTimeout(hlTimer.current);
  }, []);

  const renameDoc = (title) => {
    setDoc((d) => ({ ...d, title }));
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      api.saveDoc(projectId, docId, { title }).then(() => onMetaChange?.()).catch(() => {});
    }, 500);
  };

  const deleteDoc = async () => {
    if (!confirm(`Delete "${doc.title}" with its highlights and notes?`)) return;
    await api.deleteDoc(projectId, docId);
    onMetaChange?.();
    onDeleted();
  };

  // ----- selection & popover -----

  const onMouseUp = useCallback(() => {
    // let the browser finalize the selection first
    requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const sel = describeSelection(root);
      if (sel && sel.quote.trim()) {
        setPopover({ mode: 'new', sel, ...popoverPosition(sel.rect) });
      }
    });
  }, []);

  const onContentClick = useCallback((e) => {
    const mark = e.target.closest?.('mark[data-hl]');
    const sel = window.getSelection();
    if (mark && (!sel || sel.isCollapsed)) {
      e.stopPropagation();
      setPopover({
        mode: 'edit',
        hlId: mark.dataset.hl,
        ...popoverPosition(mark.getBoundingClientRect()),
      });
    } else if (!mark && (!sel || sel.isCollapsed)) {
      setPopover(null);
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && popover) {
        e.stopPropagation();
        setPopover(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [popover]);

  const addHighlight = (color, { openNote = false, send = false } = {}) => {
    const { sel } = popover;
    penRef.current = color;
    localStorage.setItem('seton:pen', color);
    const hl = {
      id: newId('h'),
      start: sel.start,
      quote: sel.quote,
      prefix: sel.prefix,
      suffix: sel.suffix,
      color,
      note: '',
      createdAt: Date.now(),
    };
    saveHighlights([...(doc.highlights || []), hl]);
    window.getSelection()?.removeAllRanges();
    if (openNote) {
      setPopover((p) => ({ ...p, mode: 'edit', hlId: hl.id, sel: null }));
    } else {
      setPopover(null);
    }
    if (send) sendHl(hl);
  };

  const updateHl = (id, patch) => {
    saveHighlights(
      (doc.highlights || []).map((h) => (h.id === id ? { ...h, ...patch } : h))
    );
  };

  const removeHl = (id) => {
    saveHighlights((doc.highlights || []).filter((h) => h.id !== id));
    setPopover(null);
  };

  // Title of the outline section (nearest preceding heading) a highlight
  // falls under — used as the note title when it's sent to a canvas.
  const sectionForHl = (hl) => {
    const root = contentRef.current;
    if (!root) return '';
    const start = locate(root.textContent, hl)?.start ?? hl.start;
    const range = document.createRange();
    let section = '';
    for (const h of root.querySelectorAll('h1, h2, h3, h4')) {
      range.setStart(root, 0);
      range.setEndBefore(h);
      if (range.toString().length > start) break;
      section = h.textContent.trim();
    }
    return section;
  };

  const sendHl = async (hl) => {
    try {
      await onSendToCanvas({
        quote: hl.quote,
        note: hl.note,
        color: hl.color,
        section: sectionForHl(hl),
      });
      setPopover(null);
    } catch (e) {
      setError(`Send failed: ${e.message}`);
    }
  };

  const jumpToHl = (id) => {
    const mark = contentRef.current?.querySelector(`mark[data-hl="${id}"]`);
    if (!mark) return;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.classList.add('hl-flash');
    setTimeout(() => mark.classList.remove('hl-flash'), 1200);
  };

  const jumpToHead = (i) => {
    const heads = contentRef.current?.querySelectorAll('h1, h2, h3, h4') || [];
    heads[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (error && !doc) {
    return (
      <div className="loading">
        <div>
          <p>{error}</p>
          <button onClick={onBack}>Back to canvas</button>
        </div>
      </div>
    );
  }
  if (!doc) return <div className="loading">Loading document…</div>;

  const highlights = [...(doc.highlights || [])].sort((a, b) => a.start - b.start);
  const editingHl = popover?.mode === 'edit'
    ? highlights.find((h) => h.id === popover.hlId)
    : null;
  const words = doc.content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="reader">
      <header className="reader-head">
        <button className="ghost" onClick={onBack} title="Back to canvas">
          <Icon name="back" />
          <span className="btn-label">Canvas</span>
        </button>
        <input
          className="reader-title"
          value={doc.title}
          onChange={(e) => renameDoc(e.target.value)}
          placeholder="Untitled document"
        />
        <span className="reader-meta muted small">
          {words.toLocaleString()} words · ~{Math.max(1, Math.round(words / 220))} min · {percent}% read
          <span title="Active time spent reading this document"> · {fmtDuration(readSecs)} spent</span>
        </span>
        <span className="tb-sep" />
        <div className="font-stepper" title="Reading font size">
          <button className="ghost tiny" onClick={() => setFontSize((s) => Math.max(14, s - 1))}>A−</button>
          <button className="ghost tiny" onClick={() => setFontSize((s) => Math.min(24, s + 1))}>A+</button>
        </div>
        <button
          className={`ghost ${tocOpen ? 'active' : ''}`}
          onClick={() => setTocOpen((v) => !v)}
          title="Toggle outline"
        >
          <Icon name="list" />
        </button>
        <button
          className={`ghost ${notesOpen ? 'active' : ''}`}
          onClick={() => setNotesOpen((v) => !v)}
          title="Toggle highlights & annotations"
        >
          <Icon name="highlighter" />
        </button>
        <button className="ghost danger" onClick={deleteDoc} title="Delete document">
          <Icon name="trash" />
        </button>
        <div className="reader-progress" aria-hidden="true">
          <div style={{ width: `${percent}%` }} />
        </div>
      </header>

      {error && <div className="error reader-error">{error}</div>}

      <div className="reader-body">
        {tocOpen && toc.length > 0 && (
          <nav className="reader-toc">
            <div className="panel-label">Outline</div>
            {tocRows.map((h) => (
              <div
                key={h.i}
                className={`toc-item lvl-${h.level} ${h.i === activeHead ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => jumpToHead(h.i)}
                onKeyDown={(e) => e.key === 'Enter' && jumpToHead(h.i)}
              >
                {h.hasChildren ? (
                  <button
                    className={`toc-caret ${tocCollapsed.has(h.i) ? '' : 'open'}`}
                    title={tocCollapsed.has(h.i) ? 'Expand section' : 'Collapse section'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTocSection(h.i);
                    }}
                  >
                    <Icon name="chevronRight" size={11} />
                  </button>
                ) : (
                  <span className="toc-caret-spacer" />
                )}
                <span className="toc-text">{h.text}</span>
              </div>
            ))}
          </nav>
        )}

        <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
          <article
            className="reader-content"
            ref={contentRef}
            style={{ fontSize }}
            onMouseUp={onMouseUp}
            onClick={onContentClick}
          >
            {body}
          </article>
        </div>

        {notesOpen && (
          <aside className="reader-notes">
            <div className="panel-label">
              Highlights <span className="muted">({highlights.length})</span>
            </div>
            {highlights.length === 0 && (
              <p className="muted small hint">
                Select any text to highlight it. Add a note to capture your
                thinking — everything is saved with the document.
              </p>
            )}
            {highlights.map((h) => (
              <div
                key={h.id}
                className={`hl-card pen-${h.color}`}
                onClick={() => jumpToHl(h.id)}
              >
                <blockquote>{h.quote}</blockquote>
                {h.note ? (
                  <p className="hl-note">{h.note}</p>
                ) : (
                  <p className="hl-note muted">No note yet</p>
                )}
                <div className="hl-card-actions">
                  <button
                    className="ghost tiny"
                    title="Edit note"
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpToHl(h.id);
                      const mark = contentRef.current?.querySelector(
                        `mark[data-hl="${h.id}"]`
                      );
                      if (mark) {
                        setPopover({
                          mode: 'edit',
                          hlId: h.id,
                          ...popoverPosition(mark.getBoundingClientRect()),
                        });
                      }
                    }}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    className="ghost tiny"
                    title="Send to canvas as a note"
                    onClick={(e) => { e.stopPropagation(); sendHl(h); }}
                  >
                    <Icon name="send" size={13} />
                  </button>
                  <button
                    className="ghost tiny danger"
                    title="Remove highlight"
                    onClick={(e) => { e.stopPropagation(); removeHl(h.id); }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </aside>
        )}
      </div>

      {popover && popover.mode === 'new' && (
        <div
          className={`hl-popover ${popover.flip ? 'flip' : ''}`}
          style={{ left: popover.x, top: popover.y, width: popover.width }}
        >
          <div className="hl-popover-row">
            {HL_COLORS.map((c) => (
              <button
                key={c}
                className="pen-dot"
                style={{ background: HL_SWATCH[c] }}
                title={`Highlight ${c}`}
                onClick={() => addHighlight(c)}
              />
            ))}
            <span className="tb-sep" />
            <button
              className="ghost small"
              title="Highlight and write a note"
              onClick={() => addHighlight(penRef.current, { openNote: true })}
            >
              <Icon name="note" size={14} /> Note
            </button>
            <button
              className="ghost small"
              title="Highlight and send to the canvas as a note"
              onClick={() => addHighlight(penRef.current, { send: true })}
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>
      )}

      {editingHl && (
        <div
          className={`hl-popover ${popover.flip ? 'flip' : ''}`}
          style={{ left: popover.x, top: popover.y, width: popover.width }}
        >
          <div className="hl-popover-row">
            {HL_COLORS.map((c) => (
              <button
                key={c}
                className={`pen-dot ${editingHl.color === c ? 'selected' : ''}`}
                style={{ background: HL_SWATCH[c] }}
                onClick={() => updateHl(editingHl.id, { color: c })}
              />
            ))}
            <span className="spacer" />
            <button
              className="ghost tiny"
              title="Send to canvas as a note"
              onClick={() => sendHl(editingHl)}
            >
              <Icon name="send" size={14} />
            </button>
            <button
              className="ghost tiny danger"
              title="Remove highlight"
              onClick={() => removeHl(editingHl.id)}
            >
              <Icon name="trash" size={14} />
            </button>
            <button className="ghost tiny" title="Close" onClick={() => setPopover(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <textarea
            className="hl-note-input"
            placeholder="Your annotation… (why does this matter?)"
            value={editingHl.note}
            autoFocus
            rows={3}
            onChange={(e) => updateHl(editingHl.id, { note: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
