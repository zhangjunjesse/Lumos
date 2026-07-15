// 会话级停止:中断正在执行的 SDK 会话(普通聊天/团队会话通用),并兜底清锁。
// 场景:团队多轮执行时间长,用户要能随时终止;导航离开再回来时本地已无流,
// 但服务端仍在跑占锁——必须有服务端中断入口,光断前端 SSE 停不掉。

import { getConversation } from '@/lib/conversation-registry';
import { getDb } from '@/lib/db';
import { setSessionRuntimeStatus } from '@/lib/db';

export async function stopSessionRun(sessionId: string): Promise<{ interrupted: boolean; lockCleared: boolean }> {
  let interrupted = false;
  const conversation = getConversation(sessionId);
  if (conversation) {
    try {
      await conversation.interrupt();
      interrupted = true;
    } catch (err) {
      console.warn('[session-stop] interrupt 失败(会话可能已自然结束):', err);
    }
  }
  // 兜底强制清锁:正常路径 interrupt 后流结束会走 onComplete 释放;这里覆盖
  // 注册表里没有会话(如 dev 重载后孤儿锁)的情况,保证用户能继续发消息。
  const lockCleared = getDb()
    .prepare('DELETE FROM session_runtime_locks WHERE session_id = ?')
    .run(sessionId).changes > 0;
  try { setSessionRuntimeStatus(sessionId, 'idle'); } catch { /* best effort */ }
  return { interrupted, lockCleared };
}
