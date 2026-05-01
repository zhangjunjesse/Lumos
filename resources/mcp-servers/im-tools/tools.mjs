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
  {
    name: 'im_send_attachment',
    description: 'Send a local file (image / Word / Excel / PPT / PDF / 任意二进制) to a specific IM chat. Optional text caption. Use after generating an artifact (e.g. a docx via office MCP) when the user wants the file pushed to IM. Returns { ok, messageId, error }.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'IM provider id, e.g. "feishu" or "wechat".',
        },
        chatId: {
          type: 'string',
          description: 'Target chat id (group chat_id, user open_id, wechat peer userId, etc.).',
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the local file. Must be inside ~/.lumos/.lumos-uploads / .lumos-media / .lumos-images (lumos sandbox). Server reads the bytes — do NOT pass huge base64 through the tool args.',
        },
        fileName: {
          type: 'string',
          description: 'Optional display filename. Defaults to basename(filePath). Useful for renaming "1700000-foo.docx" → "report.docx".',
        },
        mimeType: {
          type: 'string',
          description: 'Optional MIME override. Defaults to extension-based detection.',
        },
        text: {
          type: 'string',
          description: 'Optional caption text sent alongside the file (after the file in WeChat / before in Feishu).',
        },
      },
      required: ['providerId', 'chatId', 'filePath'],
    },
  },
  {
    name: 'im_send_to_default_attachment',
    description: 'Same as im_send_attachment but uses the user\'s default IM provider (so caller only needs chatId + filePath).',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: {
          type: 'string',
          description: 'Target chat id within the default provider.',
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the local file. Must be inside lumos sandbox dirs.',
        },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['chatId', 'filePath'],
    },
  },
];
