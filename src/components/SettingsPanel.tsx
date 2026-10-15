import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BackupFile } from '../lib/backup';
import { formatRelative } from '../lib/dates';
import { MIN_PASSCODE_LENGTH, passcodeStrength } from '../lib/passcode';
import { AUTO_LOCK_OPTIONS, type ThemePref } from '../lib/prefs';
import { store, useApp } from '../state/store';
import { dialogs, errorMessage, toast } from '../state/ui';
import { ChevronLeft, CloseIcon } from './icons';
import { Button, cx, IconButton, Spinner, TextInput } from './primitives';


function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mt-6 first:mt-2">
      <h3 className="mb-2 px-1 text-[13px] font-semibold tracking-wide text-faint uppercase">{title}</h3>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">{children}</div>
      {footer && <p className="mt-2 px-1 text-[13px] leading-snug text-faint">{footer}</p>}
    </section>
  );
}

function Row({ label, detail, children }: { label: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px]">{label}</p>
        {detail && <p className="text-[13px] leading-snug text-muted">{detail}</p>}
      </div>
      {children}
    </div>
  );
}

function ActionRow({ label, detail, onClick, tone = 'accent', disabled }: { label: string; detail?: string; onClick: () => void; tone?: 'accent' | 'danger'; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center px-4 py-2.5 text-left transition-colors hover:bg-hover disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className={cx('block text-[15px]', tone === 'danger' ? 'text-danger' : 'text-accent')}>{label}</span>
        {detail && <span className="block text-[13px] leading-snug text-muted">{detail}</span>}
      </span>
    </button>
  );
}

function ChangePasscode({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passcodeStrength(next);
  const valid = current.length > 0 && next.length >= MIN_PASSCODE_LENGTH && next === confirm && next !== current;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await store.changePasscode(current, next);
      toast('Passcode changed. Download a new backup — old backups still need the old passcode.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <TextInput
      type="password"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder={label}
      aria-label={label}
      value={value}
      onChange={(e) => {
        set(e.target.value);
        setError(null);
      }}
    />
  );

  return (
    <form className="flex flex-col gap-3 pt-2" onSubmit={submit}>
      <p className="text-[14px] leading-relaxed text-muted">
        Every note and folder is re-encrypted with the new passcode, on this device and on the server, in a single step.
        Your other devices will ask for the new passcode.
      </p>
      {field('Current passcode', current, setCurrent)}
      {field(`New passcode (at least ${MIN_PASSCODE_LENGTH} characters)`, next, setNext)}
      {next && (
        <p className="text-[13px] text-muted">
          <strong className="text-ink">{strength.label}.</strong> {strength.hint}
        </p>
      )}
      {field('Confirm new passcode', confirm, setConfirm)}
      {confirm && confirm !== next && <p className="text-[13px] text-danger">The new passcodes don’t match.</p>}
      {error && <p className="text-[14px] text-danger">{error}</p>}
      <Button variant="primary" type="submit" disabled={!valid || busy} className="mt-1">
        {busy ? <Spinner /> : 'Change passcode'}
      </Button>
    </form>
  );
}

export function SettingsPanel() {
  const open = useApp((s) => s.settingsOpen);
  const prefs = useApp((s) => s.prefs);
  const account = useApp((s) => s.account);
  const sync = useApp((s) => s.sync);
  const noteCount = useApp((s) => s.notes.size);
  const undecryptable = useApp((s) => s.undecryptable);
  const authKind = useApp((s) => s.authKind);
  const [page, setPage] = useState<'main' | 'passcode'>('main');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setPage('main');
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]:not([data-settings])') && store.setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const close = () => store.setSettingsOpen(false);

  const restore = async (file: File) => {
    let backup: BackupFile;
    try {
      backup = await store.readBackupFile(file);
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
      return;
    }
    const passcode = await dialogs.prompt({
      title: 'Restore Backup',
      message: `Backup from ${new Date(backup.createdAt).toLocaleString()} with ${backup.notes.length} notes. Enter the passcode that was in use when it was made.`,
      secure: true,
      placeholder: 'Passcode for this backup',
      confirmLabel: 'Restore',
    });
    if (!passcode) return;
    try {
      const result = await store.restoreFromBackup(backup, passcode);
      const parts = [`${result.added} added`, `${result.updated} updated`, `${result.unchanged} already up to date`];
      if (result.failed) parts.push(`${result.failed} unreadable`);
      toast(`Restore complete: ${parts.join(', ')}.`);
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
    }
  };

  const exportMarkdown = async () => {
    const ok = await dialogs.confirm({
      title: 'Export unencrypted notes?',
      message:
        'The .zip file will contain all your notes as plain Markdown, NOT encrypted. Anyone who gets the file can read them. Store it carefully and delete it when you’re done.',
      confirmLabel: 'Export',
    });
    if (ok) toast(`Exported ${store.exportMarkdown()} notes`);
  };

  const signOut = async () => {
    const pending = await store.pendingChangeCount();
    const ok = await dialogs.confirm({
      title: 'Sign out of this device?',
      message:
        pending > 0
          ? `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} synced yet and will be lost. The encrypted copy on this device is erased.`
          : 'The encrypted copy on this device is erased. Your notes stay safe in your account.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (ok) await store.signOut();
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-40 flex items-stretch justify-center bg-[var(--c-overlay)] sm:items-center sm:p-6"
      onPointerDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-settings
        className="animate-sheet-in sm:animate-rise-in flex h-full w-full flex-col bg-bg sm:h-auto sm:max-h-[86dvh] sm:max-w-lg sm:rounded-3xl sm:border sm:border-line sm:shadow-[var(--c-shadow)]"
      >
        <header className="pt-safe chrome flex shrink-0 items-center gap-2 border-b border-line px-3 sm:pt-0">
          <div className="flex h-14 w-full items-center gap-2">
            {page === 'passcode' ? (
              <button type="button" onClick={() => setPage('main')} className="flex h-10 items-center gap-0.5 pr-2 text-[17px] text-accent">
                <ChevronLeft size={24} strokeWidth={2.2} /> Settings
              </button>
            ) : (
              <h2 className="ml-2 flex-1 text-[17px] font-semibold">Settings</h2>
            )}
            <div className="flex-1" />
            <IconButton label="Close settings" onClick={close}>
              <CloseIcon />
            </IconButton>
          </div>
        </header>

        <div className="scroll-area min-h-0 flex-1 pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(24px,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
          {page === 'passcode' ? (
            <ChangePasscode onDone={() => setPage('main')} />
          ) : (
            <>
              <Section title="Security" footer="Folio locks itself and forgets your passcode key when you step away.">
                <Row label="Auto-lock" detail="After inactivity, or this long in the background">
                  <select
                    value={prefs.autoLockMinutes}
                    onChange={(e) => store.setPrefs({ autoLockMinutes: Number(e.target.value) })}
                    className="rounded-lg bg-input px-2 py-1.5 text-[15px] text-ink outline-none"
                    aria-label="Auto-lock after"
                  >
                    {AUTO_LOCK_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`}
                      </option>
                    ))}
                  </select>
                </Row>
                <ActionRow label="Change Passcode" onClick={() => setPage('passcode')} />
                <ActionRow label="Lock Now" onClick={() => void store.lock('manual')} />
              </Section>

              <Section title="Appearance">
                <Row label="Theme">
                  <div className="flex rounded-lg bg-input p-0.5" role="radiogroup" aria-label="Theme">
                    {(['system', 'light', 'dark'] as ThemePref[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        role="radio"
                        aria-checked={prefs.theme === theme}
                        onClick={() => store.setPrefs({ theme })}
                        className={cx(
                          'rounded-md px-3 py-1.5 text-[14px] capitalize transition-colors',
                          prefs.theme === theme ? 'bg-elevated text-ink shadow-sm' : 'text-muted hover:text-ink',
                        )}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </Row>
              </Section>

              <Section
                title="Backup & Export"
                footer="Encrypted backups can only be opened with the passcode in use when they were made. A forgotten passcode cannot be recovered."
              >
                <ActionRow
                  label="Download Encrypted Backup"
                  detail={prefs.lastBackupAt ? `Last backup ${formatRelative(prefs.lastBackupAt)}` : 'No backup downloaded yet'}
                  onClick={() =>
                    store.downloadBackup().then(
                      () => toast('Encrypted backup downloaded'),
                      (err) => toast(errorMessage(err), { tone: 'error' }),
                    )
                  }
                />
                <ActionRow label="Restore from Backup…" detail="Adds notes from a backup file; nothing is overwritten with older versions" onClick={() => fileInput.current?.click()} />
                <ActionRow label="Export as Markdown (.zip)" detail="Unencrypted — readable by anyone with the file" onClick={() => void exportMarkdown()} />
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void restore(file);
                  }}
                />
              </Section>

              <Section title="Account">
                <Row label={account?.email || 'Signed in'} detail={authKind === 'demo' ? 'Demo mode (development only)' : 'Supabase account'} />
                <Row
                  label="Sync"
                  detail={
                    sync.status === 'error'
                      ? `Error: ${sync.error}`
                      : sync.lastSyncedAt
                        ? `Last synced ${formatRelative(sync.lastSyncedAt)}`
                        : sync.status === 'offline'
                          ? 'Offline — changes will sync when you reconnect'
                          : 'Not synced yet'
                  }
                >
                  <Button variant="secondary" className="!min-h-9 !px-3 !text-[14px]" onClick={() => store.syncNow()}>
                    Sync Now
                  </Button>
                </Row>
                <ActionRow label="Sign Out" tone="danger" onClick={() => void signOut()} />
              </Section>

              <p className="mt-8 mb-2 text-center text-[12px] leading-relaxed text-faint">
                Folio {__APP_VERSION__} · {noteCount} notes · End-to-end encrypted with AES-256-GCM
                {undecryptable > 0 && (
                  <>
                    <br />
                    <span className="text-danger">{undecryptable} item(s) couldn’t be decrypted on this device.</span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
