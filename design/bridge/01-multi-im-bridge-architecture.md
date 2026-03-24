# 多 IM Bridge 架构设计

**文档版本**: 1.0  
**创建日期**: 2026-03-17  
**状态**: Draft  
**适用范围**: Lumos 会话与外部 IM 平台的绑定、双向消息同步、连接健康与失败恢复

---

## 1. 背景与结论

当前 Bridge 已经具备飞书双向同步能力，但实现上存在两个问题：

1. **运行时主链路是飞书专用实现**
   - 入站处理、出站发送、鉴权、绑定、连接状态都耦合在飞书代码里
   - 当前真实生效链路主要由以下模块组成：
     - `src/lib/bridge/message-handler.ts`
     - `src/lib/bridge/sync-helper.ts`
     - `src/lib/bridge/websocket/websocket-manager.ts`
     - `src/app/api/bridge/bindings/route.ts`

2. **仓库内同时存在一套未落地为主链路的通用抽象**
   - 例如：
     - `src/lib/bridge/channel-adapter.ts`
     - `src/lib/bridge/bridge-manager.ts`
     - `src/lib/bridge/sync/sync-coordinator.ts`
   - 这套抽象没有成为实际入口，导致 Bridge 目前处于“两套模型并存”状态

**结论**:
- 需要重构，但不需要推倒重来
- 重构目标不是“把飞书代码写得更整齐”，而是**收敛成一套真正支持多 IM 的统一 Bridge 架构**
- 后续新增 Telegram / Discord / Slack / 企业微信时，必须复用同一条 Bridge Core 主链路，而不是复制一套平台专用逻辑

---

## 2. 设计目标

### 2.1 目标

1. 支持一个 Lumos 会话绑定多个外部 IM 平台
2. 同一平台内，一个 Lumos 会话只允许一个 `active` 频道绑定
3. 统一入站、出站、重试、日志、健康状态与可观测性
4. 平台差异收敛到 Adapter 层
5. 让 UI 可以展示真实同步状态，而不是只显示“已绑定”
6. 让后续接入新 IM 的改动范围稳定、可预测

### 2.2 非目标

1. 本阶段不实现跨平台群组联邦同步
2. 不做分布式 Bridge 节点
3. 不做复杂规则引擎
4. 不要求所有平台第一版就支持文件、卡片、流式编辑等高级能力

---

## 3. 架构原则

### P1. 平台无关的主链路只有一套

所有平台共享：
- Binding 模型
- Inbound Pipeline
- Outbound Pipeline
- Retry / Dead Letter
- Health / Metrics
- Event Log

### P2. 平台差异只留在 Adapter 层

Adapter 只负责：
- 平台连接
- 消息发送
- 事件接收
- 平台 payload 与统一 envelope 的转换

Adapter 不负责：
- 会话路由
- 业务状态更新
- 对话引擎调用
- 重试策略
- UI 状态语义

### P3. 连接状态与同步状态分开建模

不能再把“已绑定”直接等同于“已同步”。

必须拆开：
- Binding 状态
- Auth 状态
- Transport 状态
- Pipeline 状态

### P4. Durable First

去重、失败记录、重试、健康判断必须优先依赖持久化状态，而不是内存变量。

### P5. 路由唯一性优先于灵活性

V1 为保证可预测性，采用保守绑定策略：
- 一个 Lumos 会话可以绑定多个平台
- 但同一平台下只允许一个 `active` 绑定
- 同一个平台频道只允许绑定到一个 Lumos 会话

不支持：
- 同一个会话在同一平台同时绑定多个群
- 同一个群同时绑定多个 Lumos 会话

---

## 4. 目标架构

### 4.1 分层图

```text
┌──────────────────────────────────────────────────────────────┐
│ UI / Main Agent / APIs                                       │
│ - 聊天页面                                                    │
│ - 绑定入口                                                    │
│ - 健康状态展示                                                │
│ - 重试 / 解绑 / 暂停                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Bridge Application Layer                                     │
│ - bindChannel(sessionId, platform)                           │
│ - unbindChannel(bindingId)                                   │
│ - sendMessage(sessionId, platform, payload)                  │
│ - getBridgeHealth(sessionId)                                 │
│ - retryEvent(eventId)                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Bridge Core                                                  │
│ - BindingService                                             │
│ - InboundPipeline                                            │
│ - OutboundPipeline                                           │
│ - EventLogService                                            │
│ - RetryService / DeadLetterService                           │
│ - BridgeHealthService                                        │
│ - ChannelRegistry                                            │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Platform Adapters                                            │
│ - FeishuAdapter                                              │
│ - TelegramAdapter                                            │
│ - DiscordAdapter                                             │
│ - SlackAdapter                                               │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Platform SDK / REST / WebSocket / Webhook                    │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 关键结论

1. `Bridge Core` 是唯一主链路
2. `Platform Adapter` 是平台插件层
3. 不允许业务层直接调用平台 SDK
4. 不允许新增平台时复制一套 `message-handler + sync-helper + websocket-manager`

---

## 5. 模块划分

### 5.1 Bridge Application Layer

职责：
- 提供给 UI、主会话、系统 API 的统一服务入口
- 不承载平台细节

建议模块：
- `src/lib/bridge/app/bridge-service.ts`
- `src/lib/bridge/app/bridge-health-service.ts`
- `src/lib/bridge/app/bridge-command-service.ts`

建议接口：

```ts
interface BridgeService {
  bindChannel(input: BindChannelInput): Promise<BindChannelResult>;
  unbindChannel(bindingId: number): Promise<void>;
  pauseBinding(bindingId: number): Promise<void>;
  resumeBinding(bindingId: number): Promise<void>;

  sendMessage(input: SendBridgeMessageInput): Promise<SendBridgeMessageResult>;
  retryEvent(eventId: string): Promise<void>;

  getSessionBindings(sessionId: string): Promise<BridgeBinding[]>;
  getSessionHealth(sessionId: string): Promise<BridgeHealthView>;
}
```

### 5.2 Bridge Core

职责：
- 平台无关的核心业务编排

内部子模块：

1. `BindingService`
   - 负责会话与平台频道的绑定关系

2. `InboundPipeline`
   - 负责处理平台发到 Lumos 的消息

3. `OutboundPipeline`
   - 负责处理 Lumos 发到平台的消息

4. `EventLogService`
   - 统一记录入站/出站事件、状态和错误

5. `RetryService`
   - 统一重试与死信

6. `BridgeHealthService`
   - 统一汇总绑定状态、鉴权状态、连接状态、事件健康状态

7. `ChannelRegistry`
   - 平台注册中心，按 `platform` 获取 adapter

### 5.3 Platform Adapter

职责：
- 封装平台 SDK / REST / WebSocket / Webhook
- 暴露统一接口

禁止事项：
- 不准直接操作 `session_bindings`
- 不准直接写 Lumos 消息表
- 不准自行决定重试策略

---

## 6. 核心数据模型

### 6.1 Binding

表示一个 Lumos 会话与外部 IM 频道的关联。

```ts
interface BridgeBinding {
  id: number;
  sessionId: string;
  platform: string;
  channelId: string;
  channelName?: string;
  platformAccountId?: string;
  status: 'pending' | 'active' | 'paused' | 'expired' | 'deleted';
  mode: 'bidirectional' | 'inbound_only' | 'outbound_only';
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

### 6.1.1 绑定唯一性规则

V1 明确约束如下：

1. 一个 Lumos 会话可以同时绑定多个平台
2. 同一 `sessionId + platform` 最多只允许一个 `active` binding
3. 同一 `platform + channelId` 最多只允许一个 `active` binding
4. 重新绑定同平台新频道前，必须先解绑或暂停旧 binding

原因：
- 避免出站消息 fan-out 到多个同平台群，导致用户误判
- 避免入站路由冲突和重试语义混乱
- 避免 UI 无法清晰展示“当前这个平台到底绑定的是哪个群”

### 6.1.2 账号模型

V1 采用**单平台单账号**模型：

- 每个平台默认只存在一个已登录账号
- `platformAccountId` 作为保留字段存在
- V1 可统一写入 `'default'` 或由 repo 层做缺省填充
- 多账号切换不是本阶段目标

### 6.2 Event

表示一次可观测、可重试、可追踪的桥接事件。

```ts
interface BridgeEvent {
  id: string;
  bindingId: number;
  platform: string;
  direction: 'inbound' | 'outbound';
  transportKind: 'websocket' | 'webhook' | 'polling' | 'rest';
  channelId: string;
  platformAccountId?: string;
  platformMessageId?: string;
  eventType: 'message' | 'file' | 'image' | 'reaction' | 'system';
  status: 'received' | 'processing' | 'success' | 'failed' | 'dead_letter';
  payloadJson: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  lastAttemptAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

### 6.2.1 去重键要求

`platformMessageId` 不能单独作为 durable dedup 键。

V1 推荐唯一语义：

- 入站事件唯一键：`platform + channelId + direction=inbound + platformMessageId`
- 出站事件唯一键：`platform + bindingId + direction=outbound + platformMessageId`

如果某平台 message id 还需要账号维度隔离，则追加 `platformAccountId`。

### 6.3 Connection Health

表示平台 transport 的连接健康，而不是绑定状态。

```ts
interface BridgeConnectionHealth {
  platform: string;
  accountId?: string;
  transportKind: 'websocket' | 'webhook' | 'polling';
  status: 'starting' | 'connected' | 'reconnecting' | 'disconnected' | 'stale';
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastEventAt?: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
}
```

说明：
- 对 V1 单账号模型，`accountId` 默认可视为 `'default'`
- 对 webhook 平台，`connected` 不一定代表长连接，而表示事件入口和鉴权处于可用状态

---

## 7. 状态模型

### 7.1 绑定状态

- `pending`: 已创建绑定流程，未完成激活
- `active`: 已激活，可参与同步
- `paused`: 用户主动暂停
- `expired`: 鉴权失效或平台账号不可用
- `deleted`: 解绑或逻辑删除

### 7.2 鉴权状态

- `ok`
- `missing`
- `expired`
- `revoked`

### 7.3 传输状态

- `starting`
- `connected`
- `reconnecting`
- `disconnected`
- `stale`

### 7.4 Pipeline 状态

- `healthy`
- `degraded`
- `failing`

判定建议：
- 最近 5 分钟有入站成功，且无连续失败：`healthy`
- 有连接但最近连续失败 >= 3：`degraded`
- transport 断开或最近失败持续升高：`failing`

---

## 8. 健康检查模型

UI 顶部不应再显示“飞书会话已同步”，而应展示统一健康视图。

```ts
interface BridgeHealthView {
  sessionId: string;
  bindings: Array<{
    bindingId: number;
    platform: string;
    bindingStatus: 'pending' | 'active' | 'paused' | 'expired' | 'deleted';
    authStatus: 'ok' | 'missing' | 'expired' | 'revoked';
    transportStatus: 'starting' | 'connected' | 'reconnecting' | 'disconnected' | 'stale';
    pipelineStatus: 'healthy' | 'degraded' | 'failing';
    lastInboundEventAt?: number | null;
    lastInboundSuccessAt?: number | null;
    lastInboundFailureAt?: number | null;
    lastOutboundSuccessAt?: number | null;
    lastOutboundFailureAt?: number | null;
    consecutiveInboundFailures: number;
    consecutiveOutboundFailures: number;
    summary: string;
  }>;
}
```

### 8.1 “心跳”定义

这里的心跳不是单指 WebSocket ping/pong。

对 Bridge 而言，健康信号至少包括：

1. **Transport heartbeat**
   - 连接是否建立
   - 最近是否收到平台事件

2. **Pipeline heartbeat**
   - 最近是否成功处理过消息
   - 最近是否连续失败

3. **Auth heartbeat**
   - 令牌是否有效
   - 是否能正常调用平台 API

### 8.2 最低实现要求

Bridge Health 第一版必须具备：
- `lastConnectedAt`
- `lastDisconnectedAt`
- `lastInboundEventAt`
- `lastInboundSuccessAt`
- `lastInboundFailureAt`
- `lastOutboundSuccessAt`
- `lastOutboundFailureAt`
- `lastErrorMessage`

---

## 9. Adapter 统一接口

### 9.1 平台适配器契约

```ts
interface PlatformAdapter {
  readonly platform: string;
  readonly transportMode: 'push' | 'webhook' | 'polling' | 'hybrid';

  startTransport?(): Promise<void>;
  stopTransport?(): Promise<void>;
  getTransportHealth(): Promise<BridgeConnectionHealth | null>;
  getCapabilities(): PlatformCapabilities;

  createBinding(input: CreatePlatformBindingInput): Promise<CreatePlatformBindingResult>;
  refreshBinding?(binding: BridgeBinding): Promise<RefreshPlatformBindingResult>;
  deleteBinding?(binding: BridgeBinding): Promise<void>;

  sendMessage(input: PlatformSendMessageInput): Promise<PlatformSendMessageResult>;
  sendFiles?(input: PlatformSendFilesInput): Promise<PlatformSendFilesResult>;

  normalizeInboundEvent(raw: unknown, context?: PlatformIngressContext): Promise<InboundEnvelope | null>;
}
```

### 9.2 平台能力协商

```ts
interface PlatformCapabilities {
  supportsText: boolean;
  supportsFiles: boolean;
  supportsImages: boolean;
  supportsRichCard: boolean;
  supportsMessageEdit: boolean;
  supportsThreads: boolean;
  supportsStreamingPreview: boolean;
  maxMessageLength?: number;
}
```

规则：
- UI 和 `OutboundPipeline` 只能根据 capability 做能力分支
- 不允许写 `if (platform === 'feishu')`
- 平台不支持的能力由 pipeline 降级，例如富卡片降级为文本

### 9.3 Inbound Envelope

```ts
interface InboundEnvelope {
  platform: string;
  transportKind: 'websocket' | 'webhook' | 'polling';
  platformMessageId: string;
  channelId: string;
  senderId?: string;
  senderName?: string;
  messageType: 'text' | 'image' | 'file' | 'audio' | 'video' | 'system';
  text?: string;
  attachments?: FileAttachment[];
  rawPayload?: unknown;
  receivedAt: number;
}
```

### 9.4 设计约束

1. `normalizeInboundEvent()` 必须是纯平台转换
2. 去重不由 adapter 决定
3. 失败落库不由 adapter 决定
4. 会话绑定查找不由 adapter 决定
5. webhook/polling 平台不应被迫伪造长连接 `connected` 状态
6. `getTransportHealth()` 返回 `null` 时，由 `BridgeHealthService` 基于平台类型做降级判定

---

## 10. 关键事件流

### 10.1 绑定流程

```text
UI / API
  -> BridgeService.bindChannel()
  -> BindingService 创建 pending 记录
  -> Adapter.createBinding()
  -> BindingService 更新 active / expired
  -> EventLogService 记录 binding_event
```

### 10.2 入站流程

```text
Platform transport event
  -> Adapter.normalizeInboundEvent()
  -> InboundPipeline.receive()
  -> BindingService.resolveBinding(platform, channelId)
  -> EventLogService.create(received)
  -> Durable dedup
  -> Auth / policy validation
  -> ConversationEngine.sendMessage(...)
  -> OutboundPipeline.replyIfNeeded(...)
  -> EventLogService.markSuccess / markFailed
```

### 10.3 出站流程

```text
Main Agent / Session UI
  -> BridgeService.sendMessage(...)
  -> BindingService.resolveActiveBindings(sessionId, platform?)
  -> OutboundPipeline.deliver()
  -> Adapter.getCapabilities()
  -> Adapter.sendMessage()
  -> EventLogService.markSuccess / markFailed
  -> RetryService.enqueueIfNeeded()
```

### 10.4 重试流程

```text
failed event
  -> RetryService.enqueue()
  -> retry worker
  -> InboundPipeline.retry(eventId) / OutboundPipeline.retry(eventId)
  -> success => mark success
  -> exceed max retries => dead_letter
```

---

## 11. 存储模型

### 11.1 建议表

#### `bridge_bindings`

字段建议：
- `id`
- `session_id`
- `platform`
- `channel_id`
- `channel_name`
- `platform_account_id`
- `status`
- `mode`
- `metadata_json`
- `created_at`
- `updated_at`

唯一索引建议：
- `UNIQUE(session_id, platform) WHERE status IN ('pending', 'active', 'paused', 'expired')`
- `UNIQUE(platform, channel_id) WHERE status IN ('pending', 'active', 'paused', 'expired')`

#### `bridge_events`

字段建议：
- `id`
- `binding_id`
- `platform`
- `direction`
- `transport_kind`
- `channel_id`
- `platform_account_id`
- `platform_message_id`
- `event_type`
- `status`
- `payload_json`
- `error_code`
- `error_message`
- `retry_count`
- `last_attempt_at`
- `created_at`
- `updated_at`

索引建议：
- `(binding_id, created_at desc)`
- `(platform, direction, channel_id, platform_message_id)`
- `(status, updated_at)`

#### `bridge_connections`

字段建议：
- `platform`
- `account_id`
- `transport_kind`
- `status`
- `last_connected_at`
- `last_disconnected_at`
- `last_event_at`
- `last_error_at`
- `last_error_message`
- `updated_at`

### 11.2 与现有表的关系

现有：
- `session_bindings`
- `message_sync_log`

迁移原则：

1. Phase 1 即引入最小 `bridge_events` / `bridge_connections`，避免健康和重试先搭临时模型
2. `session_bindings` 可在早期阶段继续兼容，作为 binding 来源
3. 后续再引入正式 `bridge_bindings` 或将 `session_bindings` 演进为通用 binding 表
4. 最后清理飞书专用表名与残留兼容逻辑

---

## 12. 当前实现与目标实现映射

### 12.1 当前模块问题

| 当前模块 | 问题 | 目标去向 |
| --- | --- | --- |
| `message-handler.ts` | 飞书入站编排、去重、鉴权、回复耦合在一起 | 拆入 `InboundPipeline` + `FeishuAdapter.normalizeInboundEvent()` |
| `sync-helper.ts` | 飞书出站发送与绑定状态耦合 | 拆入 `OutboundPipeline` + `FeishuAdapter.sendMessage()` |
| `websocket-manager.ts` | 只有布尔状态，无真实健康模型 | 迁入 `FeishuTransportManager` 并接入 `BridgeHealthService` |
| `bindings/route.ts` | API 直接操作飞书平台逻辑 | 通过 `BridgeService` / `BindingService` 收口 |
| `bridge-manager.ts` | 通用抽象未成为主链路 | 重构后作为统一入口保留或更名 |
| `sync/sync-coordinator.ts` | 与新架构职能重叠 | 合并进 `Bridge Core`，避免双轨并存 |

### 12.2 目标目录建议

```text
src/lib/bridge/
  app/
    bridge-service.ts
    bridge-health-service.ts
  core/
    binding-service.ts
    inbound-pipeline.ts
    outbound-pipeline.ts
    event-log-service.ts
    retry-service.ts
    dead-letter-service.ts
    channel-registry.ts
  adapters/
    base/
      platform-adapter.ts
    feishu/
      feishu-adapter.ts
      feishu-transport.ts
      feishu-auth.ts
      feishu-message-normalizer.ts
    telegram/
    discord/
  storage/
    bridge-binding-repo.ts
    bridge-event-repo.ts
    bridge-connection-repo.ts
```

---

## 13. 飞书平台落地要求

### 13.1 Transport

飞书第一版沿用 WebSocket 事件监听，但必须补足：
- 连接状态事件
- 最近事件时间戳
- 最近错误时间戳
- 重连状态
- health 只读接口

### 13.2 入站处理修复要求

飞书入站必须修复以下问题：

1. 不允许先以内存集合标记“已处理成功”
2. 失败必须落库
3. 支持按 event 重试
4. 静默丢弃必须留下可观测原因
5. 连接中断后要能识别 `stale` 状态

### 13.3 出站处理要求

飞书出站应统一通过 `OutboundPipeline`：
- 文本
- 图片
- 文件
- 平台卡片

所有发送结果都必须落 `bridge_events`。

---

## 14. API 设计原则

### 14.1 对 UI 提供的平台无关接口

建议统一为：

- `POST /api/bridge/bindings`
- `GET /api/bridge/bindings?sessionId=...`
- `POST /api/bridge/bindings/:id/pause`
- `POST /api/bridge/bindings/:id/resume`
- `DELETE /api/bridge/bindings/:id`
- `GET /api/bridge/health?sessionId=...`
- `POST /api/bridge/events/:id/retry`

### 14.2 UI 状态语义

顶部状态文案应按真实状态展示：

- `未绑定`
- `飞书已绑定`
- `飞书同步正常`
- `飞书连接异常`
- `飞书登录失效`
- `最近同步失败`

禁止继续使用：
- “已同步” 但实际只表示 `binding.status === active`

---

## 15. 迁移策略

### Phase 1: 收敛入口，不改平台能力

目标：
- 把 API 和 UI 调用统一收口到 `BridgeService`
- 引入最小事件与连接健康存储
- 保持飞书能力不变

产出：
- `BridgeService`
- `BindingService`
- `BridgeHealthService` 初版
- `bridge_events` 最小表
- `bridge_connections` 最小表

### Phase 2: 重构飞书入站/出站主链路

目标：
- 引入 `InboundPipeline` / `OutboundPipeline`
- 飞书 adapter 只保留平台能力

产出：
- 入站 durable dedup
- 失败落库
- retry / dead letter

### Phase 3: 引入正式 bridge 存储模型

目标：
- 统一 binding 存储语义
- 决定是演进 `session_bindings` 还是切换到 `bridge_bindings`

产出：
- migration
- repo 层
- 兼容读写

### Phase 4: 接入第二个平台验证抽象

推荐：
- Telegram 或 Discord 二选一

目标：
- 验证 adapter 接口是否足够稳定
- 验证 UI 和 health 模型是否真正复用

---

## 16. 开发验收标准

### 16.1 架构验收

1. 新平台接入不需要复制 `message-handler.ts`
2. UI 不直接依赖平台 SDK 或飞书专用 helper
3. 所有同步状态可从 `BridgeHealthService` 获取
4. 所有失败都有持久化记录

### 16.2 飞书验收

1. 入站失败不再静默丢失
2. 断线后可在 UI 看到 transport 异常
3. 顶部状态不再把“绑定”误报成“同步正常”
4. 用户可对失败事件执行重试

### 16.3 多 IM 验收

1. 第二个平台接入时不改 Bridge Core 主流程
2. 新平台只新增 adapter、平台配置和少量 UI 文案
3. 健康状态展示模型保持一致

---

## 17. 本文档对后续开发的约束

从本文档生效起，后续 Bridge 开发遵循以下约束：

1. 不再新增飞书专用主链路入口
2. 不再让 API 直接编排平台 SDK
3. 不再把 `binding.active` 解释为“同步健康”
4. 所有入站消息必须具备 durable event 记录
5. 所有连接状态必须进入 `BridgeHealthService`

---

## 18. 下一步开发顺序

推荐按以下顺序实施：

1. 定义 `BridgeService` / `BridgeHealthService` 接口
2. 抽离 `BindingService`
3. 为飞书补 `FeishuTransportHealth`
4. 重写飞书 `InboundPipeline`
5. 重写飞书 `OutboundPipeline`
6. 增加失败日志与重试入口
7. 再接入第二个 IM

---

## 19. 最终结论

Bridge 当前不适合直接继续叠加第二个 IM。

需要做的不是继续给飞书打补丁，而是：

1. **统一主链路**
2. **将平台差异收敛到 Adapter**
3. **建立真实健康模型**
4. **让事件、失败、重试具备持久化能力**

这次重构完成后，飞书问题会更容易定位；更重要的是，后续接入更多 IM 时，架构不会再次失控。
