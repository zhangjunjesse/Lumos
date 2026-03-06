# 飞书机器人会话同步功能需求文档

## 功能概述

Lumos 飞书同步功能允许用户将 AI 对话会话与飞书群组绑定，实现双向消息同步。用户可以在 Lumos 桌面应用和飞书移动端/网页端之间无缝切换，保持对话连续性。

### 核心价值
- **移动办公**：在飞书中随时与 AI 对话，无需打开 Lumos
- **团队协作**：将 AI 对话分享到飞书群组，团队成员可以查看和参与
- **消息归档**：飞书作为消息备份，方便后续查阅

### 工作模式

**场景A：Lumos 必须运行（推荐方案）**

```
飞书消息 → Lumos后台服务 → Claude API → 飞书回复
```

**用户体验：**
- ✅ Lumos 可以最小化到系统托盘
- ✅ 不需要打开特定会话页面
- ✅ 可以同时在 Lumos 中进行其他会话
- ❌ Lumos 必须保持运行（关闭后飞书无法触发 AI）

**技术实现：**
- 主进程的 WebSocket 服务持续监听飞书事件
- 收到消息后调用 Claude API
- 不依赖 UI 状态

---

## 核心功能 Stories

### Story 1: 扫码绑定飞书群组

**作为** Lumos 用户
**我想要** 在会话页面点击"同步到飞书"按钮，扫码后自动创建并加入飞书群组
**以便** 我可以在飞书中查看和参与这个 AI 对话

**验收标准：**
- 会话页面有"同步到飞书"按钮
- 点击后显示二维码
- 扫码后自动创建飞书群组（群名：Lumos - {会话标题}）
- 用户自动加入群组
- 绑定关系保存到数据库
- 显示"绑定成功"提示

---

### Story 2: Lumos 消息同步到飞书

**作为** Lumos 用户
**我想要** 在 Lumos 中发送的消息和 AI 回复自动同步到飞书群组
**以便** 我可以在飞书中查看完整的对话历史

**验收标准：**
- 用户消息实时推送到飞书（蓝色卡片，标题"👤 用户"）
- AI 回复实时推送到飞书（绿色卡片，标题"🤖 AI助手"）
- 支持 Markdown 格式渲染
- 支持代码块高亮
- 消息顺序正确
- 延迟 < 2秒

---

### Story 3: 飞书消息同步到 Lumos

**作为** 飞书用户
**我想要** 在飞书群组中发送消息后，自动触发 AI 回复
**以便** 我可以在飞书中直接与 AI 对话

**验收标准：**
- 飞书消息实时同步到 Lumos
- 自动触发 Claude API 生成回复
- AI 回复同步回飞书
- 支持 @机器人 触发（可选）
- 延迟 < 3秒

---

### Story 4: 暂停/恢复同步

**作为** Lumos 用户
**我想要** 临时暂停同步，稍后再恢复
**以便** 在某些场景下控制消息流向

**验收标准：**
- 有"暂停同步"开关
- 暂停后消息不再同步
- 绑定关系保持（状态改为 'paused'）
- 可以随时恢复
- 恢复后不会补发暂停期间的消息

---

### Story 5: 解绑飞书群组

**作为** Lumos 用户
**我想要** 解除会话与飞书群组的绑定
**以便** 停止消息同步

**验收标准：**
- 有"解绑"按钮
- 解绑后消息不再同步
- 飞书群组保留（不自动解散）
- 数据库中绑定关系标记为 'unbound'
- 显示"解绑成功"提示

---

### Story 6: 查看绑定状态

**作为** Lumos 用户
**我想要** 查看当前会话的飞书绑定状态
**以便** 了解同步是否正常工作

**验收标准：**
- 会话页面显示绑定状态徽章（已绑定/未绑定/已暂停）
- 点击徽章显示详细信息（群组名称、绑定时间、同步方向）
- 显示最近同步时间
- 显示同步错误（如果有）

---

## 高级功能 Stories

### Story 7: 选择同步方向

**作为** Lumos 用户
**我想要** 选择同步方向（双向/仅 Lumos→飞书/仅飞书→Lumos）
**以便** 灵活控制消息流向

**验收标准：**
- 绑定时可以选择同步方向
- 绑定后可以修改同步方向
- 单向同步时只同步指定方向的消息

---

### Story 8: 网络断线重连

**作为** Lumos 用户
**我想要** 在网络断开后自动重连飞书
**以便** 同步功能不会因为临时网络问题而中断

**验收标准：**
- 检测到 WebSocket 断开时自动重连
- 最多重试 10 次
- 使用指数退避策略（1s, 2s, 4s, 8s...最多 30s）
- 重连成功后显示通知
- 重连失败后显示错误提示

---

### Story 9: 数据安全

**作为** Lumos 用户
**我想要** 确保飞书同步过程中数据安全
**以便** 保护隐私和敏感信息

**验收标准：**
- 使用 HTTPS/WSS 加密传输
- 飞书 Token 安全存储
- 不在日志中泄露敏感信息
- 解绑后清理本地缓存

---

### Story 13: 后台运行模式

**作为** Lumos 用户
**我想要** 最小化 Lumos 到系统托盘后，飞书同步仍然工作
**以便** 我可以在飞书中随时与 AI 对话，而不需要保持 Lumos 窗口打开

**验收标准：**
- 点击关闭按钮时，Lumos 最小化到托盘（不退出）
- 托盘图标显示同步状态（正常/同步中/错误）
- 右键托盘图标可以"显示窗口"或"退出应用"
- 后台模式下 WebSocket 保持连接
- 飞书消息正常触发 AI 回复
- 系统启动时可选自动启动

---

### Story 14: 飞书消息通知

**作为** Lumos 用户
**我想要** 在飞书群组收到新消息时，Lumos 显示桌面通知
**以便** 我知道有人在飞书中与 AI 对话

**验收标准：**
- 收到飞书消息时显示系统通知
- 通知内容："{用户名} 在飞书中发送了消息"
- 点击通知打开对应会话
- 可以在设置中关闭通知
- AI 回复时也显示通知（可选）

---

### Story 15: 多会话并发

**作为** Lumos 用户
**我想要** 在飞书中与 AI 对话的同时，在 Lumos 中进行其他会话
**以便** 我可以同时处理多个任务

**验收标准：**
- 飞书同步不阻塞 Lumos UI
- 可以同时在 Lumos 中打开其他会话
- 飞书消息到达时，如果当前打开的是绑定会话，实时显示新消息
- 如果当前打开的是其他会话，不影响当前会话
- 会话列表显示未读消息数（来自飞书的消息）

---

### Story 16: Lumos 关闭时的提示

**作为** Lumos 用户
**我想要** 在退出 Lumos 时，如果有活跃的飞书绑定，收到提醒
**以便** 我知道退出后飞书同步会停止

**验收标准：**
- 点击"退出应用"时，检查是否有活跃绑定
- 如果有，弹出确认对话框："退出后飞书同步将停止，确定退出吗？"
- 提供"最小化到托盘"选项
- 可以勾选"不再提示"
- 退出后 WebSocket 断开

---

### Story 17: 会话状态实时同步

**作为** Lumos 用户
**我想要** 在飞书中发送消息后，Lumos 中的会话页面实时更新
**以便** 我可以在两个平台之间无缝切换

**验收标准：**
- 飞书消息同步到 Lumos 后，如果会话页面已打开，实时显示
- 消息列表自动滚动到最新消息
- 显示消息来源标识（"来自飞书"）
- AI 回复时显示打字动画
- 不会出现消息重复

---

### Story 18: 离线消息处理

**作为** Lumos 用户
**我想要** 在 Lumos 离线期间，飞书消息被缓存，上线后自动处理
**以便** 不会丢失任何消息

**验收标准：**
- Lumos 关闭期间，飞书消息无法触发 AI（这是预期行为）
- Lumos 启动后，显示"离线期间错过 X 条飞书消息"
- 提供"查看错过的消息"按钮
- 不会自动回复离线期间的消息（避免延迟回复）
- 用户可以手动在 Lumos 中回复

---

### Story 30: 大量消息优化

**作为** Lumos 用户
**我想要** 在会话有大量消息时，同步仍然流畅
**以便** 不影响使用体验

**验收标准：**
- 消息列表虚拟滚动（只渲染可见区域）
- 飞书消息批量同步（100ms 内的消息合并发送）
- 历史消息分页加载（每次 50 条）
- 同步队列限制（最多 100 条待同步消息）
- 超过限制时显示警告："同步队列已满，请稍后"

---

## 技术架构

### 数据库设计

```sql
-- 飞书绑定表
CREATE TABLE feishu_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,           -- 飞书群组ID
  user_open_id TEXT NOT NULL,      -- 用户飞书OpenID
  sync_direction TEXT DEFAULT 'both', -- 'both' | 'lumos_to_feishu' | 'feishu_to_lumos'
  status TEXT DEFAULT 'active',    -- 'active' | 'paused' | 'unbound'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id)
);

-- 消息同步记录表
CREATE TABLE feishu_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  direction TEXT NOT NULL,         -- 'lumos_to_feishu' | 'feishu_to_lumos'
  status TEXT DEFAULT 'pending',   -- 'pending' | 'success' | 'failed'
  error_message TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (binding_id) REFERENCES feishu_bindings(id)
);
```

### WebSocket 服务

```typescript
// electron/feishu-websocket.ts
class FeishuWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  connect() {
    // 连接飞书 WebSocket
  }

  reconnect() {
    // 指数退避重连
  }

  handleMessage(event: MessageEvent) {
    // 处理飞书消息
    // 1. 查询绑定关系
    // 2. 调用 Claude API
    // 3. 发送回复到飞书
  }

  sendToFeishu(chatId: string, message: string) {
    // 发送消息到飞书
  }
}
```

### API 路由

```typescript
// src/app/api/feishu/bind/route.ts
POST /api/feishu/bind
  - 创建飞书群组
  - 保存绑定关系
  - 返回二维码

// src/app/api/feishu/unbind/route.ts
POST /api/feishu/unbind
  - 解除绑定
  - 更新数据库状态

// src/app/api/feishu/sync/route.ts
POST /api/feishu/sync
  - 同步消息到飞书
  - 记录同步日志

// src/app/api/feishu/status/route.ts
GET /api/feishu/status/:sessionId
  - 查询绑定状态
  - 返回同步统计
```

---

## 开发优先级

### Phase 1: MVP（核心功能）
- Story 1: 扫码绑定飞书群组
- Story 2: Lumos 消息同步到飞书
- Story 3: 飞书消息同步到 Lumos
- Story 5: 解绑飞书群组
- Story 6: 查看绑定状态

### Phase 2: 稳定性增强
- Story 4: 暂停/恢复同步
- Story 8: 网络断线重连
- Story 9: 数据安全

### Phase 3: 用户体验优化
- Story 13: 后台运行模式
- Story 14: 飞书消息通知
- Story 16: Lumos 关闭时的提示
- Story 17: 会话状态实时同步

### Phase 4: 高级功能
- Story 7: 选择同步方向
- Story 15: 多会话并发
- Story 18: 离线消息处理
- Story 30: 大量消息优化

---

## 测试计划

### 单元测试
- 飞书 API 调用
- 数据库操作
- 消息格式转换

### 集成测试
- 绑定流程
- 消息同步流程
- 断线重连

### E2E 测试
- 完整用户流程
- 多会话并发
- 网络异常场景

---

## 风险与限制

### 技术风险
- **飞书 API 限流**：需要实现请求队列和限流控制
- **WebSocket 稳定性**：需要完善的重连机制
- **消息顺序**：需要确保消息按时间顺序同步

### 产品限制
- **Lumos 必须运行**：关闭后飞书无法触发 AI
- **网络依赖**：需要稳定的网络连接
- **飞书权限**：需要用户授权创建群组和发送消息

### 性能考虑
- **大量消息**：需要虚拟滚动和分页加载
- **并发会话**：需要合理的资源分配
- **内存占用**：需要定期清理缓存
