import { formatRelative } from '../lib/dates';
import { store, useApp } from '../state/store';
import { cx } from './primitives';

const LABELS = {
  idle: 'Ready',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Offline',
  error: 'Sync error',
} as const;

/** A small, quiet sync indicator. Tap to sync now. */
export function SyncBadge() {
  const sync = useApp((s) => s.sync);
  const demo = useApp((s) => s.authKind === 'demo');
  const title =
    sync.status === 'error'
      ? `Sync error: ${sync.error ?? 'unknown'} — tap to retry`
      : sync.lastSyncedAt
        ? `Last synced ${formatRelative(sync.lastSyncedAt)} — tap to sync now`
        : 'Tap to sync now';

  return (
    <button
      type="button"
      onClick={() => store.syncNow()}
      title={title}
      aria-label={`${LABELS[sync.status]}. ${title}`}
      className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] text-faint transition-colors hover:bg-hover hover:text-muted"
    >
      <span
        className={cx(
          'h-[7px] w-[7px] rounded-full',
          sync.status === 'synced' && 'bg-[#6fbf73]/80',
          sync.status === 'syncing' && 'animate-pulse bg-accent',
          sync.status === 'offline' && 'bg-faint',
          sync.status === 'error' && 'bg-danger',
          sync.status === 'idle' && 'bg-line-strong',
        )}
      />
      {LABELS[sync.status]}
      {demo && <span className="text-accent/70">· demo</span>}
    </button>
  );
}
