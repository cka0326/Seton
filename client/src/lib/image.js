// Inline image support (issue #24).
//
// Pasted or dropped images become base64 `data:` URLs embedded directly in the
// markdown content. That keeps an image note/document indistinguishable from a
// text one: it's still just markdown, so storage, search, export, Drive sync,
// import and the auto-fit sizing all flow through with no special handling.
//
// To stop screenshots from bloating the database, images are downscaled to a
// sane maximum dimension and re-encoded as JPEG when a PNG would be large.

const MAX_DIM = 1600; // cap the longest side (px)
const JPEG_ABOVE = 900_000; // if a PNG data URL is larger than this, use JPEG
const HARD_MAX = 12_000_000; // refuse anything still bigger than this (bytes-ish)

export function isImageFile(f) {
  return !!f && typeof f.type === 'string' && f.type.startsWith('image/');
}

// Extract image File(s) from a paste or drop event. Browsers expose pasted
// images through `files` on some platforms and only through `items` on others.
export function imageFilesFromEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return [];
  const out = [];
  if (dt.files && dt.files.length) {
    for (const f of dt.files) if (isImageFile(f)) out.push(f);
  }
  if (!out.length && dt.items) {
    for (const it of dt.items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image file'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image'));
    img.src = src;
  });
}

// Read an image file and return { src, width, height } where `src` is a data
// URL, downscaled/recompressed if that keeps the note lightweight.
export async function fileToImage(file) {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));

  // small enough already → keep the original bytes (preserves GIFs/SVGs too)
  if (scale === 1 && original.length < JPEG_ABOVE) {
    return { src: original, width: w, height: h };
  }

  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);

  let src = canvas.toDataURL('image/png');
  if (src.length > JPEG_ABOVE) {
    // photos and screenshots compress far better as JPEG; flatten onto white
    // first so any transparency doesn't render black
    const flat = document.createElement('canvas');
    flat.width = cw;
    flat.height = ch;
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    src = flat.toDataURL('image/jpeg', 0.85);
  }
  if (src.length > HARD_MAX) throw new Error('Image is too large to embed');
  return { src, width: cw, height: ch };
}

// Markdown for an embedded image.
export const imageMarkdown = (src, alt = 'image') => `![${alt}](${src})`;

// Insert `text` at a textarea's caret. Returns the new value and the caret
// position after the insertion so the caller can restore the selection.
export function insertAtCursor(textarea, text) {
  const value = textarea.value;
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n\n' : '';
  const trail = after && !after.startsWith('\n') ? '\n' : '';
  const inserted = `${lead}${text}${trail}`;
  return { value: before + inserted + after, caret: (before + inserted).length };
}
