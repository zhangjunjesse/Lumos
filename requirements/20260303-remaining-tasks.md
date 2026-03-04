# 未完成任务清单

**日期**: 2026-03-03
**项目**: 数据库架构重构与ContentPanel统一容器 - Phase 2

---

## 一、ContentPanel集成任务

### 任务A1：集成ContentPanel到主布局 ⭐⭐⭐（高优先级）

**目标**：将ContentPanel替换AppShell.tsx中的RightPanel和DocPreview

**当前状态**：
- AppShell.tsx第414-427行：DocPreview（文件预览）
- AppShell.tsx第428-438行：RightPanel（右侧面板）
- 两者是独立的，需要统一到ContentPanel

**实施步骤**：
1. 在AppShell.tsx中导入ContentPanel和useContentPanelStore
2. 移除DocPreview和RightPanel的独立渲染逻辑
3. 替换为ContentPanel统一容器
4. 保留ResizeHandle功能
5. 迁移现有的文件预览功能到ContentPanel
6. 迁移RightPanel的内容到ContentPanel标签

**涉及文件**：
- `src/components/layout/AppShell.tsx` - 主布局（需要重构）
- `src/components/layout/ContentPanel.tsx` - 已实现
- `src/components/layout/ContentRenderer.tsx` - 需要扩展

**验收标准**：
- ✅ ContentPanel成功集成到主布局
- ✅ 文件预览功能正常工作
- ✅ RightPanel内容正常显示
- ✅ ResizeHandle功能正常
- ✅ 标签切换流畅

**预估工作量**：3-4小时

---

### 任务A2：实现添加标签菜单 ⭐⭐（中优先级）

**目标**：实现TabBar中的"+"按钮功能

**当前状态**：
- TabBar.tsx中有"+"按钮，但点击后没有菜单
- 需要实现下拉菜单，列出所有可用的标签类型

**实施步骤**：
1. 创建AddTabMenu组件
2. 使用shadcn/ui的DropdownMenu组件
3. 列出所有可用的标签类型（file-tree, feishu-doc, settings等）
4. 点击后调用useContentPanelStore的addTab方法
5. 添加图标和描述

**涉及文件**：
- `src/components/layout/TabBar.tsx` - 需要修改
- `src/components/layout/AddTabMenu.tsx` - 新建

**验收标准**：
- ✅ 点击"+"按钮显示菜单
- ✅ 菜单列出所有可用标签类型
- ✅ 点击菜单项成功添加标签
- ✅ 新标签自动激活

**预估工作量**：1-2小时

---

### 任务A3：实现快捷键支持 ⭐（低优先级）

**目标**：添加键盘快捷键支持

**快捷键列表**：
- `Cmd+1` ~ `Cmd+9` - 切换到第N个标签
- `Cmd+W` - 关闭当前标签
- `Cmd+T` - 新建标签（显示添加菜单）
- `Cmd+Shift+[` / `Cmd+Shift+]` - 切换到上一个/下一个标签

**实施步骤**：
1. 在ContentPanel组件中添加键盘事件监听
2. 使用useEffect注册快捷键
3. 调用useContentPanelStore的相应方法

**涉及文件**：
- `src/components/layout/ContentPanel.tsx` - 需要修改

**验收标准**：
- ✅ 所有快捷键正常工作
- ✅ 快捷键不与其他功能冲突

**预估工作量**：1-2小时

---

### 任务A4：实现拖拽排序 ⭐（低优先级）

**目标**：支持标签拖拽重新排序

**实施步骤**：
1. 安装@dnd-kit/core和@dnd-kit/sortable
2. 在TabBar中实现拖拽功能
3. 调用useContentPanelStore的reorderTabs方法

**涉及文件**：
- `src/components/layout/TabBar.tsx` - 需要修改
- `package.json` - 添加依赖

**验收标准**：
- ✅ 标签可以拖拽
- ✅ 拖拽时有视觉反馈
- ✅ 拖拽后顺序正确保存

**预估工作量**：2-3小时

---

## 二、数据库IPC扩展任务

### 任务B1：扩展Providers资源IPC接口 ⭐⭐⭐（高优先级）

**目标**：为Providers资源实现完整的IPC接口

**实施步骤**：
1. 在`src/types/ipc.ts`中添加Providers类型定义
2. 在`electron/ipc/schemas.ts`中添加Zod schemas
3. 在`electron/db/service.ts`中添加Providers CRUD方法
4. 在`electron/ipc/handlers.ts`中注册Providers handlers
5. 在`src/lib/ipc/client.ts`中添加Providers客户端方法

**IPC Channels**：
- `db:providers:list`
- `db:providers:get`
- `db:providers:create`
- `db:providers:update`
- `db:providers:delete`

**涉及文件**：
- `src/types/ipc.ts` - 添加类型
- `electron/ipc/schemas.ts` - 添加schemas
- `electron/db/service.ts` - 添加方法
- `electron/ipc/handlers.ts` - 注册handlers
- `src/lib/ipc/client.ts` - 添加客户端方法

**验收标准**：
- ✅ 所有IPC接口正常工作
- ✅ 类型安全
- ✅ Zod校验正确

**预估工作量**：2-3小时

---

### 任务B2：扩展MCP Servers资源IPC接口 ⭐⭐⭐（高优先级）

**目标**：为MCP Servers资源实现完整的IPC接口

**IPC Channels**：
- `db:mcp-servers:list`
- `db:mcp-servers:get`
- `db:mcp-servers:create`
- `db:mcp-servers:update`
- `db:mcp-servers:delete`
- `db:mcp-servers:toggle`

**实施步骤**：同任务B1

**预估工作量**：2-3小时

---

### 任务B3：扩展Skills资源IPC接口 ⭐⭐（中优先级）

**目标**：为Skills资源实现完整的IPC接口

**IPC Channels**：
- `db:skills:list`
- `db:skills:get`
- `db:skills:create`
- `db:skills:update`
- `db:skills:delete`
- `db:skills:toggle`

**实施步骤**：同任务B1

**预估工作量**：2-3小时

---

### 任务B4：扩展Tasks资源IPC接口 ⭐⭐（中优先级）

**目标**：为Tasks资源实现完整的IPC接口

**IPC Channels**：
- `db:tasks:list`
- `db:tasks:get`
- `db:tasks:create`
- `db:tasks:update`
- `db:tasks:delete`

**实施步骤**：同任务B1

**预估工作量**：2-3小时

---

### 任务B5：扩展Media资源IPC接口 ⭐（低优先级）

**目标**：为Media资源实现完整的IPC接口

**IPC Channels**：
- `db:media:list`
- `db:media:get`
- `db:media:create`
- `db:media:delete`

**实施步骤**：同任务B1

**预估工作量**：2-3小时

---

### 任务B6：迁移API Routes使用IPC Client ⭐⭐⭐（高优先级）

**目标**：将所有API Routes中的直接数据库访问改为IPC调用

**需要迁移的API Routes**：
1. `src/app/api/chat/sessions/route.ts` - Sessions
2. `src/app/api/plugins/mcp/route.ts` - MCP Servers
3. `src/app/api/skills/route.ts` - Skills
4. `src/app/api/tasks/route.ts` - Tasks
5. 其他使用数据库的API Routes

**实施步骤**：
1. 检查每个API Route是否使用数据库
2. 将`import { getDb } from '@/lib/db/connection'`改为`import { ipcClient } from '@/lib/ipc/client'`
3. 将直接的SQL查询改为IPC调用
4. 测试每个API Route

**验收标准**：
- ✅ 所有API Routes使用IPC Client
- ✅ 功能正常工作
- ✅ 无直接数据库访问

**预估工作量**：3-4小时

---

### 任务B7：移除Renderer Process的better-sqlite3依赖 ⭐（低优先级）

**目标**：清理Renderer Process中的数据库依赖

**实施步骤**：
1. 从`package.json`的dependencies中移除better-sqlite3
2. 将better-sqlite3添加到devDependencies（仅Main Process使用）
3. 删除或标记为deprecated: `src/lib/db/connection.ts`
4. 更新构建脚本
5. 测试开发模式和生产构建

**验收标准**：
- ✅ Renderer Process不再依赖better-sqlite3
- ✅ 开发模式正常工作
- ✅ 生产构建正常工作

**预估工作量**：1-2小时

---

## 三、任务优先级总结

### 🔴 高优先级（必须完成）

1. **任务A1**：集成ContentPanel到主布局（3-4小时）
2. **任务B1**：扩展Providers资源IPC接口（2-3小时）
3. **任务B2**：扩展MCP Servers资源IPC接口（2-3小时）
4. **任务B6**：迁移API Routes使用IPC Client（3-4小时）

**小计**：10-14小时（约2个工作日）

### 🟡 中优先级（建议完成）

5. **任务A2**：实现添加标签菜单（1-2小时）
6. **任务B3**：扩展Skills资源IPC接口（2-3小时）
7. **任务B4**：扩展Tasks资源IPC接口（2-3小时）

**小计**：5-8小时（约1个工作日）

### 🟢 低优先级（可选）

8. **任务A3**：实现快捷键支持（1-2小时）
9. **任务A4**：实现拖拽排序（2-3小时）
10. **任务B5**：扩展Media资源IPC接口（2-3小时）
11. **任务B7**：移除Renderer Process的better-sqlite3依赖（1-2小时）

**小计**：6-10小时（约1个工作日）

---

## 四、总工作量估算

- **高优先级**：10-14小时（2个工作日）
- **中优先级**：5-8小时（1个工作日）
- **低优先级**：6-10小时（1个工作日）

**总计**：21-32小时（约4-5个工作日）

---

## 五、建议执行顺序

**Phase 1**（高优先级，必须完成）：
1. 任务A1：集成ContentPanel到主布局
2. 任务B1：扩展Providers资源IPC接口
3. 任务B2：扩展MCP Servers资源IPC接口
4. 任务B6：迁移API Routes使用IPC Client

**Phase 2**（中优先级，建议完成）：
5. 任务A2：实现添加标签菜单
6. 任务B3：扩展Skills资源IPC接口
7. 任务B4：扩展Tasks资源IPC接口

**Phase 3**（低优先级，可选）：
8. 任务A3：实现快捷键支持
9. 任务A4：实现拖拽排序
10. 任务B5：扩展Media资源IPC接口
11. 任务B7：移除Renderer Process的better-sqlite3依赖

---

**文档创建日期**: 2026-03-03
**预计完成时间**: 4-5个工作日
