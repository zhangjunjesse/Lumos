# Lumos Mind 模块 - 视觉设计方案 v2.0

## 🎯 核心理念调整

**从"培养 AI 伙伴" → "做最懂主人的 agent"**

Lumos 的核心是持续了解主人，不断完善主人画像。

---

## 一、新的模块结构

### 视觉层级重新定义

```
┌─────────────────────────────────────┐
│   主人画像（User Profile）⭐        │
│   核心模块 - 50% 视觉权重           │
│   金色渐变 + 发光光环               │
│   展示"了解程度"进度                │
└─────────────────────────────────────┘

┌──────────────────┬──────────────────┐
│ Lumos 人格       │  相处规则        │
│ (AI Persona)     │  (Rules)         │
│ 辅助模块 - 25%   │  辅助模块 - 25%  │
│ 紫蓝渐变         │  灰蓝渐变        │
└──────────────────┴──────────────────┘
```

---

## 二、配色系统（已更新）

### 主人画像 - 金色系 ⭐
```css
--user-profile-from: #FFD700  /* 金色 */
--user-profile-to: #FFA500    /* 橙金色 */
--user-profile-bg: #FFFBEB    /* 淡金背景 */
--user-profile-border: #FDE68A
--user-profile-text: #D97706
--user-profile-glow: rgba(255, 215, 0, 0.4)  /* 金色光晕 */
```

**设计意图**：
- 金色象征"珍贵"，主人是中心
- 发光效果体现"被关注"
- 最高视觉权重

### Lumos 人格 - 紫蓝系
```css
--ai-persona-from: #8B7FFF
--ai-persona-to: #6B9FFF
--ai-persona-bg: #F0F0FF
--ai-persona-text: #6366F1
```

**设计意图**：
- 保持品牌色
- 视觉权重降低（辅助角色）

### 相处规则 - 灰蓝系
```css
--rules-from: #94A3B8
--rules-to: #64748B
--rules-bg: #F8FAFC
--rules-text: #475569
```

**设计意图**：
- 中性色调（规则/边界）
- 最低视觉权重

---

## 三、关键视觉特性

### 1. 主人画像卡片（核心）

**尺寸**：
- 宽度：100%（独占一行）
- 高度：比其他卡片高 1.5 倍

**视觉特效**：
- 3px 金色边框（比其他卡片粗）
- 持续的金色光晕（box-shadow）
- 背景伪元素脉冲动画（3s 循环）
- 悬停时上浮 6px（比其他卡片多 2px）

**独特元素**：
- 完善度进度环（圆形进度条）
- "了解程度"百分比显示
- 最近更新时间标记

### 2. AI 人格卡片（辅助）

**尺寸**：
- 宽度：50%（与规则卡片并排）
- 标准高度

**视觉特效**：
- 2px 紫蓝边框
- 标准悬停效果（上浮 4px）

### 3. 相处规则卡片（辅助）

**尺寸**：
- 宽度：50%
- 标准高度

**视觉特效**：
- 2px 虚线边框（hover 变实线）
- 标准悬停效果

---

## 四、"了解程度"可视化

### 进度环设计

```tsx
<div className="understanding-progress">
  <svg className="progress-ring">
    <circle className="progress-ring-bg" />
    <circle
      className="progress-ring-fill"
      style={{ strokeDashoffset: calculateOffset(75) }}
    />
  </svg>
  <div className="progress-text">
    <span className="percentage">75%</span>
    <span className="label">了解程度</span>
  </div>
</div>
```

**样式特点**：
- 金色渐变描边
- 动画填充效果
- 中心显示百分比

---

## 五、更新的使用示例

```tsx
import { MindCard } from '@/components/mind/mind-card';
import { SectionIcon } from '@/components/mind/section-icon';
import { Crown, Sparkles, BookOpen } from 'lucide-react';

// 主人画像（核心模块）
<MindCard
  variant="user-profile"
  icon={<SectionIcon icon={Crown} variant="user-profile" size={48} />}
  title="主人画像"
  description="Lumos 眼中的你"
  badge={<Badge>了解度 75%</Badge>}
  className="col-span-2"  // 占据两列
>
  <UnderstandingProgress value={75} />
</MindCard>

// AI 人格（辅助模块）
<MindCard
  variant="ai-persona"
  icon={<SectionIcon icon={Sparkles} variant="ai-persona" />}
  title="Lumos 人格"
  description="AI 如何表现"
/>

// 相处规则（辅助模块）
<MindCard
  variant="rules"
  icon={<SectionIcon icon={BookOpen} variant="rules" />}
  title="相处规则"
  description="互动边界"
/>
```

---

## 六、响应式布局

### 桌面端（≥1024px）
```
┌─────────────────────────────────────┐
│   主人画像（100% 宽度）             │
└─────────────────────────────────────┘
┌──────────────────┬──────────────────┐
│ AI 人格 (50%)    │  相处规则 (50%)  │
└──────────────────┴──────────────────┘
```

### 平板端（768px - 1023px）
```
┌─────────────────────────────────────┐
│   主人画像（100% 宽度）             │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   AI 人格（100% 宽度）              │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│   相处规则（100% 宽度）             │
└─────────────────────────────────────┘
```

---

## 七、与旧版本的对比

| 维度 | v1.0（旧） | v2.0（新） |
|------|-----------|-----------|
| 核心理念 | 培养 AI 伙伴 | 让 AI 了解你 |
| 视觉焦点 | 三模块平等 | 主人画像突出 |
| 配色 | 橙/紫/蓝绿 | 金/紫蓝/灰蓝 |
| 布局 | 1:1:1 | 2:1:1 |
| 特殊效果 | 无 | 金色光晕 + 进度环 |

---

## 八、已更新文件

1. **`src/styles/mind-theme.css`** - 配色系统已更新
2. **`src/components/mind/mind-card.tsx`** - 支持新变体
3. **`src/components/mind/section-icon.tsx`** - 支持新变体

---

## 九、待实现功能

1. **进度环组件** - `UnderstandingProgress.tsx`
2. **主人画像详情页** - 展示 Lumos 如何理解主人
3. **持续学习动画** - 当 AI 更新主人画像时的视觉反馈

---

**设计师**：UI Designer Agent
**版本**：v2.0（基于新理念调整）
**日期**：2026-03-08
