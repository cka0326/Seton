import { useEffect, useState } from 'react';
import ProjectList from './components/ProjectList.jsx';
import ProjectView from './components/ProjectView.jsx';

export default function App() {
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem('seton:lastProject') || null
  );

  useEffect(() => {
    if (projectId) localStorage.setItem('seton:lastProject', projectId);
    else localStorage.removeItem('seton:lastProject');
  }, [projectId]);

  if (!projectId) {
    return <ProjectList onOpen={setProjectId} />;
  }
  return (
    <ProjectView
      projectId={projectId}
      onClose={() => setProjectId(null)}
      onMissing={() => setProjectId(null)}
    />
  );
}
