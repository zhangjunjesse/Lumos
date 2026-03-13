# Team Run 执行引擎设计文档

**版本**: 1.0
**日期**: 2026-03-11
**状态**: 设计完成，待实施

---

## 文档导航

本设计经过多轮专业团队评审，包含以下模块化文档：

### 1. [需求分析](./00-requirements.md)
**负责人**: system-architect
**内容**:
- 功能需求（7项）
- 非功能需求
- 技术挑战（5项）
- 关键决策问题（5个）
- 约束条件

**关键发现**:
- 必须支持并行调度（最多3个worker）
- 需要Agent间通信机制
- SQLite并发写入限制
- Claude SDK无原生多Agent支持

---

### 2. [架构设计](./01-architecture.md)
**负责人**: tech-lead
**内容**:
- 整体架构（5层）
- 核心组件设计
- 技术选型决策
- 关键执行流程
- 实施计划（5阶段）

**核心决策**:
- 执行模型：批次并行
- Agent隔离：独立SDK session
- 状态持久化：实时写入 + WAL
- 错误处理：继续执行 + 重试
- 通信机制：数据库字段传递

---

### 3. [架构评审](./02-review.md)
**负责人**: architecture-reviewer
**评分**: ⭐⭐⭐⭐ (4/5)

**关键发现**:
- ✅ 架构清晰合理，批准进入实施
- 🔴 3个P0阻塞性问题需要解决
- 🟡 5个P1优化建议

**P0问题**:
1. Agent通信数据大小限制（10KB不够）
2. Claude SDK并行能力需要验证
3. 文件系统隔离缺失

---

### 4. [详细设计](./03-detailed-design.md)
**负责人**: detail-designer
**内容**:
- P0问题解决方案
- 核心接口定义（TypeScript）
- 数据结构设计
- 执行流程和状态机
- 错误处理策略
- 数据库变更方案

**P0解决方案**:
1. 引入 team_run_artifacts 表存储大数据
2. 提供完整POC测试代码验证并行能力
3. Stage级工作目录隔离

---

## 执行摘要

### 目标
实现完整的 Team Run 执行引擎，替换当前的模拟执行骨架，支持真实的多Agent协作。

### 核心架构
```
API Layer (tasks.ts)
    ↓
Orchestrator (调度器)
    ↓
Worker Pool (并行执行)
    ↓
Agent Factory (SDK实例化)
    ↓
State Manager (状态同步)
    ↓
Database (SQLite)
```

### 关键特性
- ✅ 批次并行执行（最多3个worker）
- ✅ DAG依赖解析
- ✅ 独立Agent隔离
- ✅ 实时状态同步
- ✅ 错误重试机制
- ✅ 大数据传递支持

### 技术栈
- Claude Agent SDK（独立session）
- SQLite + WAL模式
- TypeScript
- 文件系统隔离

---

## 实施计划

### Phase 1: 核心执行引擎（3-4天）
**优先级**: P0
**交付物**:
- Orchestrator 实现
- Worker 实现
- AgentFactory 实现
- POC验证（Claude SDK并行）

### Phase 2: 状态管理（2-3天）
**优先级**: P0
**交付物**:
- StateManager 实现
- 数据库迁移（artifacts表）
- 状态同步机制

### Phase 3: 依赖解析（2天）
**优先级**: P1
**交付物**:
- DependencyResolver 实现
- DAG构建和拓扑排序
- 依赖数据传递

### Phase 4: 错误处理（2-3天）
**优先级**: P1
**交付物**:
- 错误分类和重试
- 失败恢复机制
- 日志和监控

### Phase 5: 集成测试（2天）
**优先级**: P1
**交付物**:
- 端到端测试
- 性能测试
- 文档完善

**总计**: 11-15天

---

## 风险与缓解

### 高风险
1. **Claude SDK并行能力未验证**
   - 缓解：Phase 1 优先完成POC
   - 备选：进程池或批次串行

2. **SQLite并发写入限制**
   - 缓解：WAL模式 + 写入队列
   - 备选：迁移到PostgreSQL

### 中风险
3. **文件系统冲突**
   - 缓解：Stage级目录隔离

4. **内存占用过高**
   - 缓解：限制并行数量 + 监控

---

## 下一步行动

### 立即行动
1. ✅ 设计文档已完成
2. 🔴 执行 Claude SDK 并行 POC（见 03-detailed-design.md）
3. 🔴 创建数据库迁移脚本
4. 🔴 开始 Phase 1 实施

### 本周目标
- 完成 POC 验证
- 实现 Orchestrator 和 Worker
- 完成数据库迁移

---

## 团队成员

- **system-architect** - 需求分析
- **tech-lead** - 架构设计
- **architecture-reviewer** - 架构评审
- **detail-designer** - 详细设计

---

**文档生成时间**: 2026-03-11
