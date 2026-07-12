// Ready-made prompts for the standalone AI workflows (issue #32). The user
// downloads a prompt plus an export from the AI tools panel, runs it in any
// assistant (Claude, ChatGPT, Gemini, …), and uploads the resulting
// seton-canvases/v1 file back into the app — no AI is called from inside Seton.

// Self-contained spec of the upload format, embedded in every prompt so the
// assistant needs nothing but the prompt + the export file. Field rules must
// match sanitizeCanvas in server/index.js and the shapes in ARCHITECTURE.md.
const CANVAS_FORMAT_SPEC = `## Output format (\`seton-canvases/v1\`)

Reply with **one JSON document and nothing else** — no explanation before or
after it — so the user can save your whole reply as a \`.json\` file and upload
it. Put the JSON **inline in your reply** (a plain code block is fine); do
**not** place it in a side document, canvas, or immersive view — files
downloaded from those are often truncated. It must parse as JSON and follow
this shape exactly:

\`\`\`json
{
  "format": "seton-canvases/v1",
  "canvases": [
    {
      "name": "Canvas name",
      "nodes": [
        {
          "id": "n1",
          "type": "note",
          "position": { "x": 0, "y": 0 },
          "width": 280,
          "height": 190,
          "data": {
            "title": "Note title",
            "content": "Markdown body of the note",
            "kind": "note",
            "color": "slate",
            "fontSize": 14,
            "textAlign": "left",
            "tags": ["topic"]
          }
        }
      ],
      "edges": [
        {
          "id": "e1",
          "source": "n1",
          "target": "n2",
          "sourceHandle": "r",
          "targetHandle": "l",
          "type": "note",
          "data": { "label": "how n1 relates to n2" }
        }
      ]
    }
  ]
}
\`\`\`

Field rules:

- \`nodes[].id\` — any string, unique within the canvas. Edges reference these.
- \`data.content\` — GitHub-flavored markdown. Keep each note focused on a
  single idea, and use as many notes as the material needs — completeness
  matters more than brevity. Never truncate or summarize away substance.
- \`data.kind\` — one of \`note\`, \`question\`, \`definition\`, \`idea\`, \`resource\`.
- \`data.color\` — one of \`slate\`, \`blue\`, \`teal\`, \`green\`, \`amber\`, \`red\`,
  \`purple\`, \`pink\`. Use color to group related notes.
- \`data.tags\` — short lowercase topic slugs (optional, at most a handful).
- Do **not** include a \`data.source\` field — generated canvases carry no
  links back to reader annotations (Seton strips them on upload anyway).
- \`position\` — px coordinates; a note is about 280×190, so place notes on a
  loose grid roughly 340 apart horizontally and 240 vertically, with related
  notes near each other. If you'd rather not compute a layout, omit
  \`position\` entirely and Seton will arrange the notes in a grid.
- \`sourceHandle\`/\`targetHandle\` — side the edge attaches to: \`t\`, \`r\`, \`b\`
  or \`l\` (top/right/bottom/left). Optional; when omitted Seton uses right→left.
- \`edges[].data.label\` — a short phrase (2–6 words) naming the relationship.
  Every edge you add should have one.

The user uploads the file in Seton via **AI tools → Upload canvases**.`;

export const MERGE_CANVASES_PROMPT = `# Merge Seton canvases into one

You are given one or more Seton canvas export files (format
\`seton-canvases/v1\`, attached alongside this prompt). Seton is a
learning tool whose canvases are concept maps: markdown note cards
(\`nodes\`) connected by labelled relationships (\`edges\`).

## Your task

Combine **every canvas in every attached file into a single canvas** without
losing information. The user maintains this merged canvas as their source of
truth, so it must portray the complete picture of everything the inputs cover.

1. **Carry every idea over — and make it cohesive.** You are the editor, not
   just a copier: you may combine overlapping notes into one stronger note,
   expand thin notes with detail found elsewhere in the inputs, re-word bodies
   for a consistent voice, and retitle notes so the canvas reads as one work.
   The one hard rule is that no fact, question, example, caveat or nuance from
   any input note may be lost. When notes merge, keep the union of their tags.
2. **Keep every connection.** Recreate all existing edges with their labels.
   When an endpoint note was merged, re-point the edge at the merged note.
   Drop an edge only if merging turned it into a self-loop or an exact
   duplicate of another edge.
3. **Add the connections that are missing.** Read every note's title and
   content carefully, then connect notes that are clearly related but not yet
   linked — a term one note defines and another uses, a question one note
   raises that another answers, the same concept approached from two canvases.
   Label each new edge with the relationship. Do not force links between
   unrelated notes.
4. **Drop \`data.source\`** wherever it appears in the input — the merged
   canvas keeps no links back to reader annotations.

Produce exactly one canvas in the output, named after the merged content
(e.g. the shared topic), and lay related notes out near each other.

${CANVAS_FORMAT_SPEC}
`;

export const DOC_TO_CANVAS_PROMPT = `# Build a Seton canvas from a document and its annotations

You are given a Seton document export (format \`seton-doc/v1\`, attached
alongside this prompt). It contains the full markdown \`content\` of a document
the user studied, and \`annotations\` — the passages they highlighted
(\`quote\`) with the notes they wrote about them (\`note\`). Seton canvases are
concept maps of markdown note cards connected by labelled relationships.

## Your task

Turn this reading into **one canvas** that stands alone as a complete concept
map of the document — someone who never read the document should get the full
picture from the canvas alone.

1. **Start from the annotations.** The highlights and notes show what mattered
   to the user, so every annotation's insight must appear on the canvas. You
   may quote, re-word, combine overlapping annotations into one note, or
   expand an annotation with surrounding context from the document — whatever
   reads best. Where an annotation came from a highlight color, keep the hue
   for continuity: yellow→amber, green→green, blue→blue, red→red,
   purple→purple.
2. **Cover the whole document.** Read \`content\` end to end and add notes for
   everything of substance the annotations don't already capture — every major
   concept, definition, mechanism, process step, example, comparison, caveat
   and open question. Do not limit the number of notes: a long or dense
   document should yield a large canvas. Choose fitting kinds (\`definition\`,
   \`question\`, \`idea\`, \`resource\`) and write clear markdown bodies in your
   own words.
3. **Connect everything.** Link annotation-derived notes to the concepts they
   belong to, definitions to where they're used, steps in order, questions to
   whatever answers them. Label every edge with the relationship. Every node
   should be reachable — no orphan notes.

The export's \`hlId\`/\`docId\` values are context only — do not copy them into
the output. Name the canvas after the document.

${CANVAS_FORMAT_SPEC}
`;
