import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAutoLock } from '../hooks/useAutoLock';
import { useLayout } from '../hooks/useLayout';
import { useShortcuts } from '../hooks/useShortcuts';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { store, useApp, type MobileScreen } from '../state/store';
import { EditorPane } from './EditorPane';
import { NoteList } from './NoteList';
import { cx } from './primitives';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar } from './Sidebar';

/** A draggable divider between panes. */
function Divider({ onDrag, onCommit, label }: { onDrag: (dx: number) => void; onCommit: () => void; label: string }) {
  const start = useRef<number | null>(null);
  return (
    <div className="relative w-px shrink-0 bg-line">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        className="absolute inset-y-0 -left-[3px] z-10 w-[7px] cursor-col-resize transition-colors hover:bg-accent/30 active:bg-accent/40"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = event.clientX;
        }}
        onPointerMove={(event) => {
          if (start.current === null) return;
          onDrag(event.clientX - start.current);
        }}
        onPointerUp={() => {
          start.current = null;
          onCommit();
        }}
        onPointerCancel={() => {
          start.current = null;
          onCommit();
        }}
      />
    </div>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function DesktopLayout({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const prefs = useApp((s) => s.prefs);
  const [sidebar, setSidebar] = useState(prefs.sidebarWidth);
  const [list, setList] = useState(prefs.listWidth);
  const base = useRef({ sidebar, list });

  return (
    <div className="flex h-full pl-safe pr-safe">
      {!prefs.sidebarCollapsed && (
        <>
          <div style={{ width: sidebar }} className="animate-slide-in-left shrink-0">
            <Sidebar variant="sidebar" />
          </div>
          <Divider
            label="Resize sidebar"
            onDrag={(dx) => setSidebar(clamp(base.current.sidebar + dx, 180, 360))}
            onCommit={() => {
              base.current.sidebar = sidebar;
              store.setPrefs({ sidebarWidth: sidebar });
            }}
          />
        </>
      )}
      <div style={{ width: list }} className="shrink-0">
        <NoteList layout="desktop" searchRef={searchRef} />
      </div>
      <Divider
        label="Resize note list"
        onDrag={(dx) => setList(clamp(base.current.list + dx, 240, 520))}
        onCommit={() => {
          base.current.list = list;
          store.setPrefs({ listWidth: list });
        }}
      />
      <div className="min-w-0 flex-1">
        <EditorPane layout="desktop" />
      </div>
    </div>
  );
}

function TabletLayout({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const foldersOpen = useApp((s) => s.foldersOpen);
  const prefs = useApp((s) => s.prefs);
  const [list, setList] = useState(clamp(prefs.listWidth, 260, 400));
  const base = useRef(list);

  return (
    <div className="relative flex h-full pl-safe pr-safe">
      <div style={{ width: list }} className="shrink-0">
        <NoteList layout="tablet" searchRef={searchRef} />
      </div>
      <Divider
        label="Resize note list"
        onDrag={(dx) => setList(clamp(base.current + dx, 260, 460))}
        onCommit={() => {
          base.current = list;
          store.setPrefs({ listWidth: list });
        }}
      />
      <div className="min-w-0 flex-1">
        <EditorPane layout="tablet" />
      </div>
      {foldersOpen && (
        <div className="animate-fade-in fixed inset-0 z-30 bg-[var(--c-overlay)]" onPointerDown={() => store.setFoldersOpen(false)}>
          <div
            className="animate-slide-in-left h-full w-[300px] max-w-[85vw] border-r border-line shadow-[var(--c-shadow)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Sidebar variant="overlay" />
          </div>
        </div>
      )}
    </div>
  );
}

const DEPTH: Record<MobileScreen, number> = { folders: 0, list: 1, editor: 2 };

function StackScreen({ depth, current, children }: { depth: number; current: number; children: ReactNode }) {
  const offset = depth < current ? '-28%' : depth > current ? '100%' : '0';
  const visible = depth === current;
  return (
    <div
      className={cx('stack-screen absolute inset-0 overflow-hidden', depth > current && 'pointer-events-none', depth < current && 'opacity-60')}
      style={{ transform: `translateX(${offset})`, zIndex: depth }}
      aria-hidden={!visible}
      inert={!visible}
    >
      {children}
    </div>
  );
}

function PhoneLayout({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const screen = useApp((s) => s.mobileScreen);
  const hasNote = useApp((s) => s.selectedNoteId !== null);
  const current = DEPTH[hasNote ? screen : screen === 'editor' ? 'list' : screen];

  return (
    <div className="relative h-full overflow-hidden bg-bg">
      <StackScreen depth={0} current={current}>
        <Sidebar variant="screen" />
      </StackScreen>
      <StackScreen depth={1} current={current}>
        <NoteList layout="phone" searchRef={searchRef} />
      </StackScreen>
      <StackScreen depth={2} current={current}>
        <EditorPane layout="phone" />
      </StackScreen>
    </div>
  );
}

/** The unlocked app: three columns on desktop, two on tablet, a navigation stack on iPhone. */
export function Shell() {
  const layout = useLayout();
  useVisualViewport();
  const autoLockMinutes = useApp((s) => s.prefs.autoLockMinutes);
  useAutoLock(autoLockMinutes);
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    const state = store.getState();
    if (state.layout === 'phone' && state.mobileScreen !== 'list') store.selectView(state.view);
    if (state.layout === 'tablet' && state.foldersOpen) store.setFoldersOpen(false);
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
  }, []);
  useShortcuts(focusSearch);

  // Keep the browser's Back gesture/button from leaving the app on phones: it steps back instead.
  useEffect(() => {
    if (layout !== 'phone') return;
    const onPop = () => {
      if (store.getState().mobileScreen !== 'folders') {
        store.goBack();
        history.pushState(null, '');
      }
    };
    history.pushState(null, '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [layout]);

  return (
    <>
      {layout === 'desktop' && <DesktopLayout searchRef={searchRef} />}
      {layout === 'tablet' && <TabletLayout searchRef={searchRef} />}
      {layout === 'phone' && <PhoneLayout searchRef={searchRef} />}
      <SettingsPanel />
    </>
  );
}
