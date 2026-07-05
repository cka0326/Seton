// Markdown rendering of canvases, documents, and whole projects — used by the
// export endpoints and by the Drive sync mirror.

export function canvasToMarkdown(canvas) {
  const lines = [`# ${canvas.name || 'Untitled canvas'}`, ''];
  const byId = new Map((canvas.nodes || []).map((n) => [n.id, n]));
  for (const n of canvas.nodes || []) {
    const d = n.data || {};
    lines.push(`## ${d.title || 'Untitled note'}`);
    const meta = [];
    if (d.kind && d.kind !== 'note') meta.push(`kind: ${d.kind}`);
    if (d.tags && d.tags.length) meta.push(`tags: ${d.tags.join(', ')}`);
    if (meta.length) lines.push(`*${meta.join(' · ')}*`);
    lines.push('');
    if (d.content) lines.push(d.content, '');
    const out = (canvas.edges || []).filter((e) => e.source === n.id);
    if (out.length) {
      lines.push('**Connections:**');
      for (const e of out) {
        const target = byId.get(e.target);
        const label = e.data && e.data.label ? ` — ${e.data.label}` : '';
        lines.push(`- → ${(target && target.data && target.data.title) || e.target}${label}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function docToMarkdown(doc) {
  const parts = [`# ${doc.title || 'Untitled document'}`, '', doc.content || '', ''];
  if ((doc.highlights || []).length) {
    parts.push('## Highlights & annotations', '');
    for (const h of doc.highlights) {
      parts.push(`- > ${(h.quote || '').replace(/\s+/g, ' ')}`);
      if (h.note) parts.push(`  - ${h.note}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

export function projectToMarkdown(project, canvases) {
  const parts = [`# ${project.name}`, '', `_Exported ${new Date().toISOString()}_`, ''];
  for (const c of canvases) {
    parts.push('---', '', canvasToMarkdown(c));
  }
  return parts.join('\n');
}
