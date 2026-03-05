import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';

export async function syncMessageToFeishu(sessionId: string, role: string, content: string) {
  try {
    if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) return;

    const db = getDb();
    const binding = db.prepare(
      'SELECT platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?'
    ).get(sessionId, 'feishu', 'active') as any;

    if (!binding?.platform_chat_id) return;

    const feishuApi = new FeishuAPI(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);
    const card = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: role === 'user' ? '👤 用户' : '🤖 AI' },
          template: role === 'user' ? 'blue' : 'green'
        },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content } }]
      }
    };

    const token = await feishuApi.getToken();
    await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receive_id: binding.platform_chat_id, ...card })
    });
  } catch (err) {
    console.error('[Sync] Failed to sync message:', err);
  }
}
