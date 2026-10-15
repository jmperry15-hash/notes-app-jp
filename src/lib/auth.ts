import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { isNetworkError, SupabaseRemote, type RemoteStore } from './remote';

export interface AuthUser {
  id: string;
  email: string;
}

export type SessionCheck =
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signed-out' }
  /** Couldn't tell (usually offline). The app can still unlock its local copy. */
  | { status: 'unknown' };

export interface AuthService {
  readonly kind: 'supabase' | 'demo';
  getSession(): Promise<SessionCheck>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<{ user: AuthUser | null; needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  onSignedOut(callback: () => void): () => void;
  createRemote(userId: string): RemoteStore;
}

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(url));

function friendlyAuthError(error: { message: string; status?: number }): Error {
  const message = error.message.toLowerCase();
  if (message.includes('invalid login credentials')) return new Error('Email or password is incorrect.');
  if (message.includes('email not confirmed')) return new Error('Confirm your email address first, then sign in.');
  if (message.includes('signups not allowed') || message.includes('signup is disabled')) {
    return new Error('New accounts are turned off for this app.');
  }
  if (isNetworkError(error) || error.status === 0) return new Error('No internet connection.');
  return new Error(error.message);
}

class SupabaseAuth implements AuthService {
  readonly kind = 'supabase';

  constructor(private readonly client: SupabaseClient) {}

  async getSession(): Promise<SessionCheck> {
    const { data, error } = await this.client.auth.getSession();
    const user = data.session?.user;
    if (user) return { status: 'signed-in', user: { id: user.id, email: user.email ?? '' } };
    if (error && (isAuthRetryableFetchError(error) || isNetworkError(error))) return { status: 'unknown' };
    return { status: 'signed-out' };
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) throw friendlyAuthError(error ?? { message: 'Sign-in failed.' });
    return { id: data.user.id, email: data.user.email ?? email };
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password });
    if (error) throw friendlyAuthError(error);
    const user = data.user ? { id: data.user.id, email: data.user.email ?? email } : null;
    return { user, needsConfirmation: !data.session };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' });
  }

  onSignedOut(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') callback();
    });
    return () => data.subscription.unsubscribe();
  }

  createRemote(userId: string): RemoteStore {
    return new SupabaseRemote(this.client, userId);
  }
}

/** Only the public anon key is ever used here. The service_role key must never be in a client app. */
export function createSupabaseAuth(): AuthService | null {
  if (!isSupabaseConfigured || !url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'folio.auth',
    },
  });
  return new SupabaseAuth(client);
}
