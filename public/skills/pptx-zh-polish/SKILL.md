---
name: pptx-zh-polish
description: 'Chinese executive-style PPT iterative polishing. Use when user has an existing .pptx and wants to restyle/rebuild pages with precise control over Chinese typography, colors, and shapes (especially "top-rounded bottom-square" bars). Uses bare python-pptx + OOXML-level edits, not HTML conversion. Best for interactive loop: rebuild one page → render PNG preview → user feedback → iterate.'
---

# pptx-zh-polish — 中文 PPT 精修工作流

## When to use

- 已有 `.pptx`,需要逐页重做/美化,保持原文件结构
- 中文商务风:深灰蓝+点缀色、上圆下直色条、PingFang SC + Helvetica Neue 字体配对
- 需要精确控制:字体 East Asian `<a:ea>`、字间距 `spc`、`round2SameRect` 的 `adj1/adj2`
- 需要跨页一致性(统一改色、统一改形状、统一字阶)
- 环境没有 LibreOffice,只能用 PIL 近似预览

**不适合**:从零生成 20+ 页结构相似的新 PPT(那种用 flex 布局更快)。

## Core workflow

> 所有 `python` 命令统一走 Lumos 内置 venv（`[PYTHON_PATH]` 在同步时解析为 `~/.lumos/python-venv/bin/python3`），不要改用系统 `python`。

### 1. 先看清楚原 PPT

```bash
[PYTHON_PATH] -m markitdown <pptx>                                         # 提取文本
[PYTHON_PATH] ~/.lumos/skills-plugin/skills/pptx-zh-polish/scripts/audit.py <pptx>      # 扫色号/字体/形状
```

审计输出会列出每页用了哪些 `srgbClr` 色号、哪些字体、哪些形状,**基于此决定替换规则**。

### 2. 选主题

从 `presets/` 里选一套复制到工作目录作为 `styles.py`,或直接引用:

```python
import sys
sys.path.insert(0, '<workdir>')  # 项目自己的 styles.py 优先
from styles import *             # 色板/字阶/形状常量
```

可用 presets:
- `slate_sky.py` — 深灰蓝 + 天蓝(科技/安全/金融)
- `burgundy_gold.py` — 酒红 + 金箔(高端/品牌)
- `forest_cream.py` — 森林绿 + 奶油(ESG/健康)

### 3. 两条改页路径

**路径 A:完全重建一页**(布局要大改)

```bash
[PYTHON_PATH] ~/.lumos/skills-plugin/skills/pptx-zh-polish/scripts/scaffold.py <src.pptx> <slide_idx_1based> <workdir>
# 生成 workdir/rebuild_slideN.py,里面已有 clear_slide + add_shape + add_text + set_text
# 编辑 build() 函数写布局,然后:
[PYTHON_PATH] workdir/rebuild_slideN.py <src.pptx> <dst.pptx>
```

**路径 B:在位改色/改形状**(保留布局)

```bash
# 改色 + 把小高度矩形改成上圆下直
[PYTHON_PATH] ~/.lumos/skills-plugin/skills/pptx-zh-polish/scripts/normalize.py <src> <slide_idx> <dst> \
  --colors '[["F59E0B","0EA5E9"],["D97706","0284C7"]]' \
  --top-bars

# 批量把所有圆角矩形改成直角
[PYTHON_PATH] ~/.lumos/skills-plugin/skills/pptx-zh-polish/scripts/convert_shapes.py <src> <dst> \
  --from roundRect,round2SameRect --to rect
```

### 4. 快速预览(PIL 近似渲染)

```bash
[PYTHON_PATH] ~/.lumos/skills-plugin/skills/pptx-zh-polish/scripts/render.py <pptx> <slide_idx_1based> <out.png>
```

渲染支持 `rect` / `roundRect` / `round2SameRect` / `ellipse` + 文本。
**限制**:字间距、East Asian 字体回退、复杂 group 渲染不精确。只作方向性 QA,细节以真 PPT 打开为准。

### 5. 迭代循环

每次用户反馈 → 改 `rebuild_slideN.py` 或重跑 `normalize.py` → 重渲染 → 贴 PNG → 等反馈。
**秒级往返**是这套流程的核心价值,不要省 render 这步。

## 关键约定

### 字体
- 中文:`PingFang SC`;英文:`Helvetica Neue`
- 中英混排必须写 East Asian 属性:`<a:ea typeface="PingFang SC"/>`,见 `set_text()` 里 `rPr` 的处理
- 字间距用 `spc` 属性(单位 1/100 pt,常用 100~400 加强标题)

### 上圆下直色条
- 形状用 `MSO_SHAPE.ROUND_2_SAME_RECTANGLE`(XML prst=`round2SameRect`)
- 必须设 `avLst` 的 `adj1`(顶角半径)和 `adj2=0`(底角直)
- `styles.py` 里 `set_topbar_adj(shape, amount)` 一键搞定

### 卡片对齐规则
- 卡片用圆角矩形(`SHAPE_CARD`),顶色条用上圆下直(`SHAPE_TOPBAR`),两者圆角半径要**目测一致**
- 色条贴卡片上边,宽度等于卡片宽

### 语义色保留
审计时把"功能色"和"装饰色"分开:
- ROSE = 严重/风险,AMBER = 高危,GREEN = 正常 —— 这些别乱换
- 其它装饰色(一页多种蓝/橙/绿的堆叠)统一到主色

## 文件结构

```
pptx-zh-polish/
├── SKILL.md
├── styles.py                 # 默认主题(slate_sky)
├── scripts/
│   ├── scaffold.py           # 生成 rebuild_slideN.py 骨架
│   ├── normalize.py          # 在位改色+改形状
│   ├── render.py             # PIL 预览
│   ├── audit.py              # 色号/字体/形状审计
│   └── convert_shapes.py     # 批量形状转换
└── presets/
    ├── slate_sky.py
    ├── burgundy_gold.py
    └── forest_cream.py
```

## Dependencies

Lumos 内置 venv 已经装好 `python-pptx`、`Pillow`、`lxml`、`markitdown`。如果报缺包,用同一个 venv 补:

```bash
[PYTHON_PATH] -m pip install python-pptx Pillow lxml markitdown
```

macOS 默认有 PingFang.ttc 和 Helvetica.ttc,Linux 需要额外装中文字体(思源黑体等),改 `render.py` 里 `FONT_PATHS`。
