# Skills/MCP 隔离架构设计方案

**日期**：2026-03-01
**主题**：Skills 和 MCP 完全隔离架构
**状态**：设计阶段

---

## 背景

Lumos 应用已实现 Claude CLI 环境隔离（使用 `~/.lumos/.claude/` 而非 `~/.claude/`），但 Skills 和 MCP 的作用域设计还不完善。当前存在的问题：

1. **未完全隔离**：代码中仍可能读取用户全局环境（`~/.claude/`、`~/.agents/`）
2. **无作用域概念**：内置、用户自定义资源混在一起，难以管理
3. **无数据库管理**：依赖文件系统，难以版本控制和 UI 展示

---

## 核心原则

**Lumos 是完全隔离的沙箱环境**：
- Skills/MCP 只能在 App 内部使用
- 不与用户全局环境（`~/.claude/`）交互
- 所有资源存储在 `~/.lumos/` 内

---

## 架构设计

### 1. 两层作用域

| 作用域 | 存储位置 | 特性 | 用户操作 |
|--------|---------|------|----------|
| **builtin** | `public/skills/`<br>`public/mcp-servers/` | 随 App 打包<br>随版本更新<br>只读 | 查看<br>复制到用户空间 |
| **user** | `~/.lumos/skills/`<br>`~/.lumos/mcp-servers/` | 用户创建/修改<br>独立管理 | 创建<br>编辑<br>删除 |

**无全局作用域**：不加载 `~/.claude/` 或 `~/.agents/` 的任何资源

### 2. 数据库 Schema

```sql
-- Skills 表（元数据，内容存文件）
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('builtin', 'user')),
  description TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, scope)
);

-- MCP Servers 表（完整配置）
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('builtin', 'user')),
  command TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, scope)
);
```

### 3. 存储路径

**内置资源**（随 App 打包）：
```
public/
├── skills/
│   ├── image-generation.md          # 已有
│   ├── document-analysis.md         # 新增
│   ├── feishu-operations.md         # 新增
│   └── knowledge-search.md          # 新增
└── mcp-servers/
    └── feishu.json                  # 飞书 MCP 元数据
```

**用户资源**（可编辑）：
```
~/.lumos/
├── skills/
│   └── [用户创建的 .md 文件]
└── mcp-servers/
    └── [不使用文件，全部存数据库]
```

---

## UI 设计

### Skills 管理界面

```
┌─────────────────────────────────────────────────────────┐
│ Skills                                    [+ New Skill] │
├─────────────────────────────────────────────────────────┤
│ 🔍 Search skills...                                     │
├─────────────────────────────────────────────────────────┤
│ ▼ Built-in Skills (4)                                   │
│   📦 image-generation        [View] [Copy to User]      │
│   📦 document-analysis       [View] [Copy to User]      │
│   📦 feishu-operations       [View] [Copy to User]      │
│   📦 knowledge-search        [View] [Copy to User]      │
│                                                          │
│ ▼ User Skills (2)                                       │
│   ⚡ my-custom-skill         [Edit] [Delete]            │
│   ⚡ feishu-helper           [Edit] [Delete]            │
└─────────────────────────────────────────────────────────┘
```

**交互流程**：
1. 查看内置 Skill → 只读模式，显示内容
2. 点击"Copy to User" → 复制到用户空间，可编辑
3. 创建用户 Skill → 填写名称、描述、内容
4. 编辑用户 Skill → 修改内容，保存到 `~/.lumos/skills/`
5. 删除用户 Skill → 从数据库和文件系统删除

### MCP 管理界面

```
┌─────────────────────────────────────────────────────────┐
│ MCP Servers                              [+ Add Server] │
├─────────────────────────────────────────────────────────┤
│ ▼ Built-in Servers (1)                                  │
│   📦 feishu                  [✓] [View] [Copy to User]  │
│                                                          │
│ ▼ User Servers (2)                                      │
│   ⚡ filesystem              [✓] [Edit] [Delete]        │
│   ⚡ web-search              [ ] [Edit] [Delete]        │
└─────────────────────────────────────────────────────────┘
```

**交互流程**：
1. 查看内置 MCP → 只读模式，显示配置
2. 点击"Copy to User" → 复制到用户空间，可修改命令/参数
3. 添加用户 MCP → 填写名称、命令、参数、环境变量
4. 编辑用户 MCP → 修改配置，保存到数据库
5. 删除用户 MCP → 从数据库删除
6. 启用/禁用 → 切换 `is_enabled` 字段

---

## 数据流

```
App 启动
  ↓
检查是否已导入内置资源（settings 表标记）
  ↓
如果未导入：
  - 扫描 public/skills/ → 插入 skills 表（scope=builtin）
  - 扫描 public/mcp-servers/ → 插入 mcp_servers 表（scope=builtin）
  - 设置标记：builtin_resources_imported = true
  ↓
加载 Skills：
  - DB 查询（scope=builtin, is_enabled=1）→ 读取 public/skills/ 文件内容
  - DB 查询（scope=user, is_enabled=1）→ 读取 ~/.lumos/skills/ 文件内容
  ↓
加载 MCP Servers：
  - DB 查询（scope=builtin, is_enabled=1）
  - DB 查询（scope=user, is_enabled=1）
  - 解析 args/env JSON，传递给 Claude SDK
```

---

## 推荐的内置资源

### 内置 Skills

#### 1. document-analysis.md
**用途**：文档结构分析、关键信息提取、摘要生成

```markdown
---
name: document-analysis
description: Analyze document structure, extract key information, generate summaries
---

You are a document analysis assistant. Extract structure, key points, and metadata from documents.

## Capabilities
- Identify document type (report, article, manual, etc.)
- Extract headings, sections, tables
- Summarize key points
- Detect language and format
```

#### 2. feishu-operations.md
**用途**：飞书文档操作指南

```markdown
---
name: feishu-operations
description: Guide for Feishu document operations (read, edit, create)
---

You are a Feishu document assistant. Help users interact with Feishu docs via MCP.

## Available Operations
- Read document content
- Edit specific blocks
- Create new documents
- Upload images
```

#### 3. knowledge-search.md
**用途**：知识库检索（为未来 RAG 功能准备）

```markdown
---
name: knowledge-search
description: Search knowledge base and provide contextual answers
---

You are a knowledge base assistant. Search indexed documents and provide accurate answers with citations.

## Search Strategy
- Use hybrid search (vector + BM25)
- Cite source documents
- Provide confidence scores
```

### 内置 MCP Servers

#### 1. Feishu MCP（已有）
```json
{
  "name": "feishu",
  "description": "Feishu document operations (read, edit, create)",
  "command": "node",
  "args": ["[RUNTIME_PATH]/feishu-mcp.js"],
  "env": {}
}
```

**注意**：`[RUNTIME_PATH]` 是占位符，运行时替换为实际路径

#### 2. Filesystem MCP（可选，未来添加）
```json
{
  "name": "filesystem",
  "description": "Local file operations (read, write, search)",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "[WORKSPACE_PATH]"],
  "env": {}
}
```

---

## 实施步骤

### Phase 1: 数据库层（2 文件）

**优先级**：🔴 高
**预计时间**：1 天

1. **添加数据库表**
   - 文件：`src/lib/db/migrations-lumos.ts`
   - 内容：`skills` 和 `mcp_servers` 表定义
   - 索引：scope、is_enabled

2. **创建 Skills 数据访问层**
   - 文件：`src/lib/db/skills.ts`（新建）
   - 函数：
     - `getSkills(scope?: 'builtin' | 'user'): Skill[]`
     - `getSkillByName(name: string, scope: string): Skill | null`
     - `createSkill(skill: Omit<Skill, 'id' | 'created_at' | 'updated_at'>): Skill`
     - `updateSkill(id: string, updates: Partial<Skill>): void`
     - `deleteSkill(id: string): void`
     - `copySkillToUser(builtinId: string, newName?: string): Skill`

3. **创建 MCP 数据访问层**
   - 文件：`src/lib/db/mcp-servers.ts`（新建）
   - 函数：同上（替换为 McpServer 类型）

### Phase 2: 内置资源准备（4 文件）

**优先级**：🟡 中
**预计时间**：0.5 天

1. **创建内置 Skills**
   - `public/skills/document-analysis.md`
   - `public/skills/feishu-operations.md`
   - `public/skills/knowledge-search.md`

2. **创建飞书 MCP 元数据**
   - `public/mcp-servers/feishu.json`

### Phase 3: 初始化逻辑（1 文件）

**优先级**：🔴 高
**预计时间**：1 天

1. **创建初始化服务**
   - 文件：`src/lib/init-builtin-resources.ts`（新建）
   - 功能：
     - 检查 `settings` 表的 `builtin_resources_imported` 标记
     - 如果未导入：
       - 扫描 `public/skills/` → 解析 frontmatter → 插入数据库
       - 扫描 `public/mcp-servers/*.json` → 插入数据库
       - 设置标记为 true
     - 处理版本升级（比较 content_hash，更新变化的内置资源）

2. **集成到启动流程**
   - 文件：`electron/main.ts` 或 `src/app/layout.tsx`
   - 调用：`initBuiltinResources()` 在应用启动时

### Phase 4: API 路由重构（4 文件）

**优先级**：🔴 高
**预计时间**：2 天

1. **重构 Skills API**
   - 文件：`src/app/api/skills/route.ts`
   - GET：从数据库查询，读取文件内容
   - POST：创建用户 Skill（scope=user）
   - 移除所有 `~/.claude/`、`~/.agents/` 引用

2. **重构 Skills 详情 API**
   - 文件：`src/app/api/skills/[name]/route.ts`
   - GET：获取单个 Skill（需要 scope 参数）
   - PUT：只允许更新 user Skill
   - DELETE：只允许删除 user Skill
   - POST /copy：复制 builtin → user

3. **重构 MCP API**
   - 文件：`src/app/api/plugins/mcp/route.ts`
   - GET：从数据库查询，不再读取 `settings.json`
   - POST：创建用户 MCP（scope=user）
   - 移除文件配置逻辑

4. **创建 MCP 详情 API**
   - 文件：`src/app/api/plugins/mcp/[id]/route.ts`（新建）
   - GET：获取单个 MCP
   - PUT：只允许更新 user MCP
   - DELETE：只允许删除 user MCP
   - POST /copy：复制 builtin → user

### Phase 5: UI 更新（4 文件）

**优先级**：🟡 中
**预计时间**：2 天

1. **更新 SkillsManager**
   - 文件：`src/components/skills/SkillsManager.tsx`
   - 按 scope 分组：Built-in + User
   - Built-in 显示"Copy to User"按钮
   - User 显示"Edit"和"Delete"按钮

2. **更新 SkillEditor**
   - 文件：`src/components/skills/SkillEditor.tsx`
   - 添加只读模式（builtin）
   - 只读模式显示"Copy to User"按钮

3. **更新 McpManager**
   - 文件：`src/components/plugins/McpManager.tsx`
   - 按 scope 分组：Built-in + User
   - 移除 JSON 编辑器（改为表单）

4. **更新 McpServerEditor**
   - 文件：`src/components/plugins/McpServerEditor.tsx`
   - 添加只读模式（builtin）
   - 表单编辑：command、args、env

### Phase 6: 数据迁移（1 文件）

**优先级**：🔴 高
**预计时间**：1 天

1. **创建迁移脚本**
   - 文件：`src/lib/migrate-existing-resources.ts`（新建）
   - 功能：
     - 检查是否需要迁移（标记）
     - 迁移现有 MCP 配置（`settings.json` → 数据库，scope=user）
     - 迁移现有 Skills（文件系统 → 数据库 + `~/.lumos/skills/`）
     - 备份原文件
     - 设置迁移标记

2. **集成到启动流程**
   - 在 `initBuiltinResources()` 之后调用
   - 错误处理：失败时回滚，保留备份

---

## 风险与缓解

### 风险 1：迁移失败，用户丢失配置
**影响**：高
**缓解**：
- 迁移前备份 `settings.json` 和 Skills 文件
- 失败时回滚，显示错误提示
- 提供手动恢复工具

### 风险 2：内置资源打包失败
**影响**：中
**缓解**：
- 构建时验证 `public/skills/` 和 `public/mcp-servers/` 存在
- CI 中添加检查步骤

### 风险 3：性能下降（数据库查询 + 文件读取）
**影响**：低
**缓解**：
- 缓存 Skill 内容到内存（TTL 60s）
- 延迟加载：首次使用时才读取文件

### 风险 4：用户修改内置资源后升级冲突
**影响**：低
**缓解**：
- 内置资源只读，用户必须"复制到用户空间"才能修改
- 升级时只更新 builtin scope，不影响 user scope

---

## 成功标准

- [ ] 代码中无任何 `~/.claude/` 或 `~/.agents/` 引用（除迁移脚本）
- [ ] 首次启动自动导入内置 Skills/MCP
- [ ] 用户可以复制内置资源到用户空间并修改
- [ ] 用户无法编辑或删除内置资源
- [ ] 现有用户数据成功迁移
- [ ] UI 清晰区分 builtin 和 user 资源
- [ ] MCP 配置从数据库加载，不再依赖文件
- [ ] Skills 内容存文件，元数据存数据库

---

## 实施顺序

1. **Phase 1**（数据库）→ 基础，无 UI 变化
2. **Phase 2**（内置资源）→ 准备内容，无逻辑变化
3. **Phase 6**（迁移）→ 在破坏性变更前保护用户数据
4. **Phase 3**（初始化）→ 自动导入逻辑
5. **Phase 4**（API 重构）→ 核心逻辑变更
6. **Phase 5**（UI 更新）→ 用户可见变化

每个 Phase 可独立测试和合并。

---

## 扩展：更多内置资源推荐

### 额外的内置 Skills

基于 [Everything Claude Code](https://github.com/travisvn/awesome-claude-skills) 和社区最佳实践，以下是可选的内置 Skills：

#### 4. continuous-learning-v2.md
**用途**：基于 Instinct 的持续学习系统，自动从会话中提取可复用知识

**来源**：ECC (Everything Claude Code)

**核心功能**：
- 通过 hooks 观察会话（PreToolUse/PostToolUse）
- 提取原子级"instincts"（小型学习行为）
- 置信度评分（0.3-0.9）
- 自动演化为 Skills/Commands/Agents

**配置示例**：
```json
{
  "observation": {
    "enabled": true,
    "store_path": "~/.lumos/.claude/homunculus/observations.jsonl",
    "capture_tools": ["Edit", "Write", "Bash", "Read"]
  },
  "instincts": {
    "min_confidence": 0.3,
    "auto_approve_threshold": 0.7,
    "max_instincts": 100
  }
}
```

**是否推荐内置**：🟡 可选（高级用户功能，需要额外配置）

#### 5. pdf-parser.md
**用途**：PDF 文件解析和内容提取

**核心功能**：
- 提取文本内容
- 识别表格和图片
- 保留文档结构
- 支持多语言

**是否推荐内置**：🟢 推荐（文档助手核心功能）

#### 6. markdown-formatter.md
**用途**：Markdown 格式化和美化

**核心功能**：
- 统一标题层级
- 格式化列表和表格
- 修复语法错误
- 添加目录

**是否推荐内置**：🟢 推荐（文档编辑常用）

#### 7. readme-generator.md
**用途**：自动生成项目 README.md

**核心功能**：
- 分析项目结构
- 生成安装说明
- 添加使用示例
- 生成 API 文档

**是否推荐内置**：🟡 可选（开发者工具）

### 额外的内置 MCP Servers

#### 3. Microsoft Office MCP
**包名**：`jenstangen1/pptx-xlsx-mcp`

**支持功能**：
- PowerPoint (.pptx) 读取和创建
- Excel (.xlsx) 读取和创建
- 基本文档操作

**配置示例**：
```json
{
  "name": "ms-office-suite",
  "description": "Microsoft Office document operations (PowerPoint, Excel)",
  "command": "npx",
  "args": ["-y", "jenstangen1/pptx-xlsx-mcp"],
  "env": {}
}
```

**是否推荐内置**：🟡 可选（需要 Office 文档支持时）

**注意事项**：
- 社区维护，非微软官方
- 无需 API Key
- 直接操作本地文件

#### 4. Brave Search MCP
**包名**：`@modelcontextprotocol/server-brave-search`

**支持功能**：
- Web 搜索
- 图片/视频/新闻搜索
- 本地 POI 搜索

**配置示例**：
```json
{
  "name": "brave-search",
  "description": "Web search powered by Brave Search API",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "[USER_INPUT_REQUIRED]"
  }
}
```

**是否推荐内置**：🔴 不推荐（需要付费 API Key，$5/月起）

**替代方案**：
- DuckDuckGo MCP（免费）
- SerpAPI（有免费套餐）

#### 5. SQLite MCP
**包名**：`@modelcontextprotocol/server-sqlite`

**支持功能**：
- 查询 SQLite 数据库
- 执行 SQL 语句
- 数据导出

**配置示例**：
```json
{
  "name": "sqlite",
  "description": "SQLite database operations",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "~/.lumos/data.db"],
  "env": {}
}
```

**是否推荐内置**：🟢 推荐（Lumos 本身使用 SQLite，可用于数据查询）

#### 6. Fetch MCP
**包名**：`@modelcontextprotocol/server-fetch`

**支持功能**：
- HTTP 请求
- 网页内容抓取
- API 调用

**配置示例**：
```json
{
  "name": "fetch",
  "description": "HTTP requests and web content fetching",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-fetch"],
  "env": {}
}
```

**是否推荐内置**：🟢 推荐（通用工具，无需配置）

### 推荐的内置资源优先级

#### 第一批（MVP）
- ✅ document-analysis.md
- ✅ feishu-operations.md
- ✅ knowledge-search.md
- ✅ Feishu MCP
- ✅ Filesystem MCP

#### 第二批（增强）
- 🟢 pdf-parser.md
- 🟢 markdown-formatter.md
- 🟢 SQLite MCP
- 🟢 Fetch MCP

#### 第三批（可选）
- 🟡 continuous-learning-v2.md（需要额外配置）
- 🟡 readme-generator.md（开发者工具）
- 🟡 Microsoft Office MCP（需要 Office 文档支持）

#### 不推荐
- 🔴 Brave Search MCP（需要付费 API Key）

---

## 附录：技术细节

### A. content_hash 计算

```typescript
import crypto from 'crypto';

function calculateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
```

用途：检测内置资源是否变化，决定是否更新数据库

### B. [RUNTIME_PATH] 占位符替换

```typescript
function resolveMcpCommand(server: McpServer): { command: string; args: string[] } {
  const runtimePath = process.resourcesPath || path.join(__dirname, '../public');
  const args = JSON.parse(server.args).map((arg: string) =>
    arg.replace('[RUNTIME_PATH]', runtimePath)
  );
  return { command: server.command, args };
}
```

### C. Skill Frontmatter 解析

```typescript
import matter from 'gray-matter';

function parseSkillFile(filePath: string): { name: string; description: string; content: string } {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  return {
    name: data.name || path.basename(filePath, '.md'),
    description: data.description || '',
    content: raw,
  };
}
```

---

**文档版本**：v1.0
**最后更新**：2026-03-01
