# Lumos 重构项目 - 经验总结

## 项目概况

**时间：** 2026-03-01
**任务：** CodePilot → Lumos 品牌重构 + Built-in Provider 功能增强
**结果：** 189个文件修改，3个并行任务成功完成

---

## 核心经验

### 1. 并行任务协作的威力

**策略：** 将大型重构拆分为3个独立的并行任务
- Task 1: 数据库架构和后端逻辑
- Task 2: 数据迁移逻辑
- Task 3: UI和API更新

**效果：**
- 总工作量：157个工具调用
- 并行执行时间：~23分钟
- 如果串行执行：预计需要60-90分钟
- **效率提升：3-4倍**

**关键点：**
- 任务之间依赖最小化
- 每个任务有明确的边界
- 使用 `run_in_background: true` 并行启动
- 定期监控进度，及时发现问题

### 2. 数据库迁移的最佳实践

**问题：** 数据库文件名不一致导致provider配置丢失

**原因分析：**
```typescript
// 错误：环境变量指向 ~/.codepilot，但代码读取 lumos.db
export const DB_PATH = path.join(dataDir, 'lumos.db');
```

**解决方案：**
1. 统一命名约定（codepilot.db → lumos.db）
2. 添加自动迁移逻辑
3. 保持向后兼容（支持旧路径）
4. 复制而非移动数据（安全第一）

**教训：**
- ✅ 数据库路径变更必须有迁移逻辑
- ✅ 环境变量和代码路径必须一致
- ✅ 测试时检查实际文件位置
- ✅ 迁移前后都要验证数据完整性

### 3. 向后兼容性设计

**策略：** 渐进式迁移，保持旧系统可用

**实现：**
```typescript
// 环境变量优先级链
const dataDir = process.env.LUMOS_DATA_DIR
  || process.env.CLAUDE_GUI_DATA_DIR
  || path.join(os.homedir(), '.lumos');
```

**好处：**
- 用户无需手动修改配置
- 旧脚本继续工作
- 平滑过渡期（2-3个月）
- 降低升级风险

**教训：**
- ✅ 新旧系统并存一段时间
- ✅ 记录弃用警告（但不打扰用户）
- ✅ 提供清晰的迁移文档
- ✅ 保留旧数据作为备份

### 4. 调试技巧：从日志入手

**问题：** API调用失败，错误信息不明确

**调试流程：**
1. 检查应用日志 → 发现 "No API key found"
2. 检查数据库 → provider存在且正确
3. 添加调试日志 → 发现activeProvider为undefined
4. 检查数据库路径 → 发现文件名不匹配
5. 修复路径 → 问题解决

**教训：**
- ✅ 关键路径添加详细日志
- ✅ 日志包含上下文信息（文件路径、变量值）
- ✅ 使用分层调试（应用→数据库→文件系统）
- ✅ 验证假设（不要猜测）

### 5. 团队协作模式

**模式：** 主控 + 3个专业agent

**分工：**
- 主控：协调、监控、决策
- Agent 1：数据库专家
- Agent 2：迁移专家
- Agent 3：前端专家

**沟通：**
- 明确的任务描述
- 定期进度检查
- 问题及时上报
- 最终统一验证

**教训：**
- ✅ 任务描述要具体（文件列表、成功标准）
- ✅ 避免任务重叠（明确边界）
- ✅ 监控而非微管理
- ✅ 信任agent的专业判断

### 6. 代码审查要点

**重点检查：**
1. **数据安全：** 迁移逻辑是否会丢失数据？
2. **向后兼容：** 旧配置是否仍然有效？
3. **错误处理：** 失败时是否有回退机制？
4. **性能影响：** 迁移是否会阻塞启动？
5. **用户体验：** 是否需要用户手动操作？

**发现的问题：**
- ❌ 数据库文件名不一致
- ❌ 缺少迁移完成标志
- ❌ 环境变量文档不完整

**修复后：**
- ✅ 统一命名约定
- ✅ 添加迁移标志文件
- ✅ 更新所有文档

### 7. 测试策略

**测试场景：**
1. **全新安装：** 无旧数据，直接使用新路径
2. **升级安装：** 有旧数据，自动迁移
3. **环境变量：** 测试新旧变量都有效
4. **回退测试：** 降级后旧版本仍可用

**自动化检查：**
```bash
# 检查数据库
sqlite3 ~/.lumos/lumos.db "SELECT * FROM api_providers;"

# 检查迁移
ls -la ~/.lumos/

# 检查环境变量
env | grep LUMOS
```

**教训：**
- ✅ 测试矩阵覆盖所有场景
- ✅ 自动化验证脚本
- ✅ 保留测试数据集
- ✅ 文档化测试步骤

---

## 技术亮点

### 1. 智能迁移逻辑

```typescript
// 只在首次启动时迁移
if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
  migrateData(oldPath, newPath);
  // 创建标志文件防止重复迁移
  fs.writeFileSync(path.join(newPath, '.migrated'), '');
}
```

### 2. 环境变量抽象层

```typescript
// src/lib/platform.ts
export function getDataDir(): string {
  return process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
}
```

### 3. 数据库字段设计

```sql
-- 唯一约束确保只有一个builtin provider
CREATE UNIQUE INDEX idx_api_providers_builtin
ON api_providers(is_builtin)
WHERE is_builtin = 1;
```

### 4. UI状态管理

```typescript
// 自动追踪修改状态
if (provider.is_builtin && hasChanges) {
  await updateProvider(id, { ...changes, user_modified: 1 });
}
```

---

## 避免的陷阱

### ❌ 陷阱1：直接删除旧数据
**后果：** 用户数据丢失，无法回退
**正确做法：** 复制数据，保留旧目录

### ❌ 陷阱2：硬编码路径
**后果：** 不同环境下路径不一致
**正确做法：** 使用环境变量和配置文件

### ❌ 陷阱3：忽略WAL/SHM文件
**后果：** SQLite数据不完整
**正确做法：** 同时复制所有相关文件

### ❌ 陷阱4：没有迁移标志
**后果：** 每次启动都重复迁移
**正确做法：** 创建标志文件或数据库字段

### ❌ 陷阱5：破坏性重命名
**后果：** 旧版本无法使用
**正确做法：** 保持向后兼容，渐进式弃用

---

## 性能优化

### 1. 并行文件操作
```typescript
await Promise.all([
  fs.promises.copyFile(dbPath, newDbPath),
  fs.promises.copyFile(walPath, newWalPath),
  fs.promises.copyFile(shmPath, newShmPath),
]);
```

### 2. 延迟加载
```typescript
// 只在需要时才读取数据库
let cachedProvider: ApiProvider | undefined;
export function getBuiltinProvider() {
  if (!cachedProvider) {
    cachedProvider = db.prepare('...').get();
  }
  return cachedProvider;
}
```

### 3. 批量更新
```typescript
// 使用事务批量更新
db.transaction(() => {
  for (const file of files) {
    updateFile(file);
  }
})();
```

---

## 文档化建议

### 必须文档化的内容：
1. **迁移指南：** 用户如何升级
2. **环境变量：** 新旧变量对照表
3. **API变更：** 新增/修改的端点
4. **数据库schema：** 新增字段说明
5. **故障排查：** 常见问题和解决方案

### 文档结构：
```
docs/
├── MIGRATION_INDEX.md          # 导航页
├── migration-summary.md        # 执行摘要
├── migration-implementation.md # 实施细节
├── migration-file-changes.md   # 文件变更清单
└── migration-quick-reference.md # 快速参考
```

---

## 未来改进

### 短期（1-2周）
- [ ] 添加迁移进度UI
- [ ] 完善错误提示
- [ ] 添加回退按钮
- [ ] 性能监控

### 中期（1-2个月）
- [ ] 自动化测试套件
- [ ] 迁移数据验证工具
- [ ] 用户反馈收集
- [ ] 弃用警告系统

### 长期（3-6个月）
- [ ] 完全移除旧代码
- [ ] 清理旧环境变量
- [ ] 提示用户删除旧目录
- [ ] 发布v1.0稳定版

---

## 总结

这次重构项目展示了：
1. **并行协作**的效率优势
2. **向后兼容**的重要性
3. **数据安全**的优先级
4. **调试技巧**的实用价值
5. **文档化**的长期收益

**最重要的经验：**
> 大型重构不是一次性完成的，而是通过精心设计的渐进式迁移，
> 在保持系统稳定的前提下，逐步实现目标。

**核心原则：**
- 安全第一（数据不丢失）
- 用户友好（无需手动操作）
- 向后兼容（旧系统可用）
- 充分测试（覆盖所有场景）
- 详细文档（便于维护）

---

## 致谢

感谢3个专业agent的出色工作：
- **af4e97a** - 数据库架构专家
- **a5abb47** - 迁移逻辑专家
- **a527f7b** - UI/API专家

他们的并行协作使这个复杂项目在短时间内高质量完成。
