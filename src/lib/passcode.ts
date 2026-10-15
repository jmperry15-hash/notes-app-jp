/** Passcode rules, the strength hint, and escalating delays after wrong attempts. */

export const MIN_PASSCODE_LENGTH = 6;

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

const COMMON = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', '123123', '654321',
  '121212', '112233', 'password', 'passcode', 'qwerty', 'qwertyuiop', 'abc123', 'letmein', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'welcome', 'admin', 'secret', 'password1', 'abcdef',
]);

function isSequence(p: string): boolean {
  if (p.length < 4) return false;
  const codes = [...p].map((c) => c.charCodeAt(0));
  const step = codes[1] - codes[0];
  return Math.abs(step) === 1 && codes.every((c, i) => i === 0 || c - codes[i - 1] === step);
}

/**
 * A rough estimate of how hard the passcode is to guess. Because the encrypted data could be
 * attacked offline, longer passcodes with letters matter much more than they do for a phone PIN.
 */
export function passcodeStrength(passcode: string): Strength {
  if (!passcode) return { score: 0, label: '', hint: `Use at least ${MIN_PASSCODE_LENGTH} characters.` };
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    return { score: 0, label: 'Too short', hint: `Use at least ${MIN_PASSCODE_LENGTH} characters.` };
  }
  const lower = passcode.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(passcode) || isSequence(passcode)) {
    return { score: 1, label: 'Weak', hint: 'This is one of the first things an attacker would try.' };
  }
  let pool = 0;
  if (/[a-z]/.test(passcode)) pool += 26;
  if (/[A-Z]/.test(passcode)) pool += 26;
  if (/\d/.test(passcode)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(passcode)) pool += 33;
  const unique = new Set(passcode).size;
  const bits = Math.log2(Math.max(pool, 2)) * Math.min(passcode.length, unique * 2);

  if (/^\d+$/.test(passcode) && passcode.length < 10) {
    return { score: 1, label: 'Weak', hint: 'Numbers only are quick to guess. Add letters or make it longer.' };
  }
  if (bits < 40) return { score: 2, label: 'Fair', hint: 'Longer is stronger. Try a short phrase or mix in symbols.' };
  if (bits < 60) return { score: 3, label: 'Good', hint: 'A solid passcode. A few more characters make it even stronger.' };
  return { score: 4, label: 'Strong', hint: 'Excellent. Make sure you will remember it.' };
}

// ---- Escalating delays after wrong attempts --------------------------------------------------

const ATTEMPTS_KEY = 'folio.unlock-attempts';
export const FREE_ATTEMPTS = 4;
const DELAYS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface AttemptState {
  failures: number;
  until: number;
}

/** No delay for the first few mistakes, then 30 s, 1 min, 5 min, 15 min, and 1 hour per attempt. */
export function delayAfterFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return DELAYS_MS[Math.min(failures - FREE_ATTEMPTS - 1, DELAYS_MS.length - 1)];
}

function read(storage: StorageLike): AttemptState {
  try {
    const parsed = JSON.parse(storage.getItem(ATTEMPTS_KEY) ?? '') as AttemptState;
    if (typeof parsed.failures === 'number' && typeof parsed.until === 'number') return parsed;
  } catch {
    // fall through
  }
  return { failures: 0, until: 0 };
}

export function getLockout(storage: StorageLike, now: number = Date.now()): { failures: number; waitMs: number } {
  const state = read(storage);
  return { failures: state.failures, waitMs: Math.max(0, state.until - now) };
}

export function recordFailure(storage: StorageLike, now: number = Date.now()): number {
  const failures = read(storage).failures + 1;
  const wait = delayAfterFailures(failures);
  storage.setItem(ATTEMPTS_KEY, JSON.stringify({ failures, until: now + wait }));
  return wait;
}

export function recordSuccess(storage: StorageLike): void {
  storage.removeItem(ATTEMPTS_KEY);
}
