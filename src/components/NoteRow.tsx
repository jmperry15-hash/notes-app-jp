import { memo, useRef, useState, type PointerEvent } from 'react';
import { formatListDate } from '../lib/dates';
import { displayTitle } from '../lib/noteText';
import { daysLeft } from '../lib/purge';
import type { Note } from '../lib/types';
import { FolderIcon, PinIcon, RestoreIcon, TrashIcon } from './icons';
import { cx, Highlight } from './primitives';

const THRESHOLD = 76;
const MAX_PULL = 150;

export interface RowActions {
  onSelect: (id: string) => void;
  /** Swipe right: pin/unpin (or restore, in Recently Deleted). */
  onSwipeRight: (id: string) => void;
  /** Swipe left: delete (or delete permanently, in Recently Deleted). */
  onSwipeLeft: (id: string) => void;
}

function snippet(note: Note, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q || note.title.toLowerCase().includes(q)) return note.preview;
  const body = note.text.replace(/\s+/g, ' ');
  const at = body.toLowerCase().indexOf(q);
  if (at === -1) return note.preview;
  // Start a few words before the match so the highlight is visible in a narrow row.
  let start = Math.max(0, at - 14);
  const space = body.lastIndexOf(' ', at - 1);
  if (space >= start) start = space + 1;
  return `${start > 0 ? '…' : ''}${body.slice(start, start + 140)}`;
}

/** One note in the list. On touch screens, swipe left to delete and right to pin. */
export const NoteRow = memo(function NoteRow({
  note,
  selected,
  query,
  deletedView,
  folderName,
  actions,
}: {
  note: Note;
  selected: boolean;
  query: string;
  deletedView: boolean;
  folderName: string | null;
  actions: RowActions;
}) {
  const [offset, setOffsetState] = useState(0);
  const [settling, setSettling] = useState(false);
  // The live drag distance; a ref so the release handler never sees a stale render.
  const offsetRef = useRef(0);
  const setOffset = (value: number) => {
    offsetRef.current = value;
    setOffsetState(value);
  };
  const gesture = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const swiped = useRef(false);

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, horizontal: null };
    swiped.current = false;
    setSettling(false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!g.horizontal) {
        gesture.current = null;
        return;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // the pointer may already be gone
      }
    }
    swiped.current = true;
    setOffset(Math.max(-MAX_PULL, Math.min(MAX_PULL, dx)));
  };

  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.horizontal) return;
    setSettling(true);
    const distance = offsetRef.current;
    if (distance <= -THRESHOLD) {
      setOffset(-window.innerWidth);
      window.setTimeout(() => {
        actions.onSwipeLeft(note.id);
        setSettling(false);
        setOffset(0);
      }, 200);
    } else {
      if (distance >= THRESHOLD) actions.onSwipeRight(note.id);
      setOffset(0);
    }
  };

  const cancel = () => {
    gesture.current = null;
    setSettling(true);
    setOffset(0);
  };

  const remaining = note.deletedAt !== null ? daysLeft(note.deletedAt, Date.now()) : 0;
  const date = deletedView ? `${remaining} ${remaining === 1 ? 'day' : 'days'} left` : formatListDate(note.updatedAt);
  const preview = snippet(note, query) || 'No additional text';
  const rightLabel = deletedView ? 'Restore' : note.pinned ? 'Unpin' : 'Pin';

  return (
    <li className="relative list-none overflow-hidden rounded-xl">
      {offset !== 0 && (
        <div className="absolute inset-0 flex items-stretch" aria-hidden="true">
          {offset > 0 ? (
            <div className={cx('flex flex-1 items-center gap-2 pl-5 font-medium text-accent-ink', offset >= THRESHOLD ? 'bg-accent' : 'bg-accent/60')}>
              {deletedView ? <RestoreIcon /> : <PinIcon filled={!note.pinned} />}
              {rightLabel}
            </div>
          ) : (
            <div className={cx('flex flex-1 items-center justify-end gap-2 pr-5 font-medium text-white', offset <= -THRESHOLD ? 'bg-danger' : 'bg-danger/60')}>
              Delete
              <TrashIcon />
            </div>
          )}
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          actions.onSelect(note.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            actions.onSelect(note.id);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, touchAction: 'pan-y' }}
        className={cx(
          'chrome relative rounded-xl px-3.5 py-2.5 outline-offset-[-2px]',
          settling && 'transition-transform duration-200 ease-out',
          selected ? 'bg-select' : 'bg-panel hover:bg-[color-mix(in_srgb,var(--c-panel),var(--c-text)_4%)]',
        )}
      >
        <div className="flex items-center gap-1.5">
          {note.pinned && !deletedView && <PinIcon size={13} filled className="shrink-0 text-accent" />}
          <h3 className="truncate text-[15px] leading-6 font-semibold">
            <Highlight text={displayTitle(note.title)} query={query} />
          </h3>
        </div>
        <p className="flex gap-2 text-[14px] leading-5">
          <span className="shrink-0 text-ink/80">{date}</span>
          <span className="truncate text-muted">
            <Highlight text={preview} query={query} />
          </span>
        </p>
        {folderName && (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-faint">
            <FolderIcon size={12} /> {folderName}
          </p>
        )}
      </div>
    </li>
  );
});
