function normalizeProviderId(providerId?: string | null): string {
  return providerId?.trim() || '';
}

export function getPreferredChatProviderId(options: {
  requestProviderId?: string | null;
  sessionProviderId?: string | null;
}): string | undefined {
  const requestProviderId = normalizeProviderId(options.requestProviderId);
  if (requestProviderId) {
    return requestProviderId;
  }

  const sessionProviderId = normalizeProviderId(options.sessionProviderId);
  return sessionProviderId || undefined;
}

export function shouldPersistChatProviderBinding(options: {
  requestProviderId?: string | null;
  sessionProviderId?: string | null;
  resolvedProviderId?: string | null;
}): boolean {
  const requestProviderId = normalizeProviderId(options.requestProviderId);
  const sessionProviderId = normalizeProviderId(options.sessionProviderId);
  const resolvedProviderId = normalizeProviderId(options.resolvedProviderId);

  if (!resolvedProviderId) {
    return false;
  }

  if (requestProviderId) {
    return resolvedProviderId !== sessionProviderId;
  }

  return !sessionProviderId;
}
