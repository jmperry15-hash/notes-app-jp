import type { JSONContent } from '@tiptap/core';
import { useSyncExternalStore } from 'react';
import { createSupabaseAuth, type AuthService, type AuthUser } from '../lib/auth';
import { backupFileName, createBackup, parseBackup, restoreBackup, unlockBackup, type BackupFile, type RestoreResult } from '../lib/backup';
import { createKeyMaterial, unlockKey } from '../lib/crypto';
import {
  countPending,
  getAccount,
  getSettings,
  markPurged,
  NotesDB,
  setAccount,
  setSettings,
  writeLocal,
  type AccountInfo,
} from '../lib/db';
import { buildMarkdownZip, markdownZipName } from '../lib/exportMarkdown';
import { deriveNoteText, emptyNoteDoc } from '../lib/noteText';
import { getLockout, recordFailure, recordSuccess } from '../lib/passcode';
import { applyTheme, loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import { purgeExpired } from '../lib/purge';
import { openFolder, openNote, sealFolder, sealNote, toIso } from '../lib/records';
import type { RemoteStore } from '../lib/remote';
import { SyncEngine, type SyncChanges, type SyncStatus } from '../lib/sync';
import { sameVault, settingsFromRow, TABLES, type Folder, type Note, type VaultSettings } from '../lib/types';
import { adoptRemoteSettings, changePasscode } from '../lib/vault';
import { displayOrder, type FolderView } from './selectors';
import { errorMessage, toast } from './ui';

export type Phase = 'booting' | 'unconfigured' | 'signedOut' | 'needsNetwork' | 'setup' | 'locked' | 'unlocked';
export type LockReason = 'startup' | 'manual' | 'timeout' | 'vault-changed';
export type MobileScreen = 'folders' | 'list' | 'editor';
export type Layout = 'phone' | 'tablet' | 'desktop';

export interface AppState {
  phase: Phase;
  authKind: 'supabase' | 'demo' | null;
  account: AccountInfo | null;
  lockReason: LockReason;
  /** > 0 while the lock screen needs the previous passcode to keep unsynced edits. */
  stranded: number;
  notes: Map<string, Note>;
  folders: Map<string, Folder>;
  undecryptable: number;
  view: FolderView;
  selectedNoteId: string | null;
  /** A new note that isn't saved until something is typed. */
  draftId: string | null;
  mobileScreen: MobileScreen;
  layout: Layout;
  search: string;
  sync: { status: SyncStatus; error: string | null; lastSyncedAt: number | null };
  settingsOpen: boolean;
  foldersOpen: boolean;
  busy: string | null;
  prefs: Prefs;
}

export type UnlockResult =
  | { status: 'ok' }
  | { status: 'wrong'; waitMs: number }
  | { status: 'throttled'; waitMs: number }
  | { status: 'stranded'; count: number };

const storage = () => window.localStorage;

class AppStore {
  private state: AppState = {
    phase: 'booting',
    authKind: null,
    account: null,
    lockReason: 'startup',
    stranded: 0,
    notes: new Map(),
    folders: new Map(),
    undecryptable: 0,
    view: { kind: 'all' },
    selectedNoteId: null,
    draftId: null,
    mobileScreen: 'list',
    layout: 'desktop',
    search: '',
    sync: { status: 'idle', error: null, lastSyncedAt: null },
    settingsOpen: false,
    foldersOpen: false,
    busy: null,
    prefs: loadPrefs(),
  };
  private listeners = new Set<() => void>();

  private db = new NotesDB();
  private auth: AuthService | null = null;
  private remote: RemoteStore | null = null;
  /** The AES key. Only ever in memory, only while unlocked. */
  private key: CryptoKey | null = null;
  private engine: SyncEngine | null = null;
  private stopListening: (() => void)[] = [];
  private syncTimer: number | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private writesPaused: Promise<void> | null = null;
  private pendingNoteWrites = new Map<string, Note>();
  private pendingAdoption: { settings: VaultSettings; key: CryptoKey } | null = null;
  private signingOut = false;
  private booted = false;

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------------------------------
  // Start-up, accounts and passcode
  // ---------------------------------------------------------------------------------------------

  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    applyTheme(this.state.prefs.theme);

    this.auth = createSupabaseAuth();
    if (!this.auth && import.meta.env.DEV) {
      const { DemoAuth } = await import('../lib/demoAuth');
      this.auth = new DemoAuth();
    }
    if (!this.auth) {
      this.set({ phase: 'unconfigured' });
      return;
    }
    this.set({ authKind: this.auth.kind });
    this.auth.onSignedOut(() => this.handleSignedOut());
    await this.resolveSession();
  }

  private async resolveSession(): Promise<void> {
    const auth = this.auth!;
    const [session, settings, account] = await Promise.all([auth.getSession(), getSettings(this.db), getAccount(this.db)]);
    if (session.status === 'signed-in') {
      await this.useAccount(session.user);
    } else if (session.status === 'unknown' && settings && account) {
      // Offline: the local copy can still be unlocked; sync resumes when back online.
      this.remote = auth.createRemote(account.userId);
      this.set({ account, phase: 'locked', lockReason: 'startup' });
    } else if (session.status === 'unknown') {
      this.set({ phase: 'needsNetwork' });
    } else {
      this.set({ phase: 'signedOut' });
    }
  }

  async retryConnection(): Promise<void> {
    if (this.remote) await this.fetchVault();
    else await this.resolveSession();
  }

  private async useAccount(user: AuthUser): Promise<void> {
    const settings = await getSettings(this.db);
    if (settings && settings.userId !== user.id) await this.wipeLocal();
    const account = { userId: user.id, email: user.email };
    await setAccount(this.db, account);
    this.remote = this.auth!.createRemote(user.id);
    this.set({ account });
    if (settings && settings.userId === user.id) this.set({ phase: 'locked', lockReason: 'startup' });
    else await this.fetchVault();
  }

  private async fetchVault(): Promise<void> {
    try {
      const row = await this.remote!.getSettings();
      if (row) {
        await setSettings(this.db, settingsFromRow(row));
        this.set({ phase: 'locked', lockReason: 'startup' });
      } else {
        this.set({ phase: 'setup' });
      }
    } catch {
      this.set({ phase: 'needsNetwork' });
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    const user = await this.auth!.signIn(email, password);
    await this.useAccount(user);
  }

  async signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
    const result = await this.auth!.signUp(email, password);
    if (result.user && !result.needsConfirmation) {
      await this.useAccount(result.user);
      return 'signed-in';
    }
    return 'confirm-email';
  }

  /** First run: create the passcode, its salt and verifier, and store them on the server. */
  async setupPasscode(passcode: string): Promise<'created' | 'exists'> {
    const account = this.state.account;
    if (!account || !this.remote) throw new Error('Not signed in.');
    const material = await createKeyMaterial(passcode);
    const created = await this.remote.createSettings({
      kdf_salt: material.salt,
      kdf_iterations: material.iterations,
      verifier_ciphertext: material.verifier.ciphertext,
      verifier_iv: material.verifier.iv,
    });
    if (created === 'exists') {
      await this.fetchVault(); // another device finished setup first
      return 'exists';
    }
    await setSettings(this.db, {
      userId: account.userId,
      salt: material.salt,
      iterations: material.iterations,
      verifierCiphertext: material.verifier.ciphertext,
      verifierIv: material.verifier.iv,
    });
    recordSuccess(storage());
    await this.enterUnlocked(material.key);
    return 'created';
  }

  async unlock(passcode: string): Promise<UnlockResult> {
    const lockout = getLockout(storage());
    if (lockout.waitMs > 0) return { status: 'throttled', waitMs: lockout.waitMs };

    const local = await getSettings(this.db);
    let key = local ? await unlockKey(passcode, local) : null;

    if (!key && this.remote && navigator.onLine) {
      // Maybe the passcode was changed on another device: check the server's settings.
      try {
        const row = await this.remote.getSettings();
        const settings = row ? settingsFromRow(row) : null;
        if (settings && (!local || !sameVault(settings, local))) {
          const newKey = await unlockKey(passcode, settings);
          if (newKey) {
            recordSuccess(storage());
            const adopted = await adoptRemoteSettings({ db: this.db, settings, newKey, oldKey: null });
            if (adopted.stranded > 0) {
              this.pendingAdoption = { settings, key: newKey };
              this.set({ stranded: adopted.stranded });
              return { status: 'stranded', count: adopted.stranded };
            }
            key = newKey;
          }
        }
      } catch {
        // Offline or server error: treat as a wrong passcode below.
      }
    }

    if (!key) return { status: 'wrong', waitMs: recordFailure(storage()) };
    recordSuccess(storage());
    await this.enterUnlocked(key);
    return { status: 'ok' };
  }

  /** Keeps (with the previous passcode) or discards (null) edits made before a passcode change elsewhere. */
  async resolveStranded(previousPasscode: string | null): Promise<'ok' | 'wrong'> {
    const pending = this.pendingAdoption;
    if (!pending) return 'ok';
    let oldKey: CryptoKey | null = null;
    if (previousPasscode !== null) {
      const local = await getSettings(this.db);
      oldKey = local ? await unlockKey(previousPasscode, local) : null;
      if (!oldKey) return 'wrong';
    }
    await adoptRemoteSettings({ db: this.db, settings: pending.settings, newKey: pending.key, oldKey, discardStranded: true });
    this.pendingAdoption = null;
    await this.enterUnlocked(pending.key);
    return 'ok';
  }

  cancelStranded(): void {
    this.pendingAdoption = null;
    this.set({ stranded: 0 });
  }

  private async enterUnlocked(key: CryptoKey): Promise<void> {
    this.key = key;
    await purgeExpired(this.db);
    const { notes, folders, failed } = await this.decryptAll(key);
    if (this.key !== key) return;
    let { view, selectedNoteId } = this.state;
    if (view.kind === 'folder' && !folders.get(view.id)) view = { kind: 'all' };
    if (selectedNoteId && !notes.has(selectedNoteId)) selectedNoteId = null;
    this.set({ phase: 'unlocked', notes, folders, undecryptable: failed, view, selectedNoteId, stranded: 0, lockReason: 'startup' });
    this.startSync();
  }

  private async decryptAll(key: CryptoKey) {
    const [noteRecords, folderRecords] = await Promise.all([this.db.notes.toArray(), this.db.folders.toArray()]);
    let failed = 0;
    const notes = new Map<string, Note>();
    const folders = new Map<string, Folder>();
    await Promise.all([
      ...noteRecords
        .filter((r) => r.state !== 2)
        .map((r) => openNote(key, r).then((n) => void notes.set(n.id, n), () => void failed++)),
      ...folderRecords
        .filter((r) => r.state !== 2)
        .map((r) => openFolder(key, r).then((f) => void folders.set(f.id, f), () => void failed++)),
    ]);
    return { notes, folders, failed };
  }

  /** Clears the key and every decrypted note from memory. */
  async lock(reason: LockReason = 'manual'): Promise<void> {
    if (this.state.phase !== 'unlocked') return;
    this.discardEmptyDraft();
    await this.flushWrites(); // finish encrypting anything just typed
    this.stopSync();
    this.key = null;
    this.pendingNoteWrites.clear();
    this.set({
      phase: 'locked',
      lockReason: reason,
      notes: new Map(),
      folders: new Map(),
      search: '',
      draftId: null,
      settingsOpen: false,
      foldersOpen: false,
      busy: null,
      sync: { status: 'idle', error: null, lastSyncedAt: this.state.sync.lastSyncedAt },
    });
  }

  pendingChangeCount(): Promise<number> {
    return countPending(this.db);
  }

  async signOut(): Promise<void> {
    this.signingOut = true;
    try {
      this.stopSync();
      this.key = null;
      try {
        await this.auth?.signOut();
      } catch {
        // offline: the local session is cleared regardless
      }
      await this.wipeLocal();
      recordSuccess(storage());
      this.remote = null;
      this.set({
        phase: 'signedOut',
        account: null,
        notes: new Map(),
        folders: new Map(),
        view: { kind: 'all' },
        selectedNoteId: null,
        draftId: null,
        search: '',
        settingsOpen: false,
        sync: { status: 'idle', error: null, lastSyncedAt: null },
      });
    } finally {
      this.signingOut = false;
    }
  }

  /** The session ended without the user asking (e.g. revoked). Local data is kept for the next sign-in. */
  private handleSignedOut(): void {
    if (this.signingOut || this.state.phase === 'signedOut') return;
    this.stopSync();
    this.key = null;
    this.set({ phase: 'signedOut', notes: new Map(), folders: new Map(), settingsOpen: false, search: '' });
  }

  private async wipeLocal(): Promise<void> {
    this.db.close();
    await this.db.delete();
    this.db = new NotesDB();
  }

  // ---------------------------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------------------------

  private startSync(): void {
    if (!this.remote) return;
    const engine = new SyncEngine({
      db: this.db,
      remote: this.remote,
      getKey: () => this.key,
      isOnline: () => navigator.onLine,
      onChanges: (changes) => void this.applyChanges(changes),
      onStatus: (status, error) =>
        this.set({
          sync: {
            status,
            error: error ?? null,
            lastSyncedAt: status === 'synced' ? Date.now() : this.state.sync.lastSyncedAt,
          },
        }),
      onVaultChanged: () => void this.lock('vault-changed'),
    });
    this.engine = engine;

    const unsubscribe = this.remote.subscribe((change) => {
      if (change.type === 'delete') void engine.applyRemoteDelete(change);
      else this.scheduleSync(300);
    });
    const soon = () => this.scheduleSync(0);
    const onVisible = () => document.visibilityState === 'visible' && soon();
    const onOffline = () => this.set({ sync: { ...this.state.sync, status: 'offline' } });
    window.addEventListener('focus', soon);
    window.addEventListener('online', soon);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => document.visibilityState === 'visible' && soon(), 30_000);

    this.stopListening = [
      unsubscribe,
      () => window.removeEventListener('focus', soon),
      () => window.removeEventListener('online', soon),
      () => window.removeEventListener('offline', onOffline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => window.clearInterval(interval),
    ];
    void this.runSync(true);
  }

  private stopSync(): void {
    this.engine?.stop();
    this.engine = null;
    this.stopListening.forEach((stop) => stop());
    this.stopListening = [];
    window.clearTimeout(this.syncTimer);
  }

  private scheduleSync(delay: number): void {
    if (!this.engine) return;
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.runSync(false), delay);
  }

  private async runSync(full: boolean) {
    const engine = this.engine;
    if (!engine) return 'locked' as const;
    await this.flushWrites(); // upload what was just typed
    return engine.sync({ full });
  }

  syncNow(): void {
    void this.runSync(true);
  }

  /** Re-reads records that sync changed and updates the decrypted copies in memory. */
  private async applyChanges(changes: SyncChanges): Promise<void> {
    const key = this.key;
    if (!key) return;
    const noteUpdates = new Map<string, Note | null>();
    const folderUpdates = new Map<string, Folder | null>();
    for (const table of TABLES) for (const id of changes.removed[table]) (table === 'notes' ? noteUpdates : folderUpdates).set(id, null);

    for (const id of changes.updated.notes) {
      const record = await this.db.notes.get(id);
      if (!record || record.state === 2) noteUpdates.set(id, null);
      else await openNote(key, record).then((note) => void noteUpdates.set(id, note), () => undefined);
    }
    for (const id of changes.updated.folders) {
      const record = await this.db.folders.get(id);
      if (!record || record.state === 2) folderUpdates.set(id, null);
      else await openFolder(key, record).then((folder) => void folderUpdates.set(id, folder), () => undefined);
    }
    if (this.key !== key) return; // locked meanwhile

    const notes = new Map(this.state.notes);
    for (const [id, note] of noteUpdates) {
      if (this.pendingNoteWrites.has(id)) continue; // typing in progress; the local version is about to be saved
      if (note) notes.set(id, { ...note, syncRev: (notes.get(id)?.syncRev ?? 0) + 1 });
      else notes.delete(id);
    }
    const folders = new Map(this.state.folders);
    for (const [id, folder] of folderUpdates) {
      if (folder) folders.set(id, folder);
      else folders.delete(id);
    }
    const patch: Partial<AppState> = { notes, folders };
    if (this.state.selectedNoteId && !notes.has(this.state.selectedNoteId)) patch.selectedNoteId = null;
    if (this.state.view.kind === 'folder' && !folders.has(this.state.view.id)) patch.view = { kind: 'all' };
    this.set(patch);
  }

  // ---------------------------------------------------------------------------------------------
  // Local writes: everything is encrypted before it's written to IndexedDB.
  // ---------------------------------------------------------------------------------------------

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.writes.then(async () => {
      if (this.writesPaused) await this.writesPaused;
      await task();
    });
    this.writes = run.catch((error: unknown) => {
      toast(`Couldn’t save: ${errorMessage(error)}`, { tone: 'error' });
    });
    return run;
  }

  /** Waits until every queued write, including ones queued while waiting, has finished. */
  private async flushWrites(): Promise<void> {
    let current: Promise<unknown>;
    do {
      current = this.writes;
      await current.catch(() => undefined);
    } while (current !== this.writes);
  }

  private persistNote(note: Note): void {
    const alreadyQueued = this.pendingNoteWrites.has(note.id);
    this.pendingNoteWrites.set(note.id, note);
    if (!alreadyQueued) {
      void this.enqueue(async () => {
        const latest = this.pendingNoteWrites.get(note.id);
        const key = this.key;
        if (!latest || !key) return;
        const sealed = await sealNote(key, latest.id, latest);
        // Leave it pending until written, so an incoming sync never replaces what's being typed.
        await writeLocal(this.db, 'notes', latest.id, sealed, toIso(latest.deletedAt));
        if (this.pendingNoteWrites.get(note.id) === latest) this.pendingNoteWrites.delete(note.id);
        else this.persistNoteAgain(note.id);
      });
    }
    this.scheduleSync(1000);
  }

  private persistNoteAgain(id: string): void {
    const latest = this.pendingNoteWrites.get(id);
    if (!latest) return;
    this.pendingNoteWrites.delete(id);
    this.persistNote(latest);
  }

  private persistFolder(folder: Folder): void {
    void this.enqueue(async () => {
      const key = this.key;
      if (!key) return;
      const sealed = await sealFolder(key, folder.id, folder);
      await writeLocal(this.db, 'folders', folder.id, sealed, toIso(folder.deletedAt));
    });
    this.scheduleSync(1000);
  }

  private putNote(note: Note, extra: Partial<AppState> = {}): void {
    const notes = new Map(this.state.notes);
    notes.set(note.id, note);
    this.set({ notes, ...extra });
  }

  // ---------------------------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------------------------

  createNote(): void {
    if (this.state.phase !== 'unlocked') return;
    this.discardEmptyDraft();
    const now = Date.now();
    const view = this.state.view.kind === 'deleted' ? ({ kind: 'all' } as const) : this.state.view;
    const note: Note = {
      id: crypto.randomUUID(),
      title: '',
      body: emptyNoteDoc(),
      preview: '',
      folderId: view.kind === 'folder' ? view.id : null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      text: '',
    };
    this.putNote(note, { view, selectedNoteId: note.id, draftId: note.id, search: '', mobileScreen: 'editor', foldersOpen: false });
  }

  updateNoteBody(id: string, body: JSONContent): void {
    const previous = this.state.notes.get(id);
    if (!previous || previous.deletedAt !== null) return;
    if (JSON.stringify(previous.body) === JSON.stringify(body)) return;
    const { title, preview, text } = deriveNoteText(body);
    const note: Note = { ...previous, body, title, preview, text, updatedAt: Date.now() };
    const isDraft = this.state.draftId === id;
    if (isDraft && !text.trim()) {
      this.putNote(note); // nothing typed yet: don't save an empty note
      return;
    }
    this.putNote(note, isDraft ? { draftId: null } : {});
    this.persistNote(note);
  }

  togglePin(id: string): void {
    const note = this.state.notes.get(id);
    if (!note || note.deletedAt !== null) return;
    const next = { ...note, pinned: !note.pinned };
    this.putNote(next, this.state.draftId === id ? { draftId: null } : {});
    this.persistNote(next);
  }

  moveNote(id: string, folderId: string | null): void {
    const note = this.state.notes.get(id);
    if (!note || note.folderId === folderId) return;
    const next = { ...note, folderId };
    this.putNote(next, this.state.draftId === id ? { draftId: null } : {});
    this.persistNote(next);
  }

  /** Moves a note to Recently Deleted. Returns false if it was an empty draft that simply vanished. */
  deleteNote(id: string): boolean {
    const note = this.state.notes.get(id);
    if (!note) return false;
    const nextSelection = this.neighbourOf(id);
    if (this.state.draftId === id) {
      const notes = new Map(this.state.notes);
      notes.delete(id);
      this.set({ notes, draftId: null, ...this.afterRemoving(id, nextSelection) });
      return false;
    }
    const next = { ...note, deletedAt: Date.now(), pinned: false };
    this.putNote(next, this.afterRemoving(id, nextSelection));
    this.persistNote(next);
    return true;
  }

  restoreNote(id: string): void {
    const note = this.state.notes.get(id);
    if (!note || note.deletedAt === null) return;
    const folder = note.folderId ? this.state.folders.get(note.folderId) : undefined;
    const next = { ...note, deletedAt: null, folderId: folder && folder.deletedAt === null ? note.folderId : null };
    const nextSelection = this.state.view.kind === 'deleted' ? this.neighbourOf(id) : id;
    this.putNote(next, this.state.view.kind === 'deleted' ? this.afterRemoving(id, nextSelection) : {});
    this.persistNote(next);
  }

  deleteNotePermanently(id: string): void {
    this.purgeNotes([id]);
  }

  emptyRecentlyDeleted(): number {
    const ids = [...this.state.notes.values()].filter((n) => n.deletedAt !== null).map((n) => n.id);
    this.purgeNotes(ids);
    return ids.length;
  }

  private purgeNotes(ids: string[]): void {
    if (!ids.length) return;
    const nextSelection = ids.length === 1 ? this.neighbourOf(ids[0]) : null;
    const notes = new Map(this.state.notes);
    for (const id of ids) {
      notes.delete(id);
      this.pendingNoteWrites.delete(id);
    }
    const selectionGone = this.state.selectedNoteId !== null && ids.includes(this.state.selectedNoteId);
    this.set({ notes, ...(selectionGone ? this.afterRemoving(this.state.selectedNoteId!, nextSelection) : {}) });
    void this.enqueue(() => markPurged(this.db, 'notes', ids));
    this.scheduleSync(500);
  }

  /** The note to select after `id` leaves the current list (desktop keeps a selection; phones go back). */
  private neighbourOf(id: string): string | null {
    const order = displayOrder(this.state.notes, this.state.view, this.state.search).map((n) => n.id);
    const index = order.indexOf(id);
    if (index === -1) return null;
    return order[index + 1] ?? order[index - 1] ?? null;
  }

  private afterRemoving(id: string, next: string | null): Partial<AppState> {
    if (this.state.selectedNoteId !== id) return {};
    return this.state.layout === 'phone'
      ? { selectedNoteId: null, mobileScreen: 'list' }
      : { selectedNoteId: next };
  }

  private discardEmptyDraft(): void {
    const id = this.state.draftId;
    if (!id) return;
    const note = this.state.notes.get(id);
    const notes = new Map(this.state.notes);
    if (note && !note.text.trim()) notes.delete(id);
    this.set({ notes, draftId: null, selectedNoteId: this.state.selectedNoteId === id && !notes.has(id) ? null : this.state.selectedNoteId });
  }

  // ---------------------------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------------------------

  createFolder(name: string): string {
    const now = Date.now();
    const folder: Folder = { id: crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now, deletedAt: null };
    const folders = new Map(this.state.folders);
    folders.set(folder.id, folder);
    this.set({ folders });
    this.persistFolder(folder);
    return folder.id;
  }

  renameFolder(id: string, name: string): void {
    const folder = this.state.folders.get(id);
    if (!folder || !name.trim() || folder.name === name.trim()) return;
    const next = { ...folder, name: name.trim(), updatedAt: Date.now() };
    const folders = new Map(this.state.folders);
    folders.set(id, next);
    this.set({ folders });
    this.persistFolder(next);
  }

  /** Deletes a folder; its notes move to Recently Deleted. */
  deleteFolder(id: string): void {
    const now = Date.now();
    const folders = new Map(this.state.folders);
    folders.delete(id);
    const notes = new Map(this.state.notes);
    const moved: Note[] = [];
    for (const note of notes.values()) {
      if (note.folderId === id && note.deletedAt === null) {
        const next = { ...note, deletedAt: now, pinned: false };
        notes.set(note.id, next);
        moved.push(next);
      }
    }
    const patch: Partial<AppState> = { folders, notes };
    if (this.state.view.kind === 'folder' && this.state.view.id === id) {
      patch.view = { kind: 'all' };
      patch.selectedNoteId = null;
      if (this.state.mobileScreen !== 'folders') patch.mobileScreen = 'folders';
    }
    this.set(patch);
    moved.forEach((note) => this.persistNote(note));
    void this.enqueue(() => markPurged(this.db, 'folders', [id]));
    this.scheduleSync(500);
  }

  // ---------------------------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------------------------

  selectView(view: FolderView): void {
    this.discardEmptyDraft();
    this.set({ view, search: '', mobileScreen: 'list', foldersOpen: false, selectedNoteId: null });
  }

  selectNote(id: string | null): void {
    if (this.state.draftId && this.state.draftId !== id) this.discardEmptyDraft();
    this.set({ selectedNoteId: id, mobileScreen: id ? 'editor' : this.state.mobileScreen });
  }

  goBack(): void {
    if (this.state.mobileScreen === 'editor') {
      this.discardEmptyDraft();
      this.set({ mobileScreen: 'list' });
    } else if (this.state.mobileScreen === 'list') {
      this.set({ mobileScreen: 'folders', search: '' });
    }
  }

  setLayout(layout: Layout): void {
    if (layout !== this.state.layout) this.set({ layout });
  }

  setSearch(search: string): void {
    this.set({ search });
  }

  setSettingsOpen(settingsOpen: boolean): void {
    this.set({ settingsOpen });
  }

  setFoldersOpen(foldersOpen: boolean): void {
    this.set({ foldersOpen });
  }

  setPrefs(patch: Partial<Prefs>): void {
    const prefs = { ...this.state.prefs, ...patch };
    savePrefs(prefs);
    this.set({ prefs });
    if (patch.theme) applyTheme(prefs.theme);
  }

  // ---------------------------------------------------------------------------------------------
  // Settings actions
  // ---------------------------------------------------------------------------------------------

  async changePasscode(currentPasscode: string, newPasscode: string): Promise<void> {
    const key = this.key;
    const engine = this.engine;
    const remote = this.remote;
    if (!key || !engine || !remote) throw new Error('Unlock the app first.');
    const local = await getSettings(this.db);
    if (!local || !(await unlockKey(currentPasscode, local))) throw new Error('Your current passcode is incorrect.');
    if (!navigator.onLine) throw new Error('Connect to the internet to change your passcode.');

    this.set({ busy: 'Changing passcode…' });
    let resume = () => {};
    try {
      await this.flushWrites();
      this.writesPaused = new Promise<void>((resolve) => (resume = resolve));
      const synced = await engine.sync();
      if (synced !== 'ok') throw new Error('Couldn’t sync first. Check your connection and try again.');
      const result = await engine.exclusive(() =>
        changePasscode({ db: this.db, remote, oldKey: key, newPasscode }),
      );
      if (this.key === key) this.key = result.key;
    } finally {
      this.writesPaused = null;
      resume();
      this.set({ busy: null });
    }
  }

  async downloadBackup(): Promise<void> {
    await this.flushWrites();
    const backup = await createBackup(this.db);
    downloadFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), backupFileName());
    this.setPrefs({ lastBackupAt: Date.now() });
  }

  async readBackupFile(file: File): Promise<BackupFile> {
    return parseBackup(await file.text());
  }

  async restoreFromBackup(backup: BackupFile, passcode: string): Promise<RestoreResult> {
    const key = this.key;
    if (!key) throw new Error('Unlock the app first.');
    const backupKey = await unlockBackup(backup, passcode);
    if (!backupKey) throw new Error('That passcode doesn’t open this backup.');
    this.set({ busy: 'Restoring…' });
    try {
      await this.flushWrites();
      const result = await restoreBackup({ db: this.db, backup, backupKey, currentKey: key });
      const changes: SyncChanges = {
        updated: { notes: new Set(result.changed.notes), folders: new Set(result.changed.folders) },
        removed: { notes: new Set(), folders: new Set() },
      };
      await this.applyChanges(changes);
      this.scheduleSync(0);
      return result;
    } finally {
      this.set({ busy: null });
    }
  }

  exportMarkdown(): number {
    const notes = [...this.state.notes.values()].filter((n) => n.deletedAt === null);
    downloadFile(new Blob([buildMarkdownZip(notes, this.state.folders)], { type: 'application/zip' }), markdownZipName());
    return notes.length;
  }
}

function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const store = new AppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
