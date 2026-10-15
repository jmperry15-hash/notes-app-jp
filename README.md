# Folio — private, end-to-end encrypted notes

A calm, minimal notes app for your Mac and iPhone. It installs as a home-screen web app, works offline,
syncs between your devices through your own free Supabase project, and encrypts everything with your
passcode **before** it leaves the device.

- **Two locks.** A Supabase account sign-in (once per device) and a passcode every time the app opens.
- **End-to-end encrypted.** Titles, text, folders and pinned state are encrypted with AES-256-GCM using a
  key derived from your passcode (PBKDF2-SHA256, 600,000 iterations). The server only ever stores
  ciphertext. Your passcode is never stored or sent anywhere.
- **Local-first.** Everything is saved instantly to your device and synced in the background, including
  live updates between devices within seconds.

> ⚠️ **A forgotten passcode cannot be recovered.** Nobody — not you, not Supabase, not GitHub — can
> decrypt your notes without it. Keep it somewhere safe and download encrypted backups regularly
> (see [Backups](#6-backups-and-the-passcode-warning)).

---

## What you'll need

- A free [Supabase](https://supabase.com) account
- A free [GitHub](https://github.com) account
- [Node.js](https://nodejs.org) 22 or newer (only for running it on your Mac / running the tests)

The steps below take about 15 minutes. Do them in order.

---

## 1. Create the Supabase project and run the schema

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. Click **New project**. Pick any name (e.g. `folio`), set a strong database password (you won't
   need it for this app — store it in your password manager), choose the region closest to you, and
   click **Create new project**. Wait a minute or two until it's ready.
3. In the left sidebar open **SQL Editor**, then click **New query** (the **+** button).
4. Open [`supabase/schema.sql`](supabase/schema.sql) from this repository, copy **all** of it, paste it
   into the editor and click **Run**. You should see "Success. No rows returned".

   This creates the `user_settings`, `folders` and `notes` tables, turns on Row Level Security so every
   user can only ever read or change their own rows, adds the function used to change your passcode
   safely, and enables Realtime for live sync. It's safe to run again later.
5. Find your project's connection details. Click **Connect** at the top of the dashboard (or go to
   **Project Settings → API Keys** and **Project Settings → Data API**) and copy:
   - the **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - the **anon / public key** — on newer projects this is called the **Publishable key**
     (starts with `sb_publishable_`). Either one works.

   The anon/publishable key is designed to be public; Row Level Security is what protects your data.
   **Never use the `service_role` / secret key anywhere in this app.**

---

## 2. Create your account, then turn off sign-ups

You'll create exactly one account, then lock the door behind you so nobody else can sign up.

1. In the Supabase dashboard open **Authentication → Users**.
2. Click **Add user → Create new user**. Enter your email and a strong **account password**
   (this is your Supabase login — it's different from your notes passcode), tick
   **Auto Confirm User**, and click **Create user**.

   *(Alternatively you can use "First time here? Create your account" on the app's sign-in screen. If
   email confirmation is enabled you'll get a confirmation email; open the link, then sign in in the app.)*
3. Now disable sign-ups: open **Authentication → Sign In / Providers** (called **Providers** or
   **Auth Settings** on some dashboards), find **Allow new users to sign up**, switch it **off**, and
   click **Save**.

From now on only your account can sign in. Even if someone found your app's address, they can't create
an account, and Row Level Security means a hypothetical second account could never see your rows.

> **Free-tier note:** Supabase pauses free projects after about a week with no activity. If that
> happens, open the dashboard and click **Restore project**. Your notes stay on your devices in the
> meantime and sync again once it's back.

---

## 3. Run it on your Mac

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` in a text editor and paste in your Project URL and anon/publishable key:

```
VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

`.env` is listed in `.gitignore`, so it never gets committed. Then start the app:

```bash
npm run dev
```

Open <http://localhost:5173>, sign in with the account from step 2, and create your passcode.

Other useful commands:

```bash
npm test
```

```bash
npm run build
```

> **Demo mode:** if you run `npm run dev` *without* a `.env` file, the app uses a fake, in-browser
> backend so you can try it out. Any email and a 6+ character password work. Demo mode only exists in
> the development server and is never included in the real build.

---

## 4. Put it on GitHub Pages

### a. Create the repository and push the code

1. On GitHub click **New repository**. Name it (e.g. `notes`). Your app will live at
   `https://<your-username>.github.io/<repo-name>/`.
   - Free GitHub accounts can only publish Pages from **public** repositories. That's fine: the repo
     contains only code — never your notes, your passcode, or any secret. (The anon key is not in the
     repo either; it's injected at build time from a secret.)
2. Don't add a README or .gitignore on GitHub (this project has them). Click **Create repository**.

### b. Add the two secrets (before pushing)

In your new repository go to **Settings → Secrets and variables → Actions → New repository secret** and
add:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |

### c. Turn on GitHub Pages

Go to **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.

### d. Push

In this folder on your Mac (replace the URL with your repository's):

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "Folio notes app"
```

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
```

```bash
git push -u origin main
```

Open the **Actions** tab: the **Deploy to GitHub Pages** workflow installs dependencies, runs the tests,
builds the app and publishes it. When it shows a green tick, your app is live at
`https://<your-username>.github.io/<repo-name>/`. Every future push to `main` redeploys automatically.
(If you pushed before adding the secrets or enabling Pages, fix that and click **Run workflow** on the
Actions page.)

The workflow sets the right base path for a project site automatically. If you use a
`<username>.github.io` repository or a custom domain, it builds for `/` instead.

---

## 5. Install it on your devices

Home-screen apps keep their own storage separate from the browser, so you sign in **once inside the
installed app** on each device (that's why the app uses email + password rather than magic links).

### iPhone

1. Open your app's address in **Safari**.
2. Tap the **Share** button (the square with an arrow), scroll down and tap **Add to Home Screen**.
   If you see **Open as Web App**, leave it on.
3. Tap **Add**. Open Folio from your home screen, sign in, and enter your passcode.

### Mac

1. Open your app's address in **Safari** (macOS Sonoma or later).
2. Choose **File → Add to Dock**, then **Add**.
3. Open Folio from the Dock (or Launchpad), sign in, and enter your passcode.

Your passcode is the same everywhere; the key is derived on each device and never transmitted.

---

## 6. Backups and the passcode warning

**There is no password reset for your notes.** The passcode is the only thing that can decrypt them.
If you forget it, your notes are gone for good — on every device and on the server.

Open **Settings → Backup & Export**:

- **Download Encrypted Backup** saves a `.json` file containing your notes and folders exactly as the
  server stores them — encrypted — plus the salt needed to re-derive the key. It's safe to keep in
  iCloud Drive, a USB stick, or email to yourself.
- **Restore from Backup…** asks for the backup file and **the passcode that was in use when the backup
  was made**. Notes missing on this device are added; notes that were edited more recently in the
  backup are updated; nothing is replaced with an older version.
- **Export as Markdown (.zip)** writes every note as a plain `.md` file, in a folder per Folio folder.
  **This file is not encrypted.** Use it to move your notes elsewhere, then store or delete it carefully.

The app reminds you to download a backup if you've never made one or the last one is over a month old.
After changing your passcode, download a fresh backup: older backups still need the old passcode.

---

## Using Folio

- **Notes save as you type.** The first line becomes the title. Leave a brand-new note empty and it
  simply disappears.
- **Formatting:** Title, Heading, Subheading and Body (the **Aa** button), bold, italic, underline,
  strikethrough, bulleted / numbered lists, checklists, and links.
- **Markdown shortcuts:** `# ` title, `## ` heading, `### ` subheading, `- ` or `* ` bullets, `1. `
  numbered list, `[] ` or `[ ] ` checklist, `> ` quote, `**bold**`, `*italic*`, `~~strike~~`.
- **On iPhone:** swipe a note **left to delete** or **right to pin**. In Recently Deleted, swipe left
  to delete permanently or right to restore. The formatting bar sits just above the keyboard.
- **Recently Deleted** keeps notes for 30 days, then removes them everywhere automatically. Deleting a
  folder moves its notes there.
- **Search** covers every note (decrypted in memory only) and highlights the matches.
- **Sync status** (bottom of the sidebar, or the top of the list on iPhone): Synced, Syncing, Offline
  or Sync error. Tap it to sync now.

### Keyboard shortcuts (Mac)

| Action | Shortcut |
| --- | --- |
| New note | ⌘N (or ⌘⌥N if the browser keeps ⌘N for itself) |
| Search | ⌘F |
| Lock | ⌘L |
| Bold / Italic / Underline | ⌘B / ⌘I / ⌘U |
| Strikethrough | ⌘⇧S |
| Numbered / bulleted list / checklist | ⌘⇧7 / ⌘⇧8 / ⌘⇧9 |
| Title / Heading / Subheading / Body | ⌘⌥1 / ⌘⌥2 / ⌘⌥3 / ⌘⌥0 |
| Add or edit link | ⌘K |

---

## How the security works

| | |
| --- | --- |
| **Key derivation** | PBKDF2-SHA256, 600,000 iterations, random 16-byte salt per user. Produces a non-extractable AES-GCM 256-bit `CryptoKey` that exists only in memory while unlocked. |
| **Encryption** | AES-256-GCM via the browser's Web Crypto API (no third-party crypto). A fresh random 96-bit IV per write. Each ciphertext is bound to its record (`notes:<id>`) so rows can't be swapped. |
| **What the server and IndexedDB store** | Only `id`, `user_id`, `ciphertext`, `iv`, `updated_at`, `deleted_at` (plus the salt and verifier in `user_settings`). They can see how many notes you have, roughly how big they are and when they changed — never what they say. |
| **Wrong passcodes** | A small encrypted "verifier" detects a wrong passcode without touching any notes. The first 4 wrong tries are free; after that each wrong try locks the screen for 30 s, then 1, 5, 15 and 60 minutes (the count survives reloads). |
| **Auto-lock** | After the chosen inactivity period (default 5 minutes), and when the app returns from the background after longer than that. Locking discards the key and every decrypted note from memory. |
| **Change passcode** | Every note and folder is re-encrypted in memory first, then the server swaps the key settings and all rows in a single database transaction, then this device swaps its local copy in a single IndexedDB transaction. An interruption at any point leaves recoverable data; other devices notice and ask for the new passcode. |
| **Server access** | Row Level Security on every table: a signed-in user can only select, insert, update or delete rows where `user_id = auth.uid()`. Signed-out visitors get nothing. Only the public anon key is in the app. |
| **Browser hardening** | A strict Content-Security-Policy only allows connections to this site and your Supabase project. |

Things worth knowing:

- The escalating delays protect the app's lock screen. Someone who stole the encrypted data itself
  could try passcodes offline at full speed, which is why a **long passcode with letters** matters
  (the strength hint on the setup screen helps). A short phrase like `maple tree 47` is far stronger
  than a 6-digit number.
- JavaScript can't guarantee memory is wiped, but locking drops every reference to the key and
  decrypted text so the browser can reclaim it.

## How sync works

- Every edit is encrypted and written to IndexedDB immediately, so the app is instant and works offline.
- Folio syncs when it opens or unlocks, when the window regains focus, when you come back online, about
  a second after you stop typing, and every 30 seconds while open. Supabase Realtime pushes changes
  from your other devices within seconds.
- **Conflicts:** the most recent edit wins (last-write-wins by edit time). If the same note was edited on
  two devices since they last synced and the texts differ, both are kept: the newer edit stays as the
  note, and the other version is saved as **"Title (conflicted copy)"** so no text is ever silently lost.
  Folder renames use plain last-write-wins.
- `updated_at` is assigned by the database, so a device with a wrong clock can't make sync skip changes.

---

## Project structure

```
src/
  lib/            framework-free logic (all unit-tested)
    crypto.ts       key derivation, AES-GCM, verifier
    db.ts           IndexedDB (Dexie) — ciphertext only
    records.ts      sealing/opening notes and folders
    sync.ts         sync engine (pull, push, conflicts, purge, realtime deletes)
    conflict.ts     last-write-wins + conflicted copies
    vault.ts        change passcode, adopt a passcode changed elsewhere
    remote.ts       Supabase access (and the interface the tests fake)
    backup.ts       encrypted backup / restore
    purge.ts        30-day Recently Deleted rule
    markdown.ts, zip.ts, exportMarkdown.ts   Markdown export
  state/          app store (unlock, notes, folders, navigation), dialogs and toasts
  components/     React UI (lock/setup/sign-in screens, sidebar, list, editor, settings)
  hooks/          layout, auto-lock, keyboard shortcuts, iOS keyboard (visualViewport)
supabase/schema.sql   tables, indexes, RLS policies, rekey function, realtime
tests/                Vitest: crypto, sync & conflicts, passcode change, purge, schema (real Postgres via PGlite)
scripts/generate-icons.mjs   renders the app icon to every size (npm run icons)
.github/workflows/deploy.yml build, test and deploy to GitHub Pages
```

To rename the app, change "Folio" in `index.html`, the `manifest` block in `vite.config.ts`, and the
sign-in screen in `src/components/AuthScreens.tsx`.

## Troubleshooting

- **"Almost ready — this build doesn't know which Supabase project to use."** The secrets weren't
  available at build time. Check both secrets exist with exactly those names, then re-run the workflow.
- **"Email or password is incorrect."** That's your Supabase *account* password from step 2, not your
  notes passcode. You can set a new one in **Authentication → Users** in the dashboard.
- **Sync error mentioning a missing table or function.** Run `supabase/schema.sql` again in the SQL Editor.
- **"Your passcode was changed on another device."** Enter the new passcode. If you had unsynced edits
  on this device, Folio asks for the previous passcode once so it can keep them.
- **The installed app shows an old version.** Close it fully and reopen; updates install in the
  background and apply on the next launch.
