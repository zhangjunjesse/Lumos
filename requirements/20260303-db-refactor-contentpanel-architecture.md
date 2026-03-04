# 架构设计文档：数据库IPC通信与ContentPanel组件架构

**文档版本**: 1.0
**创建日期**: 2026-03-03
**负责人**: Architect
**项目**: Lumos 文档智能助手

---

## 1. 总体架构

### 1.1 架构原则

1. **进程隔离**: Main Process 负责数据访问，Renderer Process 负责 UI 展示
2. **类型安全**: 所有 IPC 接口使用 TypeScript 严格类型定义
3. **性能优先**: 批量操作、缓存策略、异步处理
4. **可扩展性**: 模块化设计，易于添加新功能
5. **向后兼容**: 保持现有 API 接口不变，内部实现替换

### 1.2 技术选型

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| IPC 通信 | Electron IPC (ipcMain/ipcRenderer) | 官方推荐，类型安全 |
| 状态管理 | Zustand | 轻量级，TypeScript 友好 |
| 类型校验 | Zod | 运行时类型校验，防止 IPC 数据异常 |
| 数据库 | better-sqlite3 | 现有技术栈，性能优秀 |
| 标签管理 | React Context + Zustand | 简单场景用 Context，复杂场景用 Zustand |

---

## 2. 数据库IPC通信架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (Next.js)               │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API Routes (/api/sessions, /api/providers, etc.)   │  │
│  │  - 保持现有接口不变                                   │  │
│  │  - 内部调用 IPC Client                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  IPC Client (src/lib/ipc/client.ts)                 │  │
│  │  - 封装 ipcRenderer.invoke                           │  │
│  │  - 类型安全的调用接口                                 │  │
│  │  - 错误处理和重试                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓ IPC                             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Electron)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  IPC Handlers (electron/ipc/handlers.ts)            │  │
│  │  - ipcMain.handle 注册                               │  │
│  │  - 参数校验 (Zod)                                    │  │
│  │  - 调用 Database Service                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Database Service (electron/db/service.ts)          │  │
│  │  - 业务逻辑层                                         │  │
│  │  - 事务管理                                           │  │
│  │  - 缓存策略                                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Database Layer (electron/db/*.ts)                  │  │
│  │  - better-sqlite3 封装                               │  │
│  │  - SQL 查询                                           │  │
│  │  - 数据库连接管理                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 IPC 接口设计

#### 2.2.1 接口命名规范

```
db:{resource}:{action}
```

示例:
- `db:sessions:list` - 获取会话列表
- `db:sessions:get` - 获取单个会话
- `db:sessions:create` - 创建会话
- `db:sessions:update` - 更新会话
- `db:sessions:delete` - 删除会话

#### 2.2.2 类型定义

**文件**: `src/types/ipc.ts`

```typescript
// IPC 请求/响应基础类型
export interface IpcRequest<T = unknown> {
  data: T;
  requestId?: string; // 用于日志追踪
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// 会话相关类型
export interface SessionListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionGetRequest {
  id: string;
}

export interface SessionCreateRequest {
  name: string;
  provider_id?: string;
  working_directory?: string;
}

export interface SessionUpdateRequest {
  id: string;
  name?: string;
  provider_id?: string;
  working_directory?: string;
}

export interface SessionDeleteRequest {
  id: string;
}

// ... 其他资源类型定义
```

#### 2.2.3 IPC Client 实现

**文件**: `src/lib/ipc/client.ts`

```typescript
import { ipcRenderer } from 'electron';
import type { IpcResponse } from '@/types/ipc';

class IpcClient {
  private async invoke<T, R>(
    channel: string,
    data: T,
    options?: { timeout?: number; retry?: number }
  ): Promise<R> {
    const requestId = crypto.randomUUID();
    const timeout = options?.timeout ?? 5000;
    const retry = options?.retry ?? 0;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const response = await Promise.race([
          ipcRenderer.invoke(channel, { data, requestId }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('IPC timeout')), timeout)
          ),
        ]) as IpcResponse<R>;

        if (!response.success) {
          throw new Error(response.error?.message ?? 'IPC call failed');
        }

        return response.data!;
      } catch (error) {
        lastError = error as Error;
        if (attempt < retry) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }

  // Sessions
  async listSessions(params: SessionListRequest): Promise<SessionListResponse> {
    return this.invoke('db:sessions:list', params);
  }

  async getSession(id: string): Promise<Session> {
    return this.invoke('db:sessions:get', { id });
  }

  async createSession(params: SessionCreateRequest): Promise<Session> {
    return this.invoke('db:sessions:create', params);
  }

  async updateSession(params: SessionUpdateRequest): Promise<Session> {
    return this.invoke('db:sessions:update', params);
  }

  async deleteSession(id: string): Promise<void> {
    return this.invoke('db:sessions:delete', { id });
  }

  // ... 其他资源方法
}

export const ipcClient = new IpcClient();
```

#### 2.2.4 IPC Handlers 实现

**文件**: `electron/ipc/handlers.ts`

```typescript
import { ipcMain } from 'electron';
import { z } from 'zod';
import { databaseService } from '../db/service';
import type { IpcRequest, IpcResponse } from '../../src/types/ipc';

// Zod schemas for validation
const SessionListSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(['created_at', 'updated_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const SessionGetSchema = z.object({
  id: z.string().uuid(),
});

const SessionCreateSchema = z.object({
  name: z.string().min(1),
  provider_id: z.string().uuid().optional(),
  working_directory: z.string().optional(),
});

// Helper function to wrap handlers
function createHandler<TReq, TRes>(
  schema: z.ZodSchema<TReq>,
  handler: (data: TReq) => Promise<TRes>
) {
  return async (
    _event: Electron.IpcMainInvokeEvent,
    request: IpcRequest<TReq>
  ): Promise<IpcResponse<TRes>> => {
    try {
      // Validate request
      const validatedData = schema.parse(request.data);

      // Execute handler
      const result = await handler(validatedData);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[IPC Handler Error]', error);

      return {
        success: false,
        error: {
          code: error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error instanceof z.ZodError ? error.errors : undefined,
        },
      };
    }
  };
}

// Register handlers
export function registerIpcHandlers() {
  // Sessions
  ipcMain.handle(
    'db:sessions:list',
    createHandler(SessionListSchema, databaseService.listSessions)
  );

  ipcMain.handle(
    'db:sessions:get',
    createHandler(SessionGetSchema, databaseService.getSession)
  );

  ipcMain.handle(
    'db:sessions:create',
    createHandler(SessionCreateSchema, databaseService.createSession)
  );

  // ... 其他 handlers

  console.log('[IPC] Handlers registered');
}
```

#### 2.2.5 Database Service 实现

**文件**: `electron/db/service.ts`

```typescript
import { getDb } from './connection';
import type { Session, SessionListRequest, SessionCreateRequest } from '../../src/types/ipc';

class DatabaseService {
  // Sessions
  async listSessions(params: SessionListRequest): Promise<{ sessions: Session[]; total: number }> {
    const db = getDb();
    const { limit = 50, offset = 0, sortBy = 'updated_at', sortOrder = 'desc' } = params;

    const sessions = db
      .prepare(
        `SELECT * FROM sessions
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Session[];

    const total = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };

    return { sessions, total: total.count };
  }

  async getSession(params: { id: string }): Promise<Session> {
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(params.id) as Session | undefined;

    if (!session) {
      throw new Error(`Session not found: ${params.id}`);
    }

    return session;
  }

  async createSession(params: SessionCreateRequest): Promise<Session> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sessions (id, name, provider_id, working_directory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, params.name, params.provider_id ?? null, params.working_directory ?? null, now, now);

    return this.getSession({ id });
  }

  // ... 其他方法
}

export const databaseService = new DatabaseService();
```

### 2.3 迁移策略

#### 2.3.1 渐进式迁移

1. **Phase 1**: 创建 IPC 基础设施（Client、Handlers、Service）
2. **Phase 2**: 迁移 Sessions 相关操作（作为试点）
3. **Phase 3**: 迁移其他资源（Providers、MCP Servers、Skills 等）
4. **Phase 4**: 移除 Renderer Process 中的数据库依赖

#### 2.3.2 兼容性保证

- API Routes 保持不变，只替换内部实现
- 数据库 schema 不变
- 现有功能完全兼容

#### 2.3.3 回滚方案

- 保留原有数据库访问代码（标记为 deprecated）
- 通过环境变量控制是否启用 IPC 模式
- 发现问题可快速回滚到直接访问模式

### 2.4 性能优化

#### 2.4.1 批量操作

```typescript
// 批量创建会话
async batchCreateSessions(sessions: SessionCreateRequest[]): Promise<Session[]> {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO sessions (id, name, provider_id, working_directory, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction((sessions: SessionCreateRequest[]) => {
    const results: Session[] = [];
    for (const session of sessions) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      stmt.run(id, session.name, session.provider_id ?? null, session.working_directory ?? null, now, now);
      results.push({ id, ...session, created_at: now, updated_at: now } as Session);
    }
    return results;
  });

  return transaction(sessions);
}
```

#### 2.4.2 缓存策略

```typescript
class DatabaseService {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }
    return cached.data as T;
  }

  private setCache(key: string, data: unknown, ttl: number = 5000) {
    this.cache.set(key, { data, expiry: Date.now() + ttl });
  }

  async getSession(params: { id: string }): Promise<Session> {
    const cacheKey = `session:${params.id}`;
    const cached = this.getCached<Session>(cacheKey);
    if (cached) return cached;

    const session = await this.fetchSession(params.id);
    this.setCache(cacheKey, session);
    return session;
  }
}
```

---

## 3. ContentPanel 组件架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      ContentPanel                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  TabBar (标签栏)                                      │  │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                        │  │
│  │  │文件│ │文档│ │设置│ │ + │                         │  │
│  │  └────┘ └────┘ └────┘ └────┘                        │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ContentRenderer (内容渲染器)                         │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  根据当前激活标签渲染对应组件                  │    │  │
│  │  │  - FileTree (文件树)                          │    │  │
│  │  │  - FeishuDoc (飞书文档)                       │    │  │
│  │  │  - Settings (设置)                            │    │  │
│  │  │  - Knowledge (知识库)                         │    │  │
│  │  │  - Plugins (插件管理)                         │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据结构设计

#### 3.2.1 Tab 类型定义

**文件**: `src/types/content-panel.ts`

```typescript
export type TabType = 'file-tree' | 'feishu-doc' | 'settings' | 'knowledge' | 'plugins';

export interface Tab {
  id: string; // UUID
  type: TabType;
  title: string;
  icon?: string; // Hugeicons icon name
  closable: boolean; // 是否可关闭
  data?: unknown; // 标签特定数据（如文档 ID）
  order: number; // 排序
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}

// 标签特定数据类型
export interface FileTreeTabData {
  workingDirectory: string;
  expandedPaths: string[];
}

export interface FeishuDocTabData {
  docId: string;
  docTitle: string;
  docUrl: string;
}

export interface SettingsTabData {
  section?: 'general' | 'providers' | 'plugins' | 'skills';
}
```

#### 3.2.2 状态管理

**文件**: `src/stores/content-panel.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tab, TabState } from '@/types/content-panel';

interface ContentPanelStore extends TabState {
  // Actions
  addTab: (tab: Omit<Tab, 'id' | 'order'>) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  reorderTabs: (tabIds: string[]) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
}

export const useContentPanelStore = create<ContentPanelStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      addTab: (tab) => {
        const id = crypto.randomUUID();
        const order = get().tabs.length;
        const newTab: Tab = { ...tab, id, order };

        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
      },

      removeTab: (tabId) => {
        set((state) => {
          const tabs = state.tabs.filter((t) => t.id !== tabId);
          let activeTabId = state.activeTabId;

          // 如果关闭的是当前激活标签，激活相邻标签
          if (activeTabId === tabId) {
            const index = state.tabs.findIndex((t) => t.id === tabId);
            if (tabs.length > 0) {
              activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
            } else {
              activeTabId = null;
            }
          }

          return { tabs, activeTabId };
        });
      },

      setActiveTab: (tabId) => {
        set({ activeTabId: tabId });
      },

      updateTab: (tabId, updates) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
        }));
      },

      reorderTabs: (tabIds) => {
        set((state) => {
          const tabMap = new Map(state.tabs.map((t) => [t.id, t]));
          const tabs = tabIds
            .map((id, index) => {
              const tab = tabMap.get(id);
              return tab ? { ...tab, order: index } : null;
            })
            .filter((t): t is Tab => t !== null);

          return { tabs };
        });
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTabId: null });
      },

      closeOtherTabs: (tabId) => {
        set((state) => ({
          tabs: state.tabs.filter((t) => t.id === tabId),
          activeTabId: tabId,
        }));
      },
    }),
    {
      name: 'content-panel-storage',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
```

### 3.3 组件设计

#### 3.3.1 ContentPanel 容器

**文件**: `src/components/layout/ContentPanel.tsx`

```typescript
"use client";

import { useContentPanelStore } from '@/stores/content-panel';
import { TabBar } from './TabBar';
import { ContentRenderer } from './ContentRenderer';

interface ContentPanelProps {
  width?: number;
}

export function ContentPanel({ width = 288 }: ContentPanelProps) {
  const { tabs, activeTabId } = useContentPanelStore();

  if (tabs.length === 0) {
    return <EmptyState />;
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-background"
      style={{ width }}
    >
      <TabBar />
      <ContentRenderer />
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center">
      <div className="text-sm text-muted-foreground">
        <p>No content to display</p>
        <p className="mt-2">Click + to add a tab</p>
      </div>
    </div>
  );
}
```

#### 3.3.2 TabBar 标签栏

**文件**: `src/components/layout/TabBar.tsx`

```typescript
"use client";

import { useContentPanelStore } from '@/stores/content-panel';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Add01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useContentPanelStore();

  const handleAddTab = () => {
    // 显示添加标签菜单
    // TODO: 实现菜单逻辑
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      {/* 标签列表 */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => removeTab(tab.id)}
          />
        ))}
      </div>

      {/* 添加按钮 */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleAddTab}
        className="shrink-0"
      >
        <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function TabItem({ tab, active, onSelect, onClose }: TabItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded px-2 py-1 text-xs cursor-pointer',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
      onClick={onSelect}
    >
      {tab.icon && <HugeiconsIcon icon={tab.icon} className="h-3 w-3" />}
      <span className="truncate">{tab.title}</span>
      {tab.closable && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
```


#### 3.3.3 ContentRenderer 内容渲染器

**文件**: `src/components/layout/ContentRenderer.tsx`

```typescript
"use client";

import { useContentPanelStore } from '@/stores/content-panel';
import { FileTree } from '@/components/project/FileTree';
import { FeishuDocViewer } from '@/components/feishu/FeishuDocViewer';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import type { Tab } from '@/types/content-panel';

export function ContentRenderer() {
  const { tabs, activeTabId } = useContentPanelStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  return (
    <div className="flex-1 overflow-hidden">
      {renderContent(activeTab)}
    </div>
  );
}

function renderContent(tab: Tab) {
  switch (tab.type) {
    case 'file-tree':
      return <FileTree data={tab.data} />;

    case 'feishu-doc':
      return <FeishuDocViewer data={tab.data} />;

    case 'settings':
      return <SettingsPanel data={tab.data} />;

    case 'knowledge':
      return <div>Knowledge (Coming Soon)</div>;

    case 'plugins':
      return <div>Plugins (Coming Soon)</div>;

    default:
      return <div>Unknown tab type: {tab.type}</div>;
  }
}
```

### 3.4 内容类型扩展

#### 3.4.1 注册新内容类型

```typescript
// src/lib/content-panel-registry.ts

export interface ContentTypeDefinition {
  type: TabType;
  title: string;
  icon: string;
  component: React.ComponentType<{ data?: unknown }>;
  defaultData?: unknown;
}

const contentTypes = new Map<TabType, ContentTypeDefinition>();

export function registerContentType(definition: ContentTypeDefinition) {
  contentTypes.set(definition.type, definition);
}

export function getContentType(type: TabType): ContentTypeDefinition | undefined {
  return contentTypes.get(type);
}

// 注册内置类型
registerContentType({
  type: 'file-tree',
  title: 'Files',
  icon: 'StructureFolderIcon',
  component: FileTree,
});

registerContentType({
  type: 'feishu-doc',
  title: 'Feishu Document',
  icon: 'FileDocumentIcon',
  component: FeishuDocViewer,
});

registerContentType({
  type: 'settings',
  title: 'Settings',
  icon: 'Settings01Icon',
  component: SettingsPanel,
});
```

### 3.5 交互设计

#### 3.5.1 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+1` ~ `Cmd+9` | 切换到第 N 个标签 |
| `Cmd+W` | 关闭当前标签 |
| `Cmd+Shift+W` | 关闭所有标签 |
| `Cmd+T` | 新建标签 |
| `Cmd+Tab` | 切换到下一个标签 |
| `Cmd+Shift+Tab` | 切换到上一个标签 |

#### 3.5.2 拖拽排序

使用 `@dnd-kit/core` 实现标签拖拽排序:

```typescript
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

export function TabBar() {
  const { tabs, reorderTabs } = useContentPanelStore();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      const newOrder = arrayMove(tabs, oldIndex, newIndex).map((t) => t.id);
      reorderTabs(newOrder);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        {/* 标签列表 */}
      </SortableContext>
    </DndContext>
  );
}
```

### 3.6 性能优化

#### 3.6.1 内容懒加载

```typescript
import { lazy, Suspense } from 'react';

const FileTree = lazy(() => import('@/components/project/FileTree'));
const FeishuDocViewer = lazy(() => import('@/components/feishu/FeishuDocViewer'));
const SettingsPanel = lazy(() => import('@/components/settings/SettingsPanel'));

function renderContent(tab: Tab) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      {/* 渲染逻辑 */}
    </Suspense>
  );
}
```

#### 3.6.2 虚拟滚动

对于大量标签，使用虚拟滚动优化性能:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export function TabBar() {
  const parentRef = useRef<HTMLDivElement>(null);
  const { tabs } = useContentPanelStore();

  const virtualizer = useVirtualizer({
    count: tabs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // 每个标签宽度
    horizontal: true,
  });

  return (
    <div ref={parentRef} className="overflow-x-auto">
      <div style={{ width: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const tab = tabs[virtualItem.index];
          return (
            <div
              key={tab.id}
              style={{
                position: 'absolute',
                left: 0,
                transform: `translateX(${virtualItem.start}px)`,
              }}
            >
              <TabItem tab={tab} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 4. 数据流设计

### 4.1 数据库操作流程

```
User Action (UI)
    ↓
API Route (/api/sessions)
    ↓
IPC Client (ipcClient.listSessions)
    ↓
IPC Channel (db:sessions:list)
    ↓
IPC Handler (validate + call service)
    ↓
Database Service (business logic)
    ↓
Database Layer (SQL query)
    ↓
Response (IPC → API → UI)
```

### 4.2 ContentPanel 状态流程

```
User Action (点击标签)
    ↓
TabBar Component
    ↓
Zustand Store (setActiveTab)
    ↓
ContentRenderer (re-render)
    ↓
Render Active Tab Content
```

### 4.3 标签持久化流程

```
User Action (添加/删除标签)
    ↓
Zustand Store (addTab/removeTab)
    ↓
Persist Middleware (save to localStorage)
    ↓
App Restart
    ↓
Zustand Store (restore from localStorage)
    ↓
ContentPanel (render restored tabs)
```

---

## 5. 模块划分

### 5.1 数据库模块

```
electron/
├── db/
│   ├── connection.ts       # 数据库连接管理
│   ├── service.ts          # 业务逻辑层
│   ├── sessions.ts         # Sessions 数据访问
│   ├── providers.ts        # Providers 数据访问
│   ├── mcp-servers.ts      # MCP Servers 数据访问
│   └── skills.ts           # Skills 数据访问
├── ipc/
│   ├── handlers.ts         # IPC Handlers 注册
│   ├── schemas.ts          # Zod 校验 schemas
│   └── types.ts            # IPC 类型定义
└── main.ts                 # 主进程入口（注册 IPC）
```

### 5.2 Renderer 模块

```
src/
├── lib/
│   └── ipc/
│       ├── client.ts       # IPC Client 封装
│       └── types.ts        # IPC 类型定义（共享）
├── stores/
│   └── content-panel.ts    # ContentPanel 状态管理
├── types/
│   └── content-panel.ts    # ContentPanel 类型定义
├── components/
│   └── layout/
│       ├── ContentPanel.tsx    # 容器组件
│       ├── TabBar.tsx          # 标签栏
│       ├── ContentRenderer.tsx # 内容渲染器
│       └── TabItem.tsx         # 标签项
└── app/
    └── api/                # API Routes（调用 IPC Client）
```

---

## 6. 接口定义

### 6.1 IPC 接口清单

#### Sessions
- `db:sessions:list` - 获取会话列表
- `db:sessions:get` - 获取单个会话
- `db:sessions:create` - 创建会话
- `db:sessions:update` - 更新会话
- `db:sessions:delete` - 删除会话

#### Providers
- `db:providers:list` - 获取 Provider 列表
- `db:providers:get` - 获取单个 Provider
- `db:providers:create` - 创建 Provider
- `db:providers:update` - 更新 Provider
- `db:providers:delete` - 删除 Provider

#### MCP Servers
- `db:mcp-servers:list` - 获取 MCP Server 列表
- `db:mcp-servers:get` - 获取单个 MCP Server
- `db:mcp-servers:create` - 创建 MCP Server
- `db:mcp-servers:update` - 更新 MCP Server
- `db:mcp-servers:delete` - 删除 MCP Server
- `db:mcp-servers:toggle` - 启用/禁用 MCP Server

#### Skills
- `db:skills:list` - 获取 Skill 列表
- `db:skills:get` - 获取单个 Skill
- `db:skills:create` - 创建 Skill
- `db:skills:update` - 更新 Skill
- `db:skills:delete` - 删除 Skill
- `db:skills:toggle` - 启用/禁用 Skill

### 6.2 ContentPanel 接口

```typescript
// Zustand Store Actions
interface ContentPanelStore {
  // State
  tabs: Tab[];
  activeTabId: string | null;

  // Actions
  addTab: (tab: Omit<Tab, 'id' | 'order'>) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  reorderTabs: (tabIds: string[]) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
}
```

---

## 7. 技术选型理由

### 7.1 IPC 通信

**选择**: Electron IPC (ipcMain/ipcRenderer)

**理由**:
- 官方推荐，稳定可靠
- 类型安全（TypeScript 支持）
- 性能优秀（本地调用，延迟 < 10ms）
- 支持异步调用（Promise-based）

**替代方案**:
- ❌ HTTP Server: 增加复杂度，性能较差
- ❌ WebSocket: 过度设计，不适合本地通信

### 7.2 状态管理

**选择**: Zustand

**理由**:
- 轻量级（< 1KB gzipped）
- TypeScript 友好
- 简单易用，学习成本低
- 支持持久化（persist middleware）
- 性能优秀（基于 React hooks）

**替代方案**:
- ❌ Redux: 过于复杂，boilerplate 多
- ❌ MobX: 学习成本高，不够轻量
- ✅ React Context: 简单场景可用，但缺少持久化和 devtools

### 7.3 类型校验

**选择**: Zod

**理由**:
- 运行时类型校验，防止 IPC 数据异常
- TypeScript 类型推导
- 错误信息友好
- 生态丰富（与 React Hook Form 等集成）

**替代方案**:
- ❌ io-ts: 学习成本高，API 复杂
- ❌ Yup: 主要用于表单校验，不适合 IPC

### 7.4 拖拽排序

**选择**: @dnd-kit/core

**理由**:
- 现代化，基于 React hooks
- 性能优秀（使用 CSS transforms）
- 无障碍支持（ARIA）
- 灵活可扩展

**替代方案**:
- ❌ react-beautiful-dnd: 不再维护
- ❌ react-dnd: API 复杂，学习成本高

---

## 8. 风险与挑战

### 8.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| IPC 性能问题 | 高 | 中 | 批量操作、缓存、性能测试 |
| 数据迁移失败 | 高 | 低 | 自动备份、回滚机制 |
| 类型不匹配 | 中 | 中 | Zod 运行时校验 |
| 状态管理复杂 | 中 | 低 | 使用成熟库（Zustand） |

### 8.2 实施挑战

1. **渐进式迁移**: 需要保持现有功能正常工作
2. **测试覆盖**: IPC 调用难以测试，需要 mock 机制
3. **性能优化**: 需要充分的性能测试和优化
4. **用户体验**: 标签管理需要符合用户习惯

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 所有数据库操作通过 IPC 调用
- [ ] 现有功能完全兼容
- [ ] ContentPanel 支持多标签管理
- [ ] 标签状态持久化
- [ ] 快捷键正常工作
- [ ] 拖拽排序正常工作

### 9.2 性能验收

- [ ] IPC 调用延迟 < 50ms
- [ ] 标签切换延迟 < 100ms
- [ ] 应用启动时间不增加超过 500ms
- [ ] 内存占用不增加超过 50MB

### 9.3 代码质量验收

- [ ] 单元测试覆盖率 > 80%
- [ ] 所有文件 < 300 行
- [ ] TypeScript 类型完整
- [ ] 无 ESLint 错误

---

## 10. 下一步

1. **实施 Phase 1**: 数据库 IPC 基础设施
2. **实施 Phase 2**: ContentPanel 核心组件
3. **实施 Phase 3**: 内容迁移
4. **实施 Phase 4**: 测试与优化

---

**文档状态**: ✅ 已完成
**下一步**: 开始实施
