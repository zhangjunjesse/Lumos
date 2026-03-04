# 数据库IPC迁移实施报告

**日期**: 2026-03-03
**任务**: Task #11 - 实现：数据库操作迁移到Main Process
**状态**: Phase 1 完成（基础设施）

---

## 已完成的工作

### 1. IPC 类型定义
**文件**: `src/types/ipc.ts`
- 定义了 IpcRequest 和 IpcResponse 基础类型
- 定义了 Sessions 相关的请求/响应类型
- 包含完整的 TypeScript 类型定义

### 2. Zod 校验 Schemas
**文件**: `electron/ipc/schemas.ts`
- 实现了 Sessions 相关的 Zod schemas
- 用于运行时参数校验
- 防止无效数据传递

### 3. Database Service
**文件**: `electron/db/service.ts`
- 实现了 Sessions 的 CRUD 操作
- 业务逻辑层，封装数据库操作
- 支持列表查询、创建、更新、删除

### 4. IPC Handlers
**文件**: `electron/ipc/handlers.ts`
- 实现了类型安全的 IPC handler 创建函数
- 注册了 Sessions 相关的 IPC handlers
- 包含完整的错误处理和日志记录

### 5. IPC Client
**文件**: `src/lib/ipc/client.ts`
- 封装了 ipcRenderer.invoke 调用
- 实现了超时和重试机制
- 提供了类型安全的 API 接口

### 6. Database Connection (Main Process)
**文件**: `electron/db/connection.ts`
- 实现了数据库连接管理
- 复用了现有的 schema 初始化逻辑
- 注册了优雅关闭的 shutdown handlers

### 7. Main Process 集成
**文件**: `electron/main.ts`
- 在 app.whenReady() 中初始化数据库
- 创建 DatabaseService 实例
- 注册 IPC handlers

### 8. Preload Script 更新
**文件**: `electron/preload.ts`
- 暴露了 ipcRenderer.invoke 方法
- 允许 Renderer Process 调用 IPC

### 9. TypeScript 类型定义
**文件**: `src/types/electron.d.ts`
- 更新了 ElectronAPI 接口
- 添加了 ipcRenderer 类型定义

---

## 架构图

```
┌─────────────────────────────────────────┐
│    Renderer Process (Next.js)          │
│  ┌───────────────────────────────────┐  │
│  │  IPC Client                       │  │
│  │  - ipcClient.listSessions()       │  │
│  │  - ipcClient.createSession()      │  │
│  └───────────────────────────────────┘  │
│              ↓ IPC                      │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│    Main Process (Electron)              │
│  ┌───────────────────────────────────┐  │
│  │  IPC Handlers                     │  │
│  │  - db:sessions:list               │  │
│  │  - db:sessions:create             │  │
│  └───────────────────────────────────┘  │
│              ↓                          │
│  ┌───────────────────────────────────┐  │
│  │  Database Service                 │  │
│  │  - listSessions()                 │  │
│  │  - createSession()                │  │
│  └───────────────────────────────────┘  │
│              ↓                          │
│  ┌───────────────────────────────────┐  │
│  │  better-sqlite3                   │  │
│  │  - SQL queries                    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## 待完成的工作

### Phase 2: 扩展其他资源

需要为以下资源实现 IPC 接口：

1. **Providers** (API Providers)
   - `db:providers:list`
   - `db:providers:get`
   - `db:providers:create`
   - `db:providers:update`
   - `db:providers:delete`

2. **MCP Servers**
   - `db:mcp-servers:list`
   - `db:mcp-servers:get`
   - `db:mcp-servers:create`
   - `db:mcp-servers:update`
   - `db:mcp-servers:delete`
   - `db:mcp-servers:toggle`

3. **Skills**
   - `db:skills:list`
   - `db:skills:get`
   - `db:skills:create`
   - `db:skills:update`
   - `db:skills:delete`
   - `db:skills:toggle`

4. **Tasks**
   - `db:tasks:list`
   - `db:tasks:get`
   - `db:tasks:create`
   - `db:tasks:update`
   - `db:tasks:delete`

5. **Media**
   - `db:media:list`
   - `db:media:get`
   - `db:media:create`
   - `db:media:delete`

### Phase 3: 迁移 API Routes

需要更新以下 API Routes 使用 IPC Client：

1. `src/app/api/sessions/route.ts`
2. `src/app/api/providers/route.ts`
3. `src/app/api/plugins/mcp/route.ts`
4. `src/app/api/skills/route.ts`
5. `src/app/api/tasks/route.ts`
6. `src/app/api/media/route.ts`

### Phase 4: 移除 Renderer Process 数据库依赖

1. 从 `package.json` 的 dependencies 中移除 better-sqlite3（保留在 devDependencies 用于 Main Process）
2. 删除或标记为 deprecated: `src/lib/db/connection.ts`
3. 更新构建脚本，确保 better-sqlite3 只在 Main Process 中编译

---

## 测试计划

### 单元测试
- [ ] IPC Client 测试（mock ipcRenderer）
- [ ] Database Service 测试（使用内存数据库）
- [ ] IPC Handlers 测试（mock ipcMain）

### 集成测试
- [ ] 端到端 IPC 调用测试
- [ ] 错误处理测试（网络超时、数据库错误）
- [ ] 并发请求测试

### 性能测试
- [ ] IPC 调用延迟测试（目标 < 50ms）
- [ ] 批量操作性能测试
- [ ] 内存占用测试

---

## 风险与注意事项

### 1. 数据迁移
- 现有数据库文件位置不变（`~/.lumos/lumos.db`）
- 无需数据迁移，只是访问方式改变

### 2. 向后兼容
- API Routes 接口保持不变
- 前端代码无需修改（除了 API Routes 内部实现）

### 3. 错误处理
- IPC 调用失败时需要有降级策略
- 需要完善的日志记录和错误追踪

### 4. 性能
- IPC 调用有一定开销（约 1-5ms）
- 需要实现批量操作和缓存策略

---

## 下一步

1. **扩展其他资源的 IPC 接口**（Providers、MCP Servers、Skills 等）
2. **迁移 API Routes**（使用 IPC Client 替代直接数据库访问）
3. **编写测试**（单元测试、集成测试）
4. **性能优化**（批量操作、缓存）
5. **移除 Renderer Process 的数据库依赖**

---

**状态**: ✅ Phase 1 完成
**下一步**: Phase 2 - 扩展其他资源的 IPC 接口
