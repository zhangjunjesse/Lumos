/**
 * Feishu API error codes
 */
export enum FeishuErrorCode {
  RATE_LIMIT = 99991400,           // Rate limit exceeded
  BOT_REMOVED = 230002,            // Bot removed from chat
  NO_PERMISSION = 230001,          // No permission
  INVALID_TOKEN = 99991663,        // Token expired
  CHAT_NOT_FOUND = 230004,         // Chat not found
}

/**
 * Error handling result
 */
export interface ErrorHandleResult {
  shouldRetry: boolean;
  retryAfter?: number;
  shouldUnbind?: boolean;
  userMessage?: string;
}

/**
 * Smart error handler for Feishu API errors
 */
export class FeishuErrorHandler {
  /**
   * Handle Feishu API error and return action to take
   */
  handle(errorCode: number, errorMsg: string): ErrorHandleResult {
    switch (errorCode) {
      case FeishuErrorCode.RATE_LIMIT:
        return {
          shouldRetry: true,
          retryAfter: 60000, // Retry after 1 minute
          userMessage: '发送频率过快，请稍后再试',
        };

      case FeishuErrorCode.BOT_REMOVED:
        return {
          shouldRetry: false,
          shouldUnbind: true,
          userMessage: '机器人已被移除，绑定已自动解除',
        };

      case FeishuErrorCode.NO_PERMISSION:
        return {
          shouldRetry: false,
          userMessage: '机器人无权限发送消息，请检查权限配置',
        };

      case FeishuErrorCode.INVALID_TOKEN:
        return {
          shouldRetry: true,
          retryAfter: 5000, // Retry after 5 seconds
          userMessage: 'Token 已过期，正在刷新...',
        };

      case FeishuErrorCode.CHAT_NOT_FOUND:
        return {
          shouldRetry: false,
          shouldUnbind: true,
          userMessage: '群组不存在，绑定已自动解除',
        };

      default:
        return {
          shouldRetry: false,
          userMessage: `发送失败：${errorMsg}`,
        };
    }
  }
}
