import type Database from 'better-sqlite3';

import type {
  AppManifest,
  ParsedApp,
  ValidationIssue,
} from '../manifest/types';
import type { SecretVault } from '../runtime/secret-vault';
import type { TriggerManager } from '../runtime/trigger-manager';

import type { PermissionDescriptor } from './permissions';

export type AppSource = 'ai-generated' | 'workflow-promoted' | 'local';

export type InstallSource =
  | { type: 'zip'; path: string }
  | { type: 'directory'; path: string };

export interface ConsentRequest {
  manifest: AppManifest;
  permissions: PermissionDescriptor[];
  /** True if this is upgrading an existing install of the same id. */
  isUpgrade: boolean;
  previousVersion?: string;
}

export interface ConsentResponse {
  /** Subset of req.permissions[].permission strings to grant. */
  granted: string[];
}

export type ConsentCallback = (
  req: ConsentRequest,
) => Promise<ConsentResponse | null>; // null = user cancelled

export interface InstallContext {
  db: Database.Database;
  vault: SecretVault;
  triggers: TriggerManager;
  /** Root for installed app dirs, typically `${HOME}/.lumos/apps`. */
  appsRootPath: string;
  /** Where extracted/downloaded app packages live during install. */
  tmpRootPath?: string;
  onConsent?: ConsentCallback;
  /** Override Date.now for tests. */
  now?: () => number;
}

export interface InstalledApp {
  appId: string;
  version: string;
  installPath: string;
  source: AppSource;
  isUpgrade: boolean;
  previousVersion?: string;
}

export type InstallErrorCode =
  | 'UnpackError'
  | 'ManifestInvalid'
  | 'CrossFileInvalid'
  | 'VersionConflict'
  | 'UserCancelled'
  | 'FilesystemError'
  | 'ConsentDenied';

export type InstallResult =
  | { ok: true; installed: InstalledApp; warnings: ValidationIssue[] }
  | { ok: false; error: InstallErrorCode; issues: ValidationIssue[]; message: string };

export interface UninstallContext {
  db: Database.Database;
  vault: SecretVault;
  triggers: TriggerManager;
  appsRootPath: string;
}

export interface UninstallOptions {
  /** When false, also delete user data from lumos_app_data. Default: true. */
  keepData?: boolean;
  /** Also delete the prior-version directory if one is retained. Default: true. */
  purgePrevious?: boolean;
}

export type UninstallResult =
  | { ok: true; appId: string; deletedPaths: string[]; deletedDataRows: number }
  | { ok: false; error: 'NotInstalled' | 'FilesystemError'; message: string };

/** Re-exports so callers don't need to import from manifest/. */
export type { ParsedApp, ValidationIssue, AppManifest };
