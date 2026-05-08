import { storeMemoryV2Secret } from './secret-vault';
import type { MemoryV2ScopeType, MemoryV2Sensitivity } from './types';

const SECRET_ASSIGNMENT_PATTERN = /(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|密码|口令|密钥|令牌)\s*(?:[:：=]|是|为|is)\s*([^\s，,；;]+)/ig;
const OPENAI_KEY_PATTERN = /\b(sk-[A-Za-z0-9_-]{12,})\b/g;
const JWT_PATTERN = /\b([A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b/g;
const CREDENTIAL_NEED_PATTERN = /(密码|口令|token|api\s*key|密钥|令牌|cookie|登录态|凭证|ssh\s*key|secret|credential)/i;
const SENSITIVE_RESOURCE_HINT_PATTERN = /(服务器|账号|权限|登录态|凭证)/i;

export interface ProcessResourceSecretParams {
  scopeType: MemoryV2ScopeType;
  scopeKey: string;
  ownerModule: string;
  sessionId?: string;
  messageId?: string;
  projectPath?: string;
  sourceType?: string;
  sourceId?: string;
}

export interface ProcessResourceSecretResult {
  text: string;
  sensitivity: MemoryV2Sensitivity;
  secretRefs: string[];
}

function secretValueType(label: string): string {
  if (/api/i.test(label) || /密钥/.test(label)) return 'api_key';
  if (/token|令牌/i.test(label)) return 'token';
  if (/cookie/i.test(label)) return 'cookie';
  if (/password|passwd|pwd|密码|口令/i.test(label)) return 'password';
  return 'secret';
}

export function processMemoryV2ResourceSecrets(
  text: string,
  params: ProcessResourceSecretParams,
): ProcessResourceSecretResult {
  let redacted = text;
  const secretRefs: string[] = [];

  function saveSecret(label: string, value: string, valueType?: string): string {
    const ref = storeMemoryV2Secret({
      label,
      value,
      valueType: valueType || secretValueType(label),
      scopeType: params.scopeType,
      scopeKey: params.scopeKey,
      ownerModule: params.ownerModule,
      sourceType: params.sourceType || 'memory_v2_resource',
      sourceId: params.sourceId,
      sessionId: params.sessionId,
      messageId: params.messageId,
      projectPath: params.projectPath,
      metadata: {
        capture: 'memory-v2-resource-secret',
      },
    });
    secretRefs.push(ref);
    return ref;
  }

  redacted = redacted.replace(SECRET_ASSIGNMENT_PATTERN, (_match, label, value) => {
    const ref = saveSecret(String(label), String(value));
    return `${String(label)}: [已自动加密保存到 Vault，secret_ref=${ref}]`;
  });

  redacted = redacted.replace(OPENAI_KEY_PATTERN, (value) => {
    const ref = saveSecret('api_key', value, 'api_key');
    return `[API key 已自动加密保存到 Vault，secret_ref=${ref}]`;
  });

  redacted = redacted.replace(JWT_PATTERN, (value) => {
    const ref = saveSecret('token', value, 'token');
    return `[token 已自动加密保存到 Vault，secret_ref=${ref}]`;
  });

  const uniqueRefs = Array.from(new Set(secretRefs));
  let sensitivity: MemoryV2Sensitivity = 'normal';
  if (uniqueRefs.length > 0) {
    sensitivity = 'sensitive_ref';
  } else if (CREDENTIAL_NEED_PATTERN.test(text)) {
    sensitivity = 'secret_ref_required';
  } else if (SENSITIVE_RESOURCE_HINT_PATTERN.test(text)) {
    sensitivity = 'sensitive_ref';
  }

  return { text: redacted, sensitivity, secretRefs: uniqueRefs };
}
