# Lumos Refactor Summary

## 完成时间
2026-03-01

## 团队协作
3个并行任务同时完成：
- Task 1: 数据库架构和后端逻辑
- Task 2: CodePilot → Lumos 迁移
- Task 3: UI和品牌更新

## 主要变更

### 1. Built-in Provider 增强 ✅

**数据库层：**
- 添加 `is_builtin` 字段（标识内置provider）
- 添加 `user_modified` 字段（追踪用户修改）
- 创建唯一索引确保只有一个builtin provider

**后端逻辑：**
- `updateProvider()` - 自动设置 `user_modified=1`
- `getBuiltinProvider()` - 获取内置provider
- `resetBuiltinProvider()` - 重置为默认配置

**API端点：**
- `POST /api/providers/builtin/reset` - 重置内置provider

**UI组件：**
- ProviderManager - 显示"Built-in"和"Modified"徽章
- ProviderForm - 添加"Reset to Default"按钮
- 防止删除builtin provider

### 2. CodePilot → Lumos 迁移 ✅

**数据目录：**
- `~/.codepilot/` → `~/.lumos/`
- `codepilot.db` → `lumos.db`

**环境变量：**
- 新增：`LUMOS_DATA_DIR`, `LUMOS_CLAUDE_CONFIG_DIR`
- 保持向后兼容：旧的 `CODEPILOT_*` 变量仍然有效

**自动迁移：**
- 首次启动时自动复制数据
- 复制数据库 + WAL + SHM 文件
- 复制 `.claude/` 配置目录
- 永不删除旧数据

**修改的文件（12个）：**
- `src/lib/db/connection.ts`
- `src/lib/platform.ts`
- `dev.sh`
- `package.json`
- `electron/main.ts`
- `src/lib/claude-client.ts`
- `src/lib/db/providers.ts`
- `src/lib/db/migrations-lumos.ts`
- `src/app/api/documents/upload/route.ts`
- `src/app/api/chat/route.ts`
- `src/lib/feishu-auth.ts`
- `src/lib/image-generator.ts`

### 3. Lumos 品牌更新 ✅

**Logo组件：**
- 创建 `LumosLogo.tsx` 替代 `CodePilotLogo.tsx`
- 支持亮色/暗色模式

**UI文本：**
- 更新所有"CodePilot"为"Lumos"
- 更新i18n文件（en.ts, zh.ts）

**localStorage keys：**
- `codepilot_*` → `lumos_*`
- `lumos_chatlist_width`
- `lumos_rightpanel_width`
- `lumos_docpreview_width`
- `lumos_dismissed_update_version`

## 统计数据

- **修改文件总数：** 95个
- **新增文件：** 3个
  - `src/components/chat/LumosLogo.tsx`
  - `src/app/api/providers/builtin/reset/route.ts`
  - `src/lib/platform.ts`
- **开发时间：** ~2小时（并行执行）

## 测试清单

### 数据迁移测试
- [x] `~/.lumos/` 目录已创建
- [x] `lumos.db` 数据库已迁移
- [ ] 旧数据完整性验证
- [ ] 环境变量兼容性测试

### Built-in Provider测试
- [x] 数据库字段正确（is_builtin=1, user_modified=0）
- [ ] UI显示"Built-in"徽章
- [ ] 修改后显示"Modified"徽章
- [ ] "Reset to Default"按钮功能
- [ ] 防止删除builtin provider

### 品牌更新测试
- [ ] Logo显示正确
- [ ] UI文本显示"Lumos"
- [ ] localStorage keys更新

### 功能测试
- [ ] 对话功能正常
- [ ] Provider切换正常
- [ ] 设置保存正常

## 向后兼容性

- ✅ 旧环境变量仍然有效
- ✅ 旧数据目录保留不删除
- ✅ 迁移代码中的"CodePilot"引用保留
- ✅ 示例代码中的引用保留

## 下一步

1. 完成功能测试
2. 修复发现的问题
3. 提交代码到git
4. 更新文档
5. 发布新版本

## 注意事项

- 数据库迁移是单向的（不会自动回退）
- 建议用户在升级前备份 `~/.codepilot/` 目录
- 环境变量优先级：`LUMOS_*` > `CODEPILOT_*` > 默认值
