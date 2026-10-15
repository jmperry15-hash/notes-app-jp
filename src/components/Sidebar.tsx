import { useMemo, type ReactNode } from 'react';
import { countNotes, liveFolders, sameView, type FolderView } from '../state/selectors';
import { store, useApp } from '../state/store';
import { deleteFolder, primeKeyboard, promptNewFolder, renameFolder } from './actions';
import { ChevronRight, ComposeIcon, FolderIcon, LockIcon, MoreIcon, NotesIcon, PlusIcon, SettingsIcon, SidebarIcon, TrashIcon } from './icons';
import { cx, IconButton, Menu } from './primitives';
import { SyncBadge } from './SyncBadge';


function Row({
  icon,
  label,
  count,
  active,
  onSelect,
  menu,
  large,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  menu?: ReactNode;
  large: boolean;
}) {
  return (
    <div
      className={cx(
        'group relative flex items-center rounded-xl transition-colors duration-150',
        active ? 'bg-select' : 'hover:bg-hover',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={cx('flex min-w-0 flex-1 items-center gap-3 text-left', large ? 'h-[52px] px-3.5 text-[17px]' : 'h-10 px-3 text-[15px]')}
      >
        <span className={active ? 'text-accent' : 'text-accent/80'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cx('tabular-nums text-faint', large ? 'text-[16px]' : 'text-[13px]', !!menu && !large && 'group-hover:opacity-0 group-focus-within:opacity-0')}>
          {count}
        </span>
        {large && <ChevronRight size={18} className="text-faint" />}
      </button>
      {menu && (
        <div className={cx(large ? 'pr-1' : 'absolute right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100')}>
          {menu}
        </div>
      )}
    </div>
  );
}

/** Folder navigation: the desktop sidebar, the tablet slide-over, and the first screen on iPhone. */
export function Sidebar({ variant }: { variant: 'sidebar' | 'overlay' | 'screen' }) {
  const notes = useApp((s) => s.notes);
  const folderMap = useApp((s) => s.folders);
  const view = useApp((s) => s.view);
  const counts = useMemo(() => countNotes(notes), [notes]);
  const folders = useMemo(() => liveFolders(folderMap), [folderMap]);
  const large = variant === 'screen';
  const select = (next: FolderView) => store.selectView(next);

  return (
    <nav aria-label="Folders" className={cx('chrome flex h-full flex-col', large ? 'bg-bg' : 'bg-sidebar')}>
      {large ? (
        <header className="pt-safe pl-safe pr-safe shrink-0">
          <div className="flex h-12 items-center justify-end gap-1 px-3">
            <SyncBadge />
            <IconButton label="Lock" onClick={() => void store.lock('manual')}>
              <LockIcon />
            </IconButton>
            <IconButton label="Settings" onClick={() => store.setSettingsOpen(true)}>
              <SettingsIcon />
            </IconButton>
          </div>
          <h1 className="px-5 pb-3 text-[32px] font-bold tracking-tight">Folders</h1>
        </header>
      ) : (
        <header className={cx('flex h-[52px] shrink-0 items-center gap-1 px-3', variant === 'overlay' && 'pt-safe box-content')}>
          <span className="ml-1 flex-1 text-[15px] font-semibold tracking-tight text-muted">Folio</span>
          <IconButton
            label={variant === 'overlay' ? 'Close folders' : 'Hide sidebar'}
            onClick={() => (variant === 'overlay' ? store.setFoldersOpen(false) : store.setPrefs({ sidebarCollapsed: true }))}
          >
            <SidebarIcon />
          </IconButton>
        </header>
      )}

      <div className={cx('scroll-area min-h-0 flex-1', large ? 'pr-[max(0.75rem,env(safe-area-inset-right))] pb-28 pl-[max(0.75rem,env(safe-area-inset-left))]' : 'px-2 pb-4')}>
        <div className={cx(large && 'rounded-2xl bg-panel p-1')}>
          <Row
            large={large}
            icon={<NotesIcon />}
            label="All Notes"
            count={counts.all}
            active={!large && sameView(view, { kind: 'all' })}
            onSelect={() => select({ kind: 'all' })}
          />
        </div>

        <div className={cx('flex items-center justify-between', large ? 'mt-6 mb-2 px-2' : 'mt-5 mb-1 px-3')}>
          <h2 className={cx('font-semibold', large ? 'text-[20px]' : 'text-[12px] tracking-wide text-faint uppercase')}>Folders</h2>
          <IconButton label="New folder" tone="accent" onClick={() => void promptNewFolder()} className={large ? '' : 'h-7 min-w-7'}>
            <PlusIcon size={large ? 22 : 17} />
          </IconButton>
        </div>
        {folders.length === 0 ? (
          <p className={cx('text-faint', large ? 'px-2 text-[15px]' : 'px-3 text-[13px]')}>No folders yet.</p>
        ) : (
          <div className={cx(large && 'rounded-2xl bg-panel p-1')}>
            {folders.map((folder) => {
              const count = counts.byFolder.get(folder.id) ?? 0;
              return (
                <Row
                  key={folder.id}
                  large={large}
                  icon={<FolderIcon />}
                  label={folder.name}
                  count={count}
                  active={!large && sameView(view, { kind: 'folder', id: folder.id })}
                  onSelect={() => select({ kind: 'folder', id: folder.id })}
                  menu={
                    <Menu
                      label={`Options for ${folder.name}`}
                      trigger={<MoreIcon size={18} />}
                      items={[
                        { label: 'Rename', onSelect: () => void renameFolder(folder.id, folder.name) },
                        { label: 'Delete Folder', destructive: true, onSelect: () => void deleteFolder(folder.id, folder.name, count) },
                      ]}
                    />
                  }
                />
              );
            })}
          </div>
        )}

        <div className={cx(large ? 'mt-6 rounded-2xl bg-panel p-1' : 'mt-5')}>
          <Row
            large={large}
            icon={<TrashIcon />}
            label="Recently Deleted"
            count={counts.deleted}
            active={!large && sameView(view, { kind: 'deleted' })}
            onSelect={() => select({ kind: 'deleted' })}
          />
        </div>
      </div>

      {!large && (
        <footer className="flex shrink-0 items-center gap-1 border-t border-line px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex-1 pl-1">
            <SyncBadge />
          </div>
          <IconButton label="Lock (⌘L)" onClick={() => void store.lock('manual')}>
            <LockIcon />
          </IconButton>
          <IconButton label="Settings" onClick={() => store.setSettingsOpen(true)}>
            <SettingsIcon />
          </IconButton>
        </footer>
      )}

      {large && (
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
    </nav>
  );
}
