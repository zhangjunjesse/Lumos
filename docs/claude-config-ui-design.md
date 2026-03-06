# Claude 配置页面 - UI 设计方案

## 设计概述

基于 UX 设计师的页面方案，本文档定义「Claude 配置」页面的视觉设计规范。

---

## 一、视觉风格

### 1.1 设计原则
- **简洁专业**：去除冗余元素，突出核心配置信息
- **层次清晰**：通过视觉权重区分主次信息
- **状态明确**：用颜色和图标清晰表达配置状态
- **响应友好**：适配不同屏幕尺寸

### 1.2 色彩系统
继承现有设计系统（`globals.css`）：

**主色调**
- Primary: `oklch(0.546 0.245 262.881)` - 紫蓝色，用于主要操作
- Muted: `oklch(0.97 0.001 106.424)` - 浅灰，用于次要背景
- Border: `oklch(0.923 0.003 48.717)` - 边框色

**状态色**
- Success: `oklch(0.6 0.118 184.704)` - 绿色，表示已配置/连接成功
- Warning: `oklch(0.828 0.189 84.429)` - 橙色，表示需要注意
- Destructive: `oklch(0.577 0.245 27.325)` - 红色，表示错误/删除操作

**暗色模式**
- 自动适配 `.dark` 类，使用 CSS 变量无需额外定义

---

## 二、布局设计

### 2.1 页面结构
```
┌─────────────────────────────────────────┐
│ Settings Header (固定)                   │
│ ├─ 标题: "设置"                          │
│ └─ 描述: "管理应用配置"                   │
├─────────────────────────────────────────┤
│ Sidebar (208px)  │  Content Area        │
│ ├─ General       │  ┌─────────────────┐ │
│ ├─ Claude 配置   │  │ 当前配置 (Card) │ │
│ ├─ Claude CLI    │  │                 │ │
│ └─ Usage         │  └─────────────────┘ │
│                  │  ┌─────────────────┐ │
│                  │  │ API 密钥 (Card) │ │
│                  │  │                 │ │
│                  │  └─────────────────┘ │
└─────────────────────────────────────────┘
```

### 2.2 响应式断点
- **Desktop**: > 1024px - 完整布局
- **Tablet**: 768px - 1024px - 侧边栏收窄至 180px
- **Mobile**: < 768px - 侧边栏折叠为顶部 Tab

---

## 三、组件选择

### 3.1 shadcn/ui 组件映射

| 功能 | 组件 | 用途 |
|------|------|------|
| 配置卡片 | `Card` | 包裹当前配置和 API 密钥表单 |
| 状态指示 | `Badge` | 显示"已配置"/"未配置"状态 |
| 输入框 | `Input` | API Key 输入（type="password"） |
| 按钮 | `Button` | 主要操作（保存/测试连接） |
| 开关 | `Switch` | 切换"使用自定义 API Key" |
| 折叠面板 | `Collapsible` | 展开/收起 API 密钥表单 |
| 加载状态 | `Spinner` | 测试连接时的加载动画 |
| 提示信息 | `Alert` | 显示错误/成功消息 |

### 3.2 图标系统
使用 `@hugeicons/react`：
- `Settings2` - 设置图标
- `CheckCircle` - 成功状态
- `AlertCircle` - 警告状态
- `Loading` - 加载动画
- `Eye` / `EyeOff` - 显示/隐藏密钥

---

## 四、核心界面设计

### 4.1 当前配置卡片

**视觉层级**
```
┌─────────────────────────────────────────┐
│ 当前配置                    [Badge: 已配置] │ ← Level 1 标题
├─────────────────────────────────────────┤
│ [Icon] Claude Official API               │ ← 配置名称 (font-medium)
│        https://api.anthropic.com         │ ← Base URL (text-xs, muted)
│                                          │
│ 模型: claude-opus-4-6                    │ ← 模型信息 (text-sm)
│ 状态: ● 连接正常                         │ ← 状态指示 (绿点 + 文字)
└─────────────────────────────────────────┘
```

**样式规范**
- 卡片: `rounded-lg border border-border/50 p-4`
- 标题: `text-sm font-medium`
- 描述: `text-xs text-muted-foreground`
- 状态点: `h-2 w-2 rounded-full bg-green-500`
- Hover: `hover:shadow-sm transition-shadow`

### 4.2 API 密钥管理卡片

**默认状态（折叠）**
```
┌─────────────────────────────────────────┐
│ API 密钥管理                             │
├─────────────────────────────────────────┤
│ 使用自定义 API Key          [Switch: Off] │
│ 默认使用 Claude Code 内置配置             │
└─────────────────────────────────────────┘
```

**展开状态**
```
┌─────────────────────────────────────────┐
│ API 密钥管理                             │
├─────────────────────────────────────────┤
│ 使用自定义 API Key          [Switch: On]  │
│                                          │
│ API Key                                  │
│ [●●●●●●●●●●●●●●●●●●●●]  [👁]            │ ← 密码输入框 + 显示按钮
│                                          │
│ Base URL (可选)                          │
│ [https://api.anthropic.com]              │
│                                          │
│ [测试连接]  [保存配置]                    │ ← 操作按钮
└─────────────────────────────────────────┘
```

**样式规范**
- Switch: 使用 shadcn/ui `Switch` 组件
- Input: `font-mono text-sm` (等宽字体显示密钥)
- Button:
  - 测试连接: `variant="outline"`
  - 保存配置: `variant="default"` (primary 色)
- 间距: 表单元素之间 `space-y-4`

### 4.3 状态反馈

**成功状态**
```
┌─────────────────────────────────────────┐
│ ✓ 连接成功！配置已保存                    │ ← Alert (success)
└─────────────────────────────────────────┘
```

**错误状态**
```
┌─────────────────────────────────────────┐
│ ✗ 连接失败: Invalid API Key              │ ← Alert (destructive)
└─────────────────────────────────────────┘
```

**加载状态**
```
[测试连接中... ⟳]  ← Button with spinner
```

---

## 五、交互细节

### 5.1 动画效果
- **卡片 Hover**: `transition-shadow duration-200`
- **折叠展开**: `transition-all duration-300 ease-in-out`
- **按钮点击**: `active:scale-95 transition-transform`
- **加载动画**: `animate-spin` (Hugeicons Loading)

### 5.2 焦点管理
- Switch 切换到 On 时，自动聚焦到 API Key 输入框
- 表单提交后，焦点返回到 Switch
- 使用 `autoFocus` 属性控制

### 5.3 键盘导航
- Tab 键顺序: Switch → API Key → Base URL → 测试连接 → 保存配置
- Enter 键: 在输入框中按 Enter 触发"保存配置"
- Esc 键: 关闭错误提示

---

## 六、文案规范

### 6.1 中英文对照

| 英文 | 中文 |
|------|------|
| Current Configuration | 当前配置 |
| API Key Management | API 密钥管理 |
| Use Custom API Key | 使用自定义 API Key |
| Test Connection | 测试连接 |
| Save Configuration | 保存配置 |
| Connection Successful | 连接成功 |
| Connection Failed | 连接失败 |
| Configured | 已配置 |
| Not Configured | 未配置 |

### 6.2 提示文案
- **默认状态**: "默认使用 Claude Code 内置配置"
- **输入提示**: "请输入 Anthropic API Key (sk-ant-...)"
- **Base URL 提示**: "留空使用官方 API (https://api.anthropic.com)"
- **成功提示**: "✓ 连接成功！配置已保存"
- **错误提示**: "✗ 连接失败: {错误原因}"

---

## 七、实现优先级

### P0 (核心功能)
1. 当前配置卡片 - 显示状态
2. API 密钥表单 - 输入和保存
3. 测试连接功能 - 验证 API Key

### P1 (体验优化)
4. 折叠/展开动画
5. 加载状态反馈
6. 错误提示样式

### P2 (增强功能)
7. 密钥显示/隐藏切换
8. Base URL 自定义
9. 响应式适配

---

## 八、设计资产

### 8.1 间距系统
- 卡片内边距: `p-4` (16px)
- 卡片间距: `space-y-6` (24px)
- 表单元素间距: `space-y-4` (16px)
- 标题与内容间距: `gap-2` (8px)

### 8.2 圆角系统
- 卡片: `rounded-lg` (12px)
- 按钮: `rounded-md` (6px)
- 输入框: `rounded-md` (6px)
- Badge: `rounded-full` (9999px)

### 8.3 阴影系统
- 默认: 无阴影
- Hover: `shadow-sm` (subtle shadow)
- Focus: `ring-2 ring-ring ring-offset-2`

---

## 九、可访问性

### 9.1 ARIA 标签
- Switch: `aria-label="使用自定义 API Key"`
- Input: `aria-label="API Key"`, `aria-describedby="api-key-hint"`
- Button: `aria-busy="true"` (加载时)

### 9.2 颜色对比度
- 文字与背景对比度 ≥ 4.5:1 (WCAG AA)
- 状态指示不仅依赖颜色，同时使用图标

### 9.3 键盘操作
- 所有交互元素可通过键盘访问
- 焦点状态清晰可见 (`ring-2`)

---

## 十、设计交付物

### 10.1 组件清单
- `ClaudeConfigSection.tsx` - 主容器组件
- `CurrentConfigCard.tsx` - 当前配置卡片
- `ApiKeyManagementCard.tsx` - API 密钥管理卡片

### 10.2 样式文件
- 复用 `globals.css` 中的设计 token
- 无需新增全局样式

### 10.3 图标资源
- 使用 `@hugeicons/react` 现有图标
- 使用 `@lobehub/icons` 的 Anthropic 品牌图标

---

## 附录：设计参考

### A1. 现有组件参考
- `GeneralSection.tsx` - 卡片布局和 Switch 交互
- `ProviderManager.tsx` - 表单输入和状态管理
- `Card` 组件 - 基础卡片样式

### A2. 设计系统文档
- Tailwind CSS 配置: `tailwind.config.ts`
- 全局样式: `src/app/globals.css`
- shadcn/ui 组件库: `src/components/ui/`
