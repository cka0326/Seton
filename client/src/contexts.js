import { createContext } from 'react';

// True when recall (active-recall revision) mode is on: note bodies are
// blurred and click reveals them.
export const RecallContext = createContext(false);
