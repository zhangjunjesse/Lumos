import type { ChannelType } from '../types';
import type { BaseChannelAdapter } from '../channel-adapter';

type AdapterFactory = () => BaseChannelAdapter;

const registry = new Map<ChannelType, AdapterFactory>();

export function registerAdapter(type: ChannelType, factory: AdapterFactory) {
  registry.set(type, factory);
}

export function createAdapter(type: ChannelType): BaseChannelAdapter {
  const factory = registry.get(type);
  if (!factory) throw new Error(`Adapter not found: ${type}`);
  return factory();
}

export function getAvailableAdapters(): ChannelType[] {
  return Array.from(registry.keys());
}
