export const TOOLS = [
  {
    name: 'im_list_providers',
    description: 'List all enabled IM providers (Feishu / WeChat / Work WeChat etc.) with their current configured/enabled status and the default provider id.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'im_default_provider',
    description: 'Get the id of the user\'s default IM provider (used by sendToDefault). Returns null if not configured.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'im_list_targets',
    description: 'List the chats / contacts the IM bot can send to. Use this before im_send to find the right chatId. Currently provider must be one whose manifest declares targetDirectory: true (e.g. feishu, wechat-qclaw).',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'IM provider id (e.g. "feishu", "wechat-qclaw"). Use im_list_providers first if unsure.',
        },
        query: {
          type: 'string',
          description: 'Optional search query against name/id.',
        },
        limit: {
          type: 'integer',
          description: 'Max results (default 50).',
        },
      },
      required: ['providerId'],
    },
  },
  {
    name: 'im_send',
    description: 'Send a text message via a specific IM provider to a specific chat. Use im_list_targets first to find the right chatId. Returns { ok, messageId, error }.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'IM provider id, e.g. "feishu" or "wechat-qclaw".',
        },
        chatId: {
          type: 'string',
          description: 'Target chat id (group chat_id, user open_id, wechat-work userid, etc.).',
        },
        text: {
          type: 'string',
          description: 'Message text to send.',
        },
      },
      required: ['providerId', 'chatId', 'text'],
    },
  },
  {
    name: 'im_send_to_default',
    description: 'Send a text message via the user\'s default IM provider. Caller still must specify chatId. Returns { ok, messageId, error }.',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: {
          type: 'string',
          description: 'Target chat id within the default provider.',
        },
        text: {
          type: 'string',
          description: 'Message text to send.',
        },
      },
      required: ['chatId', 'text'],
    },
  },
];
