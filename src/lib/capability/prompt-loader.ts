import { loadCapabilities } from './loader';

const promptCapabilitiesCache = new Map<string, string>();

export async function loadPromptCapabilities(): Promise<void> {
  const capabilities = await loadCapabilities();

  for (const capability of capabilities) {
    if (capability.type === 'prompt') {
      promptCapabilitiesCache.set(capability.id, capability.content);
    }
  }
}

export function getPromptCapability(id: string): string | undefined {
  return promptCapabilitiesCache.get(id);
}

export function getAllPromptCapabilities(): Map<string, string> {
  return new Map(promptCapabilitiesCache);
}

export function registerPromptCapability(id: string, content: string): void {
  promptCapabilitiesCache.set(id, content);
}

export function buildPromptCapabilitiesSystemPrompt(capabilityIds?: string[]): string {
  if (!capabilityIds || capabilityIds.length === 0) {
    return '';
  }

  const prompts: string[] = [];

  for (const id of capabilityIds) {
    const content = promptCapabilitiesCache.get(id);
    if (content) {
      prompts.push(`\n## Capability: ${id}\n\n${content}`);
    }
  }

  return prompts.length > 0 ? `\n# Available Capabilities\n${prompts.join('\n')}` : '';
}
