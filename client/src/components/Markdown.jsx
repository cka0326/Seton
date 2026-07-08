import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// react-markdown strips URLs whose protocol isn't http(s)/mailto/… — which
// would blank out the embedded `data:` image URLs we use for pasted images
// (issue #24). Allow image data URLs through; everything else keeps the safe
// default sanitization.
const urlTransform = (url) =>
  url.startsWith('data:image/') ? url : defaultUrlTransform(url);

const components = {
  img: (props) => <img {...props} loading="lazy" alt={props.alt || ''} />,
};

export default function Markdown({ children, className = '' }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={urlTransform}
        components={components}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
