export const NODE_COLORS = {
  slate: '#e8eaf0',
  blue: '#d6e4fb',
  teal: '#cfeae6',
  green: '#d8efda',
  amber: '#f6ecc6',
  red: '#fadade',
  purple: '#e7ddf7',
  pink: '#f8dbed',
};

export const KINDS = {
  note: { icon: '📝', label: 'Note' },
  question: { icon: '❓', label: 'Question' },
  definition: { icon: '📖', label: 'Definition' },
  idea: { icon: '💡', label: 'Idea' },
  resource: { icon: '🔗', label: 'Resource' },
};

// Highlight pens for the document reader. Marks get the `hl-<name>` CSS
// class, which resolves to theme-appropriate colors in styles.css.
export const HL_COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

// hex used for swatch buttons (mid-tone, readable on both themes)
export const HL_SWATCH = {
  yellow: '#eac54f',
  green: '#57ab5a',
  blue: '#539bf5',
  red: '#e5534b',
  purple: '#b083f0',
};

// note color a highlight maps to when sent to a canvas
export const HL_TO_NODE_COLOR = {
  yellow: 'amber',
  green: 'green',
  blue: 'blue',
  red: 'red',
  purple: 'purple',
};

export const DEFAULT_NODE = {
  width: 280,
  height: 190,
  fontSize: 14,
  textAlign: 'left',
  color: 'slate',
};
