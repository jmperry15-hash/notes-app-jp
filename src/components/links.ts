import type { Editor } from '@tiptap/core';
import { dialogs } from '../state/ui';

export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(mailto:|tel:)\S+$/i.test(value)) return value;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function openUrl(href: string): void {
  if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
}

/** Adds, opens, edits or removes the link at the cursor. */
export async function editLink(editor: Editor): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  const current = editor.getAttributes('link').href as string | undefined;
  if (current) {
    const choice = await dialogs.choose({
      title: 'Link',
      message: current,
      options: [
        { label: 'Open Link', value: 'open' },
        { label: 'Edit Link', value: 'edit' },
        { label: 'Remove Link', value: 'remove' },
      ],
    });
    if (choice === 'open') return openUrl(current);
    if (choice === 'remove') {
      editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link').unsetLink().run();
      return;
    }
    if (choice !== 'edit') {
      editor.commands.focus();
      return;
    }
  }
  const input = await dialogs.prompt({
    title: current ? 'Edit Link' : 'Add Link',
    initial: current ?? '',
    placeholder: 'example.com',
    confirmLabel: current ? 'Save' : 'Add',
    validate: (value) => (normalizeUrl(value) ? null : 'Enter a web address, like example.com'),
  });
  if (!input) {
    editor.commands.focus();
    return;
  }
  const href = normalizeUrl(input)!;
  const chain = editor.chain().focus().setTextSelection({ from, to });
  if (current) chain.extendMarkRange('link').setLink({ href }).run();
  else if (empty) chain.insertContent({ type: 'text', text: input.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
  else chain.setLink({ href }).run();
}
