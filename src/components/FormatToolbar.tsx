import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { editLink } from './links';
import { BulletListIcon, ChecklistIcon, KeyboardDownIcon, LinkIcon, NumberListIcon } from './icons';
import { cx } from './primitives';

type TextStyle = 'title' | 'heading' | 'subheading' | 'body';

const STYLES: { id: TextStyle; label: string; className: string }[] = [
  { id: 'title', label: 'Title', className: 'text-[20px] font-bold' },
  { id: 'heading', label: 'Heading', className: 'text-[17px] font-semibold' },
  { id: 'subheading', label: 'Subheading', className: 'text-[15px] font-semibold' },
  { id: 'body', label: 'Body', className: 'text-[15px]' },
];

function ToolButton({
  label,
  active,
  onPress,
  children,
  className,
  compact,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Keep the editor focused so the iOS keyboard stays up.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onPress}
      className={cx(
        'inline-flex h-9 shrink-0 items-center justify-center rounded-lg text-[16px] transition-colors duration-150',
        compact ? 'min-w-8 px-1' : 'min-w-9 px-1.5',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Formatting controls. On larger screens they sit at the top of the editor; on iPhone they ride
 * just above the keyboard while editing.
 */
export function FormatToolbar({ editor, placement }: { editor: Editor; placement: 'top' | 'keyboard' }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: (e.isActive('heading', { level: 1 })
        ? 'title'
        : e.isActive('heading', { level: 2 })
          ? 'heading'
          : e.isActive('heading', { level: 3 })
            ? 'subheading'
            : 'body') as TextStyle,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      link: e.isActive('link'),
    }),
  });
  const [stylesOpen, setStylesOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stylesOpen) return;
    const close = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setStylesOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [stylesOpen]);

  const chain = () => editor.chain().focus();
  const setStyle = (style: TextStyle) => {
    if (style === 'body') chain().setParagraph().run();
    else chain().setHeading({ level: style === 'title' ? 1 : style === 'heading' ? 2 : 3 }).run();
    setStylesOpen(false);
  };
  const compact = placement === 'keyboard';
  // Phones have no room for dividers; every button must fit beside the keyboard.
  const divider = compact ? null : <span className="mx-1 h-5 w-px shrink-0 bg-line-strong" aria-hidden="true" />;

  return (
    <div
      ref={wrapper}
      role="toolbar"
      aria-label="Formatting"
      className={cx(
        'chrome relative flex items-center',
        placement === 'keyboard' && 'border-t border-line bg-elevated/95 py-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur-md',
      )}
    >
      {stylesOpen && (
        <div
          className={cx(
            'animate-rise-in absolute z-30 flex min-w-44 flex-col rounded-xl border border-line-strong bg-elevated p-1 shadow-[var(--c-shadow)]',
            placement === 'keyboard' ? 'bottom-full left-2 mb-2' : 'top-full left-0 mt-1',
          )}
        >
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setStyle(style.id)}
              className={cx(
                'rounded-lg px-3 py-2 text-left hover:bg-hover',
                style.className,
                state.style === style.id ? 'text-accent' : 'text-ink',
              )}
            >
              {style.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToolButton compact={compact} label="Text style" active={stylesOpen} onPress={() => setStylesOpen((v) => !v)} className="px-2 font-semibold">
          Aa
        </ToolButton>
        {divider}
        <ToolButton compact={compact} label="Bold (⌘B)" active={state.bold} onPress={() => chain().toggleBold().run()} className="font-bold">
          B
        </ToolButton>
        <ToolButton compact={compact} label="Italic (⌘I)" active={state.italic} onPress={() => chain().toggleItalic().run()} className="font-serif italic">
          I
        </ToolButton>
        <ToolButton compact={compact} label="Underline (⌘U)" active={state.underline} onPress={() => chain().toggleUnderline().run()} className="underline underline-offset-2">
          U
        </ToolButton>
        <ToolButton compact={compact} label="Strikethrough (⌘⇧S)" active={state.strike} onPress={() => chain().toggleStrike().run()} className="line-through">
          S
        </ToolButton>
        {divider}
        <ToolButton compact={compact} label="Bulleted list" active={state.bullet} onPress={() => chain().toggleBulletList().run()}>
          <BulletListIcon />
        </ToolButton>
        <ToolButton compact={compact} label="Numbered list" active={state.ordered} onPress={() => chain().toggleOrderedList().run()}>
          <NumberListIcon />
        </ToolButton>
        <ToolButton compact={compact} label="Checklist" active={state.task} onPress={() => chain().toggleTaskList().run()}>
          <ChecklistIcon />
        </ToolButton>
        <ToolButton compact={compact} label="Link (⌘K)" active={state.link} onPress={() => void editLink(editor)}>
          <LinkIcon />
        </ToolButton>
      </div>
      {placement === 'keyboard' && (
        <ToolButton compact={compact} label="Hide keyboard" onPress={() => editor.commands.blur()} className="ml-1 text-accent">
          <KeyboardDownIcon />
        </ToolButton>
      )}
    </div>
  );
}
