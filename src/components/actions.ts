import type { Note } from '../lib/types';
import { liveFolders } from '../state/selectors';
import { store } from '../state/store';
import { dialogs, toast } from '../state/ui';

/** Note and folder actions that need a confirmation, prompt or toast. */

export async function confirmPermanentDelete(id: string) {
  const ok = await dialogs.confirm({
    title: 'Delete this note permanently?',
    message: 'This can’t be undone.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (ok) store.deleteNotePermanently(id);
}

export function deleteWithUndo(id: string) {
  if (store.deleteNote(id)) {
    toast('Moved to Recently Deleted', { action: { label: 'Undo', run: () => store.restoreNote(id) } });
  }
}

export async function promptNewFolder(): Promise<void> {
  const existing = new Set(liveFolders(store.getState().folders).map((f) => f.name.toLowerCase()));
  const name = await dialogs.prompt({
    title: 'New Folder',
    placeholder: 'Folder name',
    confirmLabel: 'Create',
    validate: (value) =>
      !value.trim() ? 'Please enter a name.' : existing.has(value.trim().toLowerCase()) ? 'You already have a folder with that name.' : null,
  });
  if (name) store.selectView({ kind: 'folder', id: store.createFolder(name) });
}

export async function renameFolder(id: string, current: string) {
  const name = await dialogs.prompt({ title: 'Rename Folder', initial: current, confirmLabel: 'Rename' });
  if (name) store.renameFolder(id, name);
}

export async function deleteFolder(id: string, name: string, count: number) {
  const ok = await dialogs.confirm({
    title: `Delete “${name}”?`,
    message:
      count > 0
        ? `Its ${count} note${count === 1 ? '' : 's'} will move to Recently Deleted.`
        : 'This folder is empty.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!ok) return;
  store.deleteFolder(id);
  toast(count > 0 ? `Folder deleted. ${count} note${count === 1 ? '' : 's'} moved to Recently Deleted.` : 'Folder deleted.');
}

export async function moveToFolder(note: Note) {
  const folders = liveFolders(store.getState().folders);
  if (folders.length === 0) {
    toast('Create a folder first, from the folder list.');
    return;
  }
  const choice = await dialogs.choose<string>({
    title: 'Move to Folder',
    options: [
      { label: 'No folder', value: '', detail: note.folderId === null ? 'Current' : undefined },
      ...folders.map((f) => ({ label: f.name, value: f.id, detail: note.folderId === f.id ? 'Current' : undefined })),
    ],
  });
  if (choice === null) return;
  store.moveNote(note.id, choice || null);
  const name = choice ? folders.find((f) => f.id === choice)?.name : null;
  toast(name ? `Moved to “${name}”` : 'Removed from folder');
}

/**
 * iOS only shows the keyboard when focus happens inside the tap itself, but a new note's editor mounts
 * a moment later. Focusing a throwaway input during the tap opens the keyboard; the editor then takes
 * over focus and the keyboard stays up.
 */
export function primeKeyboard(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const input = document.createElement('input');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;';
  document.body.appendChild(input);
  input.focus({ preventScroll: true });
  window.setTimeout(() => input.remove(), 1000);
}
