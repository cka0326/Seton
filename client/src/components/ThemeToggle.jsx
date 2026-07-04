export default function ThemeToggle({ theme, onToggle, className = '' }) {
  return (
    <button
      className={`ghost theme-toggle ${className}`}
      onClick={onToggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label="Toggle color theme"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
