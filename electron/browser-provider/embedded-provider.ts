import type { BrowserManager } from '../browser/browser-manager';
import {
  DEFAULT_BROWSER_CONTEXT_ID,
  type BrowserAutomationSession,
  type BrowserContextRef,
  type BrowserProvider,
  normalizeBrowserContextId,
} from './types';

export class EmbeddedBrowserProvider implements BrowserProvider {
  readonly id = 'embedded';
  readonly type = 'embedded';
  readonly displayName = '内置浏览器';

  constructor(private readonly getManager: () => BrowserManager | null) {}

  getDefaultContextId(): string {
    return DEFAULT_BROWSER_CONTEXT_ID;
  }

  getContext(contextId: string): BrowserContextRef | null {
    if (normalizeBrowserContextId(contextId) !== DEFAULT_BROWSER_CONTEXT_ID) {
      return null;
    }
    return {
      id: DEFAULT_BROWSER_CONTEXT_ID,
      providerId: this.id,
      profileId: 'default',
      displayName: this.displayName,
      providerType: this.type,
    };
  }

  getSession(contextId: string): BrowserAutomationSession | null {
    if (!this.getContext(contextId)) {
      return null;
    }
    return this.getManager() as BrowserAutomationSession | null;
  }

  isReady(contextId = DEFAULT_BROWSER_CONTEXT_ID): boolean {
    return Boolean(this.getContext(contextId) && this.getManager());
  }
}
