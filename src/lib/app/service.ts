import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type Database from 'better-sqlite3';

import { dataDir, getDb } from '@/lib/db';

import type { ConsentCallback, InstallContext, UninstallContext } from './installer';
import {
  createSecretVault,
  createSoftwareCryptor,
  createTriggerManager,
  getActiveCryptor,
  setActiveCryptor,
  type SecretCryptor,
  type SecretVault,
  type TriggerManager,
} from './runtime';

/**
 * Service locator for the app platform.
 *
 * Wires together db / vault / triggers / appsRootPath so API routes don't
 * each have to construct them. The cryptor resolution order:
 *
 *   1. If electron/main.ts has called setActiveCryptor with the
 *      Electron safeStorage cryptor (production), use that.
 *   2. Otherwise (Next.js dev server without Electron, jest, CLI),
 *      fall back to a software AES-256-GCM cryptor with a key stored in
 *      `<dataDir>/.app-platform-key` (mode 0o600). This is NOT a substitute
 *      for OS keyring in production — see runtime/secret-cryptor.ts.
 */

let cached: AppPlatformService | null = null;

export interface AppPlatformService {
  db: Database.Database;
  vault: SecretVault;
  triggers: TriggerManager;
  appsRootPath: string;
  cryptor: SecretCryptor;
}

export function getAppPlatformService(): AppPlatformService {
  if (cached) return cached;

  const db = getDb();
  const cryptor = resolveCryptor();
  const vault = createSecretVault({ db, cryptor });
  const triggers = createTriggerManager(db);
  const appsRootPath = path.join(dataDir, 'apps');
  if (!fs.existsSync(appsRootPath)) {
    fs.mkdirSync(appsRootPath, { recursive: true });
  }

  cached = { db, vault, triggers, appsRootPath, cryptor };
  return cached;
}

export function resetAppPlatformServiceForTests(): void {
  cached = null;
}

export function buildInstallContext(onConsent?: ConsentCallback): InstallContext {
  const svc = getAppPlatformService();
  return {
    db: svc.db,
    vault: svc.vault,
    triggers: svc.triggers,
    appsRootPath: svc.appsRootPath,
    onConsent,
  };
}

export function buildUninstallContext(): UninstallContext {
  const svc = getAppPlatformService();
  return {
    db: svc.db,
    vault: svc.vault,
    triggers: svc.triggers,
    appsRootPath: svc.appsRootPath,
  };
}

function resolveCryptor(): SecretCryptor {
  try {
    return getActiveCryptor();
  } catch {
    // Fall through to software fallback.
  }
  const cryptor = createSoftwareCryptor(loadOrCreateSoftwareKey());
  setActiveCryptor(cryptor);
  return cryptor;
}

function loadOrCreateSoftwareKey(): Buffer {
  const keyPath = path.join(dataDir, '.app-platform-key');
  if (fs.existsSync(keyPath)) {
    const buf = fs.readFileSync(keyPath);
    if (buf.length === 32) return buf;
    // Otherwise drop and regenerate.
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}
