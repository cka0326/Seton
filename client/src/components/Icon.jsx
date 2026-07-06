// Minimal inline SVG icon set (stroke-based, inherits currentColor).
// Keeps the UI chrome consistent instead of mixing emoji glyphs.

const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  pencil: (
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Zm-2 4 2 2" />
  ),
  download: <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16" />,
  upload: <path d="M12 15V3m0 0 5 5m-5-5-5 5M4 21h16" />,
  back: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </>
  ),
  bookOpen: (
    <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2V4Zm20 0h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7V4Z" />
  ),
  layout: (
    <>
      <rect x="4" y="3" width="16" height="5" rx="1.5" />
      <rect x="4" y="11" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="5" rx="1.5" />
      <path d="M12 8v3M8 16v3h8v-3" />
    </>
  ),
  layoutLR: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="11" y="4" width="5" height="7" rx="1.5" />
      <rect x="11" y="14" width="5" height="6" rx="1.5" />
      <path d="M8 12h3m5-4h3v9h-3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.7 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.6 6.6C4 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4" />
      <path d="m3 3 18 18" />
    </>
  ),
  highlighter: (
    <>
      <path d="m9 11 4 4L21.5 6.5a2.8 2.8 0 1 0-4-4L9 11Z" />
      <path d="m9 11-4.5 4.5L3 21l5.5-1.5L13 15" />
    </>
  ),
  note: (
    <>
      <path d="M4 4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" />
      <path d="M14 2v5h5M8 13h8M8 17h5" />
    </>
  ),
  send: <path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  bookmark: <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.45.93c0 1.87-2.65 2.24-2.65 3.67" />
      <path d="M12 17h.01" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.7.6 1.2 1.3 1.4 2.1h4c.2-.8.7-1.5 1.4-2.1A6 6 0 0 0 12 3Z" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1L11.7 5" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1L12.3 19" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
};

export default function Icon({ name, size = 16, className = '', ...rest }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {glyph}
    </svg>
  );
}
