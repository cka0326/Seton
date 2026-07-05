import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

export default function Markdown({ children, className = '' }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
