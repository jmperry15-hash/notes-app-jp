import { Extension } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import { formatEditorDate } from '../lib/dates';
import { daysLeft } from '../lib/purge';
import type { Note } from '../lib/types';
import { viewTitle } from '../state/selectors';
import { store, useApp, type Layout } from '../state/store';
import { toast } from '../state/ui';
import { FormatToolbar } from './FormatToolbar';
import { editLink, openUrl } from './links';
import { ChevronLeft, MoreIcon, MoveIcon, NotesIcon, PinIcon, RestoreIcon, TrashIcon } from './icons';
import { confirmPermanentDelete, deleteWithUndo, moveToFolder } from './actions';
import { Button, cx, IconButton, Menu } from './primitives';


/** ⌘K adds or edits a link. */
const LinkShortcut = Extension.create({
  name: 'folioLinkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        void editLink(this.editor);
        return true;
      },
    };
  },
});

function NoteEditor({ note, layout, autoFocus }: { note: Note; layout: Layout; autoFocus: boolean }) {
  const deleted = note.deletedAt !== null;
  const [focused, setFocused] = useState(false);
  const lastSyncRev = useRef(note.syncRev ?? 0);
  const phone = layout === 'phone';
  const listTitle = useApp((s) => viewTitle(s.view, s.folders));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Registered separately below with app-specific settings.
        link: false,
        underline: false,
        trailingNode: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^(https?:|mailto:|tel:)/i.test(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        showOnlyCurrent: false,
        placeholder: ({ node, pos }) => (pos === 0 && node.type.name === 'heading' ? 'Title' : ''),
      }),
      LinkShortcut,
    ],
    content: note.body,
    editable: !deleted,
    autofocus: autoFocus && !deleted ? 'start' : false,
    editorProps: {
      attributes: { class: 'folio-editor', 'aria-label': 'Note', spellcheck: 'true', autocapitalize: 'sentences' },
      handleClick: (view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        if (anchor?.href && (event.metaKey || event.ctrlKey || !view.editable)) {
          openUrl(anchor.getAttribute('href') ?? '');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => store.updateNoteBody(note.id, e.getJSON()),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });

  // Another device changed this note: show the new version.
  useEffect(() => {
    const rev = note.syncRev ?? 0;
    if (!editor || rev === lastSyncRev.current) return;
    lastSyncRev.current = rev;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(note.body)) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(note.body, { emitUpdate: false });
    const size = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
  }, [editor, note.syncRev, note.body]);

  useEffect(() => {
    editor?.setEditable(!deleted, false);
  }, [editor, deleted]);

  const actions = deleted ? (
    <>
      <IconButton label="Restore" tone="accent" onClick={() => (store.restoreNote(note.id), toast('Note restored'))}>
        <RestoreIcon />
      </IconButton>
      <IconButton label="Delete permanently" onClick={() => void confirmPermanentDelete(note.id)}>
        <TrashIcon />
      </IconButton>
    </>
  ) : phone ? (
    <>
      <IconButton label={note.pinned ? 'Unpin' : 'Pin'} active={note.pinned} onClick={() => store.togglePin(note.id)}>
        <PinIcon filled={note.pinned} />
      </IconButton>
      <Menu
        label="More"
        trigger={<MoreIcon />}
        items={[
          { label: 'Move to Folder…', icon: <MoveIcon size={18} />, onSelect: () => void moveToFolder(note) },
          { label: 'Delete', icon: <TrashIcon size={18} />, destructive: true, onSelect: () => deleteWithUndo(note.id) },
        ]}
      />
    </>
  ) : (
    <>
      <IconButton label={note.pinned ? 'Unpin' : 'Pin'} active={note.pinned} onClick={() => store.togglePin(note.id)}>
        <PinIcon filled={note.pinned} />
      </IconButton>
      <IconButton label="Move to folder" onClick={() => void moveToFolder(note)}>
        <MoveIcon />
      </IconButton>
      <IconButton label="Delete" onClick={() => deleteWithUndo(note.id)}>
        <TrashIcon />
      </IconButton>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className={cx('chrome shrink-0', phone && 'pt-safe pl-safe pr-safe')}>
        <div className={cx('flex items-center gap-1', phone ? 'h-12 px-2' : 'h-[52px] px-3')}>
          {phone && (
            <button
              type="button"
              onClick={() => {
                editor?.commands.blur();
                store.goBack();
              }}
              className="flex h-10 min-w-0 items-center gap-0.5 rounded-lg pr-2 text-[17px] text-accent active:opacity-60"
            >
              <ChevronLeft size={24} strokeWidth={2.2} className="shrink-0" />
              <span className="truncate">{listTitle}</span>
            </button>
          )}
          <div className="min-w-0 flex-1">{!phone && editor && !deleted && <FormatToolbar editor={editor} placement="top" />}</div>
          {actions}
          {phone && focused && (
            <button type="button" onClick={() => editor?.commands.blur()} className="ml-1 h-10 rounded-lg px-2 text-[17px] font-semibold text-accent">
              Done
            </button>
          )}
        </div>
      </header>

      <div
        className="scroll-area min-h-0 flex-1 cursor-text"
        onMouseDown={(event) => {
          // Clicking the empty space below the text puts the cursor at the end.
          if (event.target === event.currentTarget && editor && !deleted) {
            event.preventDefault();
            editor.commands.focus('end');
          }
        }}
      >
        <div className={cx('mx-auto w-full max-w-[720px] pb-32', phone ? 'pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))]' : 'px-8 lg:px-12')}>
          <p className="chrome pt-1 pb-5 text-center text-[12px] text-faint">{formatEditorDate(note.updatedAt)}</p>
          {deleted && note.deletedAt !== null && (
            <div className="chrome mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-[14px]">
              <span className="text-muted">
                In Recently Deleted · removed for good in {daysLeft(note.deletedAt, Date.now())}{' '}
                {daysLeft(note.deletedAt, Date.now()) === 1 ? 'day' : 'days'}
              </span>
              <Button variant="ghost" className="!min-h-8 !px-2.5 !text-[14px]" onClick={() => (store.restoreNote(note.id), toast('Note restored'))}>
                Restore
              </Button>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      {phone && focused && editor && !deleted && <FormatToolbar editor={editor} placement="keyboard" />}
    </div>
  );
}

export function EditorPane({ layout }: { layout: Layout }) {
  const note = useApp((s) => (s.selectedNoteId ? (s.notes.get(s.selectedNoteId) ?? null) : null));
  const draftId = useApp((s) => s.draftId);
  if (!note) {
    return (
      <div className="chrome flex h-full flex-col items-center justify-center gap-3 bg-bg text-faint">
        <NotesIcon size={40} strokeWidth={1.25} />
        <p className="text-[15px]">No note selected</p>
      </div>
    );
  }
  return <NoteEditor key={note.id} note={note} layout={layout} autoFocus={draftId === note.id} />;
}
