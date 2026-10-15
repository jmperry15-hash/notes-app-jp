import { useEffect, useMemo, type RefObject } from 'react';
import { listGroups, normalizeQuery, viewTitle, visibleNotes } from '../state/selectors';
import { store, useApp, type Layout } from '../state/store';
import { dialogs, errorMessage, toast } from '../state/ui';
import { confirmPermanentDelete, deleteWithUndo, primeKeyboard } from './actions';
import { ChevronLeft, CloseIcon, ComposeIcon, SearchIcon, SidebarIcon } from './icons';
import { NoteRow, type RowActions } from './NoteRow';
import { Button, cx, IconButton } from './primitives';
import { SyncBadge } from './SyncBadge';
import { MOD } from '../hooks/useShortcuts';

const BACKUP_REMINDER_DAYS = 30;
const SNOOZE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;


const rowActions: RowActions = {
  onSelect: (id) => store.selectNote(id),
  onSwipeRight: (id) => {
    const note = store.getState().notes.get(id);
    if (!note) return;
    if (note.deletedAt !== null) {
      store.restoreNote(id);
      toast('Note restored');
    } else {
      store.togglePin(id);
    }
  },
  onSwipeLeft: (id) => {
    const note = store.getState().notes.get(id);
    if (!note) return;
    if (note.deletedAt !== null) void confirmPermanentDelete(id);
    else deleteWithUndo(id);
  },
};

function BackupReminder() {
  const prefs = useApp((s) => s.prefs);
  const count = useApp((s) => s.notes.size);
  const now = Date.now();
  const due = !prefs.lastBackupAt || now - prefs.lastBackupAt > BACKUP_REMINDER_DAYS * DAY;
  const snoozed = prefs.backupReminderSnoozedAt !== null && now - prefs.backupReminderSnoozedAt < SNOOZE_DAYS * DAY;
  if (count < 3 || !due || snoozed) return null;
  return (
    <div className="mx-2 mb-2 rounded-xl border border-accent/30 bg-accent-soft p-3.5 text-[14px]">
      <p className="font-semibold">Back up your notes</p>
      <p className="mt-0.5 leading-snug text-muted">
        {prefs.lastBackupAt ? 'Your last backup is over a month old.' : 'You haven’t downloaded a backup yet.'} A forgotten
        passcode can’t be reset, so keep an encrypted copy somewhere safe.
      </p>
      <div className="mt-2.5 flex gap-2">
        <Button
          variant="primary"
          className="!min-h-9 !px-3 !text-[14px]"
          onClick={() => store.downloadBackup().then(() => toast('Encrypted backup downloaded'), (e) => toast(errorMessage(e), { tone: 'error' }))}
        >
          Download backup
        </Button>
        <Button variant="ghost" className="!min-h-9 !px-3 !text-[14px]" onClick={() => store.setPrefs({ backupReminderSnoozedAt: Date.now() })}>
          Later
        </Button>
      </div>
    </div>
  );
}

export function NoteList({ layout, searchRef }: { layout: Layout; searchRef: RefObject<HTMLInputElement | null> }) {
  const notes = useApp((s) => s.notes);
  const folders = useApp((s) => s.folders);
  const view = useApp((s) => s.view);
  const search = useApp((s) => s.search);
  const selectedId = useApp((s) => s.selectedNoteId);
  const sidebarCollapsed = useApp((s) => s.prefs.sidebarCollapsed);

  const query = normalizeQuery(search);
  const list = useMemo(() => visibleNotes(notes, view, search), [notes, view, search]);
  const groups = useMemo(
    () => (query && view.kind !== 'deleted' ? [{ key: 'results', label: `${list.length} ${list.length === 1 ? 'Result' : 'Results'}`, notes: listGroups(list, view).flatMap((g) => g.notes) }] : listGroups(list, view)),
    [list, view, query],
  );
  const title = viewTitle(view, folders);
  const deletedView = view.kind === 'deleted';
  const phone = layout === 'phone';

  // On larger screens, keep a note open: select the first one when nothing is selected.
  useEffect(() => {
    if (phone || query || selectedId) return;
    const first = groups[0]?.notes[0];
    if (first) store.selectNote(first.id);
  }, [phone, query, selectedId, groups]);

  const emptyText = query
    ? `No results for “${search.trim()}”`
    : deletedView
      ? 'Recently Deleted is empty'
      : 'No notes yet';

  return (
    <section aria-label="Notes" className="chrome flex h-full min-w-0 flex-col bg-panel">
      <header className={cx('shrink-0', phone && 'pt-safe pl-safe pr-safe')}>
        {phone ? (
          <>
            <div className="flex h-12 items-center justify-between px-2">
              <button
                type="button"
                onClick={() => store.goBack()}
                className="flex h-10 items-center gap-0.5 rounded-lg pr-2 text-[17px] text-accent active:opacity-60"
              >
                <ChevronLeft size={24} strokeWidth={2.2} /> Folders
              </button>
              <SyncBadge />
            </div>
            <h1 className="truncate px-5 pb-2 text-[32px] font-bold tracking-tight">{title}</h1>
          </>
        ) : (
          <div className="flex h-[52px] items-center gap-1 px-3">
            {(layout === 'tablet' || sidebarCollapsed) && (
              <IconButton
                label={layout === 'tablet' ? 'Show folders' : 'Show sidebar'}
                onClick={() => (layout === 'tablet' ? store.setFoldersOpen(true) : store.setPrefs({ sidebarCollapsed: false }))}
              >
                <SidebarIcon />
              </IconButton>
            )}
            <div className="ml-1 min-w-0 flex-1">
              <h1 className="truncate text-[15px] leading-tight font-semibold">{title}</h1>
              <p className="text-[12px] leading-tight text-faint">
                {list.length} {list.length === 1 ? 'note' : 'notes'}
              </p>
            </div>
            {!deletedView && (
              <IconButton label={`New note (${MOD}N)`} tone="accent" onClick={() => store.createNote()}>
                <ComposeIcon size={21} />
              </IconButton>
            )}
          </div>
        )}

        <div className={cx('pb-2', phone ? 'px-4' : 'px-3')}>
          <label className={cx('flex items-center gap-2 rounded-xl bg-input px-3 text-muted ring-accent/50 focus-within:ring-1', phone ? 'h-11' : 'h-9')}>
            <SearchIcon size={phone ? 19 : 16} className="shrink-0" />
            <input
              ref={searchRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={deletedView ? 'Search Recently Deleted' : phone ? 'Search' : `Search all notes  ${MOD}F`}
              aria-label="Search notes"
              value={search}
              onChange={(e) => store.setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  store.setSearch('');
                  e.currentTarget.blur();
                }
              }}
              className={cx('min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden', phone ? 'text-[17px]' : 'text-[16px]')}
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => store.setSearch('')} className="rounded-full p-0.5 text-faint hover:text-ink">
                <CloseIcon size={16} />
              </button>
            )}
          </label>
        </div>
      </header>

      <div className={cx('scroll-area min-h-0 flex-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))]', phone ? 'pb-28' : 'pb-4')}>
        {deletedView && (
          <div className="mx-2 mb-3 flex items-center justify-between gap-3 text-[13px] text-faint">
            <span>Notes are permanently deleted after 30 days.</span>
            {list.length > 0 && (
              <button
                type="button"
                className="shrink-0 font-medium text-danger"
                onClick={async () => {
                  const ok = await dialogs.confirm({
                    title: 'Delete all permanently?',
                    message: `${list.length} note${list.length === 1 ? '' : 's'} will be deleted from all your devices. This can’t be undone.`,
                    confirmLabel: 'Delete All',
                    destructive: true,
                  });
                  if (ok) toast(`${store.emptyRecentlyDeleted()} notes deleted`);
                }}
              >
                Delete All
              </button>
            )}
          </div>
        )}
        {!deletedView && !query && <BackupReminder />}

        {groups.length === 0 ? (
          <p className="mt-16 text-center text-[15px] text-faint">{emptyText}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mb-3">
              {group.label && (
                <h2 className="sticky top-0 z-[1] bg-panel/95 px-3.5 pt-2 pb-1.5 text-[13px] font-semibold text-muted backdrop-blur-sm">
                  {group.label}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.notes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    selected={!phone && note.id === selectedId}
                    query={query}
                    deletedView={deletedView}
                    folderName={query && note.folderId ? (folders.get(note.folderId)?.name ?? null) : null}
                    actions={rowActions}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {phone && !deletedView && (
        <button
          type="button"
          aria-label="New note"
          onClick={() => {
            primeKeyboard();
            store.createNote();
          }}
          className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-20 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform active:scale-95"
        >
          <ComposeIcon size={24} strokeWidth={2} />
        </button>
      )}
    </section>
  );
}
