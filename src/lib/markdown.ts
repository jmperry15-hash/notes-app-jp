import type { JSONContent } from '@tiptap/core';

type Mark = NonNullable<JSONContent['marks']>[number];

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function wrapMarks(text: string, marks: Mark[] = []): string {
  if (!text) return '';
  let out = marks.some((m) => m.type === 'code') ? `\`${text.replace(/`/g, '\\`')}\`` : escapeText(text);
  // Markdown emphasis can't start or end with whitespace, so keep it outside the markers.
  const lead = /^\s*/.exec(out)?.[0] ?? '';
  const trail = /\s*$/.exec(out)?.[0] ?? '';
  let core = out.slice(lead.length, out.length - trail.length);
  if (!core) return out;
  for (const mark of marks) {
    if (mark.type === 'bold') core = `**${core}**`;
    else if (mark.type === 'italic') core = `*${core}*`;
    else if (mark.type === 'strike') core = `~~${core}~~`;
    else if (mark.type === 'underline') core = `<u>${core}</u>`;
  }
  const link = marks.find((m) => m.type === 'link');
  if (link?.attrs?.href) core = `[${core}](${String(link.attrs.href).replace(/\)/g, '%29')})`;
  out = lead + core + trail;
  return out;
}

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return wrapMarks(node.text ?? '', node.marks);
      if (node.type === 'hardBreak') return '  \n';
      return inline(node.content);
    })
    .join('');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n');
}

function listItem(item: JSONContent, marker: string): string {
  const [first, ...rest] = item.content ?? [];
  const head = first ? block(first).trimEnd() : '';
  const pad = ' '.repeat(marker.length);
  const body = rest.map((child) => indent(block(child).trimEnd(), pad)).join('\n');
  return `${marker}${head}${body ? `\n${body}` : ''}`;
}

function block(node: JSONContent): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(node.attrs?.level ?? 1)))} ${inline(node.content)}`;
    case 'paragraph':
      return inline(node.content);
    case 'bulletList':
      return (node.content ?? []).map((item) => listItem(item, '- ')).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? []).map((item, i) => listItem(item, `${start + i}. `)).join('\n');
    }
    case 'taskList':
      return (node.content ?? [])
        .map((item) => listItem(item, item.attrs?.checked ? '- [x] ' : '- [ ] '))
        .join('\n');
    case 'blockquote':
      return indent(blocks(node.content), '> ');
    case 'codeBlock': {
      const text = (node.content ?? []).map((n) => n.text ?? '').join('');
      return `\`\`\`${node.attrs?.language ?? ''}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    default:
      return node.content ? blocks(node.content) : inline([node]);
  }
}

function blocks(nodes: JSONContent[] = []): string {
  return nodes.map(block).join('\n\n');
}

/** Converts a TipTap document to Markdown (CommonMark plus task-list and strikethrough extensions). */
export function docToMarkdown(doc: JSONContent): string {
  return `${blocks(doc.content).replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
