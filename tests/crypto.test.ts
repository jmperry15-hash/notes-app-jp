import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  createKeyMaterial,
  decryptJSON,
  deriveKey,
  encryptJSON,
  KDF_ITERATIONS,
  unlockKey,
} from '../src/lib/crypto';
import { TEST_ITERATIONS } from './helpers';

const paramsOf = (m: Awaited<ReturnType<typeof createKeyMaterial>>) => ({
  salt: m.salt,
  iterations: m.iterations,
  verifierCiphertext: m.verifier.ciphertext,
  verifierIv: m.verifier.iv,
});

describe('crypto', () => {
  it('round-trips data with the production key-derivation settings', async () => {
    const material = await createKeyMaterial('my secret passcode');
    expect(material.iterations).toBe(600_000);
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(base64ToBytes(material.salt)).toHaveLength(16);

    const note = { title: 'Groceries', body: { type: 'doc' }, pinned: true, folderId: null };
    const sealed = await encryptJSON(material.key, note, 'notes:abc');
    expect(sealed.ciphertext).not.toContain('Groceries');
    expect(base64ToBytes(sealed.iv)).toHaveLength(12);

    // Unlock from scratch with the stored parameters, as a fresh app launch would.
    const key = await unlockKey('my secret passcode', paramsOf(material));
    expect(key).not.toBeNull();
    await expect(decryptJSON(key!, sealed, 'notes:abc')).resolves.toEqual(note);
  });

  it('rejects a wrong passcode via the verifier, without touching any notes', async () => {
    const material = await createKeyMaterial('right passcode', TEST_ITERATIONS);
    await expect(unlockKey('wrong passcode', paramsOf(material))).resolves.toBeNull();
    await expect(unlockKey('right passcode', paramsOf(material))).resolves.not.toBeNull();
  });

  it('cannot decrypt with a key derived from a different passcode', async () => {
    const salt = base64ToBytes(bytesToBase64(crypto.getRandomValues(new Uint8Array(16))));
    const right = await deriveKey('right passcode', salt, TEST_ITERATIONS);
    const wrong = await deriveKey('wrong passcode', salt, TEST_ITERATIONS);
    const sealed = await encryptJSON(right, { secret: 1 }, 'notes:1');
    await expect(decryptJSON(wrong, sealed, 'notes:1')).rejects.toThrow();
  });

  it('binds ciphertext to its record so rows cannot be swapped', async () => {
    const { key } = await createKeyMaterial('passcode', TEST_ITERATIONS);
    const sealed = await encryptJSON(key, { secret: 1 }, 'notes:one');
    await expect(decryptJSON(key, sealed, 'notes:two')).rejects.toThrow();
    await expect(decryptJSON(key, sealed, 'folders:one')).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const { key } = await createKeyMaterial('passcode', TEST_ITERATIONS);
    const sealed = await encryptJSON(key, { secret: 'hello' }, 'notes:1');
    const bytes = base64ToBytes(sealed.ciphertext);
    bytes[0] ^= 1;
    await expect(decryptJSON(key, { ...sealed, ciphertext: bytesToBase64(bytes) }, 'notes:1')).rejects.toThrow();
  });

  it('uses a fresh IV every time and keeps the key non-extractable', async () => {
    const { key } = await createKeyMaterial('passcode', TEST_ITERATIONS);
    const a = await encryptJSON(key, 'same', 'x');
    const b = await encryptJSON(key, 'same', 'x');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('treats differently-encoded but identical passcodes the same', async () => {
    const material = await createKeyMaterial('café latte', TEST_ITERATIONS); // é as one code point
    await expect(unlockKey('café latte', paramsOf(material))).resolves.not.toBeNull(); // e + accent
  });

  it('refuses unsafe key-derivation settings', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await expect(deriveKey('passcode', salt, 1000)).rejects.toThrow();
  });
});
