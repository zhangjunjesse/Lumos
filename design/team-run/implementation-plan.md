# Team Run 执行引擎 - 实施计划

**制定日期**: 2026-03-12
**项目经理**: project-manager
**版本**: 1.0

---

## 执行摘要

基于架构师、代码审查员和前端专家的评估，Team Run 执行引擎整体完成度为 **85%**，核心架构已就位，剩余工作主要集中在 API 集成、UI 连接和安全加固。

**关键发现**:
- ✅ 核心执行引擎 90% 完成（Orchestrator、Worker、StateManager）
- ✅ UI 组件 70% 完成（TeamTaskHub、TeamRunDetailView 等）
- ⚠️ API 层缺失（需实现 5 个核心端点）
- ⚠️ 实时推送机制未实现（SSE/WebSocket）
- ⚠️ 安全隔离不足（文件系统、资源配额）

**预计完成时间**: 2-3 周

---

## 一、剩余工作清单

### P0 - 阻塞性问题（必须立即解决）

#### 1.1 实现 API 层（5 个端点）
**优先级**: P0
**工作量**: 3 天
**负责模块**: `src/app/api/team-run/`

**待实现端点**:
- `POST /api/team-run/runs` - 创建 Run
- `POST /api/team-run/runs/:runId/start` - 启动 Run
- `GET /api/team-run/runs/:runId` - 获取状态
- `POST /api/team-run/runs/:runId/pause` - 暂停 Run
- `GET /api/team-run/runs/:runId/stream` - SSE 实时推送

**参考**: `design/team-run/api-design.md` lines 60-502

#### 1.2 Agent 通信数据大小限制
**优先级**: P0
**工作量**: 2 天
**问题**: 当前 `latestResult` 限制 10KB，无法传递复杂数据

**解决方案**:
1. 创建 `team_run_artifacts` 表存储大文件
2. 提升 `latestResult` 限制到 100KB
3. 超出部分自动存入 artifacts 表

**参考**: `design/team-run/02-review.md` lines 100-129

#### 1.3 文件系统隔离
**优先级**: P0
**工作量**: 1 天
**问题**: Agent 共享工作目录，存在文件冲突和数据泄露风险

**解决方案**:
```typescript
const workDir = path.join(
  LUMOS_DATA_DIR,
  'team-runs',
  runId,
  'stages',
  stageId
)
```

**参考**: `design/team-run/02-review.md` lines 169-196

---

### P1 - 重要功能（影响用户体验）

#### 1.4 实时状态推送（SSE）
**优先级**: P1
**工作量**: 2 天
**当前**: UI 使用 2 秒轮询，API 负载高

**解决方案**:
1. 实现 SSE 端点 `/api/team-run/runs/:runId/stream`
2. 创建 `useTeamRunStream` hook
3. 更新 TeamRunDetailView 使用 SSE
4. 添加降级到轮询的 fallback

**参考**: `design/team-run/ui-integration.md` lines 140-181

#### 1.5 UI 组件集成
**优先级**: P1
**工作量**: 3 天

**待完成**:
- 替换 TeamRunDetailView 的轮询为 SSE (lines 86-114)
- 添加 TeamWorkspacePanel 的乐观更新
- 实现错误边界和重连逻辑
- 添加 Toast 通知和 Loading 骨架屏

**参考**: `design/team-run/ui-integration.md` lines 267-313

#### 1.6 数据库 Schema 增强
**优先级**: P1
**工作量**: 1 天

**缺失字段**:
```sql
ALTER TABLE team_run_stages ADD COLUMN retryCount INTEGER DEFAULT 0;
ALTER TABLE team_run_stages ADD COLUMN errorMessage TEXT;
ALTER TABLE team_run_stages ADD COLUMN startedAt INTEGER;
ALTER TABLE team_run_stages ADD COLUMN completedAt INTEGER;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 0;
```

**参考**: `design/team-run/02-review.md` lines 490-516

---

### P2 - 优化项（可延后）

#### 1.7 并发控制优化
**优先级**: P2
**工作量**: 2 天
**当前**: 简单的 `maxParallelWorkers` 限制

**改进**: 引入资源权重调度
```typescript
interface AgentBudget {
  weight: number  // 1-10
  maxDiskMB: number
  maxMemoryMB: number
}
```

**参考**: `design/team-run/02-review.md` lines 131-167

#### 1.8 依赖解析算法优化
**优先级**: P2
**工作量**: 0.5 天
**当前**: O(n²) 循环查找

**改进**: 使用 Kahn 算法优化到 O(n+e)

**参考**: `design/team-run/02-review.md` lines 261-304

#### 1.9 性能优化
**优先级**: P2
**工作量**: 1 天

**优化项**:
- 懒加载 Detail View 组件
- 虚拟化长列表（>100 项）
- Debounce 用户输入（500ms）
- Memoize 昂贵计算

**参考**: `design/team-run/ui-integration.md` lines 355-383

---

## 二、实施路线图

### Week 1: 核心 API 和数据层

**Day 1-2: API 端点实现**
- [ ] 创建 `/api/team-run/runs/route.ts` (POST)
- [ ] 创建 `/api/team-run/runs/[runId]/start/route.ts` (POST)
- [ ] 创建 `/api/team-run/runs/[runId]/route.ts` (GET/DELETE)
- [ ] 单元测试覆盖

**Day 3: Artifacts 表和数据迁移**
- [ ] 设计 `team_run_artifacts` 表
- [ ] 编写 migration 脚本
- [ ] 更新 StateManager 支持大文件存储
- [ ] 测试数据迁移

**Day 4: 文件系统隔离**
- [ ] 实现 Stage 独立工作目录
- [ ] 更新 Worker 使用隔离目录
- [ ] 添加磁盘配额检查
- [ ] 测试文件隔离

**Day 5: 集成测试**
- [ ] 端到端测试：创建 → 启动 → 完成
- [ ] 错误场景测试
- [ ] 性能基准测试

---

### Week 2: 实时推送和 UI 集成

**Day 6-7: SSE 实现**
- [ ] 实现 `/api/team-run/runs/[runId]/stream/route.ts`
- [ ] 创建 `src/hooks/useTeamRunStream.ts`
- [ ] 添加重连逻辑和错误处理
- [ ] 测试连接稳定性

**Day 8-9: UI 组件更新**
- [ ] 更新 TeamRunDetailView 使用 SSE
- [ ] 添加 ErrorBoundary 组件
- [ ] 实现 Toast 通知系统
- [ ] 添加 Loading 骨架屏

**Day 10: UI 集成测试**
- [ ] 测试实时更新延迟 (<500ms)
- [ ] 测试连接断开恢复
- [ ] 测试多标签页同步
- [ ] 移动端响应式测试

---

### Week 3: 优化和发布

**Day 11-12: 性能优化**
- [ ] 实现组件懒加载
- [ ] 添加列表虚拟化
- [ ] 优化依赖解析算法
- [ ] 压测和性能调优

**Day 13: 安全加固**
- [ ] 输入验证增强
- [ ] 错误信息脱敏
- [ ] 资源配额限制
- [ ] 安全审计

**Day 14: 文档和发布**
- [ ] 更新 API 文档
- [ ] 编写故障排查指南
- [ ] 准备 Release Notes
- [ ] 部署到生产环境

---

## 三、工作量估算

| 类别 | 工作量 | 占比 |
|------|--------|------|
| API 层实现 | 3 天 | 21% |
| 数据层增强 | 3 天 | 21% |
| 实时推送 | 2 天 | 14% |
| UI 集成 | 3 天 | 21% |
| 测试 | 2 天 | 14% |
| 优化和发布 | 1 天 | 7% |
| **总计** | **14 天** | **100%** |

**预留缓冲**: 3 天（应对意外问题）
**总工期**: 2-3 周

---

## 四、风险与缓解

### 高风险项

**风险 1: SSE 连接稳定性**
- **概率**: 60%
- **影响**: 用户体验下降
- **缓解**: 实现自动重连 + 降级到轮询

**风险 2: 数据迁移失败**
- **概率**: 30%
- **影响**: 数据丢失
- **缓解**: 迁移前备份 + 回滚脚本

**风险 3: 性能不达标**
- **概率**: 40%
- **影响**: 延期发布
- **缓解**: 提前压测 + 分阶段优化

---

## 五、验收标准

### 功能验收

- [ ] 支持创建和启动 Team Run
- [ ] 实时显示执行进度（延迟 <500ms）
- [ ] 支持暂停和取消操作
- [ ] 错误自动重试（最多 3 次）
- [ ] 大文件传递（>10KB）正常工作

### 性能验收

- [ ] API 响应时间 <200ms (P95)
- [ ] SSE 推送延迟 <500ms
- [ ] 支持 10 个并发 Worker
- [ ] 支持 50 个 Stage 的 Run
- [ ] 内存占用 <500MB

### 质量验收

- [ ] 单元测试覆盖率 >80%
- [ ] 集成测试覆盖核心流程
- [ ] 无 P0/P1 级别 bug
- [ ] 代码审查通过
- [ ] 文档完整

---

## 六、依赖和前置条件

### 技术依赖

- ✅ Claude SDK 支持多 session 并行（已验证）
- ✅ SQLite WAL 模式已启用
- ✅ Next.js 16 支持 SSE
- ⚠️ 需验证 EventSource 浏览器兼容性

### 团队依赖

- 需要前端开发 1 人（UI 集成）
- 需要后端开发 1 人（API 实现）
- 需要测试工程师 0.5 人（测试用例）

---

## 七、成功指标

### 业务指标

- 用户可以创建和执行 Team Run
- 执行成功率 >95%
- 用户满意度 >4.0/5.0

### 技术指标

- API 可用性 >99.9%
- 平均执行时间减少 30%（相比顺序执行）
- 错误恢复成功率 >90%

---

## 八、后续规划

### Phase 2 (3-6 个月)

- 完全并行调度（支持 100+ Stage）
- 资源权重调度
- 事件总线架构
- 高级监控和告警

### Phase 3 (6-12 个月)

- 分布式执行
- Agent 间消息传递
- 共享文件系统
- 动态扩缩容

---

## 九、关键文件清单

### 需要创建的文件

1. `src/app/api/team-run/runs/route.ts` - 创建 Run
2. `src/app/api/team-run/runs/[runId]/start/route.ts` - 启动 Run
3. `src/app/api/team-run/runs/[runId]/route.ts` - 获取/取消 Run
4. `src/app/api/team-run/runs/[runId]/stream/route.ts` - SSE 推送
5. `src/hooks/useTeamRunStream.ts` - SSE Hook
6. `src/components/error-boundary.tsx` - 错误边界
7. `src/lib/db/migrations/add-team-run-artifacts.ts` - 数据迁移

### 需要修改的文件

1. `src/components/conversations/team-run-detail-view.tsx` - 替换轮询为 SSE
2. `src/components/chat/TeamWorkspacePanel.tsx` - 添加乐观更新
3. `src/lib/team-run/state-manager.ts` - 支持 artifacts 表
4. `src/lib/team-run/worker.ts` - 文件系统隔离
5. `src/types/index.ts` - 添加 SSE 事件类型

---

## 十、总结

Team Run 执行引擎已完成 85%，核心架构稳固。剩余工作主要集中在：

1. **API 层实现**（3 天）- 连接前后端
2. **实时推送**（2 天）- 提升用户体验
3. **安全加固**（2 天）- 文件隔离和配额管理

预计 **2-3 周**完成所有 P0/P1 工作项，达到生产可用状态。

**下一步行动**: 开始 Week 1 Day 1 任务 - 实现 API 端点。
