/**
 * Shared shell-level types for the WeChat Assistant app.
 * Domain types for relations / followups / automations live in relations-types.ts.
 */

export type AppTab = 'overview' | 'followups' | 'automations' | 'settings';

export interface WeChatAssistantStatus {
  app: { id: string; name: string; version: string; source: string; status: string };
  export: {
    supported: boolean;
    platform?: string;
    ready: boolean;
    phase: string;
    message?: string;
    keyCount?: number;
    lastExtractedAt?: number | null;
    mcp?: { enabled: boolean };
  };
  im: {
    configured: boolean;
    enabled: boolean;
    isDefault: boolean;
    routedSessionId: string | null;
    routedSessionTitle: string | null;
  };
}

export function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-consent':
      return '需要授权';
    case 'needs-env':
      return '需要环境准备';
    case 'needs-resign':
      return '需要放开微信读取';
    case 'needs-extract':
      return '需要恢复密钥';
    case 'needs-restore':
      return '建议恢复微信';
    case 'unsupported':
      return '暂不支持';
    default:
      return '加载中';
  }
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
