import type { JSONContent } from '@tiptap/core';

export const UNTITLED = 'New Note';
const PREVIEW_LENGTH = 160;
const TITLE_LENGTH = 200;
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

/** A new note starts with an empty Title line, so the first thing typed becomes the title. */
export function emptyNoteDoc(): JSONContent {
  return { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] };
}

function inlineText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(inlineText).join('');
}

function collectLines(node: JSONContent, lines: string[]): void {
  if (node.type && TEXTBLOCKS.has(node.type)) {
    lines.push(...inlineText(node).split('\n'));
    return;
  }
  for (const child of node.content ?? []) collectLines(child, lines);
}

/** Plain text of a TipTap document, one line per block. */
export function docToPlainText(doc: JSONContent | null | undefined): string {
  if (!doc) return '';
  const lines: string[] = [];
  collectLines(doc, lines);
  return lines.join('\n');
}

export interface DerivedText {
  title: string;
  preview: string;
  text: string;
}

/** The first non-empty line is the title; the following lines form the one-line preview. */
export function deriveNoteText(doc: JSONContent | null | undefined): DerivedText {
  const text = docToPlainText(doc);
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const title = (lines[0] ?? '').slice(0, TITLE_LENGTH);
  const preview = lines.slice(1).join(' ').slice(0, PREVIEW_LENGTH);
  return { title, preview, text };
}

export function displayTitle(title: string): string {
  return title.trim() || UNTITLED;
}

/** Returns a copy of `doc` with `suffix` appended to its first line (used for conflicted copies). */
export function appendToFirstLine(doc: JSONContent, suffix: string): JSONContent {
  const copy = structuredClone(doc) as JSONContent;
  let done = false;
  const visit = (node: JSONContent): void => {
    if (done) return;
    if (node.type && TEXTBLOCKS.has(node.type)) {
      if (inlineText(node).trim() === '') return;
      node.content = [...(node.content ?? []), { type: 'text', text: suffix }];
      done = true;
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(copy);
  if (!done) {
    copy.content = [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: suffix.trim() }] },
      ...(copy.content ?? []),
    ];
  }
  return copy;
}
