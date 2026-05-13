/**
 * Shared shell-level types for the Goofish Assistant app.
 * Mirrors wechat-types.ts in shape so the two apps stay structurally
 * comparable.
 */

export type AppTab =
  | 'overview'
  | 'inbox'
  | 'drafts'
  | 'auto-reply'
  | 'reminders'
  | 'search'
  | 'automations'
  | 'settings';

export interface GoofishAccountStatus {
  unb: string;
  nick?: string;
  loggedIn: boolean;
}

export interface GoofishAssistantStatus {
  app: {
    id: string;
    name: string;
    version: string;
    source: string;
    category: string;
    status: string;
  };
  install: {
    installed: boolean;
    version: string | null;
    error: string | null;
  };
  auth: {
    ready: boolean;
    accountCount: number;
    loggedInCount: number;
    accounts: GoofishAccountStatus[];
    error: string | null;
  };
  ready: boolean;
  phase: 'needs-install' | 'needs-auth' | 'ready' | string;
}

export function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-install':
      return '需要安装';
    case 'needs-auth':
      return '需要登录';
    default:
      return '加载中';
  }
}
