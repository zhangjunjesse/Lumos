/**
 * Feishu API utilities
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

export interface FeishuInteractiveCardContent {
  config?: Record<string, unknown>;
  header?: Record<string, unknown>;
  elements?: unknown[];
  [key: string]: unknown;
}

export class FeishuAPI {
  private cache: TokenCache | null = null;

  constructor(
    private appId: string,
    private appSecret: string,
    private baseUrl = 'https://open.feishu.cn'
  ) {}

  async getToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now() + 300000) {
      return this.cache.token;
    }

    const res = await fetch(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });

    const data = await res.json();
    if (!data.tenant_access_token) throw new Error('Token failed');

    this.cache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire || 7200) * 1000,
    };

    return this.cache.token;
  }

  async downloadFile(messageId: string, fileKey: string): Promise<Buffer> {
    const token = await this.getToken();
    const res = await fetch(
      `${this.baseUrl}/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=image`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async createChat(name: string, description: string): Promise<{ chat_id: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/chats`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, chat_mode: 'group', chat_type: 'private' })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Create chat failed: ${data.msg}`);
    return data.data;
  }

  async createChatLink(chatId: string): Promise<{ share_link: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/chats/${chatId}/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Create link failed: ${data.msg}`);
    return data.data;
  }

  /**
   * Upload an arbitrary file (pdf/doc/zip/etc.) for messaging.
   * Uses generic file_type=stream so most types are accepted.
   */
  async uploadFile(fileName: string, buffer: Buffer): Promise<{ file_key: string }> {
    const token = await this.getToken();
    const url = `${this.baseUrl}/open-apis/im/v1/files`;

    const form = new FormData();
    // Required fields per Feishu API
    form.append('file_type', 'stream');
    form.append('file_name', fileName);
    // Convert Buffer to Uint8Array to satisfy DOM BlobPart typing in TS strict mode.
    const blob = new Blob([Uint8Array.from(buffer)]);
    form.append('file', blob, fileName);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const data = await res.json();
    if (data.code !== 0) throw new Error(`Upload file failed: ${data.msg}`);
    return data.data;
  }

  /**
   * Upload an image for chat message preview (msg_type=image).
   */
  async uploadImage(fileName: string, buffer: Buffer): Promise<{ image_key: string }> {
    const token = await this.getToken();
    const url = `${this.baseUrl}/open-apis/im/v1/images`;

    const form = new FormData();
    form.append('image_type', 'message');
    const blob = new Blob([Uint8Array.from(buffer)]);
    form.append('image', blob, fileName);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const data = await res.json();
    if (data.code !== 0) throw new Error(`Upload image failed: ${data.msg}`);
    return data.data;
  }

  /**
   * Send a file message to a chat_id using a previously uploaded file_key.
   */
  async sendFileMessage(chatId: string, fileKey: string): Promise<{ message_id: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
      }),
    });

    const data = await res.json();
    if (data.code !== 0) throw new Error(`Send file message failed: ${data.msg}`);
    return data.data;
  }

  /**
   * Send an image message to a chat_id using a previously uploaded image_key.
   */
  async sendImageMessage(chatId: string, imageKey: string): Promise<{ message_id: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      }),
    });

    const data = await res.json();
    if (data.code !== 0) throw new Error(`Send image message failed: ${data.msg}`);
    return data.data;
  }

  async sendInteractiveMessage(
    chatId: string,
    cardContent: FeishuInteractiveCardContent,
  ): Promise<{ message_id: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardContent),
      }),
    });

    const data = await res.json();
    if (!res.ok || data.code !== 0) {
      throw new Error(`Send interactive message failed: ${data?.msg || res.status}`);
    }
    return data.data;
  }

  async updateInteractiveMessage(
    messageId: string,
    cardContent: FeishuInteractiveCardContent,
  ): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: JSON.stringify(cardContent),
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || (data && typeof data.code === 'number' && data.code !== 0)) {
      throw new Error(`Update interactive message failed: ${data?.msg || res.status}`);
    }
  }

  /**
   * Update chat info (e.g., name/description).
   * Uses PUT /open-apis/im/v1/chats/:chat_id
   */
  async updateChat(chatId: string, data: { name?: string; description?: string }): Promise<{ chat_id: string }> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/chats/${chatId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (result.code !== 0) throw new Error(`Update chat failed: ${result.msg}`);
    return result.data;
  }

  async deleteChat(chatId: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/open-apis/im/v1/chats/${chatId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const result = await res.json().catch(() => null);
    if (!res.ok || (result && typeof result.code === 'number' && result.code !== 0)) {
      throw new Error(`Delete chat failed: ${result?.msg || res.status}`);
    }
  }
}
