# Lumos Mind 模块 - 视觉设计方案

## 设计目标

让 Lumos 成为有温度的伙伴，而非冷冰冰的工具。用户应该感受到界面的温暖、趣味和生命力。

---

## 一、视觉风格定位

### 核心关键词
- **温暖（Warm）** - 柔和的色彩，圆润的形状
- **有机（Organic）** - 自然的曲线，呼吸感的动效
- **亲切（Friendly）** - 可爱但不幼稚，专业但不冷淡
- **生命力（Alive）** - 微妙的动画，状态反馈

### 设计参考
- 宠物养成类应用的温暖感
- Notion 的友好简洁设计
- Duolingo 的趣味性交互

---

## 二、配色系统

### 主色调
```
核心品牌色：#7B8FFF（温暖的紫蓝色）
渐变：#8B7FFF → #6B9FFF
```

### 三大模块配色

**人格（Persona）- 温暖橙色系**
- 渐变：#FFB366 → #FF8A66
- 背景：#FFF5ED
- 边框：#FFD4B3
- 文字：#D97706

**身份（Identity）- 柔和紫色系**
- 渐变：#B794F6 → #9B7FE8
- 背景：#F5F0FF
- 边框：#D4C5F9
- 文字：#7C3AED

**用户记忆（User Memory）- 清新蓝绿系**
- 渐变：#66D9E8 → #5AB9FF
- 背景：#E8F9FC
- 边框：#B3E5F0
- 文字：#0891B2

---

## 三、关键界面元素

### 1. 模块入口卡片

**视觉特点**：
- 大圆角（16px）营造柔和感
- 渐变背景 + 半透明效果
- 悬停时轻微上浮（-4px）+ 放大（1.01）
- 顶部渐变条（hover 时显示）

**交互反馈**：
- 悬停：上浮 + 阴影加深
- 点击：轻微缩放反馈
- 加载：骨架屏闪烁

### 2. 人格卡片设计

**样式**：
- 背景：温暖橙色渐变
- 边框：2px 实线
- 图标：笑脸/心形/星星

**悬停效果**：
- 卡片放大 1.02
- 橙色发光阴影
- 图标轻微跳动

### 3. 身份卡片设计

**样式**：
- 背景：柔和紫色渐变
- 边框：2px 虚线（体现"可定制"）
- 图标：盾牌/徽章/钻石

**悬停效果**：
- 虚线变实线
- 渐变流动动画
- 紫色发光阴影

### 4. 用户记忆卡片设计

**样式**：
- 背景：清新蓝绿渐变
- 边框：1px 实线 + 内发光
- 图标：脑/书/灯泡

**悬停效果**：
- 波纹扩散动画
- 蓝绿发光阴影
- 图标呼吸效果

---

## 四、编辑状态视觉反馈

### 编辑模式激活
- 边框变为动态渐变流动（3s 循环）
- 背景添加微妙的斜纹网格
- 外围 4px 蓝色光晕
- 输入框柔和内阴影

### 保存成功
- 绿色光环从中心扩散（0.5s）
- 卡片短暂发光
- 轻微弹跳动画

### 错误状态
- 红色边框闪烁
- 左右摇晃动画（shake）
- 背景变淡红色（0.3s 过渡）

---

## 五、动效设计

### 微交互动画

**卡片悬停**：
```
transform: translateY(-4px) scale(1.01)
transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1)
```

**图标呼吸**：
```
2s 循环，透明度 0.6 → 1，缩放 1 → 1.1
```

**渐变流动**：
```
3s 循环，背景位置 0% → 200%
```

### 页面加载动画

**骨架屏**：
- 渐变闪烁（shimmer）
- 1.5s 循环
- 圆角与实际卡片一致

**内容进入**：
- 从下方滑入（translateY: 20px → 0）
- 透明度 0 → 1
- 交错延迟（0.1s、0.2s、0.3s）

---

## 六、设计规范（Design Tokens）

### 间距
```
xs: 4px   | sm: 8px   | md: 16px
lg: 24px  | xl: 32px  | 2xl: 48px
```

### 圆角
```
sm: 8px   | md: 12px  | lg: 16px
xl: 24px  | full: 9999px
```

### 阴影
```
sm: 0 2px 4px rgba(0,0,0,0.04)
md: 0 4px 12px rgba(0,0,0,0.08)
lg: 0 8px 24px rgba(0,0,0,0.12)
glow: 0 0 20px rgba(123,143,255,0.3)
```

### 字体
```
xs: 12px  | sm: 14px  | base: 16px
lg: 18px  | xl: 20px  | 2xl: 24px | 3xl: 32px

weight: 400 (normal) | 500 (medium) | 600 (semibold) | 700 (bold)
```

---

## 七、实现文件

### 已创建文件
1. **`src/styles/mind-theme.css`** - 完整的样式系统
2. **`src/components/mind/mind-card.tsx`** - 可复用卡片组件
3. **`src/components/mind/section-icon.tsx`** - 带动画的图标组件
4. **`src/lib/mind-animations.ts`** - Framer Motion 动画配置

### 使用示例

```tsx
import { MindCard } from '@/components/mind/mind-card';
import { SectionIcon } from '@/components/mind/section-icon';
import { Heart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

<MindCard
  variant="persona"
  state="normal"
  icon={<SectionIcon icon={Heart} variant="persona" />}
  title="人格设定"
  description="定义 Lumos 的性格与行为风格"
  badge={<Badge>3 条规则</Badge>}
>
  {/* 卡片内容 */}
</MindCard>
```

---

## 八、性能优化建议

### CSS 优化
- 使用 `will-change: transform` 优化动画
- 动画只使用 `transform` 和 `opacity`（GPU 加速）
- 渐变使用 `background-image` 而非多层 div

### 资源优化
- 懒加载插画资源
- SVG 图标内联（减少请求）
- 使用 CSS 动画而非 JS（性能更好）

---

## 九、暗色模式适配

所有颜色变量已定义暗色模式版本：
- 背景使用深色调（#1A1D23、#23262E）
- 卡片背景半透明（rgba）
- 阴影加深（opacity 提高）
- 渐变色保持，但降低饱和度

---

## 十、下一步工作

1. **集成到现有页面** - 在 `src/app/mind/page.tsx` 中应用新样式
2. **添加 Framer Motion** - 安装依赖并实现流畅动画
3. **设计插画资源** - 为空状态和引导页面添加插画
4. **用户测试** - 收集反馈并迭代优化

---

**设计师**：UI Designer Agent
**日期**：2026-03-08
**版本**：v1.0
