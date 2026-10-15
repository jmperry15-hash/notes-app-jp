import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
export { cx };

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tone?: 'default' | 'accent' }
>(function IconButton({ label, active, tone = 'default', className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={props.title ?? label}
      className={cx(
        'inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-1.5 transition-colors duration-150',
        'disabled:opacity-35',
        tone === 'accent' ? 'text-accent hover:bg-accent-soft' : 'text-muted hover:bg-hover hover:text-ink',
        active && 'bg-accent-soft !text-accent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function Button({
  variant = 'secondary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-[background-color,opacity,transform] duration-150 active:scale-[0.985] disabled:opacity-45 disabled:active:scale-100',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-strong',
        variant === 'secondary' && 'bg-input text-ink hover:bg-hover',
        variant === 'danger' && 'bg-input text-danger hover:bg-hover',
        variant === 'ghost' && 'text-accent hover:bg-accent-soft',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-12 w-full rounded-xl border border-line bg-input px-4 text-[17px] text-ink placeholder:text-faint',
        'outline-none transition-colors focus:border-accent/60 focus:bg-transparent focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      aria-hidden="true"
    />
  );
}

/** Text with every case-insensitive occurrence of `query` highlighted. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="hit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

/** A small popover menu anchored to its trigger button. */
export function Menu({
  label,
  trigger,
  items,
  align = 'right',
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cx('relative', className)}>
      <IconButton
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        active={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </IconButton>
      {open && (
        <div
          role="menu"
          className={cx(
            'animate-rise-in absolute top-full z-40 mt-1 min-w-48 overflow-hidden rounded-xl border border-line-strong bg-elevated p-1 shadow-[var(--c-shadow)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] hover:bg-hover',
                item.destructive ? 'text-danger' : 'text-ink',
              )}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <span className="text-muted">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
