import { useCallback, useEffect, useState } from 'react';
import ProjectList from './components/ProjectList.jsx';
import ProjectView from './components/ProjectView.jsx';

export default function App() {
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem('seton:lastProject') || null
  );
  const [theme, setTheme] = useState(
    () => localStorage.getItem('seton:theme') || 'dark'
  );

  useEffect(() => {
    if (projectId) localStorage.setItem('seton:lastProject', projectId);
    else localStorage.removeItem('seton:lastProject');
  }, [projectId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('seton:theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    []
  );

  if (!projectId) {
    return <ProjectList onOpen={setProjectId} theme={theme} onToggleTheme={toggleTheme} />;
  }
  return (
    <ProjectView
      projectId={projectId}
      theme={theme}
      onToggleTheme={toggleTheme}
      onClose={() => setProjectId(null)}
      onMissing={() => setProjectId(null)}
    />
  );
}
