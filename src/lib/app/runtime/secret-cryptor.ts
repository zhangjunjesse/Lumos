import crypto from 'crypto';

/**
 * Application secret cryptor.
 *
 * The app platform stores app config values encrypted at rest in
 * lumos_app_configs.value_encrypted. The actual encryption primitive depends
 * on context:
 *
 *   - Production (Electron main process): Electron `safeStorage`, which
 *     wraps macOS Keychain / Windows DPAPI / Linux libsecret-1. The key is
 *     bound to the OS user account, so secrets do not survive copying the
 *     SQLite file to another machine without re-entering credentials.
 *     Implementation lives in `secret-cryptor-electron.ts` and is wired up
 *     from electron/main.ts at startup.
 *
 *   - Tests / non-Electron contexts: `createSoftwareCryptor` uses
 *     AES-256-GCM with a caller-provided key. Suitable for unit tests and
 *     headless CLI flows where Electron isn't running. NOT a substitute for
 *     OS keyring in production — anyone who can read the SQLite file plus
 *     the key file can decrypt.
 *
 * One process should set the active cryptor early via `setActiveCryptor`;
 * SecretVault retrieves it via `getActiveCryptor`. In tests the vault is
 * given a cryptor directly to keep the global state out of test paths.
 */

export interface SecretCryptor {
  /** @returns base64-encoded ciphertext. Never returns plaintext. */
  encrypt(plain: string): string;
  /** @throws if the ciphertext is malformed or auth tag fails */
  decrypt(encryptedBase64: string): string;
  /** @returns false if the underlying primitive is unavailable */
  isAvailable(): boolean;
}

const SOFTWARE_VERSION_TAG = 'sw-aes-gcm-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Software AES-256-GCM cryptor. Caller provides a 32-byte master key.
 *
 * Wire format (base64):
 *   header (12 bytes ASCII "sw-aes-gcm-v1") || iv (12 bytes) || tag (16 bytes) || ciphertext
 */
export function createSoftwareCryptor(masterKey: Buffer): SecretCryptor {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('createSoftwareCryptor: masterKey must be a 32-byte Buffer');
  }
  const header = Buffer.from(SOFTWARE_VERSION_TAG, 'ascii');

  return {
    isAvailable: () => true,

    encrypt(plain: string): string {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([header, iv, tag, ciphertext]).toString('base64');
    },

    decrypt(encryptedBase64: string): string {
      const buf = Buffer.from(encryptedBase64, 'base64');
      if (buf.length < header.length + IV_BYTES + TAG_BYTES) {
        throw new Error('Invalid ciphertext: too short');
      }
      const headerSlice = buf.subarray(0, header.length);
      if (!headerSlice.equals(header)) {
        throw new Error(
          `Invalid ciphertext: unknown header ${headerSlice.toString('ascii')}`,
        );
      }
      const iv = buf.subarray(header.length, header.length + IV_BYTES);
      const tag = buf.subarray(
        header.length + IV_BYTES,
        header.length + IV_BYTES + TAG_BYTES,
      );
      const ciphertext = buf.subarray(header.length + IV_BYTES + TAG_BYTES);
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}

let active: SecretCryptor | null = null;

export function setActiveCryptor(cryptor: SecretCryptor): void {
  active = cryptor;
}

export function getActiveCryptor(): SecretCryptor {
  if (!active) {
    throw new Error(
      'Secret cryptor not initialized. Call setActiveCryptor() at process startup ' +
        '(electron/main.ts wires the Electron safeStorage cryptor; tests should ' +
        'pass a cryptor directly to createSecretVault).',
    );
  }
  return active;
}

export function clearActiveCryptor(): void {
  active = null;
}
