import './adapters'; // 确保 adapter 注册代码执行

export * from './types';
export { BridgeManager } from './bridge-manager';
export { ChannelRouter } from './channel-router';
export { DeliveryLayer } from './delivery-layer';
export { ConversationEngine } from './conversation-engine';
export { BaseChannelAdapter } from './channel-adapter';
export { registerAdapter, createAdapter, getAvailableAdapters } from './adapters/adapter-factory';
export { validateInput } from './security/validators';
export { MessageDeduplicator } from './security/dedup';
