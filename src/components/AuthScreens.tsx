import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getLockout, MIN_PASSCODE_LENGTH, passcodeStrength } from '../lib/passcode';
import { store, useApp } from '../state/store';
import { dialogs, errorMessage, toast } from '../state/ui';
import { AppIcon } from './AppIcon';
import { ChevronRight } from './icons';
import { Button, cx, Spinner, TextInput } from './primitives';

function CenteredLayout({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-area chrome h-full bg-bg pt-safe pb-safe pl-safe pr-safe">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center px-6 py-10">{children}</div>
    </div>
  );
}

function DemoBanner() {
  const kind = useApp((s) => s.authKind);
  if (kind !== 'demo') return null;
  return (
    <p className="mb-6 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-center text-[13px] leading-snug text-muted">
      <strong className="text-accent">Demo mode.</strong> Supabase isn’t configured, so this development build stores
      its “server” in this browser. Any email and a 6+ character password will do.
    </p>
  );
}

export function SplashScreen() {
  return (
    <CenteredLayout>
      <div className="animate-fade-in opacity-90">
        <AppIcon size={76} />
      </div>
    </CenteredLayout>
  );
}

export function MessageScreen({ kind }: { kind: 'unconfigured' | 'needsNetwork' }) {
  const [busy, setBusy] = useState(false);
  return (
    <CenteredLayout>
      <AppIcon size={76} />
      {kind === 'unconfigured' ? (
        <>
          <h1 className="mt-6 text-xl font-semibold">Almost ready</h1>
          <p className="mt-2 text-center text-[15px] leading-relaxed text-muted">
            This build doesn’t know which Supabase project to use. Add <code className="text-ink">VITE_SUPABASE_URL</code>{' '}
            and <code className="text-ink">VITE_SUPABASE_ANON_KEY</code> as described in the README, then rebuild.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-xl font-semibold">You’re offline</h1>
          <p className="mt-2 text-center text-[15px] leading-relaxed text-muted">
            Connect to the internet once to finish setting up this device. After that, Folio works offline.
          </p>
          <Button
            variant="primary"
            className="mt-6 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await store.retryConnection();
              setBusy(false);
            }}
          >
            {busy ? <Spinner /> : 'Try again'}
          </Button>
        </>
      )}
    </CenteredLayout>
  );
}

export function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        await store.signIn(email, password);
      } else {
        const result = await store.signUp(email, password);
        if (result === 'confirm-email') {
          setNotice('Account created. Check your inbox to confirm your email address, then sign in here.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredLayout>
      <AppIcon size={76} />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Folio</h1>
      <p className="mt-1 mb-8 text-center text-[15px] text-muted">Private notes, encrypted on your devices.</p>
      <DemoBanner />
      <form className="flex w-full flex-col gap-3" onSubmit={submit}>
        <TextInput
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextInput
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="Account password"
          aria-label="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-center text-sm text-danger">{error}</p>}
        {notice && <p className="text-center text-sm text-muted">{notice}</p>}
        <Button variant="primary" type="submit" className="mt-2" disabled={busy || !email.trim() || !password}>
          {busy ? <Spinner /> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <button
        type="button"
        className="mt-6 text-[14px] text-muted hover:text-ink"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
        }}
      >
        {mode === 'signin' ? 'First time here? Create your account' : 'Already have an account? Sign in'}
      </button>
      <p className="mt-6 text-center text-[12px] leading-relaxed text-faint">
        You sign in once per device. Your notes are protected by a separate passcode that never leaves your devices.
      </p>
    </CenteredLayout>
  );
}

function StrengthMeter({ passcode }: { passcode: string }) {
  const strength = passcodeStrength(passcode);
  const colors = ['bg-line-strong', 'bg-danger', 'bg-[#d9903c]', 'bg-accent', 'bg-[#6fbf73]'];
  return (
    <div aria-live="polite">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cx('h-1 flex-1 rounded-full transition-colors duration-200', strength.score >= i ? colors[strength.score] : 'bg-line-strong')}
          />
        ))}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted">
        {strength.label && <strong className="font-semibold text-ink">{strength.label}. </strong>}
        {strength.hint}
      </p>
    </div>
  );
}

export function SetupScreen() {
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== passcode;
  const valid = passcode.length >= MIN_PASSCODE_LENGTH && confirm === passcode && understood;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await store.setupPasscode(passcode);
      if (result === 'exists') toast('A passcode was already set on another device. Enter it to unlock.');
      else toast('Passcode set. Remember to download a backup from Settings.');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <CenteredLayout>
      <AppIcon size={64} />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Create your passcode</h1>
      <p className="mt-2 mb-7 text-center text-[15px] leading-relaxed text-muted">
        It encrypts every note on your device before anything is synced, and it never leaves your devices. You’ll enter
        it each time you open Folio.
      </p>
      <form className="flex w-full flex-col gap-3" onSubmit={submit}>
        <TextInput
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`Passcode (at least ${MIN_PASSCODE_LENGTH} characters)`}
          aria-label="New passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        <StrengthMeter passcode={passcode} />
        <TextInput
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Confirm passcode"
          aria-label="Confirm passcode"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch}
          className={cx('mt-2', mismatch && '!border-danger/60')}
        />
        {mismatch && <p className="text-[13px] text-danger">The passcodes don’t match.</p>}

        <div className="mt-3 rounded-xl border border-accent/35 bg-accent-soft p-4 text-[14px] leading-relaxed">
          <p className="font-semibold text-ink">There is no “forgot passcode”.</p>
          <p className="mt-1 text-muted">
            If you forget it, your notes <strong className="text-ink">cannot be recovered</strong> — not by you, not by
            anyone. Download an encrypted backup from Settings regularly and keep your passcode somewhere safe.
          </p>
          <label className="mt-3 flex items-start gap-3 text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--c-accent)]"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>I understand a forgotten passcode means my notes are lost.</span>
          </label>
        </div>

        {error && <p className="text-center text-sm text-danger">{error}</p>}
        <Button variant="primary" type="submit" className="mt-2" disabled={!valid || busy}>
          {busy ? (
            <>
              <Spinner /> Securing your notes…
            </>
          ) : (
            'Create passcode'
          )}
        </Button>
      </form>
      <SignOutLink />
    </CenteredLayout>
  );
}

function SignOutLink() {
  const email = useApp((s) => s.account?.email);
  return (
    <p className="mt-8 text-center text-[13px] text-faint">
      {email && <>Signed in as {email} · </>}
      <button
        type="button"
        className="text-muted underline-offset-2 hover:text-ink hover:underline"
        onClick={async () => {
          const pending = await store.pendingChangeCount();
          const ok = await dialogs.confirm({
            title: 'Sign out?',
            message:
              pending > 0
                ? `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} synced yet and will be lost. The encrypted copy on this device is erased.`
                : 'The encrypted copy on this device is erased. Your notes stay safe in your account.',
            confirmLabel: 'Sign out',
            destructive: true,
          });
          if (ok) await store.signOut();
        }}
      >
        Sign out
      </button>
    </p>
  );
}

function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

export function LockScreen() {
  const reason = useApp((s) => s.lockReason);
  const stranded = useApp((s) => s.stranded);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + getLockout(localStorage).waitMs);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const waiting = waitUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (!waiting && !busy) input.current?.focus({ preventScroll: true });
  }, [waiting, busy, stranded]);

  const fail = (message: string) => {
    setValue('');
    setError(message);
    setShakeKey((k) => k + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value || busy || waiting) return;
    setBusy(true);
    setError(null);
    try {
      if (stranded > 0) {
        if ((await store.resolveStranded(value)) === 'wrong') fail('That isn’t your previous passcode.');
        return;
      }
      const result = await store.unlock(value);
      if (result.status === 'wrong') {
        fail('Incorrect passcode');
        if (result.waitMs > 0) {
          setWaitUntil(Date.now() + result.waitMs);
          setNow(Date.now());
        }
      } else if (result.status === 'throttled') {
        setWaitUntil(Date.now() + result.waitMs);
        setNow(Date.now());
        setValue('');
      } else if (result.status === 'stranded') {
        setValue('');
      }
    } catch (err) {
      fail(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    const ok = await dialogs.confirm({
      title: 'Discard these changes?',
      message: 'They were made before your passcode changed and can’t be read without the previous one.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    await store.resolveStranded(null);
    setBusy(false);
  };

  let message: string | null = null;
  if (stranded > 0) {
    message = `${stranded} unsynced change${stranded === 1 ? ' was' : 's were'} made on this device before your passcode was changed. Enter your previous passcode to keep ${stranded === 1 ? 'it' : 'them'}.`;
  } else if (reason === 'vault-changed') {
    message = 'Your passcode was changed on another device. Enter the new passcode.';
  }

  return (
    <CenteredLayout>
      <div className="flex w-full flex-col items-center pb-[8vh]">
        <AppIcon size={84} />
        <h1 className="mt-6 text-[19px] font-semibold">{stranded > 0 ? 'Keep unsynced changes' : 'Folio is locked'}</h1>
        {message && <p className="mt-2 text-center text-[14px] leading-snug text-muted">{message}</p>}
        <form key={shakeKey} className={cx('mt-7 w-full', shakeKey > 0 && 'animate-shake')} onSubmit={submit}>
          <div className="relative">
            <TextInput
              ref={input}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={waiting}
              placeholder={waiting ? `Try again in ${formatWait(waitUntil - now)}` : stranded > 0 ? 'Previous passcode' : 'Passcode'}
              aria-label={stranded > 0 ? 'Previous passcode' : 'Passcode'}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className="pr-14 text-center tracking-[0.12em] placeholder:tracking-normal"
            />
            <button
              type="submit"
              aria-label="Unlock"
              disabled={!value || busy || waiting}
              className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-accent text-accent-ink transition-opacity disabled:opacity-0"
            >
              {busy ? <Spinner /> : <ChevronRight size={20} strokeWidth={2.4} />}
            </button>
          </div>
        </form>
        <p className="mt-3 h-5 text-center text-[13px] text-danger" role="alert">
          {error ?? (waiting ? 'Too many attempts. Please wait.' : '')}
        </p>
        {stranded > 0 && (
          <div className="mt-2 flex gap-4">
            <Button variant="ghost" onClick={discard} disabled={busy}>
              Discard them
            </Button>
            <Button variant="ghost" onClick={() => store.cancelStranded()} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      <SignOutLink />
    </CenteredLayout>
  );
}
