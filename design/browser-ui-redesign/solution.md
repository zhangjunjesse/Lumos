# 浏览器 UI 优化方案

## 当前问题分析

### 代码层面
```tsx
// 当前布局：右侧固定 360px
<div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
  <section>浏览器区域</section>
  <aside>功能面板（Context/Workflows/Downloads）</aside>
</div>
```

**问题**：
1. 右侧固定 360px 压缩了浏览器工作区
2. 在小屏幕上体验更差
3. 功能面板始终占用空间，即使不需要

### 用户体验问题
1. **空间利用率低**：浏览器只占 60-70% 屏幕
2. **不符合习惯**：Chrome/Safari 都是全屏浏览
3. **功能不灵活**：无法隐藏功能面板

## 优化方案：Chrome 风格布局

### 布局结构
```
┌─────────────────────────────────────────────┐
│  顶部工具栏（地址栏 + Tab 栏 + 功能按钮）    │
├─────────────────────────────────────────────┤
│                                             │
│                                             │
│          浏览器全屏工作区                    │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│  底部状态栏（AI 活动 + 下载进度）            │
└─────────────────────────────────────────────┘

右侧抽屉（按需弹出）：
┌──────────────┐
│  Context     │
│  Workflows   │
│  Downloads   │
└──────────────┘
```

### 核心改动

#### 1. 移除固定右侧边栏
```tsx
// 优化后：全屏浏览器
<div className="flex h-full flex-col">
  {/* 顶部工具栏 */}
  <BrowserToolbar />

  {/* 浏览器全屏区域 */}
  <div className="flex-1 min-h-0">
    <BrowserView />
  </div>

  {/* 底部状态栏 */}
  <BrowserStatusBar />
</div>

{/* 右侧抽屉（按需显示） */}
<Sheet open={showPanel}>
  <SheetContent side="right" className="w-[400px]">
    <Tabs>
      <TabsList>Context / Workflows / Downloads</TabsList>
    </Tabs>
  </SheetContent>
</Sheet>
```

#### 2. 功能按钮触发面板
```tsx
// 工具栏右侧添加功能按钮
<div className="flex items-center gap-2">
  <Button onClick={() => setShowPanel('context')}>
    <History /> 上下文
  </Button>
  <Button onClick={() => setShowPanel('workflows')}>
    <Wand2 /> Workflows
  </Button>
  <Button onClick={() => setShowPanel('downloads')}>
    <Download /> 下载
  </Button>
</div>
```

#### 3. 底部状态栏显示关键信息
```tsx
<div className="flex items-center justify-between px-4 py-2 border-t">
  {/* AI 活动指示器 */}
  {aiActivity && <AIActivityBanner compact />}

  {/* 下载进度 */}
  {downloads.length > 0 && <DownloadProgress />}

  {/* 采集状态 */}
  <CaptureStatus />
</div>
```

## 实现步骤

### 第 1 步：重构布局结构
- 移除 `xl:grid-cols-[minmax(0,1fr)_360px]`
- 改为 `flex flex-col` 垂直布局
- 浏览器区域设置为 `flex-1`

### 第 2 步：添加右侧抽屉
- 使用 shadcn/ui 的 `Sheet` 组件
- 支持从右侧滑入/滑出
- 宽度设置为 400px（比原来的 360px 稍宽）

### 第 3 步：添加底部状态栏
- 固定在底部
- 显示 AI 活动、下载进度、采集状态
- 高度约 40-50px

### 第 4 步：优化工具栏
- 添加功能按钮（Context、Workflows、Downloads）
- 按钮带图标 + 文字
- 点击时打开对应的抽屉面板

## 视觉优化

### 极简风格
- 减少边框和阴影
- 使用更扁平的设计
- 统一圆角（8px）

### 配色
- 主色：保持当前的 Sky Blue
- 背景：纯白（亮色模式）/ 深灰（暗色模式）
- 边框：淡灰色，透明度 10-20%

### 动画
- 抽屉滑入/滑出：300ms ease-in-out
- 按钮悬停：100ms ease
- 状态切换：200ms ease

## 预期效果

### 空间利用
- 浏览器工作区：从 60-70% 提升到 95%+
- 功能面板：按需显示，不占用常驻空间

### 用户体验
- 更接近 Chrome 的使用习惯
- 操作更直观（点击按钮 → 打开面板）
- 视觉更简洁

### 性能
- 减少 DOM 节点（功能面板按需渲染）
- 减少重绘（浏览器区域不再频繁调整大小）
