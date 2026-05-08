// Permission check helpers for sandbox RPC. Pure functions.

import type { ManifestPermissions } from '@/lib/app/compile/types';
import type { ErrorCode } from './protocol';

export interface PermDecision {
  ok: boolean;
  code?: ErrorCode;
  message?: string;
  hint?: string;
}

const ALLOW: PermDecision = { ok: true };

export function checkDbRead(perms: ManifestPermissions, collection: string): PermDecision {
  if (perms.db?.read?.includes(collection)) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有读取 collection "${collection}" 的权限。`,
    hint: `在 manifest.permissions.db.read 加入 "${collection}"。`,
  };
}

export function checkDbWrite(perms: ManifestPermissions, collection: string): PermDecision {
  if (perms.db?.write?.includes(collection)) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有写入 collection "${collection}" 的权限。`,
    hint: `在 manifest.permissions.db.write 加入 "${collection}"。`,
  };
}

export function checkAi(perms: ManifestPermissions, kind: 'complete' | 'stream' | 'structured'): PermDecision {
  if (perms.ai?.[kind]) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有 ai.${kind} 权限。`,
    hint: `在 manifest.permissions.ai 加入 { "${kind}": true }。`,
  };
}

export function checkWorkflow(perms: ManifestPermissions, workflowId: string): PermDecision {
  if (perms.workflow?.run?.includes(workflowId)) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有运行 workflow "${workflowId}" 的权限。`,
    hint: `在 manifest.permissions.workflow.run 加入 "${workflowId}"。`,
  };
}

export function checkDeepSearch(perms: ManifestPermissions, op: 'start' | 'read' | 'control'): PermDecision {
  if (perms.deepsearch?.[op]) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有 deepsearch.${op} 权限。`,
    hint: `在 manifest.permissions.deepsearch 加入 { "${op}": true }。`,
  };
}

export function checkSecret(perms: ManifestPermissions, key: string): PermDecision {
  if (perms.secrets?.includes(key)) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有读取密钥 "${key}" 的权限。`,
    hint: `在 manifest.permissions.secrets 加入 "${key}"。`,
  };
}

export function checkSystem(perms: ManifestPermissions, capability: 'notification' | 'schedule' | 'clipboard' | 'im-notification'): PermDecision {
  if (perms.system?.includes(capability)) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有 system.${capability} 权限。`,
    hint: `在 manifest.permissions.system 加入 "${capability}"。`,
  };
}

export function checkFiles(perms: ManifestPermissions, op: 'pick' | 'save'): PermDecision {
  if (perms.files?.[op]) return ALLOW;
  return {
    ok: false,
    code: 'PERM_DENIED',
    message: `应用没有 files.${op} 权限。`,
    hint: `在 manifest.permissions.files 加入 { "${op}": true }。`,
  };
}
