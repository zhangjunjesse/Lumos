# Team Run 执行引擎第二轮评审报告

**评审日期**: 2026-03-11
**评审团队**: 资深架构师、实施工程师、安全专家、性能专家
**评审对象**: design/team-run/ 目录下的所有设计文档

---

## 执行摘要

第二轮独立评审团队对 Team Run 执行引擎设计进行了全面评审，从架构、实施、安全、性能四个维度识别问题并提出修复方案。

### 总体评价

| 维度 | 评分 | 评审专家 | 核心结论 |
|------|------|----------|----------|
| 架构合理性 | ⭐⭐⭐⭐ (4/5) | senior-architect | 批准实施，需POC验证 |
| 实施可行性 | ⭐⭐⭐⭐ (4/5) | implementation-engineer | 可实施，工作量需调整 |
| 安全性 | ⚠️ 严重问题 | security-expert | 5个P0高危风险 |
| 性能 | ⭐⭐⭐⭐ (4/5) | performance-expert | 满足要求，需2个优化 |

**综合评分**: 3.5/5

### 关键发现

**🔴 阻塞性问题（必须解决）**:
1. **5个P0安全风险** - 文件系统隔离、SQL注入、命令注入、Artifact验证、错误信息泄露
2. **Claude SDK并行能力未验证** - 架构基础假设需要POC验证
3. **SQLite并发写入性能** - 需要批量延迟写入优化

**🟡 严重问题（建议解决）**:
1. **工作量估算偏乐观** - 11-15天不够，建议15-20天
2. **Agent启动时间** - 可能成为性能瓶颈
3. **Artifacts查询性能** - 需要缓存优化

### 评审结论

✅ **有条件批准进入实施阶段**

**前提条件**:
1. 解决5个P0安全风险
2. 完成Claude SDK并行POC验证
3. 实施SQLite批量写入优化
4. 调整工作量估算为15-20天

---

## 各维度评审详情

### 1. 架构合理性评审（senior-architect）

**评分**: ⭐⭐⭐⭐ (4/5)

**优点**:
- 架构分层清晰（API → Orchestrator → Worker → StateManager）
- 技术选型合理（批次并行、SQLite WAL、独立SDK session）
- 渐进式策略（Phase 1批次并行 → Phase 2完全并行 → Phase 3分布式）
- 组件设计优秀（5个核心组件职责单一）

**P0问题**:
1. Agent通信数据大小限制（10KB不够）- ✅ 已有解决方案（artifacts表）
2. Claude SDK并行能力未验证 - 🔴 需要立即POC
3. 文件系统隔离缺失 - ✅ 已有解决方案（Stage级目录）

**P1建议**:
- 并发控制粒度优化
- 状态同步改用WebSocket
- 增强错误恢复策略
- 资源配额控制
- 可观测性增强

**结论**: 批准进入实施，但需先完成POC验证。

---

### 2. 实施可行性评审（implementation-engineer）

**评分**: ⭐⭐⭐⭐ (4/5)

**实施步骤清晰度**: 4/5
- 5个Phase划分合理
- 核心接口定义完整
- 状态机和执行流程清晰

**工作量估算**: 🟡 偏乐观

原估算: 11-15天
- Phase 1: 3-4天（核心引擎）
- Phase 2: 2-3天（状态管理）
- Phase 3: 2天（依赖解析）
- Phase 4: 2-3天（错误处理）
- Phase 5: 2天（集成测试）

**调整后估算**: 15-20天
- Phase 1: 5-6天（含POC失败的备选方案）
- Phase 2: 3-4天（含并发测试）
- Phase 3: 2-3天（含边界情况）
- Phase 4: 3-4天（含日志监控）
- Phase 5: 2-3天（充分的集成测试）

**实施难点**:
1. 🔴 Claude SDK并行能力未验证
2. 🔴 SQLite并发写入性能
3. 🟡 文件系统隔离的强制执行
4. 🟡 Agent生命周期管理
5. 🟡 依赖数据传递的性能

**改进建议**:
- 补充数据库迁移脚本
- 前置POC验证（第1天完成）
- 增加Agent取消测试
- 增加并发压力测试
- 明确集成测试场景

**结论**: 可实施，但需调整工作量和补充测试。

---

### 3. 安全性评审（security-expert）

**评分**: ⚠️ **严重安全问题**

识别出 **5个P0高危风险** 和 **3个P1中危风险**。

#### 🔴 P0高危风险

**1. 文件系统隔离不足**
- **问题**: Claude SDK不提供强制隔离，Agent可绕过限制访问任意文件
- **风险**: 读取敏感文件（数据库、SSH密钥、.env）、跨Stage数据泄露
- **修复**: 使用文件系统监控hook强制执行访问控制
- **优先级**: P0 - 必须在实施前解决

**2. SQL注入风险**
- **问题**: 动态查询未参数化，ID验证不足
- **风险**: 数据库被注入恶意SQL
- **修复**: 强制使用参数化查询 + ID格式验证
- **优先级**: P0

**3. 命令注入风险**
- **问题**: Agent可执行任意shell命令
- **风险**: 执行恶意命令、窃取密钥、建立反向shell
- **修复**: 命令白名单 + 禁用shell工具
- **优先级**: P0

**4. Artifact内容未验证**
- **问题**: 直接存储Agent输出，无内容验证
- **风险**: 存储恶意脚本、超大数据DoS、二进制病毒
- **修复**: 大小检查 + Content-Type白名单 + 内容扫描
- **优先级**: P0

**5. 错误信息泄露**
- **问题**: 错误消息可能包含内部路径和配置
- **风险**: 暴露系统信息给攻击者
- **修复**: 错误信息脱敏
- **优先级**: P1

#### 🟡 P1中危风险

**6. 并发竞态条件** - 状态更新冲突
**7. 资源耗尽** - 缺少全局限流
**8. 依赖数据未加密** - 敏感信息明文存储

**结论**: 必须解决所有P0安全风险才能进入实施阶段。

---

### 4. 性能评审（performance-expert）

**评分**: ⭐⭐⭐⭐ (4/5)

**并发性能**: ✅ 满足要求（3个并行Worker）

#### 性能瓶颈

**🔴 P0瓶颈 #1: SQLite写入频率过高**
- **问题**: 每个Stage状态变化都立即写入，10个并行Stage = 20+次写入/秒
- **影响**: 状态更新延迟50-200ms，可能出现SQLITE_BUSY错误
- **优化**: 批量延迟写入（每500ms或累积10条）
- **预期收益**: 写入次数减少80%，延迟降至10-20ms
- **优先级**: P0 - 必须实施

**🟡 P1瓶颈 #2: Agent启动时间**
- **问题**: 单个session启动可能达到5-10秒
- **影响**: 10个Stage串行启动需50-100秒
- **优化**: Agent预热池（Phase 2实现）
- **预期收益**: 前3个Stage启动时间降至<1秒
- **优先级**: P1

**🟡 P1瓶颈 #3: Artifacts表查询性能**
- **问题**: BLOB字段读取较慢（10MB级别）
- **影响**: 依赖链较长时累积查询时间1-2秒
- **优化**: 内存缓存（LRU，100MB限制）
- **预期收益**: 重复读取延迟降至<1ms
- **优先级**: P1

#### 扩展性评估

**限制 #1: 单机并发上限**
- 当前: 3个并行Worker
- 可扩展到: 8-10个（需优化内存）
- 分布式: 需重构为PostgreSQL + 消息队列

**限制 #2: 文件系统隔离不完整**
- Claude SDK不强制执行，只能靠约定
- 需要文件系统监控（Phase 2实现）

#### 资源占用

- **内存**: 260-410MB（3个Agent + 缓存）✅ 合理
- **CPU**: 30-50%（单核）✅ 合理
- **磁盘**: 20-150MB/Run ⚠️ 需要清理机制

**结论**: 性能满足要求，但需实施2个关键优化（批量写入 + Artifacts缓存）。

---

## 关键问题清单（按优先级）

### P0 - 阻塞性问题（必须立即解决）

#### 安全问题（5个）
1. **文件系统隔离不足** - 使用文件系统监控hook强制执行
2. **SQL注入风险** - 强制参数化查询 + ID验证
3. **命令注入风险** - 命令白名单 + 禁用shell工具
4. **Artifact内容未验证** - 大小检查 + Content-Type白名单
5. **错误信息泄露** - 错误信息脱敏

#### 性能问题（1个）
6. **SQLite写入频率过高** - 批量延迟写入优化

#### 架构问题（1个）
7. **Claude SDK并行能力未验证** - 立即执行POC

### P1 - 严重问题（建议解决）

#### 性能优化（2个）
8. **Agent启动时间** - Agent预热池（Phase 2）
9. **Artifacts查询性能** - 内存缓存（Phase 1）

#### 实施问题（3个）
10. **工作量估算偏乐观** - 调整为15-20天
11. **缺少数据库迁移脚本** - 补充完整SQL
12. **POC测试不充分** - 补充并发写入、取消操作测试

### P2 - 中等问题（可选优化）

13. **并发竞态条件** - 乐观锁
14. **资源耗尽** - 全局限流
15. **依赖数据未加密** - Artifact加密
16. **磁盘占用** - 定期清理机制

---


## 修复方案

### Phase 0: 安全加固（新增，3-4天）

在实施核心功能前，必须先解决P0安全风险。

#### 1. 文件系统访问控制（1天）

```typescript
// src/lib/team-run/security/file-access-guard.ts
class FileAccessGuard {
  constructor(private allowedPaths: string[]) {}
  
  validatePath(path: string): void {
    const resolved = fs.realpathSync(path)
    const allowed = this.allowedPaths.some(p => resolved.startsWith(p))
    if (!allowed) {
      throw new SecurityError(`Access denied: ${path}`)
    }
  }
  
  wrapFileSystem(): void {
    const originalReadFile = fs.readFile
    fs.readFile = (path, ...args) => {
      this.validatePath(path.toString())
      return originalReadFile(path, ...args)
    }
    // 包装其他文件操作...
  }
}
```

#### 2. SQL注入防护（0.5天）

```typescript
// src/lib/team-run/security/sql-validator.ts
function validateId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    throw new ValidationError('Invalid ID format')
  }
}

// 强制使用参数化查询
async function safeQuery(sql: string, params: unknown[]): Promise<unknown> {
  if (sql.includes('${') || sql.includes('`')) {
    throw new SecurityError('Template literals not allowed in SQL')
  }
  return db.all(sql, params)
}
```

#### 3. 命令执行限制（1天）

```typescript
// src/lib/team-run/security/command-guard.ts
const ALLOWED_COMMANDS = ['git', 'npm', 'node', 'cat', 'ls', 'grep']

class CommandGuard {
  validateCommand(cmd: string): void {
    const binary = cmd.split(' ')[0]
    if (!ALLOWED_COMMANDS.includes(binary)) {
      throw new SecurityError(`Command not allowed: ${binary}`)
    }
  }
}

// 在AgentFactory中禁用shell工具
const agent = await ClaudeAgent.create({
  sessionId: stageId,
  disabledTools: ['bash', 'shell'],
  commandValidator: (cmd) => commandGuard.validateCommand(cmd)
})
```

#### 4. Artifact内容验证（0.5天）

```typescript
// src/lib/team-run/security/artifact-validator.ts
async function validateArtifact(input: ArtifactInput): Promise<void> {
  // 大小检查
  if (input.content.length > 10 * 1024 * 1024) {
    throw new ValidationError('Artifact too large')
  }
  
  // Content-Type白名单
  const allowed = ['text/plain', 'application/json', 'text/markdown']
  if (!allowed.includes(input.contentType)) {
    throw new ValidationError(`Content type not allowed: ${input.contentType}`)
  }
  
  // 内容扫描
  if (input.contentType.startsWith('text/')) {
    const text = input.content.toString()
    if (/<script|javascript:|onerror=/i.test(text)) {
      throw new SecurityError('Potentially malicious content detected')
    }
  }
}
```

#### 5. 错误信息脱敏（0.5天）

```typescript
// src/lib/team-run/security/error-sanitizer.ts
function sanitizeError(error: Error): SafeError {
  let message = error.message
    .replace(/\/Users\/[^/]+/g, '/Users/***')
    .replace(/\/home\/[^/]+/g, '/home/***')
    .replace(/[a-f0-9]{32,}/gi, '***')
  
  return new SafeError(
    'Task execution failed',  // 用户看到的
    message,                  // 日志记录的
    'TASK_EXEC_ERROR'
  )
}
```

---

### Phase 1: 核心执行引擎（5-6天，原3-4天）

#### 调整内容：
1. **第1天**: Claude SDK并行POC（含补充测试）
2. **第2-3天**: Orchestrator + Worker实现
3. **第4-5天**: AgentFactory实现（含生命周期管理）
4. **第6天**: 集成安全加固模块

#### 新增POC测试：
```typescript
// POC补充测试1: 并发状态写入
async function testConcurrentStateWrites() {
  const writes = Array.from({ length: 10 }, (_, i) =>
    db.run('UPDATE team_run_stages SET status=? WHERE id=?', ['running', `stage-${i}`])
  )
  await Promise.all(writes)
}

// POC补充测试2: Agent取消
async function testAgentCancellation() {
  const agent = await ClaudeAgent.create({ sessionId: 'test-cancel' })
  const task = agent.run('Count to 1000000')
  setTimeout(() => agent.terminate(), 1000)
  await task.catch(err => console.log('Cancelled:', err.message))
}
```

---

### Phase 2: 状态管理（3-4天，原2-3天）

#### 调整内容：
1. **批量延迟写入优化**（P0，必须实施）

```typescript
// src/lib/team-run/state-manager.ts
class StateManager {
  private pendingUpdates: StageUpdate[] = []
  private flushTimer: NodeJS.Timeout

  updateStageStatus(stageId: string, status: string) {
    this.pendingUpdates.push({ stageId, status, updatedAt: Date.now() })
    
    if (this.pendingUpdates.length >= 10) {
      this.flush()
    } else {
      clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => this.flush(), 500)
    }
  }

  private flush() {
    db.transaction(() => {
      this.pendingUpdates.forEach(u => {
        db.run('UPDATE team_run_stages SET status=?, updatedAt=? WHERE id=?', 
               [u.status, u.updatedAt, u.stageId])
      })
    })()
    this.pendingUpdates = []
  }
}
```

2. **Artifacts缓存优化**（P1，建议实施）

```typescript
// src/lib/team-run/state-manager.ts
import LRU from 'lru-cache'

class StateManager {
  private artifactCache = new LRU<string, Buffer>({ 
    max: 50, 
    maxSize: 100 * 1024 * 1024 
  })

  async getStageOutput(stageId: string): Promise<string> {
    const stage = await db.get('SELECT latestResult FROM team_run_stages WHERE id=?', stageId)
    
    try {
      const ref = JSON.parse(stage.latestResult)
      if (ref.type === 'artifact') {
        let content = this.artifactCache.get(ref.artifactId)
        if (!content) {
          const artifact = await db.get('SELECT content FROM team_run_artifacts WHERE id=?', ref.artifactId)
          content = artifact.content
          this.artifactCache.set(ref.artifactId, content)
        }
        return content.toString('utf8')
      }
    } catch {}
    
    return stage.latestResult
  }
}
```

3. **数据库迁移脚本**

```sql
-- migrations/001_add_team_run_artifacts.sql
CREATE TABLE IF NOT EXISTS team_run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifacts_run_id ON team_run_artifacts(run_id);
CREATE INDEX idx_artifacts_stage_id ON team_run_artifacts(stage_id);

-- 添加新字段到 team_run_stages
ALTER TABLE team_run_stages ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE team_run_stages ADD COLUMN last_error TEXT;
ALTER TABLE team_run_stages ADD COLUMN workspace_dir TEXT;
ALTER TABLE team_run_stages ADD COLUMN started_at TEXT;
ALTER TABLE team_run_stages ADD COLUMN completed_at TEXT;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 1;

-- 回滚脚本
-- migrations/001_add_team_run_artifacts.down.sql
DROP TABLE IF EXISTS team_run_artifacts;
-- SQLite不支持DROP COLUMN，需要重建表
```

---

### Phase 3-5: 保持不变

Phase 3（依赖解析）、Phase 4（错误处理）、Phase 5（集成测试）按原计划执行，但增加测试场景。

---

## 更新后的实施计划

### 总工作量：18-24天（原11-15天）

| Phase | 内容 | 工作量 | 关键交付物 |
|-------|------|--------|-----------|
| Phase 0 | 安全加固 | 3-4天 | 文件访问控制、SQL防护、命令限制、Artifact验证 |
| Phase 1 | 核心执行引擎 | 5-6天 | POC验证、Orchestrator、Worker、AgentFactory |
| Phase 2 | 状态管理 | 3-4天 | StateManager、批量写入、Artifacts缓存、数据库迁移 |
| Phase 3 | 依赖解析 | 2-3天 | DependencyResolver、DAG构建、拓扑排序 |
| Phase 4 | 错误处理 | 3-4天 | 错误分类、重试机制、日志监控 |
| Phase 5 | 集成测试 | 2-3天 | 端到端测试、性能测试、安全测试 |

### 实施顺序

```
Week 1 (Day 1-5):
  Day 1: Claude SDK并行POC + 补充测试
  Day 2-3: 安全加固（文件访问、SQL防护、命令限制）
  Day 4-5: 安全加固（Artifact验证、错误脱敏）

Week 2 (Day 6-10):
  Day 6-8: 核心执行引擎（Orchestrator + Worker）
  Day 9-10: AgentFactory + 安全集成

Week 3 (Day 11-15):
  Day 11-13: 状态管理（批量写入 + Artifacts缓存）
  Day 14-15: 数据库迁移 + 并发测试

Week 4 (Day 16-20):
  Day 16-18: 依赖解析 + 错误处理
  Day 19-20: 集成测试（基础场景）

Week 5 (Day 21-24, 可选):
  Day 21-22: 性能测试 + 优化
  Day 23-24: 安全测试 + 文档完善
```

---

## 风险与缓解

### 高风险

**1. Claude SDK并行POC失败**
- **概率**: 30%
- **影响**: 整个架构需要调整
- **缓解**: 第1天完成POC，失败则立即切换到进程池方案
- **备选方案成本**: +2-3天

**2. 安全加固影响性能**
- **概率**: 40%
- **影响**: 文件访问检查、命令验证可能增加延迟
- **缓解**: 性能测试验证，必要时优化检查逻辑

### 中风险

**3. SQLite并发写入仍有问题**
- **概率**: 20%
- **影响**: 批量写入优化后仍可能出现SQLITE_BUSY
- **缓解**: 增加重试机制 + 写入队列

**4. 工作量仍然不足**
- **概率**: 30%
- **影响**: 18-24天可能仍不够
- **缓解**: 每周评审进度，及时调整

---

## 下一步行动

### 立即行动（本周）
1. ✅ 第二轮评审已完成
2. 🔴 召开团队会议，讨论评审结果
3. 🔴 确定是否接受18-24天的工作量
4. 🔴 准备Phase 0安全加固的详细设计

### 下周行动
1. 🔴 执行Claude SDK并行POC（Day 1）
2. 🔴 开始Phase 0安全加固实施（Day 2-5）
3. 🔴 准备数据库迁移脚本

---

## 总结

第二轮评审识别出**7个P0阻塞性问题**（5个安全 + 1个性能 + 1个架构），必须在实施前解决。

**关键决策**:
1. 新增Phase 0（安全加固，3-4天）
2. 调整总工作量为18-24天（原11-15天）
3. 第1天完成POC验证，失败则切换备选方案

**评审结论**: ✅ **有条件批准进入实施阶段**

**前提条件**:
- 解决7个P0问题
- 完成POC验证
- 接受18-24天的工作量

---

**评审团队**:
- senior-architect（架构评审）
- implementation-engineer（实施可行性）
- security-expert（安全评审）
- performance-expert（性能评审）

**报告生成时间**: 2026-03-11

