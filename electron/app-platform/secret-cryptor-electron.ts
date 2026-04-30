import { safeStorage } from 'electron';

import type { SecretCryptor } from '@/lib/app/runtime/secret-cryptor';

/**
 * Production cryptor backed by Electron's safeStorage, which uses:
 *   macOS    → Keychain
 *   Windows  → DPAPI
 *   Linux    → libsecret-1 (gnome-keyring / kwallet)
 *
 * Bind this at process startup from electron/main.ts:
 *
 *   import { createElectronSafeStorageCryptor } from './app-platform/secret-cryptor-electron';
 *   import { setActiveCryptor } from '@/lib/app/runtime/secret-cryptor';
 *   setActiveCryptor(createElectronSafeStorageCryptor());
 *
 * The wire format is a base64-encoded buffer produced by safeStorage. A
 * future migration may need to support multiple cryptor versions; tag
 * any future on-disk format change with a version prefix to keep
 * decryption deterministic.
 */
export function createElectronSafeStorageCryptor(): SecretCryptor {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),

    encrypt(plain: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'safeStorage encryption is not available on this system; OS keyring ' +
            'service may be missing or locked.',
        );
      }
      return safeStorage.encryptString(plain).toString('base64');
    },

    decrypt(encryptedBase64: string): string {
      const buf = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buf);
    },
  };
}
