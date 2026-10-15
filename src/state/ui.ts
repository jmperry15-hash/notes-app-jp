import { useSyncExternalStore } from 'react';

/** Small promise-based dialogs and toasts, rendered by <DialogHost/> and <ToastHost/>. */

export interface DialogOption<T> {
  label: string;
  value: T;
  detail?: string;
}

export type DialogRequest =
  | {
      kind: 'confirm';
      title: string;
      message?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: 'prompt';
      title: string;
      message?: string;
      initial?: string;
      placeholder?: string;
      confirmLabel?: string;
      secure?: boolean;
      validate?: (value: string) => string | null;
      resolve: (value: string | null) => void;
    }
  | {
      kind: 'choose';
      title: string;
      message?: string;
      options: DialogOption<unknown>[];
      resolve: (value: unknown) => void;
    };

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: 'normal' | 'error';
}

interface UiState {
  dialog: DialogRequest | null;
  toasts: Toast[];
}

let state: UiState = { dialog: null, toasts: [] };
const listeners = new Set<() => void>();
const emit = (next: Partial<UiState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function open<R>(build: (resolve: (value: R) => void) => DialogRequest): Promise<R> {
  // Only one dialog at a time: a new one cancels the previous.
  const previous = state.dialog;
  if (previous) {
    if (previous.kind === 'confirm') previous.resolve(false);
    else previous.resolve(null);
  }
  return new Promise<R>((resolve) => {
    emit({
      dialog: build((value) => {
        emit({ dialog: null });
        resolve(value);
      }),
    });
  });
}

export const dialogs = {
  confirm(options: Omit<Extract<DialogRequest, { kind: 'confirm' }>, 'kind' | 'resolve'>): Promise<boolean> {
    return open<boolean>((resolve) => ({ kind: 'confirm', ...options, resolve }));
  },
  prompt(options: Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'kind' | 'resolve'>): Promise<string | null> {
    return open<string | null>((resolve) => ({ kind: 'prompt', ...options, resolve }));
  },
  choose<T>(options: { title: string; message?: string; options: DialogOption<T>[] }): Promise<T | null> {
    return open<T | null>((resolve) => ({
      kind: 'choose',
      ...options,
      options: options.options as DialogOption<unknown>[],
      resolve: resolve as (value: unknown) => void,
    }));
  },
  dismiss() {
    const current = state.dialog;
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(false);
    else current.resolve(null);
  },
};

let toastId = 0;

export function toast(message: string, options: { action?: Toast['action']; tone?: Toast['tone']; duration?: number } = {}) {
  const id = ++toastId;
  emit({ toasts: [...state.toasts.slice(-2), { id, message, action: options.action, tone: options.tone }] });
  window.setTimeout(() => dismissToast(id), options.duration ?? (options.action ? 6000 : 3500));
}

export function dismissToast(id: number) {
  emit({ toasts: state.toasts.filter((t) => t.id !== id) });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
