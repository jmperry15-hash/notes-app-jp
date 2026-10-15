/**
 * End-to-end encryption, built only on the Web Crypto API.
 *
 * - The passcode is stretched with PBKDF2-SHA256 (600,000 iterations, random 16-byte salt per user)
 *   into a 256-bit AES-GCM key.
 * - The key is created non-extractable, so not even this app's own code can read its raw bytes.
 * - Every value is encrypted with a fresh random 96-bit IV. "Additional authenticated data" ties each
 *   ciphertext to its record (e.g. "notes:<id>"), so the server cannot swap ciphertexts between rows.
 * - A small encrypted "verifier" detects a wrong passcode without touching any notes.
 */

export const KDF_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const VERIFIER_AAD = 'verifier';
const VERIFIER_TEXT = 'folio-vault-verifier-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Sealed {
  ciphertext: string;
  iv: string;
}

export interface KdfParams {
  salt: string;
  iterations: number;
  verifierCiphertext: string;
  verifierIv: string;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The same passcode typed on different keyboards must produce the same key. */
export function normalizePasscode(passcode: string): string {
  return passcode.normalize('NFC');
}

export async function deriveKey(
  passcode: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = KDF_ITERATIONS,
): Promise<CryptoKey> {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Unsupported key-derivation settings.');
  }
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalizePasscode(passcode)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

/** Throws if the key is wrong, the data was tampered with, or `aad` doesn't match. */
export async function decryptJSON<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(sealed.iv), additionalData: encoder.encode(aad) },
    key,
    base64ToBytes(sealed.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export function createVerifier(key: CryptoKey): Promise<Sealed> {
  return encryptJSON(key, { check: VERIFIER_TEXT }, VERIFIER_AAD);
}

export async function checkVerifier(key: CryptoKey, verifier: Sealed): Promise<boolean> {
  try {
    const value = await decryptJSON<{ check?: string }>(key, verifier, VERIFIER_AAD);
    return value?.check === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

export interface NewKeyMaterial {
  key: CryptoKey;
  salt: string;
  iterations: number;
  verifier: Sealed;
}

/** Creates a brand-new key (fresh random salt) for a passcode, plus its verifier. */
export async function createKeyMaterial(
  passcode: string,
  iterations: number = KDF_ITERATIONS,
): Promise<NewKeyMaterial> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(passcode, salt, iterations);
  return { key, salt: bytesToBase64(salt), iterations, verifier: await createVerifier(key) };
}

/** Derives the key for `passcode` and returns it only if the verifier confirms it is correct. */
export async function unlockKey(passcode: string, params: KdfParams): Promise<CryptoKey | null> {
  const key = await deriveKey(passcode, base64ToBytes(params.salt), params.iterations);
  const ok = await checkVerifier(key, { ciphertext: params.verifierCiphertext, iv: params.verifierIv });
  return ok ? key : null;
}
