import { createContext } from 'react';

// True when recall (active-recall revision) mode is on: note bodies are
// blurred and click reveals them.
export const RecallContext = createContext(false);

// Opens the reader at the annotation a canvas note mirrors:
// (source: { docId, hlId }) => void. Null when navigation is unavailable.
export const OpenSourceContext = createContext(null);
