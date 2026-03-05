/**
 * Base class for channel adapters
 */

import type {
  ChannelType,
  InboundMessage,
  OutboundMessage,
  SendResult,
  PreviewCapabilities,
} from './types';

export abstract class BaseChannelAdapter {
  abstract readonly channelType: ChannelType;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract isRunning(): boolean;
  abstract consumeOne(): Promise<InboundMessage | null>;
  abstract send(message: OutboundMessage): Promise<SendResult>;
  abstract validateConfig(): string | null;
  abstract isAuthorized(userId: string, chatId: string): boolean;

  onMessageStart?(_chatId: string): void;
  onMessageEnd?(_chatId: string): void;
  getPreviewCapabilities?(_chatId: string): PreviewCapabilities | null;
  sendPreview?(_chatId: string, _text: string, _draftId: number): Promise<'sent' | 'skip' | 'degrade'>;
}
