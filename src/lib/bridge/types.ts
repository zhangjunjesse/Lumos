/**
 * Bridge system types
 */

export type ChannelType = 'feishu' | 'telegram' | 'discord';

export interface ChannelAddress {
  channelType: ChannelType;
  chatId: string;
  userId?: string;
}

export interface InboundMessage {
  messageId: string;
  address: ChannelAddress;
  text: string;
  timestamp: number;
  callbackData?: string;
  attachments?: import('@/types').FileAttachment[];
}

export interface OutboundMessage {
  address: ChannelAddress;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'plain';
  inlineButtons?: InlineButton[][];
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface PreviewCapabilities {
  supportsStreaming: boolean;
  maxUpdateRate?: number;
}
