# Tab拖拽排序功能

## 功能说明

ContentPanel的TabBar现在支持拖拽排序功能，用户可以通过拖拽标签来调整标签的顺序。

## 实现细节

### 依赖库
- `@dnd-kit/core`: 核心拖拽功能
- `@dnd-kit/sortable`: 排序功能
- `@dnd-kit/utilities`: 工具函数

### 关键组件

#### 1. TabBar组件
- 使用`DndContext`包裹标签列表
- 使用`SortableContext`管理可排序项
- 实现`handleDragEnd`处理拖拽结束事件

#### 2. SortableTabItem组件
- 使用`useSortable` hook获取拖拽状态和属性
- 支持鼠标和键盘拖拽
- 拖拽时显示半透明效果

### 拖拽触发条件
- 鼠标拖拽：移动8px后触发（避免误触）
- 键盘拖拽：使用方向键移动标签

### 视觉反馈
- 拖拽时：标签透明度降为50%，z-index提升
- 鼠标样式：`cursor-grab`（未拖拽）→ `cursor-grabbing`（拖拽中）

## 使用方法

1. 鼠标拖拽：点击并按住标签，拖动到目标位置后释放
2. 键盘拖拽：
   - Tab键选中标签
   - 使用方向键移动标签位置
   - Enter键确认位置

## 状态管理

拖拽排序通过`useContentPanelStore`的`reorderTabs`方法更新标签顺序：

```typescript
reorderTabs: (tabIds: string[]) => {
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
}
```

## 注意事项

1. 拖拽功能不影响标签的关闭和选中操作
2. 标签顺序会持久化到localStorage（通过Zustand persist中间件）
3. 所有标签类型都支持拖拽排序
