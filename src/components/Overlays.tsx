import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { dialogs, dismissToast, useUi, type DialogRequest } from '../state/ui';
import { Button, cx, Spinner, TextInput } from './primitives';

function PromptBody({ request }: { request: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(request.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.select(), 30);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const problem = request.validate?.(value) ?? (value.trim() ? null : 'Please enter something.');
        if (problem) setError(problem);
        else request.resolve(value);
      }}
    >
      <TextInput
        ref={input}
        autoFocus
        value={value}
        type={request.secure ? 'password' : 'text'}
        autoComplete="off"
        autoCapitalize={request.secure ? 'off' : 'sentences'}
        spellCheck={!request.secure}
        placeholder={request.placeholder}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        aria-invalid={!!error}
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={() => request.resolve(null)}>Cancel</Button>
        <Button variant="primary" type="submit">
          {request.confirmLabel ?? 'OK'}
        </Button>
      </div>
    </form>
  );
}

/** Renders whichever confirm / prompt / choose dialog is open. */
export function DialogHost() {
  const request = useUi((s) => s.dialog);
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && dialogs.dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);
  if (!request) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-[var(--c-overlay)] p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"
      onPointerDown={(event) => event.target === event.currentTarget && dialogs.dismiss()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="animate-rise-in w-full max-w-sm rounded-2xl border border-line bg-elevated p-5 shadow-[var(--c-shadow)]"
      >
        <h2 id="dialog-title" className="text-[17px] font-semibold">
          {request.title}
        </h2>
        {request.message && <p className="mt-1.5 text-[15px] leading-snug text-muted">{request.message}</p>}
        <div className="mt-4">
          {request.kind === 'confirm' && (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => request.resolve(false)}>{request.cancelLabel ?? 'Cancel'}</Button>
              <Button
                autoFocus
                variant={request.destructive ? 'danger' : 'primary'}
                className={request.destructive ? '!bg-danger !text-white hover:opacity-90' : ''}
                onClick={() => request.resolve(true)}
              >
                {request.confirmLabel ?? 'OK'}
              </Button>
            </div>
          )}
          {request.kind === 'prompt' && <PromptBody request={request} />}
          {request.kind === 'choose' && (
            <div className="flex flex-col gap-1">
              <div className="scroll-area -mx-1 max-h-[50dvh]">
                {request.options.map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] hover:bg-hover"
                    onClick={() => request.resolve(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.detail && <span className="ml-3 shrink-0 text-sm text-faint">{option.detail}</span>}
                  </button>
                ))}
              </div>
              <Button className="mt-2" onClick={() => request.resolve(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-[max(16px,calc(env(safe-area-inset-bottom)+12px))]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'animate-rise-in pointer-events-auto flex max-w-md items-center gap-4 rounded-xl border border-line-strong bg-elevated px-4 py-3 text-[15px] shadow-[var(--c-shadow)]',
            t.tone === 'error' && 'text-danger',
          )}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="shrink-0 font-semibold text-accent"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useApp((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-[var(--c-overlay)]">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-elevated px-5 py-4 shadow-[var(--c-shadow)]">
        <Spinner className="text-accent" />
        <span className="text-[15px]">{busy}</span>
      </div>
    </div>
  );
}
