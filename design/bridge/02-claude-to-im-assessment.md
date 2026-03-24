# Claude-to-IM 调研与 Bridge Runtime 重构评估

**文档版本**: 1.0  
**创建日期**: 2026-03-17  
**状态**: Proposed  
**相关文档**: `design/bridge/01-multi-im-bridge-architecture.md`

---

## 1. 结论

结论很明确：

1. `Claude-to-IM` 的核心思路值得借鉴
2. 但不建议把它作为库直接接入 Lumos
3. Lumos 当前最需要的不是“重写所有 Bridge 业务”，而是**重写 Bridge Runtime 的托管方式**
4. 最优方向是：
   - 保留 Lumos 现有的绑定、事件、健康、UI、会话集成能力
   - 把 Feishu 长连接从 `Next.js API runtime` 迁出
   - 改为 **Electron 主进程常驻 Bridge Runtime**
   - Server/API 侧只负责“事件处理、落库、对话调用、状态查询”

一句话总结：

> 不做全量重写，做 Runtime 层重构；借鉴 `Claude-to-IM` 的运行模型，不直接搬它的宿主接口。

---

## 2. 为什么当前链路不稳

当前 Feishu 入站的真实主链路是：

```text
Feishu WSClient
  -> src/lib/bridge/websocket/websocket-manager.ts
  -> src/lib/bridge/websocket/listener-control.ts
  -> /api/bridge/websocket
  -> src/lib/bridge/message-handler.ts
  -> src/lib/bridge/core/inbound-pipeline.ts
  -> Lumos 会话 / 消息 / 同步状态
```

这里的根问题不是单条消息解析，而是 **WS 长连接托管位置错误**。

当前实现把 Feishu `WSClient` 生命周期绑在了 Next API 运行时上：

- `src/app/api/bridge/websocket/route.ts`
- `src/lib/bridge/websocket/websocket-manager.ts`
- `src/lib/bridge/websocket/listener-control.ts`

这会带来几个问题：

1. API route 不是天然适合托管常驻长连接的进程宿主
2. `next dev` / Turbopack / HMR 下，运行时实例可能重建
3. 页面刷新、服务重编译、路由冷/热切换时，连接状态与数据库状态容易脱节
4. UI 看到“已绑定”不代表 WS 真的还活着
5. 会出现“偶发可收、偶发不可收、连续多条只进一条”的现象

这也是为什么之前补了健康检查、自动拉起、状态修正之后，问题仍然反复。

---

## 3. Claude-to-IM 值得借鉴的部分

本次调研重点看了这些文件：

- `/Users/zhangjun/Downloads/Claude-to-IM-main/README.md`
- `/Users/zhangjun/Downloads/Claude-to-IM-main/docs/development.md`
- `/Users/zhangjun/Downloads/Claude-to-IM-main/src/lib/bridge/ARCHITECTURE.md`
- `/Users/zhangjun/Downloads/Claude-to-IM-main/src/lib/bridge/bridge-manager.ts`
- `/Users/zhangjun/Downloads/Claude-to-IM-main/src/lib/bridge/host.ts`
- `/Users/zhangjun/Downloads/Claude-to-IM-main/src/lib/bridge/adapters/feishu-adapter.ts`

其最有价值的不是某个 API 细节，而是以下 5 个设计点。

### 3.1 常驻 Runtime，而不是请求驱动

`Claude-to-IM` 的运行模型是：

```text
host app start
  -> initBridgeContext(...)
  -> bridgeManager.start()
  -> adapter.start()
  -> adapter 持续监听 IM 事件
  -> bridge-manager 持续消费消息
```

这点非常关键。IM Bridge 本质上是一个常驻服务，而不是一个按需请求函数。

### 3.2 Adapter 只做平台职责

它把平台差异收敛在 adapter：

- 连接平台
- 接收消息
- 发送消息
- 平台 payload -> 统一消息结构

而不把会话绑定、对话引擎、权限审批、重试、审计硬塞进平台 SDK 代码里。

### 3.3 Manager 负责编排，不让平台代码直接碰业务主链路

`bridge-manager.ts` 统一负责：

- adapter 生命周期
- 入站分发
- session 级串行
- permission callback
- streaming 过程编排
- delivery 触发

这正是我们当前 Lumos 缺的那一层“唯一主链路”。

### 3.4 宿主依赖通过接口抽象

`host.ts` 把宿主能力抽成：

- `BridgeStore`
- `LLMProvider`
- `PermissionGateway`
- `LifecycleHooks`

这意味着 bridge 可以独立演进，也天然适合多 IM。

### 3.5 新增平台的扩展点清晰

`Claude-to-IM` 的 adapter 注册模型说明一件事：

> 如果架构是对的，新增一个 IM 平台主要是在“接一个 adapter”，而不是再复制一整套 bridge 业务链路。

这和 Lumos 未来“飞书之后还要接更多 IM”的方向一致。

---

## 4. 哪些不能直接搬

虽然思路对，但不建议把 `Claude-to-IM` 当成依赖包直接接到 Lumos。

### 4.1 它的宿主接口过大，直接接入成本高

`src/lib/bridge/host.ts` 的 `BridgeStore` 接口很大，覆盖了：

- settings
- channel bindings
- sessions
- messages
- session locks
- sdk session
- provider
- dedup
- permission links
- channel offsets

这适合做一个可复用 bridge 库，但对 Lumos 当前阶段来说，接入面太大。

如果直接吃这个库，我们要么：

1. 为 Lumos 现有 DB/服务实现一整套 host adapter
2. 要么反过来为了迁就它重构大量现有代码

这不是当前最短路径。

### 4.2 它的抽象中心是“外部桥接库”，而 Lumos 的中心是“主产品”

Lumos 不是一个单纯的 IM bridge 宿主。它还有：

- Main Agent 会话体系
- 页面内消息流
- 本地工作目录/项目语义
- Feishu 文档能力
- 任务体系
- Electron 宿主能力

所以我们不能让 bridge 反过来定义整个应用的存储和运行边界。

### 4.3 我们已经有一部分可复用能力

Lumos 当前已有这些可复用模块：

- `src/lib/bridge/core/binding-service.ts`
- `src/lib/bridge/core/inbound-pipeline.ts`
- `src/lib/bridge/storage/bridge-event-repo.ts`
- `src/lib/bridge/storage/bridge-connection-repo.ts`
- `src/lib/bridge/app/bridge-service.ts`
- `src/lib/bridge/app/bridge-health-service.ts`
- 对应 UI 绑定状态与重试入口

如果全量换成 `Claude-to-IM`，这部分要么被抛弃，要么要重新包一层，收益不高。

---

## 5. 对 Lumos 当前代码的关键判断

Lumos 现在不是“没有架构”，而是 **两套 Bridge 模型并存**。

### 5.1 第一套：真正在线上跑的链路

当前真实生效的是 Feishu 专用链路：

- `src/lib/bridge/websocket/websocket-manager.ts`
- `src/lib/bridge/websocket/listener-control.ts`
- `src/app/api/bridge/websocket/route.ts`
- `src/lib/bridge/message-handler.ts`
- `src/lib/bridge/core/inbound-pipeline.ts`

### 5.2 第二套：仓库里存在但没成为主链路的通用抽象

当前仓库里也有这些文件：

- `src/lib/bridge/bridge-manager.ts`
- `src/lib/bridge/channel-router.ts`
- `src/lib/bridge/channel-adapter.ts`
- `src/lib/bridge/delivery-layer.ts`
- `src/lib/bridge/conversation-engine.ts`
- `src/lib/bridge/adapters/feishu-adapter.ts`

但是这套模型并没有成为 Feishu 双向同步的真正入口。

### 5.3 真正的问题是“运行时所有权”错了

现状不是简单的“代码脏”。

更准确地说，是：

1. Bridge Core 与 Platform Runtime 没有被统一起来
2. Feishu 长连接放在了错误宿主里
3. API route 既在做控制面，又在做数据面
4. UI 看的是持久化状态，但实际连接活在易失内存里

---

## 6. 推荐方案：局部重写 Bridge Runtime

### 6.1 重构边界

建议重写的部分：

- Feishu WS 监听 runtime
- Bridge runtime manager
- Adapter 生命周期管理
- Runtime 到 Server 的事件投递接口

建议保留的部分：

- 绑定模型与绑定 API
- 事件落库
- 健康汇总
- 重试入口
- 会话消息写入
- UI 状态展示框架

### 6.2 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process                                       │
│                                                             │
│  BridgeRuntimeManager                                       │
│   ├─ AdapterRegistry                                        │
│   ├─ FeishuRuntimeAdapter (WSClient 常驻)                   │
│   └─ RuntimeHealthTracker                                   │
│                                                             │
│  收到事件后：                                                │
│   -> POST /api/bridge/runtime/ingest                        │
│   -> POST /api/bridge/runtime/status                        │
└────────────────────────────┬────────────────────────────────┘
                             │ local http / ipc
┌────────────────────────────▼────────────────────────────────┐
│ Next / Server Side                                          │
│                                                            │
│ Bridge Application Layer                                    │
│  ├─ bridge-service.ts                                       │
│  ├─ bridge-health-service.ts                                │
│  └─ runtime-control-service.ts                              │
│                                                            │
│ Bridge Core                                                 │
│  ├─ binding-service.ts                                      │
│  ├─ inbound-pipeline.ts                                     │
│  ├─ bridge-event-repo.ts                                    │
│  └─ bridge-connection-repo.ts                               │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 控制面与数据面分离

重构后要明确拆开：

1. 控制面
   - 启动 runtime
   - 停止 runtime
   - 查询 runtime 状态
   - 触发重连

2. 数据面
   - 接收 Feishu 入站事件
   - 写事件日志
   - 调用 inbound pipeline
   - 更新健康状态

当前 `/api/bridge/websocket` 混合了这两件事，后面不应继续扩展。

---

## 7. 预期能达到什么效果

如果按这个方向落地，能明显改善以下问题。

### 7.1 能解决什么

1. **入站稳定性显著提升**
   - WSClient 由 Electron 主进程持有
   - 不再依赖 Next API runtime 的生存周期

2. **状态更真实**
   - UI 显示的不再只是“数据库里曾经绑定过”
   - 而是能反映 runtime 是否真的在线、最近是否真的收过事件

3. **更适合多 IM 扩展**
   - 后续接 Telegram / Discord / Slack 时，只需新增 runtime adapter

4. **重试与观测更清晰**
   - runtime 错误、平台错误、pipeline 错误可以分层记录

5. **用户体验更稳定**
   - 不会因为页面刷新、dev 重编译、API route 重建导致桥接 silently 掉线

### 7.2 不能保证什么

这套改造不是“100% 永不丢消息”魔法。

仍然可能存在：

1. 飞书平台侧限流
2. token 失效
3. 网络波动
4. 进程崩溃时的极短窗口事件丢失

但这些会变成“可观测、可重试、可解释”的问题，而不是现在这种“偶尔行偶尔不行”。

---

## 8. 实施建议

建议分三步做，不要一次性把所有 Bridge 模块全推翻。

### Phase 1: Runtime 剥离

目标：

- 在 Electron 主进程中创建 `BridgeRuntimeManager`
- Feishu `WSClient` 真正迁到主进程常驻
- 新增 server 侧 ingest API
- 现有 `inbound-pipeline` 继续复用

完成标志：

- 不再依赖 `/api/bridge/websocket` 维持长连接

### Phase 2: 统一 Runtime 状态面

目标：

- runtime 心跳
- 连接状态持久化
- 控制面 API 标准化
- UI 顶部状态从“绑定状态”升级为“绑定 + runtime + pipeline”

完成标志：

- 用户能看清“已绑定 / 已连接 / 最近有无消息 / 是否异常”

### Phase 3: 收敛双模型

目标：

- 让 `bridge-manager` / `channel-adapter` / runtime 模型成为唯一扩展入口
- 逐步废弃旧的飞书专用启动链

完成标志：

- 新增 IM 平台时，不再复制飞书专用链路

---

## 9. 是否需要重写

结论如下：

### 9.1 不建议全量重写整个 Bridge

原因：

- 现有绑定/事件/健康/UI 已经积累了不少可用资产
- 全量重写风险大，回归面广
- 不能直接证明“全部推翻”比“runtime 收敛”更快

### 9.2 建议重写 Runtime 层

原因：

- 这是当前最核心的不稳定源头
- 也是多 IM 扩展最关键的基础设施
- 同时改动收益最大，边界最清楚

### 9.3 对 Claude-to-IM 的推荐态度

建议是：

- **借鉴思路**
- **不直接集成**
- **不照搬 host.ts**
- **优先吸收它的 runtime / manager / adapter 分层方式**

---

## 10. 下一步开发建议

下一步不要继续给 `/api/bridge/websocket` 打补丁。

应该直接开始做：

1. `electron/main.ts` 中新增 `BridgeRuntimeManager`
2. 新建 `electron/bridge/feishu-runtime.ts`
3. 新建 server 侧 `POST /api/bridge/runtime/ingest`
4. 新建 server 侧 `POST /api/bridge/runtime/status`
5. 让现有 `BridgeHealthService` 读取 runtime 上报状态
6. 旧 `/api/bridge/websocket` 改为兼容层或废弃入口

---

## 11. 最终判断

针对“要么借鉴思路，要么看是否需要重写”的问题，最终判断是：

1. 借鉴 `Claude-to-IM` 的整体运行模型是正确的
2. 直接引入 `Claude-to-IM` 不是最优解
3. Lumos 需要的是 **Bridge Runtime 架构重构**
4. 最应该先改的不是 UI，不是消息解析，而是 **长连接宿主**

这也是当前飞书“有时能收、有时不能收”的最可能根因。
