import Icon from './Icon.jsx';

export default function ThemeToggle({ theme, onToggle, className = '' }) {
  return (
    <button
      className={`ghost theme-toggle ${className}`}
      onClick={onToggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label="Toggle color theme"
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
