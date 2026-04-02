# 002-RFC: 图片生成改造为 In-Process MCP Tool

| 字段 | 值 |
|------|---|
| 序号 | 002 |
| 类型 | RFC（Request for Comments） |
| 主题 | 图片生成能力改造为 In-Process MCP Tool |
| 状态 | draft |
| 版本 | v1.4 |
| 更新时间 | 2026-03-29 |
| 作者 | Claude |
| 变更记录 | v1.0 初稿; v1.1 review 修正：SDK 注册方式改为 createSdkMcpServer、工作流 Tool 名修正、补齐超时/端点保留/客户端渲染细节; v1.2 补充用户旅程与 UX 设计; v1.3 新增安全阀设计(3.9)、Provider 适配器抽象(3.10)、用量统计集成(3.11)，更新系统提示/迁移计划/风险评估; v1.4 架构 review：Phase 1 handler 简化为直接调用 generateSingleImage（不提前引入 adapter 抽象）、Phase 3 细化旧 env 注入移除边界、补充 SDK 同进程假设、安全阀闭包重置说明、新增客户端 tool_use 渲染 spike 前置步骤 |

---

## 一、现状与问题

### 1.1 当前架构

图片生成目前有两条并行链路，都绕了一大圈才到 `generateSingleImage()`：

```
链路 A — MCP 路径（gemini-image 外部进程）
  用户说"生成一张图"
  → conversation-engine 检测 gemini-image MCP 是否启用
  → 注入 GEMINI_IMAGE_MCP_SYSTEM_HINT 到系统提示
  → Claude 通过 MCP 协议调用 gemini-image 外部进程的 generate_image tool
  → 外部进程内部调用 Gemini API
  → 返回结果给 Claude
  → Claude 输出文本描述

链路 B — Legacy Block 路径（客户端正则解析）
  用户说"生成一张图"
  → 注入 IMAGE_AGENT_SYSTEM_PROMPT 到系统提示
  → Claude 输出 ```image-gen-request``` 或 ```batch-plan``` 代码块
  → 客户端 StreamingMessage.tsx 正则匹配提取 JSON
  → 渲染 ImageGenConfirmation 确认组件
  → 用户点确认 → POST /api/media/generate
  → 服务端调用 generateSingleImage()
  → 客户端渲染结果
```

### 1.2 问题

| 问题 | 影响 |
|------|------|
| **MCP 进程管理开销** | 需要启动外部 Node 进程、管理生命周期、注入 env 变量（GEMINI_API_KEY 等）到子进程 |
| **Provider 系统未打通** | 服务商设置页已有图片生成 Provider 配置，但 MCP 路径绕过了它，用自己的 env 注入 |
| **Legacy Block 是 hack** | 依赖提示词格式化输出 + 客户端正则解析，链路脆弱、调试困难 |
| **两条链路共存** | 逻辑分散在 conversation-engine、chat/route、StreamingMessage、ImageGenConfirmation 等多处，维护负担重 |
| **工作流无法用** | stage-worker 只认 Claude SDK 内置 Tool（Read/Write/Bash 等），MCP 和 Block 方式都无法在工作流中调用 |
| **需要用户手动确认** | Legacy Block 需要用户点确认按钮才生成，中断了对话流 |

### 1.3 涉及文件清单

| 文件 | 当前角色 | 行数 |
|------|---------|------|
| `src/lib/image-generator.ts` | 核心生成逻辑，调用 Gemini API | 214 |
| `src/lib/bridge/conversation-engine.ts` | MCP env 注入、系统提示拼接 | ~280 |
| `src/app/api/chat/route.ts` | 重复的 MCP 检测 + 系统提示注入 | ~1100 |
| `src/app/api/media/generate/route.ts` | REST 端点，Legacy Block + Gallery 重新生成 | ~66 |
| `src/lib/prompts/image-gen.ts` | Legacy Block 的提示词 | 45 |
| `src/components/chat/StreamingMessage.tsx` | 客户端正则解析 image-gen-request/batch-plan | ~600 |
| `src/components/chat/ImageGenConfirmation.tsx` | 确认弹窗 UI | 369 |
| `src/components/chat/batch-image-gen/` | 批量生成 UI 组件 | 多个文件 |
| `src/lib/team-run/runtime-tool-policy.ts` | 工作流 Tool 白名单 | 193 |

---

## 二、目标

1. **统一为一条链路**：Claude `tool_use` → in-process handler → `generateSingleImage()` → 返回结果
2. **对话 + 工作流统一**：同一个 in-process MCP server，Chat 和 Stage Worker 都注入
3. **打通 Provider 系统**：handler 直接调用 `resolveProviderForCapability()`，设置页配置直接生效
4. **去掉中间层**：不再需要外部 MCP 进程、Legacy Block 解析、确认弹窗

---

## 三、方案设计

### 3.1 核心机制：`createSdkMcpServer`

Claude Agent SDK 提供了 `createSdkMcpServer()` API，允许在**同一进程内**创建 MCP server，无需启动外部进程。SDK 会自动把 server 注册的 tool 暴露给 Claude：

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const server = createSdkMcpServer({
  name: 'lumos-image',
  tools: [sdkToolDefinition],
});

// 注入到 query options 的 mcpServers 中
queryOptions.mcpServers = {
  ...existingMcpServers,
  'lumos-image': server,  // type: 'sdk'，无外部进程
};
```

Claude 看到的 tool 名为 `mcp__lumos-image__generate_image`，与外部 MCP server 的命名规则一致，但执行完全在 Lumos 进程内完成。

> **关键假设**：`createSdkMcpServer` 注册的 tool handler 运行在**调用 SDK query 的同一 Node.js 进程**内（非 worker thread、非子进程）。这一点已通过 SDK 源码和类型声明确认（SDK 直接在当前进程内构造 MCP transport）。本方案依赖这个假设，因为 handler 内部会调用 better-sqlite3 的同步 API（`getDb()`、`getSetting()` 等），而 better-sqlite3 的 Database 实例不能跨线程/进程共享。如果未来 SDK 版本改变了执行模型，需要重新评估 DB 访问方式。

### 3.2 架构总览

```
┌──────────────────────────────────────────────────────────┐
│  用户: "帮我画一只猫"                                       │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│  Claude SDK (query)                                      │
│  mcpServers 中包含 lumos-image in-process server          │
│                                                          │
│  Claude 判断意图 → 发出 tool_use:                          │
│    mcp__lumos-image__generate_image                      │
│    { prompt: "A cute cat...", aspect_ratio: "1:1" }      │
└──────────────┬───────────────────────────────────────────┘
               │ SDK 自动路由到 in-process handler
               ▼
┌──────────────────────────────────────────────────────────┐
│  In-Process Handler (image-gen-tool.ts)                  │
│                                                          │
│  1. 安全阀检查（generationCount < 10）                     │
│  2. generateSingleImage({ prompt, aspectRatio, ... })    │
│     → 内部调用 resolveProviderForCapability('image-gen')   │
│     → 未配置时抛出错误，handler 捕获后返回引导文案           │
│  3. 返回 CallToolResult:                                  │
│     { content: [{ type: 'text', text: JSON结果 }] }       │
└──────────────┬───────────────────────────────────────────┘
               │ tool_result（SDK 自动回传给 Claude）
               ▼
┌──────────────────────────────────────────────────────────┐
│  Claude 收到结果 → 输出文本总结 + 图片路径                    │
└──────────────┬───────────────────────────────────────────┘
               │ SSE stream（tool_use → text → tool_result 交叉）
               ▼
┌──────────────────────────────────────────────────────────┐
│  Client 渲染                                              │
│  - tool_use 事件 → "正在生成图片..." 加载态                 │
│  - 文本穿插正常显示                                         │
│  - tool_result 事件 → 内联渲染图片缩略图                    │
└──────────────────────────────────────────────────────────┘
```

### 3.3 Tool 定义与 Handler

```typescript
// src/lib/tools/image-gen-tool.ts

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { generateSingleImage } from '@/lib/image-generator';

const IMAGE_GEN_TOOL_NAME = 'generate_image';
const MAX_GENERATIONS_PER_SESSION = 10;

const inputSchema = {
  prompt: z.string().describe(
    'Detailed English description of the image to generate. '
    + 'For editing tasks, describe only the requested changes.'
  ),
  aspect_ratio: z.enum(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'])
    .optional()
    .describe('Aspect ratio. Defaults to 1:1.'),
  image_size: z.enum(['1K', '2K', '4K'])
    .optional()
    .describe('Resolution. Defaults to 1K.'),
  reference_image_paths: z.array(z.string())
    .optional()
    .describe('Local file paths of reference images for editing or style transfer.'),
};

export function createImageGenTool(sessionId?: string) {
  let generationCount = 0;

  return tool(
    IMAGE_GEN_TOOL_NAME,
    'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images.',
    inputSchema,
    async (args): Promise<CallToolResult> => {
      // 安全阀：单次对话上限
      generationCount++;
      if (generationCount > MAX_GENERATIONS_PER_SESSION) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `本次对话已生成 ${MAX_GENERATIONS_PER_SESSION} 张图片，已达上限。`
                + '请开启新对话继续生成，或让用户确认后继续。',
            }),
          }],
          isError: true,
        };
      }

      // Phase 1：直接调用 generateSingleImage()，
      // Provider 解析由 generateSingleImage 内部完成（已有 resolveProviderForCapability 调用）。
      // Phase 4 再拆分 adapter 抽象，届时 handler 改为先解析 provider 再传入 generateImage()。
      try {
        const result = await generateSingleImage({
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio || '1:1',
          imageSize: args.image_size || '1K',
          referenceImagePaths: args.reference_image_paths,
          sessionId,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              media_generation_id: result.mediaGenerationId,
              images: result.images.map(img => ({
                path: img.localPath,
                mime_type: img.mimeType,
              })),
              elapsed_ms: result.elapsedMs,
              generation_count: generationCount,
              generation_limit: MAX_GENERATIONS_PER_SESSION,
            }),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片生成失败';
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    },
  );
}
```

**设计要点**：
- `inputSchema` 使用 Zod（SDK 要求），不是 JSON Schema
- handler 返回 `CallToolResult`（MCP 标准），不是 string
- Provider 未配置时**仍注册 Tool**，`generateSingleImage` 内部会抛出明确错误，handler 捕获后返回 `isError: true` + 引导文案
- `sessionId` 通过闭包传入，不走 Tool input（对 Claude 不可见）
- 刻意**不提供 count/n 参数**：每次只生成一张。批量需求由 Claude 拆分为多次调用（见 3.7）
- **安全阀**：闭包内 `generationCount` 计数，单次对话上限 10 张（见 3.9）
- **Phase 1 不引入 adapter 抽象**：handler 直接调用现有 `generateSingleImage()`，Provider 解析由其内部完成。Phase 4 再拆分 adapter 接口
- tool_result 包含 `generation_count` / `generation_limit`，Claude 可据此告知用户剩余额度

### 3.4 创建 In-Process MCP Server

```typescript
// src/lib/tools/lumos-mcp-server.ts

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createImageGenTool } from './image-gen-tool';

export const LUMOS_MCP_SERVER_NAME = 'lumos-image';

export function createLumosMcpServer(sessionId?: string) {
  return createSdkMcpServer({
    name: LUMOS_MCP_SERVER_NAME,
    tools: [
      createImageGenTool(sessionId),
      // 未来可扩展更多内置 tool
    ],
  });
}
```

### 3.5 注册到 Claude SDK

#### 3.5.1 对话场景（conversation-engine + chat route）

两个入口都在构建 `mcpServers` 时注入：

```typescript
// conversation-engine.ts — loadMcpServers() 末尾
const lumosMcpServer = createLumosMcpServer(sessionId);
mcpServers[LUMOS_MCP_SERVER_NAME] = lumosMcpServer;

// chat/route.ts — buildMcpServers() 末尾，同理
```

替代现有的：
- `hasGeminiImageMcp()` 检测 + `GEMINI_IMAGE_MCP_SYSTEM_HINT` 系统提示自动注入
- 注意：`resolveGeminiMcpEnv()` **不在此步移除**（见 Phase 3 说明），用户手动保留的 gemini-image 外部 MCP 仍需要 env 注入

#### 3.5.2 工作流场景（stage-worker）

stage-worker 同样注入 in-process MCP server：

```typescript
// stage-worker.ts — 构建 queryOptions 时
const lumosMcpServer = createLumosMcpServer(payload.sessionId);
queryOptions.mcpServers = {
  [LUMOS_MCP_SERVER_NAME]: lumosMcpServer,
};
```

Tool 权限控制：in-process MCP tool 名为 `mcp__lumos-image__generate_image`。需要在 `runtime-tool-policy.ts` 中处理：

```typescript
// 扩展 ClaudeToolName 类型
type ClaudeToolName =
  | 'Read' | 'Edit' | 'Write' | ...
  | 'mcp__lumos-image__generate_image';  // 新增

// 扩展 capability 映射
const CLAUDE_TOOLS_BY_CAPABILITY = {
  ...existing,
  'media.generate': ['mcp__lumos-image__generate_image'],
};

// validateToolInput 中新增 case
case 'mcp__lumos-image__generate_image': {
  // 校验 reference_image_paths 在允许的读取范围内
  const paths = record.reference_image_paths;
  if (Array.isArray(paths)) {
    for (const p of paths) {
      validateFileToolPath(guards.readGuard, p, 'read', executionCwd);
    }
  }
  return;
}
```

工作流 Agent 定义中声明 `allowedTools: ['media.generate']` 即可。

### 3.6 客户端渲染

现有 SSE 流已发送 `tool_use` 和 `tool_result` 事件。需要在客户端识别 `mcp__lumos-image__generate_image` 并渲染。

**注意**：`tool_use`、文本、`tool_result` 三者是异步交叉的。一次对话中可能出现：

```
text: "好的，我来帮你生成一张猫的图片。"
tool_use: { name: "mcp__lumos-image__generate_image", input: { prompt: "..." } }
text: "图片正在生成中..."
tool_result: { content: '{"success":true,"images":[...]}' }
text: "图片已生成，是一只橘色的猫..."
```

客户端需要按顺序渲染这些事件块。

#### tool_use 阶段（生成中）

```tsx
// 识别 tool_use.name 包含 'generate_image'
<div className="rounded-lg border border-border bg-muted/30 p-4 my-2">
  <div className="flex items-center gap-2">
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    <span className="text-sm text-muted-foreground">正在生成图片...</span>
  </div>
  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{input.prompt}</p>
</div>
```

#### tool_result 阶段（生成完成）

```tsx
// 解析 tool_result content → JSON → 渲染图片
const result = JSON.parse(content);
if (result.success && result.images?.length > 0) {
  <div className="rounded-lg border p-2 my-2">
    {result.images.map(img => (
      <img
        src={`/api/files/raw?path=${encodeURIComponent(img.path)}`}
        className="max-w-sm rounded"
      />
    ))}
    <p className="text-xs text-muted-foreground mt-1">
      耗时 {(result.elapsed_ms / 1000).toFixed(1)}s
    </p>
  </div>
} else {
  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 my-2">
    <p className="text-sm text-destructive">{result.error}</p>
  </div>
}
```

可从 `ImageGenConfirmation.tsx` 中提取图片展示组件复用，去掉确认按钮逻辑。

### 3.7 批量生成

批量需求（如"给这篇文档的每个章节配一张图"）由 Claude 拆分为多次 `generate_image` 调用。

**选择这个方案的理由**：
- 无需额外 batch 基础设施
- 每张图独立出错、独立重试
- Claude 可以根据前一张结果调整后续 prompt
- 客户端只需处理多个 tool_use/tool_result 块的顺序渲染

**代价**：串行执行，每张 10-30 秒。如果用户有 10 张批量需求，总耗时 2-5 分钟。

**后续优化（Phase 5）**：如果批量场景反馈太慢，追加 `batch_generate_images` tool，内部复用 `job-executor.ts` 的并发控制逻辑（默认 concurrency: 2）。

### 3.8 超时策略

| 环节 | 当前值 | 建议值 | 说明 |
|------|--------|--------|------|
| Gemini API 请求 | 300s（`image-generator.ts` AbortSignal.timeout） | 300s（保持） | 大图/慢网络需要足够时间 |
| SDK MCP tool 默认超时 | 60s（`CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`） | 需覆盖 | 默认 60s 不够，会导致生成中途超时 |
| 客户端 SSE 连接 | 无限制 | 无限制（保持） | 图片生成期间连接持续 |

解决方案：通过环境变量 `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` 设置为 `360`（秒），在 `streamClaude()` 的 `env` 中注入。或者在 `createSdkMcpServer` 调用时通过 SDK 的配置覆盖。

### 3.9 安全阀设计

#### 问题

图片生成有真实成本（API 调用费用 + 生成时间）。如果 Claude 在批量场景下无限制地循环调用 `generate_image`（如"给这 100 页 PPT 每页配一张图"），可能导致：
- 费用失控（每次调用 ≈ $0.01-0.05，100 次 = $1-5）
- 长时间阻塞对话（100 × 15s = 25 分钟）
- 用户无法中断（SDK 流式调用中途取消能力有限）

#### 方案

**单次对话生成上限**：`MAX_GENERATIONS_PER_SESSION = 10`

机制已在 3.3 handler 代码中实现：
- 闭包变量 `generationCount` 在每次 `createImageGenTool()` 调用时初始化为 0
- 每次 handler 执行时 `generationCount++`
- 超过上限后 handler 返回 `isError: true` + 引导文案
- 每次 tool_result 中返回 `generation_count` / `generation_limit`，Claude 可据此告知用户

**已知限制**：闭包计数绑定在 `createImageGenTool()` 返回的实例上。如果同一对话中多次调用 `createLumosMcpServer()`（例如用户刷新页面触发新的 query），计数会重置。Phase 1 接受这个限制（每次都是有意的用户行为）。如果后续需要更严格的控制，可改为按 `sessionId` 在内存 Map 中计数，或持久化到 DB。

**系统提示引导**（配合 section 五）：
- 告知 Claude 单次对话限额 10 张
- 批量超过 5 张时，先告知用户预计耗时和数量，等用户确认
- 接近上限时（第 8-9 张）主动提示用户"即将达到本轮上限"

**不做硬性弹窗确认**：
- ❌ 不弹"确认生成？"弹窗 — 打断对话流，与去掉确认弹窗的目标矛盾
- ✅ 通过系统提示让 Claude 自行判断是否需要向用户确认

**后续扩展**：
- 可在设置页暴露上限配置（默认 10，允许用户调整 5-50）
- 可增加日维度的全局上限（跨对话累计，防止意外循环）

### 3.10 Provider 适配器抽象

#### 现状

`image-generator.ts` 中 `generateSingleImage()` 硬编码了 Gemini：

```typescript
// 当前代码（硬编码）
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export async function generateSingleImage(opts) {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const model = google('gemini-2.0-flash-preview-image-generation');
  // ...
}
```

Provider 系统已经支持配置不同的图片生成服务商（如 Gemini、DALL·E、Stable Diffusion），但生成逻辑只走 Gemini 一条路。

#### 目标

`generateImage()` 接收已解析的 provider 对象，根据 `provider_type` 路由到对应 adapter。

#### 设计

```typescript
// src/lib/image-generator.ts — 重构后

/** 统一入口 */
export async function generateImage(opts: ImageGenOptions): Promise<ImageGenResult> {
  const adapter = getAdapter(opts.provider.provider_type);
  return adapter.generate(opts);
}

/** Adapter 接口 */
interface ImageGenAdapter {
  generate(opts: ImageGenOptions): Promise<ImageGenResult>;
}

/** 根据 provider_type 路由 */
function getAdapter(providerType: string): ImageGenAdapter {
  switch (providerType) {
    case 'google':
    case 'gemini':
      return geminiAdapter;
    case 'openai':
      return openaiAdapter;
    default:
      throw new Error(`不支持的图片生成 Provider 类型：${providerType}`);
  }
}
```

```typescript
// src/lib/image-gen-adapters/gemini.ts

import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const geminiAdapter: ImageGenAdapter = {
  async generate(opts) {
    const google = createGoogleGenerativeAI({
      apiKey: opts.provider.apiKey,
      baseURL: opts.provider.baseUrl || undefined,
    });
    const model = google(opts.provider.model || 'gemini-2.0-flash-preview-image-generation');
    // ... 现有 generateSingleImage 逻辑迁移过来
  },
};
```

```typescript
// src/lib/image-gen-adapters/openai.ts（Phase 4 步骤 18）

import OpenAI from 'openai';

export const openaiAdapter: ImageGenAdapter = {
  async generate(opts) {
    const client = new OpenAI({
      apiKey: opts.provider.apiKey,
      baseURL: opts.provider.baseUrl || undefined,
    });
    const response = await client.images.generate({
      model: opts.provider.model || 'dall-e-3',
      prompt: opts.prompt,
      size: mapAspectRatioToSize(opts.aspectRatio),  // "1:1" → "1024x1024"
      quality: mapImageSizeToQuality(opts.imageSize), // "2K" → "hd"
    });
    // ... 下载图片、保存到本地、返回 ImageGenResult
  },
};
```

#### 类型定义

```typescript
interface ImageGenOptions {
  provider: ResolvedProvider;   // 从 resolveProviderForCapability 获取
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  referenceImagePaths?: string[];
  sessionId?: string;
}

interface ImageGenResult {
  mediaGenerationId: string;
  images: Array<{
    localPath: string;
    mimeType: string;
  }>;
  elapsedMs: number;
}
```

#### 迁移策略

> 注：以下分步属于主迁移计划中的 Phase 4，此处细化内部顺序。

1. 先只实现 Gemini adapter，`generateImage()` 仅转发到 `geminiAdapter`（Phase 4 步骤 14-17）
2. 随后新增 OpenAI (DALL·E) adapter（Phase 4 步骤 18）
3. 后续按需添加 Stable Diffusion、Midjourney API 等

### 3.11 用量统计集成

#### 现状

`UsageStatsSection` 已展示对话用量（token 数、API 调用次数等），但图片生成的用量没有接入。

#### 方案

在 handler 执行成功后，记录一条用量记录：

```typescript
// handler 成功后
await recordUsage({
  type: 'image_generation',
  provider_id: provider.id,
  provider_type: provider.provider_type,
  model: provider.model || 'default',
  session_id: sessionId,
  elapsed_ms: result.elapsedMs,
  metadata: {
    aspect_ratio: args.aspect_ratio,
    image_size: args.image_size,
    has_reference: !!args.reference_image_paths?.length,
  },
});
```

#### 展示

在 `UsageStatsSection` 增加"图片生成"分组：

| 指标 | 来源 |
|------|------|
| 总生成次数 | `COUNT(*)` where type = 'image_generation' |
| 按服务商分布 | `GROUP BY provider_type` |
| 平均耗时 | `AVG(elapsed_ms)` |
| 今日 / 本周 / 本月 | 按 `created_at` 筛选 |

实现优先级较低（Phase 7），不阻塞核心功能。

---

## 四、用户旅程与 UX 设计

### 4.1 用户旅程全景

```
旅程 1：首次使用（未配置）
  用户说"画一只猫"
  → Claude 调用 generate_image
  → handler 检测未配置 Provider → 返回引导错误
  → Claude 回复："图片生成需要先配置服务。点击下方链接前往设置。"
  → 消息内渲染「前往配置」按钮 → 跳转设置页图片生成区

旅程 2：简单生成
  用户说"画一只可爱的猫"
  → Claude 调用 generate_image { prompt: "A cute cat..." }
  → 对话区出现加载卡片（骨架屏 + prompt 文字）
  → 10-30s 后图片出现，内联渲染缩略图
  → 用户点击图片 → Lightbox 全屏查看
  → 可下载 / 重新生成 / 继续编辑

旅程 3：带参数生成
  用户说"画一只猫，宽屏高清"
  → Claude 解释"宽屏"为 16:9、"高清"为 2K
  → 调用 generate_image { prompt: "...", aspect_ratio: "16:9", image_size: "2K" }
  → 同旅程 2

旅程 4：编辑上一张图
  用户说"把背景改成蓝色"
  → Claude 从上一轮 tool_result 中找到图片路径
  → 调用 generate_image {
      prompt: "Change the background to blue",
      reference_image_paths: ["/.../.lumos-media/xxx.png"]
    }
  → 对话区显示：原图缩略 → 箭头 → 新图缩略

旅程 5：用上传的图做垫图
  用户拖入一张图 + 说"参考这个风格画一只猫"
  → 图片保存到 .lumos-uploads/，路径写入上下文
  → Claude 调用 generate_image {
      prompt: "A cute cat in the style of the reference image",
      reference_image_paths: ["/.../.lumos-uploads/xxx.png"]
    }
  → 对话区显示：参考图 + 生成图

旅程 6：批量生成
  用户说"给这 5 个产品各画一张图"
  → Claude 依次调用 5 次 generate_image
  → 每张完成后立即渲染，逐张出现
  → 对话末尾 Claude 总结："已为 5 个产品各生成一张图"

旅程 7：工作流中使用
  工作流步骤定义：为文章配图
  → stage-worker 的 Claude 调用 generate_image
  → 结果写入 artifact output
  → 用户在工作流结果页看到生成的图片
```

### 4.2 对话区 UI 设计

#### 4.2.1 加载态（tool_use 收到后）

```
┌──────────────────────────────────────────────┐
│  🎨 正在生成图片...                            │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │                                      │    │
│  │      ░░░░░░░░░░░░░░░░░░░░░░         │    │
│  │      ░░░  骨架屏动画  ░░░           │    │
│  │      ░░░  按 aspect_ratio  ░░░      │    │
│  │      ░░░  显示比例     ░░░          │    │
│  │      ░░░░░░░░░░░░░░░░░░░░░░         │    │
│  │                                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  A cute orange cat sitting on a windowsill   │
│  with warm afternoon sunlight...             │
│                                              │
│  ⏱ 已等待 12s                                │
└──────────────────────────────────────────────┘
```

设计要点：
- **骨架屏按比例显示**：根据 `aspect_ratio` 参数计算占位区域比例（如 16:9 → 宽矮，9:16 → 窄高），避免图片出现时布局跳动
- **显示 prompt 原文**：让用户知道 Claude 具体发了什么给模型
- **计时器**：10s+ 的等待需要反馈，显示"已等待 Xs"，降低焦虑
- **可取消**：超过 30s 可显示"停止生成"按钮

#### 4.2.2 完成态（tool_result 收到后）

复用现有 `ImageGenCard` 组件，它已经提供了：
- 图片网格（1/2/3 列自适应）
- 点击打开 `ImageLightbox` 全屏
- 下载按钮
- 重新生成按钮
- model / aspect_ratio / image_size 标签

需要扩展：
- **新增「继续编辑」按钮**：点击后在输入框预填"修改这张图：" + 自动关联 reference_image_paths
- **新增「发送到飞书」按钮**（如果飞书 MCP 已配置）
- **参考图展示**：如果有 reference_image_paths，在卡片上方显示小缩略图 + 箭头 → 生成结果

#### 4.2.3 错误态

```
┌──────────────────────────────────────────────┐
│  ❌ 图片生成失败                               │
│                                              │
│  图片生成服务未配置。                           │
│  请在设置 → 服务商 → 图片生成中添加服务。         │
│                                              │
│  [ 前往配置 ]          [ 重试 ]               │
└──────────────────────────────────────────────┘
```

三种错误分别处理：
| 错误类型 | 提示 | 操作 |
|---------|------|------|
| Provider 未配置 | "请在设置中配置图片生成服务" | 「前往配置」跳转到设置页 |
| API Key 无效/余额不足 | 显示原始错误 | 「前往配置」跳转到 Provider 编辑 |
| 生成失败（模型拒绝等） | "请修改 prompt 后重试" | 「重试」按钮 |

#### 4.2.4 编辑链展示

连续编辑同一张图时，显示编辑链条：

```
第一轮：
  [生成图] A cute cat

第二轮（用户说"把背景改成蓝色"）：
  ┌─────────────────────┐
  │  原图          新图   │
  │  [缩略]  →   [缩略]  │
  │               ✏️ 改为蓝色背景 │
  └─────────────────────┘
```

实现：tool_result 中包含 `reference_image_paths`，客户端提取后在 `ImageGenCard` 的 `referenceImages` 区域渲染原图。这个已有组件支持（`ImageGenCard.referenceImages` prop）。

### 4.3 输入区增强

当前输入区已支持拖拽上传图片（`MessageInput.tsx` + `AttachFileButton`）。图片生成场景额外需要：

#### 4.3.1 自然语言参数识别

不需要 UI 上的按钮，由 Claude 理解自然语言：

| 用户说 | Claude 解释为 |
|-------|-------------|
| "宽屏" / "横版" / "16:9" | aspect_ratio: "16:9" |
| "竖版" / "手机壁纸" / "9:16" | aspect_ratio: "9:16" |
| "高清" / "大图" / "2K" | image_size: "2K" |
| "超高清" / "4K" | image_size: "4K" |
| "正方形" / "1:1" | aspect_ratio: "1:1" |

这些映射通过系统提示引导 Claude 完成，不需要额外 UI。

#### 4.3.2 快捷操作（可选，Phase 6+）

在输入框左侧或上方增加图片生成快捷入口：

```
┌─────────────────────────────────────────────────┐
│ [📎]  [🖼️]  请输入消息...                 [发送] │
└─────────────────────────────────────────────────┘
        ↑
    点击展开图片生成面板（可选，低优先级）
```

**暂不实现**：直接在对话中说"画一张图"比点按钮更自然。如果后续用户反馈需要快捷入口再加。

### 4.4 Gallery 联动

生成的图片已通过 `generateSingleImage()` 写入 `media_generations` 表。Gallery 页面无需改动即可展示新生成的图片。

需要补充的联动：
- 对话内图片卡片增加「在画廊查看」链接 → 跳转 Gallery 页面并定位到该图
- Gallery 详情页增加「所属对话」链接 → 如果有 `session_id`，跳转回对话页

### 4.5 工作流结果展示

stage-worker 生成的图片：
- tool_result 写入 stage 的 artifact output
- 工作流结果页渲染图片时，复用 `ImageGenCard` 组件
- 图片同样存入 `media_generations` 表，Gallery 可见

---

## 五、系统提示

注册 Tool 后，Claude 自动获取 Tool 的 description 和 schema。补充提示引导行为习惯：

```typescript
export const IMAGE_GEN_SYSTEM_HINT = `关于图片生成（generate_image tool）：
- 用户要求画图时直接调用，不需要确认
- prompt 必须使用详细的英文描述
- 理解用户的中文尺寸描述："宽屏/横版" → 16:9，"竖版/手机壁纸" → 9:16，"高清" → 2K，"超高清" → 4K
- 编辑已有图片时，prompt 只描述修改内容，通过 reference_image_paths 传入原图路径
- 如果用户要修改上一次生成的图片，从对话历史中找到上次 tool_result 里的图片路径传入 reference_image_paths
- 批量需求拆分为多次独立调用，每次生成后简要报告进度（如"第 3/5 张已完成"）
- 如果 tool 返回未配置错误，告知用户到"设置 → 服务商 → 图片生成"配置
- 单次对话最多生成 10 张图片。tool_result 中的 generation_count/generation_limit 字段可以帮你追踪进度
- 当批量需求超过 5 张时，先告知用户预计数量和大致耗时（约 15-30 秒/张），等用户确认后再开始
- 接近上限时（第 8-9 张），主动提示用户"即将达到本轮上限，剩余 N 张额度"
- 达到上限后，建议用户开启新对话继续生成`;
```

这段提示**始终注入**，替代现有的 `GEMINI_IMAGE_MCP_SYSTEM_HINT`。

---

## 六、迁移计划

> 注：以下步骤编号与前文 Phase 对应

### Phase 0（前置）：客户端 tool_use 渲染能力验证

在开始 Phase 1 之前，需要先验证当前客户端 streaming 实现是否已经能识别和渲染 `tool_use` 类型的 content block。

**验证内容**：
- `StreamingMessage.tsx` 是否处理了 `content_block_start` 中 `type: 'tool_use'` 的事件
- SSE 流中 tool_use / text / tool_result 三种 block 的交叉顺序是否能正确渲染
- 如果不支持，需要先在 Phase 1 步骤 6 中补齐基础渲染能力，工作量会显著增加

**方式**：用一个已有的 MCP tool（如 feishu）触发一次 tool_use 调用，观察客户端渲染行为。

### Phase 1：实现 In-Process MCP Tool（核心）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1 | 创建 Tool 定义 + Handler（直接调用现有 `generateSingleImage()`，不引入 adapter 抽象） | `src/lib/tools/image-gen-tool.ts`（新建） |
| 2 | 创建 Lumos in-process MCP server 工厂 | `src/lib/tools/lumos-mcp-server.ts`（新建） |
| 3 | conversation-engine 注入 server，移除旧的**自动**系统提示注入（`GEMINI_IMAGE_MCP_SYSTEM_HINT`） | `src/lib/bridge/conversation-engine.ts` |
| 4 | chat route 注入 server，移除旧系统提示注入 | `src/app/api/chat/route.ts` |
| 5 | 设置超时环境变量 | `src/lib/claude-client.ts`（env 注入） |
| 6 | 客户端渲染 tool_use/tool_result（图片加载态 + 内联图片） | `src/components/chat/StreamingMessage.tsx` 或 `MessageItem.tsx` |

### Phase 2：接入工作流

| 步骤 | 改动 | 文件 |
|------|------|------|
| 7 | stage-worker 注入 in-process MCP server | `src/lib/team-run/stage-worker.ts` |
| 8 | 扩展 capability 映射 + Tool 输入校验 | `src/lib/team-run/runtime-tool-policy.ts` |

### Phase 3：清理旧代码

| 步骤 | 改动 | 文件 |
|------|------|------|
| 9 | 移除 Legacy Block 解析（保留旧消息只读渲染） | `StreamingMessage.tsx`（parseImageGenRequest, parseBatchPlan） |
| 10 | 移除 ImageGenConfirmation 确认流程（提取图片展示为独立组件复用） | `ImageGenConfirmation.tsx` |
| 11 | 移除**自动注入** `GEMINI_IMAGE_MCP_SYSTEM_HINT` 的逻辑（`hasGeminiImageMcp()` 检测 + hints.push） | `conversation-engine.ts` |
| 12 | 移除 `prompts/image-gen.ts`（Legacy Block 专用提示词） | `src/lib/prompts/image-gen.ts` |
| 13 | gemini-image MCP 标记为 deprecated（不删除，允许用户手动恢复） | `seed-builtin.ts` |

**注意**：
- `/api/media/generate` REST 端点**保留**，Gallery 页面的重新生成、外部调用等场景仍需要它。
- **`resolveGeminiMcpEnv()` 函数保留**：即使系统不再自动注入提示，用户仍可能在 MCP 列表中手动保留 `gemini-image` 外部 MCP。如果该 MCP 仍在 servers 列表中，env 注入逻辑（`GEMINI_API_KEY`、`GEMINI_BASE_URL`、`MEDIA_OUTPUT_DIR`）必须继续工作，否则外部 MCP 会静默失败。等确认无用户依赖后（可通过日志或遥测判断），再在后续版本中移除。

### Phase 4：Provider 适配器抽象

此阶段将 Phase 1 中直接调用 `generateSingleImage()` 的方式重构为 adapter 模式，支持多 Provider。重构后 handler 改为先调 `resolveProviderForCapability()` 再传入 `generateImage()`。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 14 | 定义 `ImageGenAdapter` 接口和 `ImageGenOptions` / `ImageGenResult` 类型 | `src/lib/image-generator.ts` |
| 15 | 将现有 `generateSingleImage()` 逻辑迁移到 `geminiAdapter` | `src/lib/image-gen-adapters/gemini.ts`（新建） |
| 16 | 创建统一入口 `generateImage()` + `getAdapter()` 路由 | `src/lib/image-generator.ts` |
| 17 | 更新 handler：先解析 provider，再传入 `generateImage()` | `src/lib/tools/image-gen-tool.ts` |
| 18 | 新增 OpenAI (DALL·E) adapter | `src/lib/image-gen-adapters/openai.ts`（新建） |

### Phase 5：批量生成优化（可选）

| 步骤 | 改动 |
|------|------|
| 19 | 追加 `batch_generate_images` Tool（接收 items 数组） |
| 20 | handler 复用 `job-executor.ts` 的并发控制逻辑 |

### Phase 6：UX 增强（可选）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 21 | 加载态骨架屏（按 aspect_ratio 显示占位 + 计时器） | `StreamingMessage.tsx` 或新组件 |
| 22 | 错误态「前往配置」跳转按钮 | 新组件 |
| 23 | ImageGenCard「继续编辑」按钮 | `ImageGenCard.tsx` |
| 24 | Gallery ↔ 对话互相跳转链接 | `ImageGenCard.tsx` + Gallery 详情页 |

### Phase 7：用量统计（可选）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 25 | 新增 `usage_records` 表 + `recordUsage()` 函数 | `src/lib/db/schema.ts` + `src/lib/db/usage.ts`（新建） |
| 26 | handler 成功后写入用量记录 | `src/lib/tools/image-gen-tool.ts` |
| 27 | `UsageStatsSection` 增加图片生成分组展示 | `src/components/settings/UsageStatsSection.tsx` |

---

## 七、风险与应对

### 7.1 Zod 版本兼容

**风险**：SDK 的 `SdkMcpToolDefinition` 注释写明"Supports both Zod 3 and Zod 4 schemas"，但需确认项目当前使用的 Zod 版本是否兼容。

**应对**：检查 `package.json` 中 `zod` 版本。如果不兼容，SDK 也导出了 `tool()` helper 函数处理适配。

### 7.2 图片在对话中的显示

**问题**：tool_result 包含文件路径，客户端需转为可访问 URL。

**方案**：使用现有的 `/api/files/raw?path=` 端点。路径是服务端本地绝对路径，通过 API 中转读取，不返回 base64（太大）。

### 7.3 Reference Images 传递

**问题**：编辑/垫图场景，用户上传的图片或上一次生成的图片如何传给 Tool。

**方案**：
- 用户上传的图片：已保存到 `.lumos-uploads/`，有 filePath。`buildFinalPrompt()` 中已将路径以 `[User attached image: /path]` 格式写入 prompt，Claude 可从对话上下文获取
- 上次生成的图片：上次 `tool_result` 中返回了路径，Claude 从对话历史中引用，传入 `reference_image_paths`

### 7.4 向后兼容

**问题**：已有对话历史中包含 `image-gen-request` 代码块。

**方案**：
- Phase 3 清理时保留 `MessageItem.tsx` 中对旧格式的**只读渲染**能力（仅展示，不触发生成）
- 新消息走 tool_use/tool_result，旧消息走旧渲染器
- 后续版本迭代中逐步移除旧渲染器

### 7.5 `canUseTool` 权限

**问题**：in-process MCP tool 默认走 `canUseTool` 权限检查。在 `acceptEdits` 权限模式下，MCP tool 调用可能弹出用户确认。

**方案**：在 `canUseTool` 回调中自动放行 `mcp__lumos-image__` 前缀的 tool（与现有 `mcp__feishu__` 自动放行逻辑一致）：

```typescript
if (toolName.startsWith('mcp__lumos-image__')) {
  return { behavior: 'allow' as const, updatedInput: input };
}
```

### 7.6 多 Provider 参数差异

**风险**：不同图片生成 Provider 的参数映射不一致：
- Gemini：aspect_ratio 直接支持 "16:9" 等字符串
- DALL·E：size 参数为 "1024x1024" / "1792x1024" 等像素值，不支持所有比例
- 部分 Provider 不支持 reference images（编辑/垫图）

**应对**：
- 每个 adapter 内部做参数映射（`mapAspectRatioToSize()`）
- 不支持的参数组合返回明确错误（如"当前服务不支持图片编辑，请切换到 Gemini"）
- 系统提示中不暴露 Provider 差异，由 handler 的错误信息引导

### 7.7 安全阀绕过

**风险**：用户可能通过快速开启多个对话来绕过单次对话 10 张的限制。

**应对**：
- Phase 1 只做单会话限制，风险可接受（每次对话是有意的用户行为）
- Phase 7 如果发现滥用模式，可增加日维度全局上限（如每日 100 张）
- 不做硬性阻断，而是通过 Claude 的自然语言引导让用户意识到成本

### 7.8 客户端 tool_use 渲染能力

**风险**：方案假设客户端 streaming 已能识别 `tool_use` 类型的 content block 并渲染。但当前 `StreamingMessage.tsx` 可能只处理了 `text` 类型的 content block。如果不支持，Phase 1 步骤 6 的工作量会从"在已有框架上加一个渲染分支"变为"从零搭建 tool_use block 的识别、状态管理和渲染流程"。

**应对**：Phase 0 前置验证。用已有 MCP tool（如 feishu）触发一次 tool_use，观察客户端行为。根据结果评估 Phase 1 实际工作量。

---

## 八、对比总结

| 维度 | 现状（外部 MCP + Legacy Block） | 改造后（In-Process MCP Tool） |
|------|-------------------------------|---------------------------|
| 链路 | 2 条并行、6+ 文件 | 1 条，3 个核心文件 |
| 进程 | 需启动外部 Node 进程 | 同进程内，零开销 |
| Provider | MCP env 注入绕行 | 直接读 Provider 配置 |
| 工作流 | 不可用 | stage-worker 注入同一 server |
| 权限 | MCP 默认需确认 | 自动放行（同 feishu） |
| 用户体验 | Legacy Block 需确认按钮 | Claude 直接调用，无中断 |
| 批量 | client 解析 batch-plan | Claude 多次 tool_use |
| 超时 | MCP 进程各自处理 | 统一设置 360s |
| 错误体验 | Provider 未配置时静默失败 | Claude 主动引导用户去设置 |
| 可维护性 | 代码分散，两套提示词 | 集中，一个 server 文件 |
