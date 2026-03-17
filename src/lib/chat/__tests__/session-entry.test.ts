import {
  getPostDeleteRedirectPath,
  getSessionEntryBasePath,
} from '../session-entry';

describe('session-entry', () => {
  test('keeps main-agent delete redirects isolated from project sessions', () => {
    expect(getPostDeleteRedirectPath('main-agent', 'session-project-123')).toBe('/main-agent');
    expect(getPostDeleteRedirectPath('main-agent')).toBe('/main-agent');
  });

  test('keeps chat delete redirects on the nearest chat session when available', () => {
    expect(getPostDeleteRedirectPath('chat', 'session-chat-123')).toBe('/chat/session-chat-123');
    expect(getPostDeleteRedirectPath('chat')).toBe(getSessionEntryBasePath('chat'));
  });
});
