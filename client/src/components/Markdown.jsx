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

// Stamp every rendered element with its character range in the markdown
// source (`data-srcpos="start-end"`). The reader uses this to map a DOM
// selection back to the exact source markdown, so highlights sent to a canvas
// keep tables, code fences, lists and inline formatting intact.
function rehypeSrcpos() {
  return (tree) => {
    (function walk(node) {
      if (node.type === 'element') {
        const { start, end } = node.position || {};
        if (start?.offset != null && end?.offset != null) {
          node.properties = {
            ...node.properties,
            dataSrcpos: `${start.offset}-${end.offset}`,
          };
        }
      }
      for (const child of node.children || []) walk(child);
    })(tree);
  };
}

const remarkPlugins = [remarkGfm, remarkBreaks];
const srcposPlugins = [rehypeSrcpos];

export default function Markdown({ children, className = '', sourcePos = false }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={sourcePos ? srcposPlugins : undefined}
        urlTransform={urlTransform}
        components={components}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
