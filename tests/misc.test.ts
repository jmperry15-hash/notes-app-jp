import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup, unlockBackup } from '../src/lib/backup';
import { groupNotes } from '../src/lib/dates';
import { docToMarkdown } from '../src/lib/markdown';
import { MemoryServer } from '../src/lib/memoryRemote';
import { appendToFirstLine, deriveNoteText } from '../src/lib/noteText';
import { delayAfterFailures, getLockout, passcodeStrength, recordFailure, recordSuccess } from '../src/lib/passcode';
import type { Note } from '../src/lib/types';
import { crc32, createZip } from '../src/lib/zip';
import { createVault, doc, makeDevice, notePayload, readNotes, saveNote } from './helpers';

describe('note text', () => {
  it('uses the first line as the title and the rest as the preview', () => {
    expect(deriveNoteText(doc('Shopping', 'Milk', '', 'Eggs'))).toMatchObject({ title: 'Shopping', preview: 'Milk Eggs' });
    expect(deriveNoteText(doc(''))).toMatchObject({ title: '', preview: '' });
  });

  it('appends the conflict suffix to the first line', () => {
    const changed = appendToFirstLine(doc('Plan', 'body'), ' (conflicted copy)');
    expect(deriveNoteText(changed).title).toBe('Plan (conflicted copy)');
  });
});

describe('markdown export', () => {
  it('converts formatting, lists and checklists', () => {
    const md = docToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }],
        },
      ],
    });
    expect(md).toBe('# Title\n\n**bold** and [link](https://example.com)\n\n- [x] done\n- [ ] todo\n\n1. first\n');
  });

  it('writes a valid zip archive', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const zip = createZip([{ name: 'Folder/Note.md', data: '# Hi\n' }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
  });
});

describe('note list grouping', () => {
  it('groups by Pinned, Today, Yesterday, Previous 7 and 30 days, then month', () => {
    const now = new Date(2026, 9, 14, 12);
    const day = 24 * 60 * 60 * 1000;
    const note = (id: string, ago: number, pinned = false) =>
      ({ id, updatedAt: now.getTime() - ago, pinned, deletedAt: null }) as Note;
    const groups = groupNotes(
      [note('a', 0), note('b', day), note('c', 3 * day), note('d', 20 * day), note('e', 60 * day), note('f', 400 * day), note('p', 90 * day, true)],
      now,
    );
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id).join('')])).toEqual([
      ['Pinned', 'p'],
      ['Today', 'a'],
      ['Yesterday', 'b'],
      ['Previous 7 Days', 'c'],
      ['Previous 30 Days', 'd'],
      [new Date(now.getTime() - 60 * day).toLocaleDateString(undefined, { month: 'long' }), 'e'],
      [new Date(now.getTime() - 400 * day).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), 'f'],
    ]);
  });
});

describe('passcode helpers', () => {
  it('rates passcodes', () => {
    expect(passcodeStrength('12345').label).toBe('Too short');
    expect(passcodeStrength('123456').label).toBe('Weak');
    expect(passcodeStrength('482916').label).toBe('Weak');
    expect(passcodeStrength('maple tree 47').score).toBeGreaterThanOrEqual(3);
  });

  it('adds escalating delays after repeated wrong attempts', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const waits = Array.from({ length: 8 }, () => recordFailure(storage, 0));
    expect(waits).toEqual([0, 0, 0, 0, 30_000, 60_000, 300_000, 900_000]);
    expect(getLockout(storage, 1000).waitMs).toBe(899_000);
    expect(delayAfterFailures(50)).toBe(3_600_000);
    recordSuccess(storage);
    expect(getLockout(storage, 0)).toEqual({ failures: 0, waitMs: 0 });
  });
});

describe('encrypted backup', () => {
  it('restores into a vault with a different passcode', async () => {
    const server = new MemoryServer();
    const original = await createVault(server, 'first passcode');
    const mac = await makeDevice(server, original.key, original.settings);
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Backed up', 'contents']));
    const file = JSON.stringify(await createBackup(mac.db));
    expect(file).not.toContain('Backed up');

    const backup = parseBackup(file);
    expect(await unlockBackup(backup, 'wrong passcode')).toBeNull();
    const backupKey = (await unlockBackup(backup, 'first passcode'))!;

    const other = await createVault(new MemoryServer(), 'second passcode');
    const fresh = await makeDevice(new MemoryServer(), other.key, other.settings);
    const result = await restoreBackup({ db: fresh.db, backup, backupKey, currentKey: other.key });
    expect(result).toMatchObject({ added: 1, updated: 0, failed: 0 });
    expect((await readNotes(fresh)).get(id)?.title).toBe('Backed up');

    // Restoring again changes nothing.
    const again = await restoreBackup({ db: fresh.db, backup, backupKey, currentKey: other.key });
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('{"hello": 1}')).toThrow(/not a Folio backup/);
    expect(() => parseBackup('nope')).toThrow(/not a Folio backup/);
  });
});
