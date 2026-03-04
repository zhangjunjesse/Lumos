# ContentPanel统一容器实施报告

**日期**: 2026-03-03
**任务**: Task #13 - 实现：ContentPanel统一容器（混合渲染）
**状态**: 基础实现完成

---

## 已完成的工作

### 1. Zustand Store
**文件**: `src/stores/content-panel.ts`
- 实现了标签状态管理
- 支持添加、删除、切换、更新标签
- 支持标签重排序
- 使用 persist middleware 实现状态持久化

### 2. ContentPanel 容器
**文件**: `src/components/layout/ContentPanel.tsx`
- 统一的内容展示容器
- 支持多标签管理
- 空状态提示

### 3. TabBar 标签栏
**文件**: `src/components/layout/TabBar.tsx`
- 标签列表展示
- 标签切换
- 标签关闭
- 添加标签按钮（待实现菜单）

### 4. ContentRenderer 内容渲染器
**文件**: `src/components/layout/ContentRenderer.tsx`
- 根据标签类型动态渲染内容
- 支持文件树、飞书文档、设置等类型
- 预留知识库、插件管理扩展

---

## 架构设计

```
┌─────────────────────────────────────────┐
│         ContentPanel (统一容器)          │
│  ┌───────────────────────────────────┐  │
│  │  TabBar (标签栏)                   │  │
│  │  [文件] [文档] [设置] [+]          │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  ContentRenderer (内容渲染器)      │  │
│  │  - FileTree                       │  │
│  │  - FeishuPanel                    │  │
│  │  - Settings                       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## 支持的标签类型

1. **file-tree** - 文件树（已集成）
2. **feishu-doc** - 飞书文档（已集成）
3. **settings** - 设置（占位符）
4. **knowledge** - 知识库（占位符）
5. **plugins** - 插件管理（占位符）

---

## 待完成的工作

### 1. 添加标签菜单
- 实现添加标签的下拉菜单
- 列出所有可用的标签类型
- 点击后创建对应类型的标签

### 2. 快捷键支持
- `Cmd+1` ~ `Cmd+9` - 切换到第 N 个标签
- `Cmd+W` - 关闭当前标签
- `Cmd+T` - 新建标签

### 3. 拖拽排序
- 使用 @dnd-kit/core 实现标签拖拽
- 支持标签重新排序

### 4. 集成到主布局
- 替换现有的 RightPanel 组件
- 迁移文件树功能到 ContentPanel
- 迁移飞书文档功能到 ContentPanel

### 5. 性能优化
- 标签内容懒加载
- 虚拟滚动（标签过多时）
- 内存优化

### 6. 用户体验优化
- 标签关闭确认（如有未保存内容）
- 标签拖拽视觉反馈
- 标签切换动画

---

## 使用示例

```typescript
import { useContentPanelStore } from '@/stores/content-panel';

function MyComponent() {
  const { addTab } = useContentPanelStore();

  const handleOpenFileTree = () => {
    addTab({
      type: 'file-tree',
      title: 'Files',
      icon: '📁',
      closable: true,
    });
  };

  const handleOpenSettings = () => {
    addTab({
      type: 'settings',
      title: 'Settings',
      icon: '⚙️',
      closable: true,
    });
  };

  return (
    <div>
      <button onClick={handleOpenFileTree}>Open Files</button>
      <button onClick={handleOpenSettings}>Open Settings</button>
    </div>
  );
}
```

---

## 测试计划

### 单元测试
- [ ] Zustand Store 测试
- [ ] TabBar 组件测试
- [ ] ContentRenderer 组件测试

### 集成测试
- [ ] 标签添加/删除测试
- [ ] 标签切换测试
- [ ] 状态持久化测试

### 用户体验测试
- [ ] 标签切换流畅度
- [ ] 标签关闭确认
- [ ] 快捷键功能

---

## 下一步

1. **实现添加标签菜单**
2. **集成到主布局**（替换 RightPanel）
3. **添加快捷键支持**
4. **实现拖拽排序**
5. **性能优化和用户体验优化**

---

**状态**: ✅ 基础实现完成
**下一步**: 集成到主布局并测试
