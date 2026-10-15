import type { AuthService, AuthUser, SessionCheck } from './auth';
import { MemoryRemote, MemoryServer, type MemoryServerState } from './memoryRemote';
import type { RemoteStore } from './remote';

/**
 * DEVELOPMENT ONLY. When no Supabase keys are configured, `npm run dev` uses this fake backend
 * (stored in this browser's localStorage) so the app can be tried out before Supabase is set up.
 * It is never included in production builds.
 */
const SERVER_KEY = 'folio.demo-server';
const SESSION_KEY = 'folio.demo-session';

function loadServer(): MemoryServer {
  const server = new MemoryServer((state) => {
    try {
      localStorage.setItem(SERVER_KEY, JSON.stringify(state));
    } catch {
      // ignore quota errors in the demo
    }
  });
  try {
    const saved = localStorage.getItem(SERVER_KEY);
    if (saved) server.load(JSON.parse(saved) as MemoryServerState);
  } catch {
    // start empty
  }
  return server;
}

async function userIdFor(email: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase())));
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class DemoAuth implements AuthService {
  readonly kind = 'demo';
  private server = loadServer();
  private listeners = new Set<() => void>();

  async getSession(): Promise<SessionCheck> {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? { status: 'signed-in', user: JSON.parse(saved) as AuthUser } : { status: 'signed-out' };
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    if (!email.includes('@') || password.length < 6) throw new Error('Email or password is incorrect.');
    const user = { id: await userIdFor(email), email: email.trim() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }

  async signUp(email: string, password: string) {
    return { user: await this.signIn(email, password), needsConfirmation: false };
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
    this.listeners.forEach((l) => l());
  }

  onSignedOut(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  createRemote(userId: string): RemoteStore {
    return new MemoryRemote(this.server, userId);
  }
}
